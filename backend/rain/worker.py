import argparse
import logging
import signal
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from .capture import capture_clip, CaptureError
from .classification import advance
from .contracts import Camera, RainSequence, RawClassification
from .detector import RainDetector
from .evidence import RainEvidenceStore
from .settings import RainSettings, load_settings, load_catalog
from .store import RainStore
from .supervision import DetectorSupervisor, DetectorError

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('rain_worker')


class RainScheduler:
    def __init__(self, camera_ids: list[str], interval: float = 60.0, capture_limit: int = 2, queue_limit: int = 2):
        self.camera_ids = list(camera_ids)
        self.interval = float(interval)
        self.capture_limit = int(capture_limit)
        self.queue_limit = int(queue_limit)
        self.last_completed: dict[str, float] = {}
        self.in_flight: set[str] = set()

    def due(self, now_monotonic: float) -> list[str]:
        if len(self.in_flight) >= self.capture_limit:
            return []
        slots = min(self.capture_limit - len(self.in_flight), self.queue_limit)
        candidates = []
        for cid in self.camera_ids:
            if cid in self.in_flight:
                continue
            last = self.last_completed.get(cid, -1e9)
            if now_monotonic - last >= self.interval:
                candidates.append((now_monotonic - last, cid))
        candidates.sort(reverse=True)
        chosen = [cid for _, cid in candidates[:slots]]
        for cid in chosen:
            self.in_flight.add(cid)
        return chosen

    def completed(self, camera_id: str, now_monotonic: float):
        self.in_flight.discard(camera_id)
        self.last_completed[camera_id] = now_monotonic


class RainWorker:
    def __init__(self, settings: RainSettings, catalog: list[Camera] | None = None, stop_event: threading.Event | None = None):
        self.settings = settings
        self.catalog = catalog if catalog is not None else load_catalog(settings.catalog_path)
        self.catalog_map = {c.id: c for c in self.catalog}
        self.stop_event = stop_event or threading.Event()
        self.store = RainStore(settings.db_path, self.catalog)
        self.evidence_store = RainEvidenceStore(settings.evidence_root)
        self.detector = RainDetector()
        self.supervisor = DetectorSupervisor(settings.detector_timeout_seconds)
        self.scheduler = RainScheduler(
            [c.id for c in self.catalog],
            interval=settings.target_interval_seconds,
            capture_limit=settings.capture_concurrency,
            queue_limit=settings.max_queue_depth,
        )
        self.sequences: dict[str, RainSequence] = {}
        self.last_prune = 0.0

    def process_camera(self, camera: Camera):
        cfg = self.store.get_config(camera.id)
        if not cfg.enabled or not cfg.roi:
            return

        now_start = time.time()
        try:
            clip = capture_clip(
                camera,
                ffmpeg=self.settings.ffmpeg_path,
                timeout=self.settings.capture_timeout_seconds,
            )
        except CaptureError as exc:
            logger.warning(f"Camera {camera.id} capture error: {exc}")
            raw = RawClassification(raw_status='unknown', reason=str(exc))
            composite_mask = None
            rep_frame = None
            clip_started = now_start
            captured_at = time.time()
        except Exception as exc:
            logger.error(f"Camera {camera.id} unexpected capture failure: {exc}")
            raw = RawClassification(raw_status='unknown', reason='unexpected_capture_error')
            composite_mask = None
            rep_frame = None
            clip_started = now_start
            captured_at = time.time()
        else:
            clip_started = clip.clip_started_at
            captured_at = clip.captured_at
            rep_frame = clip.frames[len(clip.frames) // 2]
            try:
                raw, composite_mask = self.supervisor.analyze(clip.frames, cfg.roi, cfg.thresholds)
            except Exception as exc:
                logger.error(f"Camera {camera.id} detector error: {exc}")
                raw = RawClassification(raw_status='unknown', reason=str(exc) if isinstance(exc, DetectorError) else 'detector_failed')
                composite_mask = None

        processed_at = time.time()
        prev_seq = self.sequences.get(camera.id, RainSequence())

        # Check evidence generation if entering/exiting rainy state
        evidence_id = None
        is_rainy_candidate = (raw.raw_status == 'rainy' and prev_seq.high_count + 1 >= cfg.thresholds.confirmations)
        is_dry_transition = (prev_seq.status == 'rainy' and raw.raw_status == 'dry' and prev_seq.low_count + 1 >= cfg.thresholds.confirmations)

        if (is_rainy_candidate or is_dry_transition) and rep_frame is not None and cfg.roi:
            try:
                evidence_id = self.evidence_store.save(rep_frame, composite_mask, cfg.roi)
            except Exception as exc:
                logger.warning(f"Failed to save evidence for {camera.id}: {exc}")

        new_seq, reading = advance(
            sequence=prev_seq,
            raw=raw,
            captured_at=captured_at,
            clip_started_at=clip_started,
            processed_at=processed_at,
            camera_id=camera.id,
            config_revision=cfg.revision,
            detector_revision=self.detector.revision,
            thresholds=cfg.thresholds,
            evidence_id=evidence_id,
        )

        first_det = new_seq.first_rain_at if new_seq.status == 'rainy' else None
        first_dry = new_seq.first_dry_at if new_seq.status == 'dry' else None

        accepted = self.store.record(
            reading=reading,
            expected_revision=cfg.revision,
            first_detected_at=first_det,
            first_dry_at=first_dry,
        )
        if accepted:
            self.sequences[camera.id] = new_seq
        else:
            self.sequences.pop(camera.id, None)

    def run_cycle(self, now: float, now_mono: float):
        self.store.set_health('worker_heartbeat', {
            'available': True,
            'timestamp': now,
            'target_interval_seconds': self.settings.target_interval_seconds,
            'fresh_age_seconds': self.settings.fresh_age_seconds,
        })
        self.store.expire_events(now)
        self.scheduler.camera_ids = [c.id for c in self.catalog
            if (cfg := self.store.get_config(c.id)).enabled and cfg.roi]
        due_cids = self.scheduler.due(now_mono)

        with ThreadPoolExecutor(max_workers=self.settings.capture_concurrency) as executor:
            futures = []
            for cid in due_cids:
                cam = self.catalog_map.get(cid)
                if cam:
                    futures.append((cid, executor.submit(self.process_camera, cam)))

            for cid, f in futures:
                try:
                    f.result(timeout=self.settings.capture_timeout_seconds + self.settings.detector_timeout_seconds + 5)
                except Exception as exc:
                    logger.error(f"Task for camera {cid} failed: {exc}")
                finally:
                    self.scheduler.completed(cid, time.monotonic())

        # Update heartbeat
        self.store.set_health('worker_heartbeat', {
            'available': True,
            'timestamp': now,
            'target_interval_seconds': self.settings.target_interval_seconds,
            'fresh_age_seconds': self.settings.fresh_age_seconds,
        })

        # Periodic pruning (every 6 hours)
        if now - self.last_prune > 21600:
            try:
                self.store.prune(now, observation_days=self.settings.observation_days)
                self.evidence_store.prune(now, days=self.settings.evidence_days)
                self.last_prune = now
            except Exception as exc:
                logger.error(f"Prune error: {exc}")

    def run(self):
        logger.info("Rain worker started.")
        while not self.stop_event.is_set():
            now = time.time()
            now_mono = time.monotonic()
            self.run_cycle(now, now_mono)
            self.stop_event.wait(timeout=1.0)
        logger.info("Rain worker stopped.")

    def close(self):
        self.supervisor.close()
        self.store.set_health('worker_heartbeat', {'available': False, 'timestamp': time.time()})
        self.store.close()


def main():
    parser = argparse.ArgumentParser(description="Chachoengsao CCTV Rain Detection Worker")
    parser.add_argument('--once', action='store_true', help="Run one pass over all due cameras and exit")
    args = parser.parse_args()

    settings = load_settings()
    stop_event = threading.Event()

    def handle_sig(sig, frame):
        logger.info("Received termination signal, shutting down...")
        stop_event.set()

    signal.signal(signal.SIGINT, handle_sig)
    signal.signal(signal.SIGTERM, handle_sig)

    worker = RainWorker(settings, stop_event=stop_event)
    try:
        if args.once:
            logger.info("Running single worker cycle...")
            for _ in range(max(1, len(worker.catalog))):
                worker.run_cycle(time.time(), time.monotonic())
                configured = [c.id for c in worker.catalog if worker.store.get_config(c.id).enabled]
                if all(cid in worker.scheduler.last_completed for cid in configured):
                    break
        else:
            worker.run()
    finally:
        worker.close()


if __name__ == '__main__':
    main()
