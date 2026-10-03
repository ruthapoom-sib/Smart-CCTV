from dataclasses import replace
import importlib
import numpy as np
import pytest


def modules():
    assert importlib.util.find_spec('backend.flood'), 'Flood analysis package is missing'
    from backend.flood.contracts import CameraConfig, Thresholds, Reading, Sequence, Prediction
    from backend.flood.classification import advance, effective, measure
    from backend.flood.geometry import validate_roi, roi_mask
    return locals()


def feed(values, gaps=None, revisions=None):
    m = modules()
    seq = m['Sequence']()
    at = 1000.0
    for i, value in enumerate(values):
        at += (gaps or [60] * len(values))[i]
        reading = m['Reading']('03', at, at, status='unknown' if value is None else 'clear',
                               water_coverage_pct=value, config_revision=(revisions or [1] * len(values))[i],
                               model_revision='trained')
        seq = m['advance'](seq, reading, m['Thresholds']())
    return seq


@pytest.mark.parametrize('values,want', [([0], 'clear'), ([5], 'suspect'), ([14.99], 'suspect'),
    ([15, 15], 'suspect'), ([15, 15, 15], 'active'), ([15, 15, 15, 4, 4], 'active'),
    ([15, 15, 15, 4, 4, 4], 'clear'), ([15, None, 15, 15], 'suspect')])
def test_confirmation_and_hysteresis(values, want):
    assert feed(values).status == want


def test_gap_and_revision_reset_confirmation():
    assert feed([15, 15, 15], gaps=[60, 60, 181]).status == 'suspect'
    assert feed([15, 15, 15], gaps=[60, 60, 180]).status == 'active'
    assert feed([15, 15, 15], revisions=[1, 1, 2]).status == 'suspect'


def test_freshness_and_missing_values_are_never_clear():
    m = modules()
    r = m['Reading']('03', 1000, 1000, status='clear', water_coverage_pct=0)
    assert m['effective'](r, 1180).status == 'clear'
    assert m['effective'](r, 1181).water_coverage_pct is None
    assert m['effective'](r, 999).status == 'unknown'
    assert m['effective'](replace(r, water_coverage_pct=None), 1001).status == 'unknown'


def test_polygon_validation_and_mask_measurement():
    m = modules()
    for points in [[(0, 0), (1, 1), (1, 0), (0, 1)], [(0, 0), (0, 0), (1, 1)],
                   [(0, 0), (1.1, 0), (1, 1)], [(float('nan'), 0), (1, 0), (1, 1)]]:
        with pytest.raises(ValueError):
            m['validate_roi'](points)
    roi = [(0, 0), (1, 0), (1, 1), (0, 1)]
    assert m['roi_mask'](roi, 10, 10).sum() == 100
    mask = np.zeros((10, 10), dtype=bool); mask[:2] = True
    p = m['Prediction'](mask, np.full((10, 10), .6), 'real-model', 'revision')
    cfg = m['CameraConfig']('03', roi=roi, revision=1, enabled=True)
    assert m['measure'](p, cfg) == pytest.approx((20, .6))
    with pytest.raises(ValueError):
        m['measure'](p, replace(cfg, roi=None))
    with pytest.raises(ValueError):
        m['measure'](replace(p, water_prob=np.full((10, 10), np.nan)), cfg)
