from dataclasses import asdict, replace
import base64
import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from .classification import effective
from .contracts import RainConfig, RainThresholds, RainReading, RainEvent, RainPage
from .geometry import validate_roi


class RainStore:
    def __init__(self, db_path: Path, catalog):
        self.catalog = {c.id: c for c in catalog}
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(db_path, check_same_thread=False, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA busy_timeout=10000')
        version = self.db.execute('PRAGMA user_version').fetchone()[0]
        if version > 1:
            raise ValueError('Database schema is newer than this application')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS rain_configs(
            camera_id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL,
            data TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS rain_observations(
            id INTEGER PRIMARY KEY,
            camera_id TEXT NOT NULL,
            captured_at REAL NOT NULL,
            config_revision INTEGER NOT NULL,
            detector_revision TEXT NOT NULL,
            data TEXT NOT NULL,
            UNIQUE(camera_id, captured_at, config_revision, detector_revision)
          );
          CREATE INDEX IF NOT EXISTS rain_obs_camera_time ON rain_observations(camera_id, captured_at DESC, id DESC);
          CREATE INDEX IF NOT EXISTS rain_obs_time ON rain_observations(captured_at);
          CREATE INDEX IF NOT EXISTS rain_obs_evidence ON rain_observations(json_extract(data, '$.evidence_id'));
          CREATE TABLE IF NOT EXISTS rain_events(
            id TEXT PRIMARY KEY,
            camera_id TEXT NOT NULL,
            first_detected_at REAL NOT NULL,
            confirmed_at REAL NOT NULL,
            ended_at REAL,
            end_reason TEXT,
            peak_score REAL NOT NULL,
            start_evidence_id TEXT,
            end_evidence_id TEXT
          );
          CREATE INDEX IF NOT EXISTS rain_events_camera_time ON rain_events(camera_id, first_detected_at);
          CREATE TABLE IF NOT EXISTS rain_metadata(
            key TEXT PRIMARY KEY,
            data TEXT NOT NULL
          );
          PRAGMA user_version=1;
        ''')

    def _known(self, camera_id: str):
        if camera_id not in self.catalog:
            raise KeyError(f'Unknown camera {camera_id}')

    def get_config(self, camera_id: str) -> RainConfig:
        self._known(camera_id)
        with self.lock:
            row = self.db.execute('SELECT data FROM rain_configs WHERE camera_id=?', (camera_id,)).fetchone()
        if not row:
            return RainConfig(camera_id)
        data = json.loads(row['data'])
        data['thresholds'] = RainThresholds(**data['thresholds'])
        return RainConfig(**data)

    def save_config(self, config: RainConfig, expected_revision: int) -> RainConfig:
        self._known(config.camera_id)
        if config.roi is not None:
            validate_roi(config.roi)
        if config.enabled and not config.roi:
            raise ValueError('Enabled cameras require ROI')
        with self.lock, self.db:
            self.db.execute('BEGIN IMMEDIATE')
            current = self.get_config(config.camera_id)
            if current.revision != expected_revision:
                raise ValueError('config_revision_conflict')
            saved = replace(config, revision=current.revision + 1)
            self.db.execute(
                'INSERT OR REPLACE INTO rain_configs VALUES(?,?,?)',
                (config.camera_id, saved.revision, json.dumps(asdict(saved)))
            )
            latest = self._last(config.camera_id)
            self.db.execute(
                "UPDATE rain_events SET ended_at=?, end_reason='reconfigured' WHERE camera_id=? AND ended_at IS NULL",
                (latest.captured_at if latest else time.time(), config.camera_id)
            )
        return saved

    def _last(self, camera_id: str) -> RainReading | None:
        row = self.db.execute(
            'SELECT data FROM rain_observations WHERE camera_id=? ORDER BY captured_at DESC, id DESC LIMIT 1',
            (camera_id,)
        ).fetchone()
        return RainReading(**json.loads(row['data'])) if row else None

    def record(
        self,
        reading: RainReading,
        expected_revision: int,
        first_detected_at: float | None = None,
        first_dry_at: float | None = None,
    ) -> bool:
        self._known(reading.camera_id)
        reading = effective(reading, reading.processed_at)
        with self.lock, self.db:
            self.db.execute('BEGIN IMMEDIATE')
            config = self.get_config(reading.camera_id)
            if config.revision != expected_revision or reading.config_revision != config.revision:
                return False
            if not config.enabled or not config.roi:
                reading = replace(reading, status='unconfigured', reason='roi_required', detector_score=None)
            prior = self._last(reading.camera_id)
            if prior and prior.captured_at >= reading.captured_at:
                return False

            self.db.execute(
                'INSERT INTO rain_observations(camera_id, captured_at, config_revision, detector_revision, data) VALUES(?,?,?,?,?)',
                (
                    reading.camera_id,
                    reading.captured_at,
                    config.revision,
                    reading.detector_revision or 'v1',
                    json.dumps(asdict(reading), allow_nan=False),
                )
            )

            event = self.db.execute(
                'SELECT * FROM rain_events WHERE camera_id=? AND ended_at IS NULL',
                (reading.camera_id,)
            ).fetchone()

            gap = prior and (reading.captured_at - prior.captured_at > 180.0)
            if event and (gap or reading.status in ('unknown', 'unconfigured')):
                self.db.execute(
                    "UPDATE rain_events SET ended_at=?, end_reason='data_gap' WHERE id=?",
                    (prior.captured_at if prior else reading.captured_at, event['id'])
                )
                event = None

            score = reading.detector_score or 0.0
            if reading.status == 'rainy':
                if event:
                    self.db.execute(
                        'UPDATE rain_events SET peak_score=MAX(peak_score, ?) WHERE id=?',
                        (score, event['id'])
                    )
                else:
                    self.db.execute(
                        'INSERT INTO rain_events VALUES(?,?,?,?,?,?,?,?,?)',
                        (
                            uuid.uuid4().hex,
                            reading.camera_id,
                            first_detected_at or reading.clip_started_at,
                            reading.captured_at,
                            None,
                            None,
                            score,
                            reading.evidence_id,
                            None,
                        )
                    )
            elif event and reading.status == 'dry':
                self.db.execute(
                    "UPDATE rain_events SET ended_at=?, end_reason='dry', end_evidence_id=? WHERE id=?",
                    (first_dry_at or reading.clip_started_at, reading.evidence_id, event['id'])
                )
        return True

    def latest(self, now: float) -> list[RainReading]:
        out = []
        with self.lock:
            for camera_id in self.catalog:
                cfg = self.get_config(camera_id)
                r = self._last(camera_id)
                if not cfg.roi or not cfg.enabled:
                    r = RainReading(
                        camera_id=camera_id,
                        captured_at=0,
                        clip_started_at=0,
                        processed_at=0,
                        status='unconfigured',
                        reason='roi_required',
                        config_revision=cfg.revision,
                    )
                elif not r or r.config_revision != cfg.revision:
                    r = RainReading(
                        camera_id=camera_id,
                        captured_at=0,
                        clip_started_at=0,
                        processed_at=0,
                        status='unknown',
                        reason='awaiting_analysis',
                        config_revision=cfg.revision,
                    )
                out.append(effective(r, now))
        return out

    def _ids(self, ids: list[str]) -> tuple[list[str], str]:
        unique_ids = list(dict.fromkeys(ids))
        for camera_id in unique_ids:
            self._known(camera_id)
        return unique_ids, ','.join('?' for _ in unique_ids)

    def history(self, ids: list[str], start: float, end: float, limit: int = 100, cursor: str | None = None) -> RainPage:
        unique_ids, marks = self._ids(ids)
        if not unique_ids:
            return RainPage([])
        limit = max(1, min(int(limit), 500))
        values = [*unique_ids, start, end]
        extra = ''
        if cursor:
            try:
                at, ident = json.loads(base64.urlsafe_b64decode(cursor))
                at, ident = float(at), int(ident)
            except Exception as exc:
                raise ValueError('invalid_cursor') from exc
            extra = ' AND (captured_at<? OR (captured_at=? AND id<?))'
            values.extend([at, at, ident])

        with self.lock:
            rows = self.db.execute(
                f'SELECT id, captured_at, data FROM rain_observations WHERE camera_id IN ({marks}) AND captured_at>=? AND captured_at<?{extra} ORDER BY captured_at DESC, id DESC LIMIT ?',
                (*values, limit + 1)
            ).fetchall()

        shown = rows[:limit]
        next_cursor = (
            base64.urlsafe_b64encode(json.dumps([shown[-1]['captured_at'], shown[-1]['id']]).encode()).decode()
            if len(rows) > limit else None
        )
        return RainPage([RainReading(**json.loads(row['data'])) for row in shown], next_cursor)

    def events(self, ids: list[str], start: float, end: float, limit: int = 100, cursor: str | None = None, now: float | None = None) -> RainPage:
        self.expire_events(now if now is not None else time.time())
        unique_ids, marks = self._ids(ids)
        if not unique_ids:
            return RainPage([])
        values = [*unique_ids, end, start]
        extra = ''
        if cursor:
            try:
                at, ident = json.loads(base64.urlsafe_b64decode(cursor))
                extra = ' AND (first_detected_at<? OR (first_detected_at=? AND id<?))'
                values.extend([float(at), float(at), str(ident)])
            except Exception as exc:
                raise ValueError('invalid_cursor') from exc

        limit = max(1, min(int(limit), 500))
        with self.lock:
            rows = self.db.execute(
                f'SELECT * FROM rain_events WHERE camera_id IN ({marks}) AND first_detected_at<? AND (ended_at IS NULL OR ended_at>=?){extra} ORDER BY first_detected_at DESC, id DESC LIMIT ?',
                (*values, limit + 1)
            ).fetchall()

        shown = rows[:limit]
        next_cursor = (
            base64.urlsafe_b64encode(json.dumps([shown[-1]['first_detected_at'], shown[-1]['id']]).encode()).decode()
            if len(rows) > limit else None
        )
        return RainPage([RainEvent(**dict(row)) for row in shown], next_cursor)

    def readings_for_buckets(self, ids: list[str], start: float, end: float) -> list[RainReading]:
        unique_ids, marks = self._ids(ids)
        if not unique_ids:
            return []
        with self.lock:
            rows = self.db.execute(
                f'SELECT data FROM rain_observations WHERE camera_id IN ({marks}) AND captured_at>=? AND captured_at<=? ORDER BY captured_at, id',
                (*unique_ids, start - 180.0, end)
            ).fetchall()
        return [RainReading(**json.loads(r['data'])) for r in rows]

    def set_health(self, key: str, value: dict):
        with self.lock, self.db:
            self.db.execute('INSERT OR REPLACE INTO rain_metadata VALUES(?,?)', (key, json.dumps(value, allow_nan=False)))

    def get_health(self, key: str) -> dict | None:
        with self.lock:
            row = self.db.execute('SELECT data FROM rain_metadata WHERE key=?', (key,)).fetchone()
        return json.loads(row['data']) if row else None

    def has_evidence(self, ident: str) -> bool:
        with self.lock:
            return (
                self.db.execute(
                    "SELECT 1 FROM rain_observations WHERE json_extract(data, '$.evidence_id')=? LIMIT 1",
                    (ident,)
                ).fetchone() is not None
            )

    def expire_events(self, now: float):
        with self.lock, self.db:
            self.db.execute('''
                UPDATE rain_events SET ended_at=(
                    SELECT MAX(captured_at) FROM rain_observations WHERE rain_observations.camera_id=rain_events.camera_id
                ),
                end_reason='data_gap' WHERE ended_at IS NULL AND (
                    SELECT MAX(captured_at) FROM rain_observations WHERE rain_observations.camera_id=rain_events.camera_id
                )<?
            ''', (now - 180.0,))

    def prune(self, now: float, observation_days: int = 30) -> int:
        self.expire_events(now)
        with self.lock, self.db:
            count = self.db.execute(
                'DELETE FROM rain_observations WHERE captured_at<?',
                (now - observation_days * 86400.0,)
            ).rowcount
            self.db.execute(
                'DELETE FROM rain_events WHERE ended_at IS NOT NULL AND ended_at<?',
                (now - observation_days * 86400.0,)
            )
        return count

    def close(self):
        with self.lock:
            self.db.close()
