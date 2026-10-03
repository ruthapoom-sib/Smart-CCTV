from dataclasses import dataclass
from pathlib import Path
import json
import os
import shutil
from .contracts import Camera

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    runtime: Path = ROOT / 'runtime/flood'
    catalog_path: Path = ROOT / 'backend/cameras.json'
    admin_token: str = ''
    origins: tuple[str, ...] = ('http://127.0.0.1:8000', 'http://localhost:8000')
    ffmpeg: str = 'ffmpeg'
    model_path: Path = ROOT / 'runtime/flood/models'
    device: str = 'cpu'
    interval: float = 60
    capture_timeout: float = 20
    inference_timeout: float = 120
    fresh_age: float = 180
    observation_days: int = 30
    evidence_days: int = 7

    def __post_init__(self):
        if '*' in self.origins:
            raise ValueError('Explicit origins required')
        if min(self.interval, self.capture_timeout, self.inference_timeout, self.fresh_age, self.observation_days, self.evidence_days) <= 0:
            raise ValueError('Positive durations required')


def load_settings() -> Settings:
    runtime = Path(os.environ.get('FLOOD_RUNTIME', str(ROOT / 'runtime/flood'))).resolve()
    return Settings(runtime=runtime,
        admin_token=os.environ.get('FLOOD_ADMIN_TOKEN', ''),
        origins=tuple(filter(None, os.environ.get('FLOOD_ORIGINS', 'http://127.0.0.1:8000,http://localhost:8000').split(','))),
        ffmpeg=resolve_ffmpeg(),
        model_path=Path(os.environ.get('FLOOD_MODEL_PATH', str(runtime / 'models'))).resolve(),
        device=os.environ.get('FLOOD_DEVICE', 'cpu'),
        interval=float(os.environ.get('FLOOD_INTERVAL', '60')),
        observation_days=int(os.environ.get('FLOOD_OBSERVATION_DAYS', '30')),
        evidence_days=int(os.environ.get('FLOOD_EVIDENCE_DAYS', '7')))

def resolve_ffmpeg():
    configured = os.environ.get('FLOOD_FFMPEG')
    if configured: return configured
    if shutil.which('ffmpeg'): return 'ffmpeg'
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
        return get_ffmpeg_exe()
    except ImportError: return 'ffmpeg'


def load_catalog(path: Path) -> list[Camera]:
    raw = json.loads(path.read_text(encoding='utf-8'))
    cameras = [Camera(**c) for c in raw['cameras']]
    if len({c.id for c in cameras}) != len(cameras):
        raise ValueError('Duplicate camera IDs')
    for cam in cameras:
        if len(cam.id) != 2 or not cam.id.isdigit() or cam.stream_url != f'https://camerai1.iticfoundation.org/hls/ccs{cam.id}.m3u8':
            raise ValueError('Only registered ITIC camera sources allowed')
    return cameras
