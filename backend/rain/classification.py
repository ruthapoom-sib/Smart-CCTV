from dataclasses import replace
import math
from .contracts import RainReading, RainSequence, RawClassification, RainThresholds


def effective(reading: RainReading, now: float, max_age: float = 180.0) -> RainReading:
    if reading.status == 'unconfigured':
        return reading
    age = now - reading.captured_at
    if not math.isfinite(age) or age < 0 or age > max_age:
        return replace(
            reading,
            status='unknown',
            reason='stale' if age > max_age else 'invalid_timestamp',
            detector_score=None,
        )
    if reading.status not in ('dry', 'rainy'):
        return replace(
            reading,
            status='unknown',
            reason=reading.reason or 'unconfirmed',
            detector_score=None,
        )
    return reading


def advance(
    sequence: RainSequence,
    raw: RawClassification,
    captured_at: float,
    clip_started_at: float,
    processed_at: float,
    camera_id: str,
    config_revision: int,
    detector_revision: str,
    thresholds: RainThresholds,
    source_at: float | None = None,
    evidence_id: str | None = None,
) -> tuple[RainSequence, RainReading]:
    # Check if sequence must be reset due to gap or revision mismatch
    if sequence.last_captured_at is not None:
        gap = captured_at - sequence.last_captured_at
        if gap <= 0 or gap > 180.0 or sequence.config_revision != config_revision or sequence.detector_revision != detector_revision:
            sequence = RainSequence()

    if raw.raw_status == 'unknown':
        new_seq = RainSequence(
            status='unknown',
            high_count=0,
            low_count=0,
            last_captured_at=captured_at,
            config_revision=config_revision,
            detector_revision=detector_revision,
            first_rain_at=None,
            first_dry_at=None,
        )
        reading = RainReading(
            camera_id=camera_id,
            captured_at=captured_at,
            clip_started_at=clip_started_at,
            processed_at=processed_at,
            source_at=source_at,
            status='unknown',
            raw_status='unknown',
            reason=raw.reason or 'detection_failed',
            detector_score=raw.score,
            diagnostics=raw.diagnostics,
            config_revision=config_revision,
            detector_revision=detector_revision,
            evidence_id=evidence_id,
        )
        return new_seq, reading

    if raw.raw_status == 'rainy':
        high_count = sequence.high_count + 1
        low_count = 0
        first_rain = sequence.first_rain_at or clip_started_at
        first_dry = None

        if high_count >= thresholds.confirmations:
            status = 'rainy'
            reason = None
        else:
            if sequence.status == 'rainy':
                status = 'rainy'
                reason = None
            else:
                status = 'unknown'
                reason = 'confirming_rain'

        new_seq = RainSequence(
            status=status,
            high_count=high_count,
            low_count=low_count,
            last_captured_at=captured_at,
            config_revision=config_revision,
            detector_revision=detector_revision,
            first_rain_at=first_rain,
            first_dry_at=first_dry,
        )
        reading = RainReading(
            camera_id=camera_id,
            captured_at=captured_at,
            clip_started_at=clip_started_at,
            processed_at=processed_at,
            source_at=source_at,
            status=status,
            raw_status='rainy',
            reason=reason,
            detector_score=raw.score,
            diagnostics=raw.diagnostics,
            config_revision=config_revision,
            detector_revision=detector_revision,
            evidence_id=evidence_id,
        )
        return new_seq, reading

    # raw.raw_status == 'dry'
    low_count = sequence.low_count + 1
    high_count = 0
    first_dry = sequence.first_dry_at or clip_started_at
    first_rain = None

    if low_count >= thresholds.confirmations:
        status = 'dry'
        reason = None
    else:
        # Hysteresis: retain previous confirmed status while confirming dry
        if sequence.status == 'rainy':
            status = 'rainy'
            reason = 'confirming_dry'
        elif sequence.status == 'dry':
            status = 'dry'
            reason = None
        else:
            status = 'unknown'
            reason = 'confirming_dry'

    new_seq = RainSequence(
        status=status,
        high_count=high_count,
        low_count=low_count,
        last_captured_at=captured_at,
        config_revision=config_revision,
        detector_revision=detector_revision,
        first_rain_at=first_rain,
        first_dry_at=first_dry,
    )
    reading = RainReading(
        camera_id=camera_id,
        captured_at=captured_at,
        clip_started_at=clip_started_at,
        processed_at=processed_at,
        source_at=source_at,
        status=status,
        raw_status='dry',
        reason=reason,
        detector_score=raw.score,
        diagnostics=raw.diagnostics,
        config_revision=config_revision,
        detector_revision=detector_revision,
        evidence_id=evidence_id,
    )
    return new_seq, reading
