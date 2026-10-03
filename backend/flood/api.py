from contextlib import asynccontextmanager
from dataclasses import asdict
import hmac
import math
from pathlib import Path
import re
import shutil
import threading
import time
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from .analytics import bucket_readings
from .capture import capture_frame, CaptureError
from .contracts import CameraConfig, Thresholds
from .evidence import EvidenceStore
from .settings import load_settings, load_catalog
from .store import Store

class ConfigInput(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    expected_revision: int = Field(ge=0)
    enabled: bool = False
    roi: list[tuple[float, float]] | None = None
    thresholds: dict = Field(default_factory=dict)

def create_app(settings):
    catalog = load_catalog(settings.catalog_path); by_id={c.id:c for c in catalog}
    store = Store(settings.runtime/'flood.sqlite3', catalog); evidence=EvidenceStore(settings.runtime/'evidence')
    snapshots = settings.runtime/'snapshots'; snapshots.mkdir(parents=True, exist_ok=True)
    capture_slots = threading.BoundedSemaphore(2)
    @asynccontextmanager
    async def lifespan(app):
        yield
        store.close()
    app = FastAPI(title='CCTV flood observations', lifespan=lifespan)
    app.state.store = store
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins), allow_methods=['GET','POST','PUT'],
        allow_headers=['Authorization','Content-Type'])
    @app.middleware('http')
    async def no_cache(request, call_next):
        response=await call_next(request); response.headers['Cache-Control']='no-store'; return response
    def known(ident):
        if ident not in by_id: raise HTTPException(404, 'unknown_camera')
        return by_id[ident]
    def admin(request):
        expected = 'Bearer '+settings.admin_token
        if not settings.admin_token or not hmac.compare_digest(request.headers.get('authorization','').encode(), expected.encode()):
            raise HTTPException(401, 'admin_token_required')
    def selection(camera_id=None, group=None):
        if camera_id: known(camera_id); return [camera_id]
        if group is not None:
            ids=[c.id for c in catalog if group in c.groups]
            if not ids: raise HTTPException(422, 'unknown_group')
            return ids
        return list(by_id)
    def range_check(start, end, bucket=None):
        if not all(math.isfinite(v) for v in (start,end)) or not 0 <= start < end or end-start > 30*86400:
            raise HTTPException(422, 'invalid_time_range')
        if bucket is not None and (bucket < 1 or math.ceil((end-start)/bucket)>720):
            raise HTTPException(422, 'too_many_buckets')
    def page_call(fn, *args):
        try: return asdict(fn(*args))
        except ValueError: raise HTTPException(422, 'invalid_cursor')
    @app.get('/api/flood/health')
    def health():
        now=time.time(); worker=store.get_health('worker') or {}; age=now-worker.get('heartbeat',0)
        analysis=store.get_health('analysis') or {}
        worker_available=worker.get('state')=='running' and 0<=age<=settings.fresh_age
        model_age=now-analysis.get('processed_at',0)
        model_available=bool(worker_available and analysis.get('model_revision') and not analysis.get('reason') and 0<=model_age<=settings.fresh_age)
        return {'api':'available', 'worker':{**worker,'available':worker_available},
            'model':{**analysis,'files_installed':(settings.model_path/'manifest.json').is_file(),'available':model_available},
            'dependencies':{'ffmpeg':shutil.which(settings.ffmpeg) is not None},
            'fresh_age_seconds':settings.fresh_age, 'target_interval_seconds':settings.interval,
            'last_cycle_seconds':store.get_health('last_cycle_seconds')}
    @app.get('/api/flood/cameras')
    def cameras():
        latest={r.camera_id:r for r in store.latest(time.time())}
        return {'generated_at':time.time(), 'cameras':[{'id':c.id,'name':c.name,'groups':c.groups,
            'reading':asdict(latest[c.id])} for c in catalog]}
    @app.get('/api/flood/cameras/{ident}/config')
    def get_config(ident:str): known(ident); return asdict(store.get_config(ident))
    @app.put('/api/flood/cameras/{ident}/config')
    def put_config(ident:str, payload:ConfigInput, request:Request):
        known(ident); admin(request)
        try:
            cfg=CameraConfig(ident, roi=payload.roi, thresholds=Thresholds(**payload.thresholds), enabled=payload.enabled)
            return asdict(store.save_config(cfg, payload.expected_revision))
        except (ValueError, TypeError) as error:
            raise HTTPException(409 if str(error)=='config_revision_conflict' else 422,
                                'config_revision_conflict' if str(error)=='config_revision_conflict' else 'invalid_configuration')
    @app.get('/api/flood/cameras/{ident}/history')
    def history(ident:str, start:float, end:float, limit:int=Query(100,ge=1,le=500), cursor:str|None=None):
        known(ident); range_check(start,end); return page_call(store.history,[ident],start,end,limit,cursor)
    @app.get('/api/flood/analytics')
    def analytics(start:float,end:float,bucket_seconds:int=300,camera_id:str|None=None,group:int|None=None):
        range_check(start,end,bucket_seconds); ids=selection(camera_id,group)
        buckets=bucket_readings(store.readings_for_buckets(ids,start,end),ids,start,end,bucket_seconds,settings.fresh_age)
        # Coverage across different views is deliberately unavailable.
        result=[asdict(b) for b in buckets]
        if len(ids)!=1:
            for b in result: b['water_mean_pct']=b['water_max_pct']=None
        return {'start':start,'end':end,'bucket_seconds':bucket_seconds,'camera_ids':ids,'buckets':result}
    @app.get('/api/flood/events')
    def events(start:float,end:float,camera_id:str|None=None,group:int|None=None,limit:int=Query(100,ge=1,le=500),cursor:str|None=None):
        range_check(start,end); return page_call(store.events,selection(camera_id,group),start,end,limit,cursor)
    @app.get('/api/flood/evidence/{ident}')
    def get_evidence(ident:str,kind:str='overlay'):
        if kind not in ('image','mask','overlay') or not re.fullmatch('[a-f0-9]{32}',ident): raise HTTPException(404,'unknown_evidence')
        if not store.has_evidence(ident): raise HTTPException(404,'unknown_evidence')
        path=evidence.resolve(ident,kind)
        if not path: raise HTTPException(410,'evidence_expired')
        return FileResponse(path)
    def snapshot_path(ident):
        known(ident); path=snapshots/f'{ident}.jpg'
        if path.is_symlink(): raise HTTPException(503,'snapshot_unavailable')
        return path
    @app.post('/api/flood/cameras/{ident}/snapshot')
    def post_snapshot(ident:str,request:Request):
        admin(request); path=snapshot_path(ident)
        if not capture_slots.acquire(blocking=False): raise HTTPException(429,'capture_busy')
        try:
            frame=capture_frame(known(ident),settings.ffmpeg,settings.capture_timeout)
            temporary=path.with_suffix('.tmp'); frame.image.save(temporary,format='JPEG'); temporary.replace(path)
            return {'camera_id':ident,'captured_at':frame.captured_at,'source_at':frame.source_at}
        except CaptureError as error: raise HTTPException(503,str(error))
        finally: capture_slots.release()
    @app.get('/api/flood/cameras/{ident}/snapshot')
    def get_snapshot(ident:str,request:Request):
        admin(request); path=snapshot_path(ident)
        if not path.is_file(): raise HTTPException(404,'snapshot_missing')
        return FileResponse(path)
    return app

app=create_app(load_settings())
