import threading
import multiprocessing as mp
import time
import pytest
from backend.flood.worker import Scheduler, analyze, InferenceSupervisor
from backend.flood.capture import CaptureError
from backend.flood.contracts import Sequence

def hang(connection):
    connection.recv(); time.sleep(30)

def hang_before_read(connection):
    time.sleep(30)

def test_inference_deadline_includes_model_loading_and_large_input_send(tmp_path):
    from backend.flood.contracts import Capture
    from PIL import Image
    supervisor=InferenceSupervisor(tmp_path,timeout=.1)
    ctx=mp.get_context('spawn');parent,child=ctx.Pipe()
    process=ctx.Process(target=hang_before_read,args=(child,));process.start();child.close()
    supervisor.connection=parent;supervisor.process=process
    errors=[]
    def predict():
        try:supervisor.predict(Capture('03',Image.new('RGB',(1280,720)),100),.5)
        except Exception as error:errors.append(str(error))
    thread=threading.Thread(target=predict,daemon=True);thread.start()
    try:
        thread.join(1)
        assert not thread.is_alive(), 'Timeout must cover blocked input send during model initialization'
        assert errors==['inference_timeout']
    finally:
        supervisor.close();thread.join(5)

def test_hung_inference_is_terminated_and_reaped(tmp_path):
    from backend.flood.contracts import Capture
    from backend.flood.model import ModelError
    from PIL import Image
    supervisor=InferenceSupervisor(tmp_path, timeout=.1)
    ctx=mp.get_context('spawn'); parent, child=ctx.Pipe()
    process=ctx.Process(target=hang,args=(child,)); process.start(); child.close()
    supervisor.connection=parent; supervisor.process=process
    with pytest.raises(ModelError,match='inference_timeout'):
        supervisor.predict(Capture('03',Image.new('RGB',(20,20)),100),.5)
    assert not process.is_alive() and supervisor.process is None

def test_bounded_fair_unique_schedule_without_catchup():
    scheduler = Scheduler(['03','03','05','13'], interval=60, capture_limit=2, queue_limit=4)
    assert scheduler.due(100) == ['03','05']
    assert scheduler.due(101) == []
    scheduler.completed('03', 200)
    assert scheduler.due(200) == ['13']
    scheduler.completed('05', 200); scheduler.completed('13', 200)
    assert scheduler.due(201) == []
    assert scheduler.due(260) == ['03','05']

def test_capture_failure_is_unknown_and_resets_sequence(monkeypatch, catalog, config_factory):
    def fail(*args, **kwargs): raise CaptureError('capture_timeout')
    monkeypatch.setattr('backend.flood.worker.capture_frame', fail)
    reading, sequence, frame, prediction = analyze(catalog[0], config_factory(revision=1), Sequence(status='active'), None, 'ffmpeg')
    assert reading.status == 'unknown' and reading.reason == 'capture_timeout'
    assert reading.water_coverage_pct is None and sequence.high_count == 0


@pytest.mark.parametrize('failure_kind', ['capture', 'quality', 'inference'])
def test_source_failure_and_inference_failure_have_separate_model_health(tmp_path, monkeypatch, catalog, config_factory, failure_kind):
    import numpy as np
    from PIL import Image
    from backend.flood.contracts import Capture, Prediction
    from backend.flood.worker import run_worker
    from backend.flood.settings import Settings
    from backend.flood.store import Store
    from backend.flood.model import ModelError
    monkeypatch.setattr('backend.flood.worker.load_catalog', lambda path: catalog)
    store = Store(tmp_path/'flood.sqlite3', catalog)
    for camera in catalog:
        store.save_config(config_factory(camera.id), 0)
    store.close()
    def capture(camera, *args):
        if camera.id == '13':
            time.sleep(0.1)
            if failure_kind == 'capture':
                raise CaptureError('capture_failed')
        return Capture(camera.id, Image.new('RGB',(20,20)), time.time())
    class Model:
        def __init__(self, *args): pass
        def predict(self, frame, threshold):
            if frame.camera_id == '13' and failure_kind in ('quality', 'inference'):
                raise ModelError('image_quality' if failure_kind == 'quality' else 'model_unavailable')
            return Prediction(np.zeros((20,20),bool),np.zeros((20,20)), 'test-model', 'test-revision')
        def close(self): pass
    monkeypatch.setattr('backend.flood.worker.capture_frame', capture)
    monkeypatch.setattr('backend.flood.worker.InferenceSupervisor', Model)
    run_worker(Settings(runtime=tmp_path), threading.Event(), once=True)
    store = Store(tmp_path/'flood.sqlite3', catalog)
    try:
        expected_reason = {'capture':'capture_failed', 'quality':'image_quality', 'inference':'model_unavailable'}[failure_kind]
        if failure_kind in ('capture', 'quality'):
            assert store.get_health('analysis')['model_revision'] == 'test-revision'
            assert store.get_health('analysis')['reason'] is None
        else:
            assert store.get_health('analysis')['model_revision'] is None
            assert store.get_health('analysis')['reason'] == expected_reason
        offline = next(r for r in store.latest(time.time()) if r.camera_id == '13')
        assert offline.status == 'unknown' and offline.reason == expected_reason
    finally:
        store.close()

def test_retention_runs_when_all_cameras_disabled(tmp_path,reading_factory):
    from backend.flood.worker import run_worker
    from backend.flood.settings import Settings,load_catalog
    from backend.flood.store import Store
    settings=Settings(runtime=tmp_path)
    store=Store(tmp_path/'flood.sqlite3',load_catalog(settings.catalog_path))
    at=time.time()-31*86400
    # Default config revision is zero; seed an expired observation directly through its contract.
    from dataclasses import replace
    store.record(replace(reading_factory(captured_at=at+2,processed_at=at+3),config_revision=0),0)
    store.close();run_worker(settings,threading.Event(),once=True)
    store=Store(tmp_path/'flood.sqlite3',load_catalog(settings.catalog_path))
    assert store.history(['03'],at-1,at+10).items==[]
    store.close()

def test_supervisor_closes_and_missing_model_is_bounded(tmp_path):
    supervisor = InferenceSupervisor(tmp_path/'missing', 'cpu', timeout=10)
    from backend.flood.contracts import Capture
    from backend.flood.model import ModelError
    from PIL import Image
    try:
        with pytest.raises(ModelError, match='model_unavailable'):
            supervisor.predict(Capture('03', Image.new('RGB', (20,20)), 100), .5)
    finally: supervisor.close()
    assert supervisor.process is None
