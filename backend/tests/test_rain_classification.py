import pytest
from backend.rain.contracts import RainThresholds, RawClassification, RainReading, RainSequence
from backend.rain.classification import advance, effective


def test_rain_confirmation_three_readings():
    seq = RainSequence()
    thresholds = RainThresholds(confirmations=3)

    # 1st rainy reading -> confirming_rain, status unknown
    raw1 = RawClassification(raw_status='rainy', score=0.6)
    seq, r1 = advance(seq, raw1, captured_at=100.0, clip_started_at=98.0, processed_at=100.5,
                      camera_id='03', config_revision=1, detector_revision='v1', thresholds=thresholds)
    assert r1.status == 'unknown'
    assert r1.reason == 'confirming_rain'
    assert seq.high_count == 1

    # 2nd rainy reading -> confirming_rain, status unknown
    raw2 = RawClassification(raw_status='rainy', score=0.7)
    seq, r2 = advance(seq, raw2, captured_at=160.0, clip_started_at=158.0, processed_at=160.5,
                      camera_id='03', config_revision=1, detector_revision='v1', thresholds=thresholds)
    assert r2.status == 'unknown'
    assert r2.reason == 'confirming_rain'
    assert seq.high_count == 2

    # 3rd rainy reading -> confirmed rainy!
    raw3 = RawClassification(raw_status='rainy', score=0.8)
    seq, r3 = advance(seq, raw3, captured_at=220.0, clip_started_at=218.0, processed_at=220.5,
                      camera_id='03', config_revision=1, detector_revision='v1', thresholds=thresholds)
    assert r3.status == 'rainy'
    assert r3.reason is None
    assert seq.status == 'rainy'
    assert seq.high_count == 3


def test_hysteresis_and_dry_confirmation():
    # Start with already confirmed rainy
    seq = RainSequence(status='rainy', high_count=3, low_count=0, last_captured_at=220.0,
                       config_revision=1, detector_revision='v1')
    thresholds = RainThresholds(confirmations=3)

    # 1st dry reading while rainy -> retains rainy (hysteresis), reason confirming_dry
    raw1 = RawClassification(raw_status='dry', score=0.05)
    seq, r1 = advance(seq, raw1, captured_at=280.0, clip_started_at=278.0, processed_at=280.5,
                      camera_id='03', config_revision=1, detector_revision='v1', thresholds=thresholds)
    assert r1.status == 'rainy'
    assert r1.reason == 'confirming_dry'
    assert seq.low_count == 1

    # 2nd dry reading -> still rainy
    raw2 = RawClassification(raw_status='dry', score=0.02)
    seq, r2 = advance(seq, raw2, captured_at=340.0, clip_started_at=338.0, processed_at=340.5,
                      camera_id='03', config_revision=1, detector_revision='v1', thresholds=thresholds)
    assert r2.status == 'rainy'
    assert r2.reason == 'confirming_dry'
    assert seq.low_count == 2

    # 3rd dry reading -> confirmed dry!
    raw3 = RawClassification(raw_status='dry', score=0.01)
    seq, r3 = advance(seq, raw3, captured_at=400.0, clip_started_at=398.0, processed_at=400.5,
                      camera_id='03', config_revision=1, detector_revision='v1', thresholds=thresholds)
    assert r3.status == 'dry'
    assert r3.reason is None
    assert seq.status == 'dry'
    assert seq.low_count == 3


def test_gap_and_revision_resets_sequence():
    seq = RainSequence(status='rainy', high_count=3, low_count=0, last_captured_at=100.0,
                       config_revision=1, detector_revision='v1')
    thresholds = RainThresholds(confirmations=3)

    # Gap > 180s (at=300, diff=200 > 180) -> sequence resets
    raw = RawClassification(raw_status='rainy', score=0.6)
    seq, r = advance(seq, raw, captured_at=300.0, clip_started_at=298.0, processed_at=300.5,
                     camera_id='03', config_revision=1, detector_revision='v1', thresholds=thresholds)
    # Since sequence reset, this is 1st rainy reading
    assert r.status == 'unknown'
    assert r.reason == 'confirming_rain'
    assert seq.high_count == 1

    # Now change revision -> resets again
    seq, r2 = advance(seq, raw, captured_at=350.0, clip_started_at=348.0, processed_at=350.5,
                      camera_id='03', config_revision=2, detector_revision='v1', thresholds=thresholds)
    assert r2.status == 'unknown'
    assert seq.high_count == 1
    assert seq.config_revision == 2


def test_effective_freshness():
    r = RainReading(
        camera_id='03',
        captured_at=1000.0,
        clip_started_at=998.0,
        processed_at=1000.5,
        status='rainy',
        detector_score=0.75,
    )
    # Fresh within 180s
    eff = effective(r, now=1100.0, max_age=180.0)
    assert eff.status == 'rainy'
    assert eff.detector_score == 0.75

    # Stale > 180s
    stale = effective(r, now=1200.0, max_age=180.0)
    assert stale.status == 'unknown'
    assert stale.reason == 'stale'
    assert stale.detector_score is None

    # Future timestamp (now < captured_at)
    future = effective(r, now=990.0, max_age=180.0)
    assert future.status == 'unknown'
    assert future.reason == 'invalid_timestamp'


def test_custom_freshness_resets_confirmation():
    seq = RainSequence(status='rainy',high_count=3,last_captured_at=100,config_revision=1,detector_revision='v1')
    seq, reading = advance(seq,RawClassification('rainy',score=.8),191,189,192,'03',1,'v1',
        RainThresholds(),max_age=90)
    assert seq.high_count == 1
    assert reading.status == 'unknown' and reading.reason == 'confirming_rain'
