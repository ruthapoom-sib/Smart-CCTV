from dataclasses import replace
import math
import numpy as np
from .contracts import Reading, Sequence
from .geometry import roi_mask


def measure(prediction, config):
    if not config.roi or not config.enabled: raise ValueError('unconfigured')
    mask, prob = np.asarray(prediction.water_mask), np.asarray(prediction.water_prob)
    if mask.ndim != 2 or mask.shape != prob.shape or not np.isfinite(prob).all() or (prob < 0).any() or (prob > 1).any():
        raise ValueError('invalid_prediction')
    roi = roi_mask(config.roi, mask.shape[1], mask.shape[0])
    water = mask.astype(bool) & (prob >= config.thresholds.pixel_score) & roi
    return float(water.sum()/roi.sum()*100), float(prob[roi].mean())


def effective(reading: Reading, now: float, max_age=180) -> Reading:
    if reading.status == 'unconfigured': return reading
    age = now - reading.captured_at
    valid = reading.water_coverage_pct is not None and math.isfinite(reading.water_coverage_pct) and 0 <= reading.water_coverage_pct <= 100
    if not math.isfinite(age) or not 0 <= age <= max_age:
        return replace(reading, status='unknown', reason='stale' if age > max_age else 'invalid_timestamp', water_coverage_pct=None, model_score=None)
    if reading.status not in ('clear', 'suspect', 'active') or not valid:
        return replace(reading, status='unknown', reason=reading.reason or 'invalid_result', water_coverage_pct=None, model_score=None)
    return reading


def advance(sequence, reading, thresholds):
    at = reading.captured_at
    metadata = dict(last_captured_at=at, config_revision=reading.config_revision, model_revision=reading.model_revision)
    if reading.status in ('unknown', 'unconfigured') or reading.water_coverage_pct is None or not math.isfinite(reading.water_coverage_pct):
        return Sequence(status=reading.status if reading.status == 'unconfigured' else 'unknown', **metadata)
    if sequence.last_captured_at is not None and (not 0 < at-sequence.last_captured_at <= 180 or sequence.config_revision != reading.config_revision or sequence.model_revision != reading.model_revision):
        sequence = Sequence()
    value = reading.water_coverage_pct
    high = sequence.high_count+1 if value >= thresholds.active_pct else 0
    low = sequence.low_count+1 if value < thresholds.suspect_pct else 0
    if sequence.status == 'active' and low < thresholds.confirmations: status = 'active'
    elif high >= thresholds.confirmations: status = 'active'
    elif value >= thresholds.suspect_pct: status = 'suspect'
    else: status = 'clear'
    return Sequence(status=status, high_count=high, low_count=low, **metadata)
