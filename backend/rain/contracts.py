from dataclasses import dataclass, field
import math
from typing import Literal

RainStatus = Literal['unconfigured', 'unknown', 'dry', 'rainy']


@dataclass(frozen=True)
class Camera:
    id: str
    name: str
    stream_url: str
    groups: list[int]


@dataclass(frozen=True)
class RainThresholds:
    min_intensity_diff: float = 8.0
    min_streak_aspect: float = 1.8
    min_streaks: int = 4
    min_frame_ratio: float = 0.35
    confirmations: int = 3

    def __post_init__(self):
        if not all(math.isfinite(x) for x in [self.min_intensity_diff, self.min_streak_aspect, self.min_frame_ratio]):
            raise ValueError('Thresholds must be finite')
        if self.min_intensity_diff <= 0 or self.min_streak_aspect <= 1.0 or not 0 < self.min_frame_ratio <= 1.0:
            raise ValueError('Invalid threshold ordering')
        if isinstance(self.confirmations, bool) or not isinstance(self.confirmations, int) or not 1 <= self.confirmations <= 20:
            raise ValueError('Invalid confirmations')
        if self.min_streaks < 1 or self.min_streaks > 500:
            raise ValueError('Invalid min_streaks')


@dataclass(frozen=True)
class RainConfig:
    camera_id: str
    roi: list[tuple[float, float]] | None = None
    thresholds: RainThresholds = field(default_factory=RainThresholds)
    revision: int = 0
    detector_revision: str = 'v1'
    enabled: bool = False
    validated_at: float | None = None
    validation_id: str | None = None


@dataclass(frozen=True)
class StreakDiagnostics:
    candidate_streaks: int = 0
    active_frames: int = 0
    total_frames: int = 0
    mean_aspect: float = 0.0
    mean_streak_diff: float = 0.0


@dataclass(frozen=True)
class RawClassification:
    raw_status: Literal['rainy', 'dry', 'unknown']
    score: float | None = None
    reason: str | None = None
    diagnostics: dict = field(default_factory=dict)


@dataclass(frozen=True)
class RainReading:
    camera_id: str
    captured_at: float
    clip_started_at: float
    processed_at: float
    source_at: float | None = None
    status: RainStatus = 'unknown'
    raw_status: Literal['rainy', 'dry', 'unknown'] | None = None
    reason: str | None = None
    detector_score: float | None = None
    diagnostics: dict = field(default_factory=dict)
    config_revision: int = 0
    detector_revision: str = 'v1'
    evidence_id: str | None = None


@dataclass(frozen=True)
class RainSequence:
    status: RainStatus = 'unknown'
    high_count: int = 0
    low_count: int = 0
    last_captured_at: float | None = None
    config_revision: int = 0
    detector_revision: str | None = None
    first_rain_at: float | None = None
    first_dry_at: float | None = None


@dataclass(frozen=True)
class RainEvent:
    id: str
    camera_id: str
    first_detected_at: float
    confirmed_at: float
    ended_at: float | None = None
    end_reason: str | None = None
    peak_score: float = 0.0
    start_evidence_id: str | None = None
    end_evidence_id: str | None = None


@dataclass(frozen=True)
class RainPage:
    items: list
    next_cursor: str | None = None
