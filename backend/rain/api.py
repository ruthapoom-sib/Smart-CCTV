from contextlib import asynccontextmanager
from dataclasses import asdict
import hmac
import math
import re
import shutil
import threading
import time
from fastapi import APIRouter, FastAPI, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from .analytics import bucket_rain_readings
from .capture import capture_clip, CaptureError
from .contracts import RainConfig, RainThresholds, Camera
from .evidence import RainEvidenceStore
from .settings import RainSettings, load_settings, load_catalog
from .store import RainStore


class RainConfigInput(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    expected_revision: int = Field(ge=0)
    enabled: bool = False
    roi: list[tuple[float, float]] | None = None
    thresholds: dict = Field(default_factory=dict)


def create_rain_router(
    settings: RainSettings,
    store: RainStore,
    evidence: RainEvidenceStore,
    catalog: list[Camera],
) -> APIRouter:
    router = APIRouter(prefix='/api/rain')
    by_id = {c.id: c for c in catalog}
    snapshots = settings.db_path.parent / 'snapshots'
    snapshots.mkdir(parents=True, exist_ok=True)
    capture_slots = threading.BoundedSemaphore(2)

    def known(ident: str) -> Camera:
        if ident not in by_id:
            raise HTTPException(404, 'unknown_camera')
        return by_id[ident]

    def admin(request: Request):
        expected = 'Bearer ' + (settings.admin_token or '')
        if not settings.admin_token or not hmac.compare_digest(
            request.headers.get('authorization', '').encode(), expected.encode()
        ):
            raise HTTPException(401, 'admin_token_required')

    def selection(camera_id: str | None = None, group: int | None = None) -> list[str]:
        if camera_id:
            known(camera_id)
            return [camera_id]
        if group is not None:
            ids = [c.id for c in catalog if group in c.groups]
            if not ids:
                raise HTTPException(422, 'unknown_group')
            return ids
        return list(by_id)

    def range_check(start: float, end: float, bucket: int | None = None):
        if not all(math.isfinite(v) for v in (start, end)) or not 0 <= start < end or end - start > 30 * 86400:
            raise HTTPException(422, 'invalid_time_range')
        if bucket is not None and (bucket < 1 or math.ceil((end - start) / bucket) > 720):
            raise HTTPException(422, 'too_many_buckets')

    def page_call(fn, *args):
        try:
            return asdict(fn(*args))
        except ValueError:
            raise HTTPException(422, 'invalid_cursor')

    @router.get('/health')
    def health():
        now = time.time()
        heartbeat = store.get_health('worker_heartbeat') or {}
        worker_age = now - heartbeat.get('timestamp', 0)
        worker_available = heartbeat.get('available', False) and (0 <= worker_age <= settings.fresh_age_seconds)
        return {
            'api': 'available',
            'worker': {
                **heartbeat,
                'available': worker_available,
            },
            'dependencies': {
                'ffmpeg': shutil.which(settings.ffmpeg_path) is not None,
            },
            'fresh_age_seconds': settings.fresh_age_seconds,
            'target_interval_seconds': settings.target_interval_seconds,
        }

    @router.get('/cameras')
    def cameras():
        latest = {r.camera_id: r for r in store.latest(time.time())}
        return {
            'generated_at': time.time(),
            'cameras': [
                {
                    'id': c.id,
                    'name': c.name,
                    'groups': c.groups,
                    'reading': asdict(latest[c.id]),
                }
                for c in catalog
            ],
        }

    @router.get('/cameras/{ident}/config')
    def get_config(ident: str):
        known(ident)
        return asdict(store.get_config(ident))

    @router.put('/cameras/{ident}/config')
    def put_config(ident: str, payload: RainConfigInput, request: Request):
        known(ident)
        admin(request)
        try:
            thresholds_dict = payload.thresholds or {}
            thresholds = RainThresholds(**thresholds_dict) if thresholds_dict else RainThresholds()
            cfg = RainConfig(
                ident,
                roi=payload.roi,
                thresholds=thresholds,
                enabled=payload.enabled,
            )
            return asdict(store.save_config(cfg, payload.expected_revision))
        except (ValueError, TypeError) as error:
            is_conflict = str(error) == 'config_revision_conflict'
            raise HTTPException(
                409 if is_conflict else 422,
                'config_revision_conflict' if is_conflict else f'invalid_configuration: {error}',
            )

    @router.get('/cameras/{ident}/history')
    def history(
        ident: str,
        start: float,
        end: float,
        limit: int = Query(100, ge=1, le=500),
        cursor: str | None = None,
    ):
        known(ident)
        range_check(start, end)
        return page_call(store.history, [ident], start, end, limit, cursor)

    @router.get('/analytics')
    def analytics(
        start: float,
        end: float,
        bucket_seconds: int = 300,
        camera_id: str | None = None,
        group: int | None = None,
    ):
        range_check(start, end, bucket_seconds)
        ids = selection(camera_id, group)
        buckets = bucket_rain_readings(
            store.readings_for_buckets(ids, start, end),
            ids,
            start,
            end,
            bucket_seconds,
            settings.fresh_age_seconds,
        )
        result = [asdict(b) for b in buckets]
        return {
            'start': start,
            'end': end,
            'bucket_seconds': bucket_seconds,
            'camera_ids': ids,
            'buckets': result,
        }

    @router.get('/events')
    def events(
        start: float,
        end: float,
        camera_id: str | None = None,
        group: int | None = None,
        limit: int = Query(100, ge=1, le=500),
        cursor: str | None = None,
    ):
        range_check(start, end)
        return page_call(store.events, selection(camera_id, group), start, end, limit, cursor)

    @router.get('/evidence/{ident}')
    def get_evidence(ident: str, kind: str = 'overlay'):
        if kind not in ('image', 'overlay') or not re.fullmatch(r'[a-f0-9]{32}', ident):
            raise HTTPException(404, 'unknown_evidence')
        if not store.has_evidence(ident):
            raise HTTPException(404, 'unknown_evidence')
        path = evidence.resolve(ident, kind)
        if not path:
            raise HTTPException(410, 'evidence_expired')
        return FileResponse(path)

    def snapshot_path(ident: str):
        known(ident)
        path = snapshots / f'{ident}.jpg'
        if path.is_symlink():
            raise HTTPException(503, 'snapshot_unavailable')
        return path

    @router.post('/cameras/{ident}/snapshot')
    def post_snapshot(ident: str, request: Request):
        admin(request)
        cam = known(ident)
        path = snapshot_path(ident)
        if not capture_slots.acquire(blocking=False):
            raise HTTPException(429, 'capture_busy')
        try:
            clip = capture_clip(
                cam,
                ffmpeg=settings.ffmpeg_path,
                timeout=settings.capture_timeout_seconds,
            )
            rep_frame = clip.frames[len(clip.frames) // 2]
            from PIL import Image
            img = Image.fromarray(rep_frame)
            temp = path.with_suffix('.tmp')
            img.save(temp, format='JPEG', quality=85)
            temp.replace(path)
            return {
                'camera_id': ident,
                'captured_at': clip.captured_at,
                'clip_started_at': clip.clip_started_at,
            }
        except CaptureError as error:
            raise HTTPException(503, str(error))
        finally:
            capture_slots.release()

    @router.get('/cameras/{ident}/snapshot')
    def get_snapshot(ident: str, request: Request):
        admin(request)
        path = snapshot_path(ident)
        if not path.is_file():
            raise HTTPException(404, 'snapshot_missing')
        return FileResponse(path)

    return router


def create_rain_app(settings: RainSettings, catalog: list[Camera] | None = None) -> FastAPI:
    cam_catalog = catalog if catalog is not None else load_catalog(settings.catalog_path)
    store = RainStore(settings.db_path, cam_catalog)
    evidence = RainEvidenceStore(settings.evidence_root)

    @asynccontextmanager
    async def lifespan(app):
        yield
        store.close()

    app = FastAPI(title='CCTV rain observations', lifespan=lifespan)
    app.state.store = store
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=['GET', 'POST', 'PUT'],
        allow_headers=['Authorization', 'Content-Type'],
    )

    @app.middleware('http')
    async def no_cache(request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    router = create_rain_router(settings, store, evidence, cam_catalog)
    app.include_router(router)
    return app
