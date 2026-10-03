import json
import os
from pathlib import Path
from dataclasses import dataclass, field
from .contracts import Camera


@dataclass(frozen=True)
class RainSettings:
    db_path: Path = Path('runtime/rain/rain.sqlite3')
    evidence_root: Path = Path('runtime/rain/evidence')
    catalog_path: Path = Path('backend/cameras.json')
    target_interval_seconds: float = 60.0
    fresh_age_seconds: float = 180.0
    observation_days: int = 30
    evidence_days: int = 7
    capture_timeout_seconds: float = 20.0
    detector_timeout_seconds: float = 10.0
    capture_concurrency: int = 2
    detector_concurrency: int = 1
    max_queue_depth: int = 2
    ffmpeg_path: str = 'ffmpeg'
    admin_token: str | None = None
    api_host: str = '127.0.0.1'
    api_port: int = 8100
    cors_origins: list[str] = field(default_factory=lambda: [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:8080',
        'http://127.0.0.1:8080',
    ])


def load_settings() -> RainSettings:
    db_env = os.getenv('RAIN_DB_PATH')
    ev_env = os.getenv('RAIN_EVIDENCE_ROOT')
    token = os.getenv('RAIN_ADMIN_TOKEN') or os.getenv('FLOOD_ADMIN_TOKEN')
    origins_env = os.getenv('RAIN_CORS_ORIGINS') or os.getenv('FLOOD_CORS_ORIGINS')
    origins = [o.strip() for o in origins_env.split(',') if o.strip()] if origins_env else [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:8080',
        'http://127.0.0.1:8080',
    ]
    return RainSettings(
        db_path=Path(db_env) if db_env else Path('runtime/rain/rain.sqlite3'),
        evidence_root=Path(ev_env) if ev_env else Path('runtime/rain/evidence'),
        admin_token=token,
        cors_origins=origins,
    )


def load_catalog(path: Path) -> list[Camera]:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    items = data.get('cameras', data) if isinstance(data, dict) else data
    return [
        Camera(
            id=str(c['id']).zfill(2),
            name=c['name'],
            stream_url=c['stream_url'],
            groups=list(c.get('groups', [])),
        )
        for c in items
    ]
