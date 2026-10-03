# Flood detection and Analysis

The static viewer now has an **Analysis** menu, separate playback/flood badges, history charts, events and a per-camera ROI editor. Backend services require an always-running Python host and persistent storage. A static Vercel deployment does not run the worker or SQLite API.

## Windows / local startup

Python 3.11 and Node 20+ are required. Use a project virtual environment, never install these dependencies into an unrelated global environment:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
# Install FFmpeg and put it on PATH, or use this portable Windows package:
backend/.venv/Scripts/python.exe -m pip install imageio-ffmpeg==0.6.0
backend/.venv/Scripts/python.exe tools/prepare-flood-model.py --output runtime/flood/models
```

Preparation checks the model card license and available pretrained safetensors, pins the Hub commit and hashes every downloaded file. The adapter uses `microsoft/beit-base-finetuned-ade-640-640`, whose [primary model card](https://huggingface.co/microsoft/beit-base-finetuned-ade-640-640) specifies Apache-2.0. It replaces the proposed Mask2Former model because that model's weight license was unclear. BEiT is a general semantic model, not validated flood detection for these cameras. No random-weight or simulated production fallback exists. Never disable TLS verification to work around download failures.

In separate terminals from the repository root:

```powershell
# Supply your own private token in this terminal; never put it in public JS.
$env:FLOOD_ADMIN_TOKEN = '<private-admin-token>'
backend/.venv/Scripts/python.exe -m uvicorn backend.flood.api:app --host 127.0.0.1 --port 8100
```

```powershell
# cuda is optional on a compatible GPU installation; default is cpu.
$env:FLOOD_DEVICE = 'cuda'
backend/.venv/Scripts/python.exe -m backend.flood.worker
```

```powershell
npm.cmd start
```

Open `http://127.0.0.1:8000/#analyst`. Enter the token only in the ROI dialog. Select each camera, capture a real image, draw a non-crossing road polygon, enable monitoring and save. Avoid permanent water and reflective surfaces. Cameras without enabled, reviewed ROI remain `unconfigured`. Token stays in dialog memory and clears on close. An empty API token disables configuration/snapshot writes.

`FLOOD_FFMPEG` overrides FFmpeg's executable; otherwise PATH is used, then optional imageio's bundled executable. `FLOOD_RUNTIME` selects a persistent root. `FLOOD_MODEL_PATH`, `FLOOD_DEVICE`, `FLOOD_INTERVAL`, `FLOOD_OBSERVATION_DAYS` and `FLOOD_EVIDENCE_DAYS` configure deployment. The pinned library import compatibility was checked locally with torch 2.13.0+cu126, transformers 4.57.6, huggingface-hub 0.36.2 and safetensors 0.7.0. Fresh install/container build must also be checked on the target host.

## Docker

Copy `.env.flood.example` to ignored `.env.flood`, add the private token and actual frontend origins. Create `runtime/flood`; on Linux grant container UID 10001 write permission to this directory. Download the model explicitly before starting, or run the preparation CLI as a one-off container command with the same mount.

```sh
docker compose --env-file .env.flood -f compose.flood.yaml config
docker compose --env-file .env.flood -f compose.flood.yaml build
docker compose --env-file .env.flood -f compose.flood.yaml up -d
docker compose --env-file .env.flood -f compose.flood.yaml stop
```

Both services mount `./runtime/flood:/app/runtime/flood`; API publishes only `127.0.0.1:8100:8100`. The API and worker are separate processes. For remote access configure a TLS reverse proxy, explicit `FLOOD_ORIGINS` (no wildcard), and set `apiBaseUrl` in `scripts/flood-config.js` to the HTTPS API origin. Hosted config defaults to no backend URL; local config points to localhost. Never include admin tokens in JS, URLs, commits or Vercel build variables for public files. `.dockerignore`, `.vercelignore` and the static build allowlist exclude runtime, virtualenv and private env files.

## Semantics and operation

- `water_coverage_pct`: percent of ROI pixels whose highest scoring semantic class is water/river/sea/lake and whose grouped water probability reaches the pixel threshold (default 0.50).
- `model_score`: mean water probability over ROI, uncalibrated; it is not flood precision or confidence in a safety decision.
- Defaults: suspect at 5%, active at 15% for three consecutive accepted results; active clears after three results below 5%. Errors, gaps over 180 seconds, config/model changes and worker restart reset confirmation.
- Capture is limited to two concurrent jobs, one inference process, at most two pending captures. Each capture has a 20-second deadline; inference has 120 seconds. A stalled inference child is terminated and reaped. Worker shutdown waits for bounded captures. API remains usable if the worker/model is absent.
- A 60-second interval is a target, not a guarantee. Inspect actual cycle time in health and measure `--all-cameras` before deploying. CPU may need a larger interval or fewer configured cameras/GPU; results older than 180 seconds become unknown regardless of interval. Never enlarge freshness merely to hide delay.
- `source_at` and HLS sequence remain null when FFmpeg cannot tie metadata to the exact decoded frame. Capture time is acquisition time, not proof of the camera's source clock. Identical scene pixels alone never establish a frozen stream.
- Observations/events retain 30 days; event image/mask/overlay files retain 7 days. Setup snapshots retain only the latest per camera. Unknown and unconfigured metrics are null. A missing curve segment is not zero water.
- Charts use the latest fresh reading at/before each bucket end for camera counts, with a 180-second warm-up preceding the range. Mean/max coverage use valid samples in the half-open bucket only. Aggregate coverage across camera views is unavailable. Times render in Asia/Bangkok.
- All viewer mode scrolls readable tiles and connects at most nine visible streams. Analysis releases players and stops the tour, then restores the previous live position without restarting the tour.

Stop/restart services with Ctrl+C or Compose stop/up. Keep only one worker per database. Configuration revision is checked during result insertion, so results for edited ROI are discarded. SQLite WAL protects independent reader/writer processes. Model files and manifest must travel together; changing model revision resets subsequent confirmations.

Use SQLite's backup API for a consistent database backup while running:

```powershell
backend/.venv/Scripts/python.exe -c "import sqlite3; a=sqlite3.connect('runtime/flood/flood.sqlite3'); b=sqlite3.connect('runtime/flood/backup.sqlite3'); a.backup(b); b.close(); a.close()"
```

Back up model manifest/weights and evidence separately. To restore, stop both services, replace the database with a verified backup, restore evidence if available, then restart. Missing expired evidence is reported as 410, unknown IDs as 404. Never recursively delete runtime to resolve an error.

## HTTP API

Responses have `Cache-Control: no-store`. Read endpoints are public; PUT config and both snapshot methods require `Authorization: Bearer <token>`.

| Endpoint | Result |
|---|---|
| GET `/api/flood/health` | API, worker heartbeat, model/dependencies, cycle duration and freshness |
| GET `/api/flood/cameras` | `{generated_at,cameras:[{id,name,groups,reading}]}` |
| GET `/api/flood/cameras/03/config` | `{camera_id,roi,thresholds,revision,enabled}` |
| PUT `/api/flood/cameras/03/config` | `{expected_revision,roi,thresholds,enabled}` → new configuration |
| GET `/api/flood/cameras/03/history?start=...&end=...` | `{items,next_cursor}` |
| GET `/api/flood/analytics?start=...&end=...&bucket_seconds=300&camera_id=03` | `{camera_ids,buckets,start,end,bucket_seconds}` |
| GET `/api/flood/events?start=...&end=...&group=4` | `{items,next_cursor}` |
| GET `/api/flood/evidence/{id}?kind=overlay` | JPEG/PNG; `kind=image|mask|overlay` |
| POST `/api/flood/cameras/03/snapshot` | Capture metadata; bounded real capture |
| GET `/api/flood/cameras/03/snapshot` | Latest setup JPEG |

Unix timestamps are seconds. Camera IDs come only from the catalog, never arbitrary stream URLs. Ranges use `[start,end)`, at most 30 days. History/events cap pages at 500; analytics cap 720 buckets. `camera_id` takes priority over `group`. Unknown camera/evidence/snapshot: 404; expired known evidence: 410; missing/wrong token: 401; edited revision: 409; invalid ROI/range/cursor: 422; busy snapshot: 429; capture error: 503. Errors never include tokens or filesystem paths.

## Verification

```powershell
npm.cmd run check
python -m pytest backend/tests -q
npm.cmd run test:browser
node tests/flood-browser.cjs
npm.cmd run build
backend/.venv/Scripts/python.exe tools/flood-live-check.py --camera 03 --cycles 2
backend/.venv/Scripts/python.exe tools/flood-live-check.py --all-cameras
node tests/flood-live-browser.cjs
```

The live checker uses real catalog streams and the actual supervised model; it does not enable unreviewed camera regions. After inspecting a captured road image, `--roi 'x,y;x,y;x,y;...'` can configure that single camera and publish checked observations. The diagnostic report lives in ignored `runtime/flood/checks`. Browser fixture results are separate from the actual API check. Read [the validation report](reviews/2026-10-03-flood-validation.md) for tested scope and external prerequisites.
