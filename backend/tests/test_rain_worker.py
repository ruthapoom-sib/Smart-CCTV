import threading
import time
import pytest
from backend.rain.contracts import Camera
from backend.rain.worker import RainScheduler, RainWorker
from backend.rain.settings import RainSettings
from backend.rain.store import RainStore


class HungDetector:
    def analyze(self, *args):
        time.sleep(60)


def test_detector_timeout_reaps_child():
    from backend.rain.supervision import DetectorSupervisor, DetectorError
    supervisor = DetectorSupervisor(timeout=.2, detector_factory=HungDetector)
    started = time.monotonic()
    try:
        with pytest.raises(DetectorError, match='detector_timeout'):
            supervisor.analyze([], [], None)
        assert time.monotonic() - started < 5
        assert supervisor.process is None
    finally:
        supervisor.close()


@pytest.fixture
def catalog():
    return [
        Camera(id='03', name='มุ่งหน้าชลบุรี', stream_url='https://example.com/03.m3u8', groups=[0]),
        Camera(id='05', name='มุ่งหน้าเมืองฉะเชิงเทรา', stream_url='https://example.com/05.m3u8', groups=[0]),
    ]


def test_scheduler_monotonic_and_bounds():
    scheduler = RainScheduler(['03', '05'], interval=60.0, capture_limit=2, queue_limit=2)

    # At t=100, both due
    due = scheduler.due(now_monotonic=100.0)
    assert set(due) == {'03', '05'}

    # While in flight, none due
    assert scheduler.due(now_monotonic=101.0) == []

    # One completes
    scheduler.completed('03', now_monotonic=102.0)
    # '03' not due again until 102 + 60 = 162
    assert scheduler.due(now_monotonic=150.0) == []

    # After interval, '03' becomes due again
    due_again = scheduler.due(now_monotonic=163.0)
    assert due_again == ['03']


def test_worker_one_cycle(tmp_path, catalog, monkeypatch):
    import numpy as np
    from backend.rain.capture import RainCapture
    db_file = tmp_path / 'rain.sqlite3'
    ev_dir = tmp_path / 'evidence'
    settings = RainSettings(db_path=db_file, evidence_root=ev_dir)

    store = RainStore(db_file, catalog)
    from backend.rain.contracts import RainConfig
    # Enable camera 03 with valid ROI
    store.save_config(RainConfig('03', roi=[(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)], enabled=True), 0)
    store.close()

    # Mock capture_clip
    def fake_capture(camera, **kwargs):
        # 16 static frames
        frames = [np.full((50, 50, 3), 120, dtype=np.uint8) for _ in range(16)]
        now = time.time()
        return RainCapture(camera.id, frames, clip_started_at=now-2.0, captured_at=now)

    monkeypatch.setattr('backend.rain.worker.capture_clip', fake_capture)

    worker = RainWorker(settings, catalog=catalog)
    worker.run_cycle(now=time.time(), now_mono=100.0)

    # Check store has recorded observation for 03
    s = RainStore(db_file, catalog)
    latest = s.latest(now=time.time())
    cam03 = next(c for c in latest if c.camera_id == '03')
    assert cam03.status in ('dry', 'unknown')
    # Camera 05 unconfigured
    cam05 = next(c for c in latest if c.camera_id == '05')
    assert cam05.status == 'unconfigured'

    # Check health heartbeat exists
    health = s.get_health('worker_heartbeat')
    assert health is not None
    assert health['available'] is True
    s.close()
    worker.close()


def test_disabled_cameras_do_not_delay_enabled_camera(tmp_path, monkeypatch):
    from backend.rain.contracts import RainConfig
    cams = [Camera(str(i).zfill(2), str(i), 'https://example.com/clip', [0]) for i in range(1, 6)]
    settings = RainSettings(db_path=tmp_path/'rain.sqlite3', evidence_root=tmp_path/'evidence')
    worker = RainWorker(settings, catalog=cams)
    worker.store.save_config(RainConfig('01', roi=[(.1,.1),(.9,.1),(.9,.9),(.1,.9)], enabled=True), 0)
    processed = []
    monkeypatch.setattr(worker, 'process_camera', lambda camera: processed.append(camera.id))
    try:
        worker.run_cycle(time.time(), 100)
        assert processed == ['01']
    finally:
        worker.close()


def test_heartbeat_updates_while_waiting_for_next_capture(tmp_path, catalog):
    settings = RainSettings(db_path=tmp_path/'rain.sqlite3', evidence_root=tmp_path/'evidence')
    worker = RainWorker(settings, catalog=catalog)
    try:
        worker.run_cycle(1000, 100)
        worker.run_cycle(1020, 120)
        assert worker.store.get_health('worker_heartbeat')['timestamp'] == 1020
    finally:
        worker.close()
