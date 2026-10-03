"""Short SQLite transactions; accepted observations and events are atomic."""
from dataclasses import asdict, replace
import base64
import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from .classification import effective
from .contracts import CameraConfig, Thresholds, Reading, Event, Page
from .geometry import validate_roi


class Store:
    def __init__(self, db_path: Path, catalog):
        self.catalog = {c.id: c for c in catalog}
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(db_path, check_same_thread=False, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA busy_timeout=10000')
        version = self.db.execute('PRAGMA user_version').fetchone()[0]
        if version > 1: raise ValueError('Database schema is newer than this application')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS camera_configs(camera_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY, camera_id TEXT NOT NULL,
            captured_at REAL NOT NULL, config_revision INTEGER NOT NULL, model_revision TEXT NOT NULL, data TEXT NOT NULL,
            UNIQUE(camera_id,captured_at,config_revision,model_revision));
          CREATE INDEX IF NOT EXISTS obs_camera_time ON observations(camera_id,captured_at DESC,id DESC);
          CREATE INDEX IF NOT EXISTS obs_time ON observations(captured_at);
          CREATE INDEX IF NOT EXISTS obs_evidence ON observations(json_extract(data,'$.evidence_id'));
          CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,camera_id TEXT NOT NULL,started_at REAL NOT NULL,
            ended_at REAL,end_reason TEXT,peak_pct REAL NOT NULL,start_evidence_id TEXT,end_evidence_id TEXT);
          CREATE INDEX IF NOT EXISTS events_camera_time ON events(camera_id,started_at);
          CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,data TEXT NOT NULL);
          PRAGMA user_version=1;
        ''')

    def _known(self, camera_id):
        if camera_id not in self.catalog: raise KeyError('Unknown camera')

    def get_config(self, camera_id):
        self._known(camera_id)
        with self.lock:
            row = self.db.execute('SELECT data FROM camera_configs WHERE camera_id=?', (camera_id,)).fetchone()
        if not row: return CameraConfig(camera_id)
        data = json.loads(row['data']); data['thresholds'] = Thresholds(**data['thresholds'])
        return CameraConfig(**data)

    def save_config(self, config, expected_revision):
        self._known(config.camera_id)
        if config.roi is not None: validate_roi(config.roi)
        if config.enabled and not config.roi: raise ValueError('Enabled cameras require ROI')
        with self.lock, self.db:
            self.db.execute('BEGIN IMMEDIATE')
            current = self.get_config(config.camera_id)
            if current.revision != expected_revision: raise ValueError('config_revision_conflict')
            saved = replace(config, revision=current.revision+1)
            self.db.execute('INSERT OR REPLACE INTO camera_configs VALUES(?,?,?)',
                            (config.camera_id, saved.revision, json.dumps(asdict(saved))))
            latest = self._last(config.camera_id)
            self.db.execute("UPDATE events SET ended_at=?,end_reason='reconfigured' WHERE camera_id=? AND ended_at IS NULL",
                            (latest.captured_at if latest else time.time(), config.camera_id))
        return saved

    def _last(self, camera_id):
        row = self.db.execute('SELECT data FROM observations WHERE camera_id=? ORDER BY captured_at DESC,id DESC LIMIT 1', (camera_id,)).fetchone()
        return Reading(**json.loads(row['data'])) if row else None

    def record(self, reading, expected_revision):
        self._known(reading.camera_id)
        reading = effective(reading, reading.processed_at)
        with self.lock, self.db:
            self.db.execute('BEGIN IMMEDIATE')
            config = self.get_config(reading.camera_id)
            if config.revision != expected_revision or reading.config_revision != config.revision: return False
            if not config.enabled or not config.roi:
                reading = replace(reading, status='unconfigured', reason='roi_required', water_coverage_pct=None, model_score=None)
            prior = self._last(reading.camera_id)
            if prior and prior.captured_at >= reading.captured_at: return False
            self.db.execute('INSERT INTO observations(camera_id,captured_at,config_revision,model_revision,data) VALUES(?,?,?,?,?)',
                (reading.camera_id, reading.captured_at, config.revision, reading.model_revision or '', json.dumps(asdict(reading), allow_nan=False)))
            event = self.db.execute('SELECT * FROM events WHERE camera_id=? AND ended_at IS NULL', (reading.camera_id,)).fetchone()
            gap = prior and reading.captured_at-prior.captured_at > 180
            if event and (gap or reading.status in ('unknown', 'unconfigured')):
                self.db.execute("UPDATE events SET ended_at=?,end_reason='data_gap' WHERE id=?", (prior.captured_at if prior else reading.captured_at, event['id']))
                event = None
            if reading.status == 'active':
                if event:
                    self.db.execute('UPDATE events SET peak_pct=MAX(peak_pct,?) WHERE id=?', (reading.water_coverage_pct, event['id']))
                else:
                    self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',
                        (uuid.uuid4().hex, reading.camera_id, reading.captured_at, None, None, reading.water_coverage_pct, reading.evidence_id, None))
            elif event and reading.status == 'clear':
                self.db.execute("UPDATE events SET ended_at=?,end_reason='clear',end_evidence_id=? WHERE id=?", (reading.captured_at, reading.evidence_id, event['id']))
        return True

    def latest(self, now):
        out = []
        with self.lock:
            for camera_id in self.catalog:
                cfg = self.get_config(camera_id)
                r = self._last(camera_id)
                if not cfg.roi or not cfg.enabled:
                    r = Reading(camera_id, 0, 0, status='unconfigured', reason='roi_required', config_revision=cfg.revision)
                elif not r or r.config_revision != cfg.revision:
                    r = Reading(camera_id, 0, 0, reason='awaiting_analysis', config_revision=cfg.revision)
                out.append(effective(r, now))
        return out

    def _ids(self, ids):
        ids = list(dict.fromkeys(ids))
        for camera_id in ids: self._known(camera_id)
        return ids, ','.join('?' for _ in ids)

    def history(self, ids, start, end, limit=100, cursor=None):
        ids, marks = self._ids(ids)
        if not ids: return Page([])
        limit = max(1, min(int(limit), 500))
        values = [*ids, start, end]
        extra = ''
        if cursor:
            try:
                at, ident = json.loads(base64.urlsafe_b64decode(cursor))
                at, ident = float(at), int(ident)
            except Exception as exc: raise ValueError('invalid_cursor') from exc
            extra = ' AND (captured_at<? OR (captured_at=? AND id<?))'
            values.extend([at, at, ident])
        with self.lock:
            rows = self.db.execute(f'SELECT id,captured_at,data FROM observations WHERE camera_id IN ({marks}) AND captured_at>=? AND captured_at<?{extra} ORDER BY captured_at DESC,id DESC LIMIT ?', (*values, limit+1)).fetchall()
        shown = rows[:limit]
        next_cursor = base64.urlsafe_b64encode(json.dumps([shown[-1]['captured_at'], shown[-1]['id']]).encode()).decode() if len(rows)>limit else None
        return Page([Reading(**json.loads(row['data'])) for row in shown], next_cursor)

    def events(self, ids, start, end, limit=100, cursor=None):
        self.expire_events(time.time())
        ids, marks = self._ids(ids)
        if not ids: return Page([])
        values = [*ids, end, start]
        extra = ''
        if cursor:
            try:
                at, ident = json.loads(base64.urlsafe_b64decode(cursor))
                extra = ' AND (started_at<? OR (started_at=? AND id<?))'; values.extend([float(at), float(at), str(ident)])
            except Exception as exc: raise ValueError('invalid_cursor') from exc
        limit = max(1, min(int(limit), 500))
        with self.lock:
            rows = self.db.execute(f'SELECT * FROM events WHERE camera_id IN ({marks}) AND started_at<? AND (ended_at IS NULL OR ended_at>=?){extra} ORDER BY started_at DESC,id DESC LIMIT ?', (*values, limit+1)).fetchall()
        shown = rows[:limit]
        next_cursor = base64.urlsafe_b64encode(json.dumps([shown[-1]['started_at'], shown[-1]['id']]).encode()).decode() if len(rows)>limit else None
        return Page([Event(**dict(row)) for row in shown], next_cursor)

    def readings_for_buckets(self, ids, start, end):
        ids, marks = self._ids(ids)
        if not ids: return []
        with self.lock:
            rows = self.db.execute(f'SELECT data FROM observations WHERE camera_id IN ({marks}) AND captured_at>=? AND captured_at<=? ORDER BY captured_at,id', (*ids, start-180, end)).fetchall()
        return [Reading(**json.loads(r['data'])) for r in rows]

    def set_health(self, key, value):
        with self.lock, self.db:
            self.db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', (key, json.dumps(value, allow_nan=False)))

    def get_health(self, key):
        with self.lock:
            row = self.db.execute('SELECT data FROM metadata WHERE key=?', (key,)).fetchone()
        return json.loads(row['data']) if row else None

    def has_evidence(self, ident):
        with self.lock:
            return self.db.execute("SELECT 1 FROM observations WHERE json_extract(data,'$.evidence_id')=? LIMIT 1",(ident,)).fetchone() is not None

    def expire_events(self, now):
        with self.lock, self.db:
            self.db.execute('''UPDATE events SET ended_at=(
                SELECT MAX(captured_at) FROM observations WHERE observations.camera_id=events.camera_id),
                end_reason='data_gap' WHERE ended_at IS NULL AND (
                SELECT MAX(captured_at) FROM observations WHERE observations.camera_id=events.camera_id)<?''',(now-180,))

    def prune(self, now, observation_days=30):
        self.expire_events(now)
        with self.lock, self.db:
            count = self.db.execute('DELETE FROM observations WHERE captured_at<?', (now-observation_days*86400,)).rowcount
            self.db.execute('DELETE FROM events WHERE ended_at IS NOT NULL AND ended_at<?', (now-observation_days*86400,))
        return count

    def close(self):
        with self.lock: self.db.close()
