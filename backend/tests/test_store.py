import importlib
from dataclasses import replace
import pytest


def make_store(tmp_path, catalog):
    assert importlib.util.find_spec('backend.flood.store'), 'Persistent store is missing'
    from backend.flood.store import Store
    return Store(tmp_path / 'test.sqlite', catalog)


def test_persistence_and_revision_race(tmp_path, catalog, reading_factory, config_factory):
    s = make_store(tmp_path, catalog)
    cfg = s.save_config(config_factory(), expected_revision=0)
    assert s.record(reading_factory(config_revision=cfg.revision), expected_revision=cfg.revision)
    s.close()
    s = make_store(tmp_path, catalog)
    assert s.latest(now=1010)[0].water_coverage_pct == 0
    s.save_config(config_factory(), expected_revision=cfg.revision)
    assert not s.record(reading_factory(captured_at=1020), expected_revision=cfg.revision)
    with pytest.raises(ValueError, match='revision'):
        s.save_config(config_factory(), expected_revision=cfg.revision)
    assert s.latest(now=1020)[0].status == 'unknown'
    s.close()


def test_events_gap_and_recovery_are_not_false_clear(tmp_path, catalog, reading_factory, config_factory):
    s = make_store(tmp_path, catalog); s.save_config(config_factory(), 0)
    s.record(reading_factory(status='active', water_coverage_pct=22), 1)
    s.record(reading_factory(captured_at=1060, processed_at=1061, status='unknown', water_coverage_pct=None, reason='capture_timeout'), 1)
    event = s.events(['03'], 900, 1200, 100, None).items[0]
    assert event.end_reason == 'data_gap'
    assert event.peak_pct == 22
    assert s.latest(1062)[0].water_coverage_pct is None
    assert not s.record(reading_factory(captured_at=1020), 1)
    assert len(s.history(['03'], 900, 1200, 1, None).items) == 1
    next_cursor = s.history(['03'], 900, 1200, 1, None).next_cursor
    assert s.history(['03'], 900, 1200, 1, next_cursor).items[0].captured_at == 1000
    s.close()


def test_retention_freshness_and_concurrent_configuration(tmp_path, catalog, reading_factory, config_factory):
    a = make_store(tmp_path, catalog); b = make_store(tmp_path, catalog)
    a.save_config(config_factory(), 0)
    with pytest.raises(ValueError, match='revision'): b.save_config(config_factory(), 0)
    a.record(reading_factory(captured_at=1000, processed_at=999), 1)
    assert a.latest(999)[0].status == 'unknown'
    assert a.prune(now=1000+30*86400+1) == 1
    assert a.history(['03'], 0, 10000, 100, None).items == []
    a.close(); b.close()
