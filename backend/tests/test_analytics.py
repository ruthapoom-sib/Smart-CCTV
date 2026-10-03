from backend.flood.analytics import bucket_readings

def test_active_before_range_expires(reading_factory):
    r = reading_factory(captured_at=990, status='active')
    b = bucket_readings([r], ['03','03'], 1000, 1300, 60)
    assert b[0].active_count == 1 and b[0].monitored_count == 1
    assert b[-1].active_count == 0 and b[-1].unknown_count == 1
    assert all(x.water_mean_pct is None for x in b)

def test_half_open_metrics_end_status_no_future_and_unknown(reading_factory):
    rows = [reading_factory(captured_at=1060, processed_at=1061, water_coverage_pct=10),
            reading_factory(captured_at=1090, processed_at=1091, status='unknown', water_coverage_pct=None)]
    b = bucket_readings(rows, ['03'], 1000, 1120, 60)
    assert b[0].valid_count == 1 and b[0].water_mean_pct is None
    assert b[1].unknown_count == 1 and b[1].water_mean_pct == 10
