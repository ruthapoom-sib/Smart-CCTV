# Live Camera Redesign and Rain Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the primary live camera view to give video more vertical height and cleaner desktop/mobile ergonomics, add per-camera rain status detection with bounded CPU streak analysis on short video clips, and integrate rain status, evidence, and historical analytics into the existing Analysis view.

**Architecture:** A streamlined single-bar desktop header and optimized toolbars maximize video tile heights while preserving `object-fit: contain`. A supervised Python rain worker captures short 2-second video clips via FFmpeg and detects rain streaks on CPU using temporal median and frame differencing in camera-specific rain ROIs. Results and events are saved to an isolated SQLite database (`runtime/rain/rain.sqlite3`). The existing FastAPI backend exposes `/api/rain/*` endpoints. The browser viewer consumes rain status via polling alongside flood status, presenting per-camera badges ("ฝนตก", "ไม่พบฝน", "ประเมินฝนไม่ได้", "ยังไม่เปิดตรวจฝน"), details dialog, and an Analysis tab for rain history and events.

**Tech Stack:** Existing HTML/CSS/JavaScript and Node.js >=20; Python >=3.11, FastAPI, Uvicorn, SQLite WAL, OpenCV/NumPy/Pillow, FFmpeg, pytest, Playwright. CPU processing by default.

**Spec:** [Approved design](../specs/2026-10-03-live-redesign-rain-design.md).

## Global Constraints

- ทะเบียน 40 รหัสกล้องที่ไม่ซ้ำใน 10 กลุ่ม รหัส 13 และ 14 อยู่มากกว่าหนึ่งกลุ่ม ต้องประมวลผลและนับเพียงครั้งเดียว
- Rain status: `unconfigured` | `unknown` | `dry` | `rainy`
- ป้ายฝนตก: แสดงข้อความและไอคอน ไม่พึ่งสีอย่างเดียว (`rainy`: "ฝนตก", `dry`: "ไม่พบฝน", `unknown`: "ประเมินฝนไม่ได้", `unconfigured`: "ยังไม่เปิดตรวจฝน")
- ยืนยัน rainy: raw rain ติดต่อกัน 3 ผลที่ fresh และ config/algorithm revision เดียวกัน ระหว่างรอยืนยันเป็น `unknown` (reason: `confirming_rain`)
- ยืนยัน dry: raw no-rain ติดต่อกัน 3 ผล ใช้ hysteresis คงสถานะเดิมระหว่างรอยืนยัน หากไม่มีสถานะเดิมเป็น `unknown` (reason: `confirming_dry`)
- Freshness: 180 วินาทีสำหรับ worker, API, browser และ analytics หากเกินหรือข้อมูลขาดช่วงให้เป็น `unknown` (reason: `stale` หรือ `data_gap`)
- Capture: คลิปสั้น 2 วินาที ที่ 8 fps (16 เฟรม), ลดขนาดความกว้างไม่เกิน 640px, FFmpeg argument list ไม่ผ่าน shell, timeout 20 วินาที, ขนาดไม่เกิน 32 MiB, cleanup child process เสมอ
- Concurrency worker: capture สูงสุด 2, detector สูงสุด 1, pending queue สูงสุด 2, detector timeout 10 วินาที
- Store: SQLite WAL ใน `runtime/rain/rain.sqlite3`, observations/events เก็บ 30 วัน, ภาพหลักฐาน 7 วัน
- Admin token Bearer auth สำหรับการตั้งค่า ROI/config และ snapshot
- Frontend polling: ทุก 15 วินาที, พักเมื่อแท็บซ่อน, isolation ระหว่าง flood และ rain (ความผิดพลาดของระบบหนึ่งไม่กระทบอีกระบบ)
- Analysis: เพิ่มตัวเลือกสลับ "น้ำท่วม" / "ฝน" ในหน้าเดียว, รองรับ deep link `#kind=rain`
- ไม่ทำการแจ้งเตือนภายนอกอัตโนมัติ (ไม่มี LINE, browser notifications หรือเสียง), ไม่ใช้ placeholder แทนกล้องจริง

## Review Focus

1. **Layout & Visual Performance:** Desktop 1440×900 4-screen layout must achieve noticeably taller video frames than before-desktop.png; no horizontal overflow at 320/390/768/1440px.
2. **Detection & Revision Safety:** Changing rain ROI or detector revision must invalidate in-flight confirmation sequences and close open events with proper reason.
3. **Data Isolation:** Rain and flood use separate SQLite databases, separate worker processes, and independent frontend client states so failure in one never clears or corrupts the other.
4. **Hysteresis & Gap Handling:** Data gaps >180s must terminate active rainy events with `end_reason=data_gap` rather than falsely marking them as dry.

## File Map

| Files | Responsibility |
|---|---|
| `backend/rain/{contracts,settings,geometry,classification}.py` | Shared contracts, settings, rain ROI geometry and 3-consecutive temporal status logic |
| `backend/rain/{store,evidence}.py` | SQLite migrations, WAL transactions, observations, events, rain config and evidence lifecycle |
| `backend/rain/{capture,detector,worker}.py` | FFmpeg short-clip capture, CPU streak feature extraction, monotonic scheduling and supervisor |
| `backend/rain/{analytics,api}.py` | Rain count buckets, event durations, FastAPI endpoints (`/api/rain/*`) |
| `backend/tests/test_rain_*.py` | Comprehensive Python unit tests for contracts, geometry, detector, store, worker, API |
| `scripts/{rain-config,rain-core,rain-client,rain-ui}.js` | Frontend rain configuration, status formatting, network polling and tile badge integration |
| `index.html`, `styles.css`, `scripts/app.js` | Live view redesign (header unification, toolbar streamlining, video height maximization, badges) |
| `scripts/analyst.js` | Analysis view tabs for Flood / Rain, rain count charts, single-camera timeline, events table |
| `scripts/roi-editor.js` | Support switching between Flood ROI and Rain ROI configuration |
| `tools/{build,serve,public-files}.cjs`, `package.json` | Updated public allowlist and build packaging |
| `tests/{rain-core.test.cjs,rain-client.test.cjs,rain-browser.cjs}` | Node and Playwright tests for rain logic, live redesign and analysis |
| `runtime/design-review/{capture.cjs,after-desktop.png,after-mobile.png}` | Visual screenshot regression and before/after verification |
| `docs/flood-operations.md` / `docs/rain-operations.md` | Runbooks, deployment instructions and operational guidelines |

---

### Task 1: Rain Contracts, Registry and Geometry

**Files:** Create `backend/rain/__init__.py`, `backend/rain/contracts.py`, `backend/rain/settings.py`, `backend/rain/geometry.py`, `backend/rain/classification.py`, `backend/tests/test_rain_classification.py`.

- [x] **1. Write failing tests** in `backend/tests/test_rain_classification.py`:
  - 3 consecutive raw rain readings yield confirmed `rainy`.
  - 1 or 2 raw rain readings stay `unknown` (`confirming_rain`).
  - While `rainy`, 1 or 2 raw dry readings remain `rainy` (hysteresis).
  - 3 consecutive raw dry readings transition to `dry`.
  - Freshness expiry (>180s) or invalid timestamp resets sequence to `unknown`.
  - Config revision or algorithm revision mismatch resets sequence.
  - Rain ROI validation: normalized polygon coordinates in [0, 1], non-crossing, minimum area.
- [x] **2. Run** `python -m pytest backend/tests/test_rain_classification.py -q`; verify failures.
- [x] **3. Implement** `contracts.py`, `settings.py`, `geometry.py`, and `classification.py`:
  - Enums: `Status = Literal['unconfigured', 'unknown', 'dry', 'rainy']`.
  - Dataclasses: `RainThresholds`, `RainConfig`, `RainCapture`, `StreakFeatures`, `RainReading`, `RainSequence`, `RainEvent`.
  - `effective(reading, now, max_age=180) -> RainReading`.
  - `advance(sequence, raw_reading, thresholds) -> tuple[RainSequence, RainReading]`.
- [x] **4. Run** `python -m pytest backend/tests/test_rain_classification.py -q`; verify all tests PASS.

---

### Task 2: Rain Persistence, Events, and Evidence

**Files:** Create `backend/rain/store.py`, `backend/rain/evidence.py`, `backend/tests/test_rain_store.py`, `backend/tests/test_rain_evidence.py`.

- [x] **1. Write failing tests** in `backend/tests/test_rain_store.py` and `backend/tests/test_rain_evidence.py`:
  - Database schema initialization in `runtime/rain/rain.sqlite3` with WAL mode.
  - Config save and optimistic concurrency via `expected_revision`.
  - Record observations atomically with event start/end lifecycle.
  - `first_detected_at` and `confirmed_at` tracking on rain start; `ended_at` on dry or `data_gap`.
  - Pruning of observations older than 30 days and evidence older than 7 days.
  - Safe evidence path resolution preventing directory traversal.
- [x] **2. Run** `python -m pytest backend/tests/test_rain_store.py backend/tests/test_rain_evidence.py -q`; verify failures.
- [x] **3. Implement** `backend/rain/store.py` and `backend/rain/evidence.py`:
  - SQLite tables: `schema_migrations`, `rain_configs`, `rain_observations`, `rain_events`.
  - Indexes on `(camera_id, captured_at)`, `(captured_at)`, `(evidence_id)`.
  - Atomic transaction for observation record + event transition.
  - Evidence store saving JPEG composite/overlay and pruning safely.
- [x] **4. Run** `python -m pytest backend/tests/test_rain_store.py backend/tests/test_rain_evidence.py -q`; verify all tests PASS.

---

### Task 3: Bounded Video Capture and Streak Detector

**Files:** Create `backend/rain/capture.py`, `backend/rain/detector.py`, `backend/tests/test_rain_capture.py`, `backend/tests/test_rain_detector.py`.

- [x] **1. Write failing tests**:
  - `capture.py`: FFmpeg command uses argument list (no shell injection), 20s timeout, child process termination on timeout/error, max size 32 MiB, yields sequence of frames at 8 fps (16 frames max).
  - `detector.py`: Temporal median background subtraction, frame differencing, streak detection in ROI, aspect ratio / direction / density filtering, scores normalized 0-1, synthetic streak fixture triggers rain, static image triggers unknown/no-rain.
- [x] **2. Run** `python -m pytest backend/tests/test_rain_capture.py backend/tests/test_rain_detector.py -q`; verify failures.
- [x] **3. Implement** `backend/rain/capture.py` and `backend/rain/detector.py`:
  - Capture clip using FFmpeg pipe into numpy array of frames.
  - Detector computes temporal median image, absolute differences, directional morphological kernel or streak filter, and evaluates candidate streak count against thresholds.
  - Error handling: low contrast, black frames, camera blur return `unknown` with descriptive reason.
- [x] **4. Run** tests; verify all PASS.

---

### Task 4: Rain Analysis Worker & Supervisor

**Files:** Create `backend/rain/worker.py`, `backend/tests/test_rain_worker.py`.

- [x] **1. Write failing tests** for `backend/rain/worker.py`:
  - Monotonic round-robin scheduler across configured cameras.
  - Concurrency caps: max 2 captures, max 1 detector, max 2 queue.
  - Detector timeout (10s) terminates hung analysis and records `unknown`.
  - Stale open events closed on worker restart or prolonged gaps.
  - Worker heartbeat written to SQLite / health check.
- [x] **2. Run** `python -m pytest backend/tests/test_rain_worker.py -q`; verify failures.
- [x] **3. Implement** `backend/rain/worker.py`:
  - Standalone worker script runnable via `python -m backend.rain.worker`.
  - Process pool / thread pool with explicit limits.
  - Periodic heartbeat and retention pruning.
- [x] **4. Run** `python -m pytest backend/tests/test_rain_worker.py -q`; verify all tests PASS.

---

### Task 5: Rain API and Analytics Endpoints

**Files:** Create `backend/rain/analytics.py`, `backend/rain/api.py`, `backend/tests/test_rain_api.py`, `backend/tests/test_rain_analytics.py`.

- [x] **1. Write failing tests** for:
  - `GET /api/rain/health`: worker status, target cadence, freshness.
  - `GET /api/rain/cameras`: latest reading for each camera ID.
  - `GET /api/rain/cameras/{id}/history`: paginated readings.
  - `GET /api/rain/events`: paginated events with camera/group filters.
  - `GET /api/rain/analytics`: time buckets of rainy vs evaluable camera counts and duration.
  - `GET /api/rain/evidence/{id}`: returns JPEG evidence or 404/410.
  - `GET/PUT /api/rain/cameras/{id}/config`: Bearer token required for PUT, optimistic revision check.
  - `POST /api/rain/cameras/{id}/snapshot`: authenticated clip snapshot.
- [x] **2. Run** pytest; verify failures.
- [x] **3. Implement** `backend/rain/analytics.py` and `backend/rain/api.py`:
  - Bucket calculation: latest fresh reading at end of each bucket, empty bucket returns null (not 0).
  - FastAPI router mounted under `/api/rain` in `backend/flood/api.py` or standalone app.
  - Security headers, CORS, query parameter bounds (max 30d, 720 buckets, 500 rows/page).
- [x] **4. Run** pytest; verify all PASS.

---

### Task 6: Live View Redesign and Rain UI Badges

**Files:** Create `scripts/rain-config.js`, `scripts/rain-core.js`, `scripts/rain-client.js`, `scripts/rain-ui.js`, `tests/rain-core.test.cjs`, `tests/rain-client.test.cjs`; modify `index.html`, `styles.css`, `scripts/app.js`, `tools/public-files.cjs`.

- [x] **1. Write failing unit tests** (`tests/rain-core.test.cjs`, `tests/rain-client.test.cjs`):
  - Rain label mapping: `rainy` -> "ฝนตก", `dry` -> "ไม่พบฝน", `unknown` -> "ประเมินฝนไม่ได้", `unconfigured` -> "ยังไม่เปิดตรวจฝน".
  - Polling lifecycle: stops on hidden, restarts on visible, request generation guard.
  - Rain failure isolation: rain API offline does not disturb flood badge or playback.
- [x] **2. Run** `node --test tests/rain-core.test.cjs tests/rain-client.test.cjs`; verify failures.
- [x] **3. Redesign Live UI in `index.html` and `styles.css`**:
  - Combine header: unified top bar with brand, live/analysis tabs, live clock, help button.
  - Streamline toolbar: compact filter row with search, intersection select, favorites filter, and grid buttons (1, 4, 9, 16, All).
  - Maximize video height: reduce superfluous padding and vertical header bulk so 4-screen layout at 1440x900 has significantly taller video display.
  - Integrate rain badge on tile: adjacent to camera name/info, non-intrusive, clear text + icon.
  - Add rain detail modal (`#rain-detail`) showing latest detection time, reason, evidence image, and link to Analysis.
- [x] **4. Implement** `rain-core.js`, `rain-client.js`, `rain-ui.js` and wire them into `scripts/app.js` and `index.html`.
- [x] **5. Run** tests and check that existing `npm test` and new tests PASS.

---

### Task 7: Analysis View Rain Tab, Charts and ROI Setup

**Files:** Modify `scripts/analyst.js`, `scripts/roi-editor.js`, `index.html`, `styles.css`; create `tests/rain-browser.cjs`.

- [x] **1. Write Playwright test** in `tests/rain-browser.cjs`:
  - Navigate to Analysis, switch between "น้ำท่วม" (Flood) and "ฝน" (Rain) tabs.
  - Deep link `#analyst?kind=rain&camera=03&range=24h` loads rain view directly.
  - Rain chart renders rainy count curve + evaluable curve.
  - Single camera selection renders rain timeline and events table with evidence dialog.
  - Rain ROI editor mode loads and saves rain-specific polygon config.
- [x] **2. Run** `node tests/rain-browser.cjs`; verify failure.
- [x] **3. Implement**:
  - Tab controls in Analysis view for Flood / Rain.
  - Rain analytics fetching, SVG timeline and count chart rendering.
  - Events table with start, confirmation, end time, duration, and evidence thumbnail.
  - ROI editor support for editing Rain ROI separately from Flood ROI.
- [x] **4. Run** `node tests/rain-browser.cjs` and verify PASS.

---

### Task 8: Visual Verification, Packaging and Handoff

**Files:** Modify `runtime/design-review/capture.cjs`, `package.json`, `docs/flood-operations.md`; generate `runtime/design-review/after-desktop.png`, `runtime/design-review/after-mobile.png`.

- [x] **1. Update capture script** and take new screenshots at 1440×900 and 390×844.
- [x] **2. Visual verification**: Compare `before-desktop.png` vs `after-desktop.png` to confirm video height increase in 4-screen layout; verify mobile layout at 390×844 and 320px.
- [x] **3. Package build & syntax check**: Run `npm run check`, `npm run build`, `python -m pytest backend/tests -q`, ensure all static files in `dist/` match allowlist.
- [x] **4. Update operations documentation**: Document rain worker execution (`python -m backend.rain.worker`), API endpoints, database location, and operational thresholds.
- [x] **5. Review and finalize**: Clean git state, record evidence and summarize deliverable.
