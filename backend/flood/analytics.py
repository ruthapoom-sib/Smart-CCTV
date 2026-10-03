from dataclasses import dataclass
from bisect import bisect_left
from .classification import effective

@dataclass(frozen=True)
class Bucket:
    start: float
    end: float
    valid_count: int
    unknown_count: int
    monitored_count: int
    active_count: int
    suspect_count: int
    water_mean_pct: float | None
    water_max_pct: float | None

def bucket_readings(readings, ids, start, end, bucket_seconds, fresh_age=180):
    ids = set(ids); rows = sorted((r for r in readings if r.camera_id in ids), key=lambda r:r.captured_at)
    output = []; last = {}; index = 0; at = start
    timestamps = [r.captured_at for r in rows]
    while at < end:
        until = min(at+bucket_seconds, end)
        while index < len(rows) and rows[index].captured_at <= until:
            r = rows[index]; last[r.camera_id] = r
            index += 1
        values = [r.water_coverage_pct for r in rows[bisect_left(timestamps,at):bisect_left(timestamps,until)]
                  if effective(r,r.processed_at).status in ('clear','suspect','active')]
        statuses = [effective(last[i], until, fresh_age).status if i in last else 'unknown' for i in ids]
        valid = sum(s in ('clear','suspect','active') for s in statuses)
        output.append(Bucket(at, until, valid, len(ids)-valid, len(ids), statuses.count('active'), statuses.count('suspect'),
            sum(values)/len(values) if values else None, max(values) if values else None))
        at = until
    return output
