from dataclasses import dataclass, field
import math
from typing import Literal
import numpy as np
from PIL import Image

Status = Literal['unconfigured', 'clear', 'suspect', 'active', 'unknown']


@dataclass(frozen=True)
class Camera:
    id: str
    name: str
    stream_url: str
    groups: list[int]


@dataclass(frozen=True)
class Thresholds:
    pixel_score: float = .50
    suspect_pct: float = 5.0
    active_pct: float = 15.0
    confirmations: int = 3

    def __post_init__(self):
        if not all(math.isfinite(x) for x in [self.pixel_score, self.suspect_pct, self.active_pct]):
            raise ValueError('Thresholds must be finite')
        if not 0 < self.pixel_score <= 1 or not 0 < self.suspect_pct < self.active_pct <= 100:
            raise ValueError('Invalid threshold ordering')
        if isinstance(self.confirmations, bool) or not isinstance(self.confirmations, int) or not 1 <= self.confirmations <= 20:
            raise ValueError('Invalid confirmations')


@dataclass(frozen=True)
class CameraConfig:
    camera_id: str
    roi: list[tuple[float, float]] | None = None
    thresholds: Thresholds = field(default_factory=Thresholds)
    revision: int = 0
    enabled: bool = False


@dataclass(frozen=True)
class Capture:
    camera_id: str
    image: Image.Image
    captured_at: float
    source_at: float | None = None
    media_sequence: int | None = None


@dataclass(frozen=True)
class Prediction:
    water_mask: np.ndarray
    water_prob: np.ndarray
    model_id: str
    model_revision: str


@dataclass(frozen=True)
class Reading:
    camera_id: str
    captured_at: float
    processed_at: float
    source_at: float | None = None
    status: Status = 'unknown'
    reason: str | None = None
    water_coverage_pct: float | None = None
    model_score: float | None = None
    model_id: str | None = None
    model_revision: str | None = None
    config_revision: int = 0
    evidence_id: str | None = None


@dataclass(frozen=True)
class Sequence:
    status: Status = 'unknown'
    high_count: int = 0
    low_count: int = 0
    last_captured_at: float | None = None
    config_revision: int = 0
    model_revision: str | None = None


@dataclass(frozen=True)
class Event:
    id: str
    camera_id: str
    started_at: float
    ended_at: float | None = None
    end_reason: str | None = None
    peak_pct: float = 0
    start_evidence_id: str | None = None
    end_evidence_id: str | None = None


@dataclass(frozen=True)
class Page:
    items: list
    next_cursor: str | None = None
