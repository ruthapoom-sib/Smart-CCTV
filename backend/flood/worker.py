"""Dedicated process; the web API never owns the inference model."""
import argparse
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from dataclasses import replace
import multiprocessing as mp
import signal
import threading
import time
from .capture import capture_frame, CaptureError
from .classification import advance, measure, effective
from .contracts import Reading, Sequence
from .evidence import EvidenceStore
from .model import ModelError, Segmenter
from .settings import load_settings, load_catalog
from .store import Store

class Scheduler:
    def __init__(self, camera_ids, interval=60, capture_limit=2, queue_limit=4):
        self.ids = list(dict.fromkeys(camera_ids)); self.interval = interval
        self.capacity = min(capture_limit, queue_limit); self.inflight = set()
        self.next = {i: 0 for i in self.ids}; self.cursor = 0
    def due(self, now_monotonic):
        result = []
        for _ in range(len(self.ids)):
            if len(self.inflight) >= self.capacity: break
            ident = self.ids[self.cursor]; self.cursor = (self.cursor+1) % len(self.ids)
            if ident not in self.inflight and now_monotonic >= self.next[ident]:
                self.inflight.add(ident); result.append(ident)
        return result
    def completed(self, ident, now_monotonic):
        self.inflight.discard(ident); self.next[ident] = now_monotonic+self.interval

def _model_child(connection, path, device):
    try:
        segmenter = Segmenter(path, device)
        while True:
            request = connection.recv()
            if request is None: break
            image, threshold = request
            try: connection.send(('ok', segmenter.predict(image, threshold)))
            except Exception as error: connection.send(('error', str(error) if isinstance(error, ModelError) else 'inference_failed'))
    except Exception: connection.send(('error', 'model_unavailable'))
    finally: connection.close()

class InferenceSupervisor:
    def __init__(self, model_path, device='cpu', timeout=120):
        self.path, self.device, self.timeout = model_path, device, timeout
        self.process = None; self.connection = None
    def predict(self, capture, pixel_score):
        if self.process is None:
            context = mp.get_context('spawn'); parent, child = context.Pipe()
            self.connection = parent
            self.process = context.Process(target=_model_child, args=(child, self.path, self.device), daemon=True)
            self.process.start(); child.close()
        try:
            self.connection.send((capture.image, pixel_score))
            if not self.connection.poll(self.timeout): raise ModelError('inference_timeout')
            status, value = self.connection.recv()
            if status != 'ok': raise ModelError(value)
            return value
        except (EOFError, BrokenPipeError, OSError):
            self.close(); raise ModelError('model_unavailable')
        except ModelError:
            self.close(); raise
    def close(self):
        if self.process:
            if self.process.is_alive(): self.process.terminate()
            self.process.join(timeout=5)
            if self.process.is_alive(): self.process.kill(); self.process.join()
        if self.connection: self.connection.close()
        self.process = self.connection = None

def analyze(camera, config, sequence, supervisor, ffmpeg, capture=None, capture_timeout=20):
    frame = prediction = None
    try:
        frame = capture or capture_frame(camera, ffmpeg, capture_timeout)
        prediction = supervisor.predict(frame, config.thresholds.pixel_score)
        coverage, score = measure(prediction, config)
        reading = Reading(camera.id, frame.captured_at, time.time(), source_at=frame.source_at,
            status='clear', water_coverage_pct=coverage, model_score=score,
            model_id=prediction.model_id, model_revision=prediction.model_revision, config_revision=config.revision)
        reading = effective(reading, reading.processed_at)
    except Exception as error:
        reason = str(error) if isinstance(error, (CaptureError, ModelError)) else 'analysis_failed'
        reading = Reading(camera.id, frame.captured_at if frame else time.time(), time.time(),
                          reason=reason, config_revision=config.revision)
    sequence = advance(sequence, reading, config.thresholds)
    return replace(reading, status=sequence.status), sequence, frame, prediction

def run_worker(settings, stop_event, once=False):
    catalog = load_catalog(settings.catalog_path); by_id = {c.id:c for c in catalog}
    store = Store(settings.runtime/'flood.sqlite3', catalog)
    evidence = EvidenceStore(settings.runtime/'evidence')
    supervisor = InferenceSupervisor(settings.model_path, settings.device, settings.inference_timeout)
    scheduler = Scheduler(list(by_id), settings.interval)
    sequences = {}; fingerprints = {}; finished = set(); futures = {}
    cycle_started = time.monotonic(); pruned = 0; last_capture = None
    executor = ThreadPoolExecutor(max_workers=2)
    try:
        while not stop_event.is_set():
            for ident in scheduler.due(time.monotonic()):
                config = store.get_config(ident)
                if not config.enabled or not config.roi or (once and ident in finished):
                    scheduler.completed(ident, time.monotonic()); finished.add(ident); continue
                futures[executor.submit(capture_frame, by_id[ident], settings.ffmpeg, settings.capture_timeout)] = (ident, config)
            store.set_health('worker', {'heartbeat':time.time(), 'state':'running', 'queue_depth':len(futures),
                'last_capture_at':last_capture, 'cycle_seconds':time.monotonic()-cycle_started})
            if once and len(finished) == len(catalog): break
            if not futures: stop_event.wait(.2); continue
            done, _ = wait(futures, timeout=.2, return_when=FIRST_COMPLETED)
            for future in done:
                ident, config = futures.pop(future)
                try:
                    frame = future.result()
                    if frame.media_sequence is not None:
                        if fingerprints.get(ident) == frame.media_sequence: raise CaptureError('frozen_playlist')
                        fingerprints[ident] = frame.media_sequence
                    reading, sequence, frame, prediction = analyze(by_id[ident], config, sequences.get(ident, Sequence()), supervisor, settings.ffmpeg, frame)
                except Exception as error:
                    reason = str(error) if isinstance(error, CaptureError) else 'capture_failed'
                    reading = Reading(ident, time.time(), time.time(), reason=reason, config_revision=config.revision)
                    sequence, frame, prediction = Sequence(), None, None
                previous = sequences.get(ident, Sequence())
                if frame and prediction and ((sequence.status=='active' and previous.status!='active') or (previous.status=='active' and sequence.status=='clear')):
                    reading = replace(reading, evidence_id=evidence.save(frame, prediction, config.roi))
                if store.record(reading, config.revision):
                    sequences[ident] = sequence; last_capture = reading.captured_at
                else: sequences.pop(ident, None)
                store.set_health('analysis', {'reason':reading.reason, 'model_id':reading.model_id,
                    'model_revision':reading.model_revision, 'processed_at':reading.processed_at})
                scheduler.completed(ident, time.monotonic()); finished.add(ident)
            if len(finished)==len(catalog):
                store.set_health('last_cycle_seconds', time.monotonic()-cycle_started)
                if not once: finished.clear(); cycle_started=time.monotonic()
            if time.monotonic()-pruned > 3600:
                store.prune(time.time(), settings.observation_days); evidence.prune(time.time(), settings.evidence_days); pruned=time.monotonic()
    finally:
        supervisor.close(); executor.shutdown(wait=True, cancel_futures=True)
        store.set_health('worker', {'heartbeat':time.time(), 'state':'stopped', 'queue_depth':0}); store.close()

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--once', action='store_true'); args=parser.parse_args()
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM): signal.signal(sig, lambda *args: stop.set())
    run_worker(load_settings(), stop, args.once)
if __name__ == '__main__': main()
