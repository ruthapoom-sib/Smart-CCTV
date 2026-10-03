import json
import pytest
from pathlib import Path
from backend.rain.contracts import Camera, RainConfig, RainReading, RainThresholds
from backend.rain.store import RainStore
from backend.rain.evidence import RainEvidenceStore


@pytest.fixture
def catalog():
    return [
        Camera(id='03', name='มุ่งหน้าชลบุรี', stream_url='https://example.com/03.m3u8', groups=[0]),
        Camera(id='05', name='มุ่งหน้าเมืองฉะเชิงเทรา', stream_url='https://example.com/05.m3u8', groups=[0]),
    ]


def test_rain_store_config_revision_and_persistence(tmp_path, catalog):
    db_file = tmp_path / 'rain.sqlite3'
    store = RainStore(db_file, catalog)

    cfg = store.get_config('03')
    assert cfg.revision == 0
    assert not cfg.enabled

    # Save with expected_revision=0
    new_cfg = RainConfig(camera_id='03', roi=[(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)], enabled=True)
    saved = store.save_config(new_cfg, expected_revision=0)
    assert saved.revision == 1
    assert saved.enabled

    # Concurrent save with wrong expected_revision fails
    with pytest.raises(ValueError, match='config_revision_conflict'):
        store.save_config(new_cfg, expected_revision=0)

    # Reopening database preserves saved config
    store.close()
    store2 = RainStore(db_file, catalog)
    assert store2.get_config('03').revision == 1
    store2.close()


def test_rain_store_record_and_event_lifecycle(tmp_path, catalog):
    db_file = tmp_path / 'rain.sqlite3'
    store = RainStore(db_file, catalog)

    roi = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]
    cfg = store.save_config(RainConfig(camera_id='03', roi=roi, enabled=True), expected_revision=0)

    # Record 1: raw dry
    r1 = RainReading(camera_id='03', captured_at=100.0, clip_started_at=98.0, processed_at=100.5,
                     status='dry', raw_status='dry', detector_score=0.01, config_revision=cfg.revision)
    assert store.record(r1, expected_revision=cfg.revision) is True

    # Record 2: rainy event starts
    r2 = RainReading(camera_id='03', captured_at=160.0, clip_started_at=158.0, processed_at=160.5,
                     status='rainy', raw_status='rainy', detector_score=0.75, config_revision=cfg.revision,
                     evidence_id='abc123')
    assert store.record(r2, expected_revision=cfg.revision, first_detected_at=158.0) is True

    events = store.events(['03'], start=0, end=500, now=165.0).items
    assert len(events) == 1
    ev = events[0]
    assert ev.first_detected_at == 158.0
    assert ev.confirmed_at == 160.0
    assert ev.ended_at is None
    assert ev.start_evidence_id == 'abc123'

    # Record 3: rainy continues with higher score
    r3 = RainReading(camera_id='03', captured_at=220.0, clip_started_at=218.0, processed_at=220.5,
                     status='rainy', raw_status='rainy', detector_score=0.92, config_revision=cfg.revision)
    assert store.record(r3, expected_revision=cfg.revision) is True
    events = store.events(['03'], start=0, end=500, now=225.0).items
    assert events[0].peak_score == 0.92

    # Record 4: transition to dry ends the event
    r4 = RainReading(camera_id='03', captured_at=280.0, clip_started_at=278.0, processed_at=280.5,
                     status='dry', raw_status='dry', detector_score=0.02, config_revision=cfg.revision,
                     evidence_id='end456')
    assert store.record(r4, expected_revision=cfg.revision, first_dry_at=278.0) is True

    events = store.events(['03'], start=0, end=500, now=285.0).items
    assert len(events) == 1
    assert events[0].ended_at == 278.0
    assert events[0].end_reason == 'dry'
    assert events[0].end_evidence_id == 'end456'

    store.close()


def test_rain_store_data_gap_ends_event(tmp_path, catalog):
    db_file = tmp_path / 'rain.sqlite3'
    store = RainStore(db_file, catalog)
    roi = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]
    cfg = store.save_config(RainConfig(camera_id='03', roi=roi, enabled=True), expected_revision=0)

    # Rainy event
    r1 = RainReading(camera_id='03', captured_at=100.0, clip_started_at=98.0, processed_at=100.5,
                     status='rainy', raw_status='rainy', detector_score=0.8, config_revision=cfg.revision)
    store.record(r1, expected_revision=cfg.revision, first_detected_at=98.0)

    # Next reading comes after 300 seconds (> 180s gap!)
    r2 = RainReading(camera_id='03', captured_at=400.0, clip_started_at=398.0, processed_at=400.5,
                     status='unknown', raw_status='unknown', reason='data_gap', config_revision=cfg.revision)
    store.record(r2, expected_revision=cfg.revision)

    events = store.events(['03'], start=0, end=600).items
    assert len(events) == 1
    assert events[0].ended_at == 100.0
    assert events[0].end_reason == 'data_gap'

    store.close()
