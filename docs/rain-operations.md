# Rain Detection and Analysis

The CCTV Smart City platform includes a per-camera rain detection pipeline with real-time badges ("ฝนตก", "ไม่พบฝน", "ประเมินฝนไม่ได้", "ยังไม่เปิดตรวจฝน"), a detail modal, and an integrated **Analysis** tab with timeline charts and historical events.

Detection runs on CPU via short 2-second clip sampling (8 fps, 16 frames, max 640px width) using temporal median background subtraction and directional streak feature extraction within camera-specific rain ROIs.

## Windows / Local Startup

Python 3.11+ and Node.js 20+ are required. Ensure dependencies are installed in the backend environment:

```powershell
# Virtual environment setup
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
# Ensure FFmpeg is available on PATH or via imageio-ffmpeg
backend/.venv/Scripts/python.exe -m pip install imageio-ffmpeg==0.6.0
```

Run services in separate terminals:

```powershell
# 1. API Server (serves both /api/flood/* and /api/rain/*)
$env:RAIN_ADMIN_TOKEN = '<private-admin-token>'
backend/.venv/Scripts/python.exe -m uvicorn backend.flood.api:app --host 127.0.0.1 --port 8100
```

```powershell
# 2. Rain Worker (supervised clip capture and streak detection)
backend/.venv/Scripts/python.exe -m backend.rain.worker
# Alternatively via npm:
npm run rain:worker
```

```powershell
# 3. Static Viewer Frontend
npm start
```

Open `http://127.0.0.1:8000/#analyst?kind=rain` to view rain analytics and configure camera ROIs.

## Configuration and Environment

| Environment Variable | Default | Description |
|---|---|---|
| `RAIN_ADMIN_TOKEN` | (falls back to `FLOOD_ADMIN_TOKEN`) | Bearer token for PUT config and capture snapshots |
| `RAIN_RUNTIME` | `runtime/rain` | Directory for SQLite database (`rain.sqlite3`) and evidence |
| `RAIN_CADENCE_SECONDS` | `60` | Target seconds between clip evaluations per camera |
| `RAIN_FRESHNESS_SECONDS` | `180` | Maximum age before an observation is considered stale / unknown |
| `RAIN_OBSERVATION_DAYS` | `30` | Retention window for historical observations and events |
| `RAIN_EVIDENCE_DAYS` | `7` | Retention window for JPEG evidence and overlay files |
| `RAIN_CAPTURE_MAX_CONCURRENCY` | `2` | Maximum concurrent FFmpeg capture processes |
| `RAIN_DETECTOR_MAX_CONCURRENCY` | `1` | Maximum concurrent CPU streak detection jobs |

## Detection Semantics & Thresholds

- **Status Values:**
  - `rainy`: Confirmed rain (3 consecutive fresh raw-rain observations).
  - `dry`: Confirmed dry / no rain (3 consecutive fresh raw-dry observations with hysteresis).
  - `unknown`: Analysis inconclusive, confirming sequence in progress, stale (>180s), or camera stream offline.
  - `unconfigured`: Camera has no enabled rain ROI polygon.
- **Streak Detector:**
  - Computes temporal median background across the 16 decoded grayscale frames.
  - Computes inter-frame positive brightness differences.
  - Identifies vertical/near-vertical streak connected components within the normalized ROI.
  - Evaluates aspect ratio, length, frame consistency, and candidate density.
  - Produces a normalized evidence index (`detector_score` 0.00–1.00). Score >= `score_threshold` (default 0.35) classifies raw reading as rain.
- **Confirmation & Hysteresis:**
  - To enter `rainy`: requires 3 consecutive raw rain readings.
  - To enter `dry`: requires 3 consecutive raw dry readings. While confirming dry, the status remains `rainy` (hysteresis).
  - If a data gap (>180s) occurs or the ROI configuration revision changes, active confirmation sequences reset to `unknown`.
  - Open rain events close with `end_reason=dry` or `end_reason=data_gap`.

## HTTP API

All endpoints reside under `/api/rain/*`:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/rain/health` | Worker heartbeat, target cadence, freshness age |
| `GET` | `/api/rain/cameras` | Latest readings for all cameras (`{ generated_at, cameras: [...] }`) |
| `GET` | `/api/rain/cameras/{id}/history?start=...&end=...` | Paginated historical readings for a camera |
| `GET` | `/api/rain/events?start=...&end=...&camera_id=03` | Paginated rain events with start, confirmation, peak score |
| `GET` | `/api/rain/analytics?start=...&end=...&bucket_seconds=300` | Half-open time buckets for rain/dry camera counts and scores |
| `GET` | `/api/rain/evidence/{id}?kind=overlay` | JPEG composite or overlay visual evidence |
| `GET` | `/api/rain/cameras/{id}/config` | Public camera rain ROI polygon and thresholds |
| `PUT` | `/api/rain/cameras/{id}/config` | Update camera rain ROI (requires `Authorization: Bearer <token>`) |
| `POST` | `/api/rain/cameras/{id}/snapshot` | Capture real clip snapshot for ROI configuration (requires Bearer token) |
| `GET` | `/api/rain/cameras/{id}/snapshot` | Retrieve latest snapshot image |

## Maintenance & Database Backups

The SQLite database uses Write-Ahead Logging (WAL) mode for concurrency between the FastAPI web server and the background rain worker.

To perform a safe live backup:

```powershell
backend/.venv/Scripts/python.exe -c "import sqlite3; a=sqlite3.connect('runtime/rain/rain.sqlite3'); b=sqlite3.connect('runtime/rain/backup.sqlite3'); a.backup(b); b.close(); a.close()"
```

Pruning jobs automatically remove observations older than 30 days and evidence files older than 7 days during worker execution.

## Verification

Run the full automated test suite:

```powershell
# Frontend syntax and unit tests
npm run check

# Browser tests (flood and rain)
npm run test:flood-browser
npm run test:rain-browser
npm run test:browser

# Backend pytest suite
$env:PYTHONPATH="."; pytest backend/tests/ -q

# Production static build validation
npm run build
```
