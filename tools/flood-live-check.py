"""Real cameras/model only. Missing prerequisites stay explicit in the report."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, replace
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.flood.capture import capture_frame, CaptureError
from backend.flood.contracts import CameraConfig, Sequence
from backend.flood.evidence import EvidenceStore
from backend.flood.settings import load_settings, load_catalog
from backend.flood.store import Store
from backend.flood.worker import InferenceSupervisor, analyze

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--camera',default='03');parser.add_argument('--cycles',type=int,default=2)
    parser.add_argument('--all-cameras',action='store_true');parser.add_argument('--roi',help='Reviewed normalized vertices: x,y;x,y;...')
    args=parser.parse_args();settings=load_settings();catalog=load_catalog(settings.catalog_path)
    if not 1<=args.cycles<=5: parser.error('cycles must be 1..5')
    if args.all_cameras and args.roi: parser.error('Review ROI per camera, never reuse one across all cameras')
    cameras=catalog if args.all_cameras else [c for c in catalog if c.id==args.camera]
    if not cameras: parser.error('Unknown camera')
    root=settings.runtime/'checks'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');root.mkdir(parents=True)
    store=Store(settings.runtime/'flood.sqlite3',catalog);evidence=EvidenceStore(settings.runtime/'evidence')
    if args.roi:
        roi=[tuple(map(float,p.split(','))) for p in args.roi.split(';')];cfg=store.get_config(args.camera)
        store.save_config(replace(cfg,roi=roi,enabled=True),cfg.revision)
    supervisor=InferenceSupervisor(settings.model_path,settings.device,settings.inference_timeout)
    records=[];sequences={};started=time.monotonic()
    def capture(cam):
        at=time.monotonic()
        try:return capture_frame(cam,settings.ffmpeg,settings.capture_timeout),None,time.monotonic()-at
        except CaptureError as error:return None,str(error),time.monotonic()-at
    try:
        for cycle in range(1 if args.all_cameras else args.cycles):
            with ThreadPoolExecutor(max_workers=2) as executor:
                for cam,(frame,error,seconds) in zip(cameras,executor.map(capture,cameras)):
                    cfg=store.get_config(cam.id);result={'camera_id':cam.id,'cycle':cycle,'capture_seconds':seconds,'configured_roi':bool(cfg.enabled and cfg.roi),'capture_error':error}
                    if frame:
                        frame.image.save(root/f'{cam.id}-{cycle}.jpg');result.update(captured_at=frame.captured_at,source_at=frame.source_at)
                        if cfg.enabled and cfg.roi:
                            at=time.monotonic();r,seq,_,pred=analyze(cam,cfg,sequences.get(cam.id,Sequence()),supervisor,settings.ffmpeg,frame)
                            sequences[cam.id]=seq;result['inference_seconds']=time.monotonic()-at
                            if pred:r=replace(r,evidence_id=evidence.save(frame,pred,cfg.roi))
                            result['accepted']=store.record(r,cfg.revision);result['reading']=asdict(r)
                        elif (settings.model_path/'manifest.json').is_file():
                            # Measure segmentation without classifying an unreviewed region or publishing it.
                            at=time.monotonic()
                            try:p=supervisor.predict(frame,.5);result['model_revision']=p.model_revision
                            except Exception as e:result['model_error']=str(e)
                            result['inference_seconds']=time.monotonic()-at
                        else:result['model_error']='model_unavailable'
                    records.append(result)
        times=[r['capture_seconds'] for r in records]
        report={'run_at':datetime.now(timezone.utc).isoformat(),'elapsed_seconds':time.monotonic()-started,
            'capture_success':sum(r['capture_error'] is None for r in records),'capture_failures':sum(r['capture_error'] is not None for r in records),
            'capture_median_seconds':float(np.median(times)),'capture_p95_seconds':float(np.percentile(times,95)),
            'trained_model_available':(settings.model_path/'manifest.json').is_file(),'records':records}
        (root/'result.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({'report':str(root/'result.json'),**{k:v for k,v in report.items() if k!='records'}}))
    finally:supervisor.close();store.close()
if __name__=='__main__':main()
