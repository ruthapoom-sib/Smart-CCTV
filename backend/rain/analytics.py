from dataclasses import dataclass
from bisect import bisect_left
from .classification import effective
from .contracts import RainReading


@dataclass(frozen=True)
class RainBucket:
    start: float
    end: float
    valid_count: int
    unknown_count: int
    monitored_count: int
    rainy_count: int
    dry_count: int
    mean_score: float | None
    max_score: float | None


def bucket_rain_readings(
    readings: list[RainReading],
    ids: list[str],
    start: float,
    end: float,
    bucket_seconds: float,
    fresh_age: float = 180.0,
) -> list[RainBucket]:
    unique_ids = set(ids)
    rows = sorted((r for r in readings if r.camera_id in unique_ids), key=lambda r: r.captured_at)
    output = []
    last = {}
    index = 0
    at = start
    timestamps = [r.captured_at for r in rows]

    while at < end:
        until = min(at + bucket_seconds, end)
        while index < len(rows) and rows[index].captured_at <= until:
            r = rows[index]
            last[r.camera_id] = r
            index += 1

        # Scores strictly inside [at, until)
        window_rows = rows[bisect_left(timestamps, at):bisect_left(timestamps, until)]
        scores = [
            r.detector_score for r in window_rows
            if r.detector_score is not None and effective(r, r.processed_at, fresh_age).status in ('dry', 'rainy')
        ]

        # Statuses evaluated at bucket end 'until'
        statuses = [
            effective(last[i], until, fresh_age).status if i in last else 'unknown'
            for i in unique_ids
        ]
        rainy = statuses.count('rainy')
        dry = statuses.count('dry')
        valid = rainy + dry
        unknown = len(unique_ids) - valid

        output.append(RainBucket(
            start=at,
            end=until,
            valid_count=valid,
            unknown_count=unknown,
            monitored_count=len(unique_ids),
            rainy_count=rainy,
            dry_count=dry,
            mean_score=float(sum(scores) / len(scores)) if scores else None,
            max_score=float(max(scores)) if scores else None,
        ))
        at = until

    return output
