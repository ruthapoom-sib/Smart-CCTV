# Camera Flood Detection and Analyst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze actual images from each configured CCTV camera, persist observations, and provide a separate Thai Analyst view with historical charts and evidence.

**Architecture:** A Python API and supervised analysis worker share a persistent SQLite database. The worker captures allowlisted HLS sources using FFmpeg and runs a pretrained semantic segmentation model independently of browser activity. The existing static viewer consumes the API and releases video players while Analyst is open.

**Tech Stack:** Existing HTML/CSS/JavaScript and Node.js >=20; Python >=3.11, FastAPI, Uvicorn, SQLite WAL, PyTorch, Transformers, Pillow, NumPy, FFmpeg, pytest, Playwright. CPU by default, optional CUDA. No cloud AI provider or production deployment.

**Spec:** [Approved design](../specs/2026-10-03-flood-detection-analyst-design.md). The user approved the written spec on 2026-10-03; this plan awaits review and selection of execution method.

## Global Constraints

- มี 40 รหัสกล้องที่ไม่ซ้ำใน 10 กลุ่ม รหัส 13 และ 14 อยู่มากกว่าหนึ่งกลุ่ม ต้องประมวลผลและนับเพียงครั้งเดียวต่อรหัส
- คะแนน pixel น้ำขั้นต่ำ 0.50
- สัดส่วนน้ำตั้งแต่ 5% แต่ต่ำกว่า 15%: “สงสัยน้ำท่วม”
- ตั้งแต่ 15% ติดต่อกัน 3 ผลที่ใช้งานได้: “พบต่อเนื่อง” ก่อนครบให้เป็น “สงสัยน้ำท่วม”
- เมื่อเคยพบต่อเนื่อง ต้องต่ำกว่า 5% ติดต่อกัน 3 ผลจึงกลับเป็นไม่พบ ระหว่างรอยืนยันการลดลงแสดงสถานะเดิมพร้อมค่าล่าสุด
- ผลขาดช่วงเกิน 180 วินาที ผลผิดพลาด การเปลี่ยน ROI หรือการเปลี่ยนรุ่นโมเดล/เกณฑ์ ตัดการนับผลต่อเนื่อง
- ตั้งเป้า 60 วินาทีต่อกล้อง ใช้ capture concurrency ไม่เกิน 2 และ inference ทีละภาพ เริ่มด้วย CPU และรองรับ GPU เมื่อมี
- แต่ละ capture หมดอายุภายใน 20 วินาที และยุติ child process พร้อมเก็บสาเหตุ เมื่อไม่มี FFmpeg ให้ health รายงาน dependency missing
- เก็บ observation 30 วันและภาพหลักฐาน 7 วันเป็นค่าเริ่มต้น ปรับได้ด้วยการตั้งค่าเซิร์ฟเวอร์
- token อยู่ในหน่วยความจำของแท็บเท่านั้น ไม่บันทึกใน localStorage และไม่ใส่ใน URL
- polling ผลล่าสุดทุก 15 วินาที พัก polling เมื่อแท็บซ่อน ยกเลิก request เก่าเมื่อเปลี่ยนตัวกรอง
- กล้องที่ยังไม่ตั้งค่าแสดง “ยังไม่กำหนดบริเวณตรวจ” และไม่สร้างผลไม่พบน้ำอัตโนมัติ
- ผลมาจากภาพจริงเท่านั้น ข้อมูลสังเคราะห์ใช้เฉพาะการทดสอบที่แยกจากฐานข้อมูลใช้งาน
- ไม่ทำการแจ้งเตือนภายนอกอัตโนมัติ ไม่เพิ่มค่าความลึกน้ำ ไม่เก็บวิดีโอตลอดเวลา ไม่ฝึกโมเดลเฉพาะพื้นที่โดยไม่มีชุดภาพติด label และไม่เปิดบริการสาธารณะหรือ deploy production อัตโนมัติ

## Review Focus

1. A wall-clock adjustment must not cause duplicate captures or make future-dated results appear fresh: monotonic scheduling, freshness rejects future timestamps (Tasks 2, 4).
2. Editing ROI while an image is in flight must not publish a result for the old region as current: recheck configuration revision inside the write transaction (Task 2).
3. A late browser response after a filter or route change must not overwrite the new view: abort plus request generation guard (Task 6).
4. Letterboxed camera images and device rotation must not move the saved polygon relative to the actual image: original-image SVG coordinates, normalized storage (Task 7).
5. A historical range beginning during an ongoing event must include the preceding fresh sample; missing samples must not be counted as clear: query warm-up and bucket-end freshness (Task 5).

## File Map

| Files | Responsibility |
|---|---|
| `tools/export-cameras.cjs`, `backend/cameras.json` | Export the existing authoritative catalog, deduplicate IDs and retain all groups |
| `backend/flood/{settings,contracts,geometry,classification}.py` | Runtime configuration, shared types, ROI and temporal status logic |
| `backend/flood/{store,evidence}.py` | SQLite migrations, observations, events, configuration and safe evidence lifecycle |
| `backend/flood/{capture,model,worker}.py` | Bounded live capture, real pretrained inference and process supervision |
| `backend/flood/{analytics,api}.py` | Historical buckets, authenticated configuration and read API |
| `backend/requirements*.txt`, `backend/flood/__init__.py`, `backend/tests/conftest.py` | Isolated dependency setup and temporary test resources |
| `tools/prepare-flood-model.py` | Preflight, model revision/weight verification and explicit download |
| `scripts/{flood-config,flood-core,flood-client,flood-ui,analyst,roi-editor,navigation}.js` | Browser config, pure presentation logic, network lifecycle and focused views |
| `index.html`, `styles.css`, `scripts/app.js` | Integrate navigation, badges and live-view suspension into existing UI |
| `tools/{build,serve}.cjs`, `package.json`, `tests/*.cjs` | Allowlisted static package, local serving and regression checks |
| `backend/Dockerfile`, `compose.flood.yaml`, `.env.flood.example` | API/worker startup with durable volumes and explicit admin configuration |
| `docs/flood-operations.md`, `docs/reviews/2026-10-03-flood-validation.md` | Setup, actual validation results and operating limitations |

All new backend modules have a narrow purpose; avoid moving unrelated viewer code. Runtime files live under ignored `runtime/flood/` (database, evidence, model cache, configuration). Test databases are temporary and never point at this directory.

## Shared Contracts

Define these once in Task 1; all later tasks consume the same names. Times are UTC epoch seconds internally and timezone-aware ISO strings in HTTP JSON. Client display uses `Asia/Bangkok`.

```text
Camera(id: str, name: str, stream_url: str, groups: list[int])
Thresholds(pixel_score=0.50, suspect_pct=5.0, active_pct=15.0, confirmations=3)
CameraConfig(camera_id: str, roi: list[tuple[float,float]]|None,
             thresholds: Thresholds, revision: int, enabled: bool)
Capture(camera_id: str, image: PIL.Image, captured_at: float,
        source_at: float|None, media_sequence: int|None)
Prediction(water_mask: np.ndarray[bool], water_prob: np.ndarray[float],
           model_id: str, model_revision: str)
Status = unconfigured | clear | suspect | active | unknown
Reading(camera_id: str, captured_at: float, processed_at: float,
        source_at: float|None, status: Status, reason: str|None,
        water_coverage_pct: float|None, model_score: float|None,
        model_id: str|None, model_revision: str|None,
        config_revision: int, evidence_id: str|None)
Sequence(status: Status, high_count: int, low_count: int,
         last_captured_at: float|None, config_revision: int,
         model_revision: str|None)
Event(id: str, camera_id: str, started_at: float, ended_at: float|None,
      end_reason: clear|data_gap|reconfigured|None, peak_pct: float,
      start_evidence_id: str|None, end_evidence_id: str|None)
```

`model_score` is the mean water probability over ROI pixels, expressly an uncalibrated model score. `water_mask` requires the highest-scoring semantic class to be in the water class group and grouped water probability to meet `pixel_score`. Invalid input yields null metrics, never zero as a substitute. `Sequence` resets at worker restart.

### Task 1: Camera Registry and Classification Contracts

**Files:** Create `tools/export-cameras.cjs`, `backend/cameras.json`, `backend/flood/__init__.py`, `backend/flood/settings.py`, `backend/flood/contracts.py`, `backend/flood/geometry.py`, `backend/flood/classification.py`, `backend/tests/conftest.py`, `backend/tests/test_classification.py`, `tests/camera-export.test.cjs`; modify `.gitignore` and `package.json`.

**Interfaces:** `exportCatalog() -> {version:1,cameras:Camera[],groups:{id:number,name:string}[]}` (Node). `load_settings() -> Settings`; `load_catalog(path: Path) -> list[Camera]`; `validate_roi(points) -> list[tuple[float,float]]`; `roi_mask(points,width,height) -> np.ndarray[bool]`; `measure(prediction,config) -> tuple[coverage_pct,model_score]`; `advance(sequence,reading,thresholds) -> Sequence`; `effective(reading,now,max_age=180) -> Reading`.

- [ ] **1. Write failing tests** with these assertions, using 100 ROI pixels in NumPy fixtures:

```python
def test_confirmation_and_clear_hysteresis():
    # feed helper creates Reading and calls advance with the shared default thresholds
    assert feed([15, 15, 15]).status == 'active'
    assert feed([15, 15]).status == 'suspect'
    assert feed([15, 15, 15, 4.9, 4.9]).status == 'active'
    assert feed([15, 15, 15, 4.9, 4.9, 4.9]).status == 'clear'
```

Also assert exact boundaries 5/15/180 seconds, null on invalid prediction, no ROI → unconfigured, crossing polygons rejected, zero-area polygons rejected, group memberships of 13/14 preserved while unique count is 40. Define `feed(values, gaps=None, revisions=None)` in this test module; null values create unknown readings.
- [ ] **2. Run** `node --test tests/camera-export.test.cjs` and `python -m pytest backend/tests/test_classification.py -q`; expect failures because modules do not exist.
- [ ] **3. Implement** shared types and pure functions. Keep IDs as two-character strings (including `00`). Export the catalog with Node VM evaluation of only the trusted existing `scripts/data.js`. Use exact Thai status labels in `scripts/flood-core.js` later, and enum values above in backend. Validate threshold ordering and normalized finite coordinates. Reset confirmation on error, config/model revision change, non-increasing timestamps or gap >180. Defaults: API `127.0.0.1:8100`, capture 20 seconds, inference timeout 120 seconds, queue maximum 4, fresh age 180 seconds, runtime path `runtime/flood/`. Add `runtime/flood/`, Python caches and `backend/.venv/` to ignore rules.
- [ ] **4. Run** both tests again; expect PASS, and `node tools/export-cameras.cjs --check` must exit 0 when the tracked JSON equals the source catalog.
- [ ] **5. Commit** only this task's files: `feat: add flood camera registry and classification contracts`.

### Task 2: Persistent Observations, Events and Evidence

**Files:** Create `backend/flood/store.py`, `backend/flood/evidence.py`, `backend/tests/test_store.py`, `backend/tests/test_evidence.py`.

**Interfaces:** `Store(db_path:Path,catalog:list[Camera])`; methods `get_config(id)->CameraConfig`, `save_config(config,expected_revision:int)->CameraConfig`, `record(reading,expected_revision:int)->bool`, `latest(now)->list[Reading]`, `history(ids,start,end,limit,cursor)->Page[Reading]`, `events(ids,start,end,limit,cursor)->Page[Event]`, `readings_for_buckets(ids,start,end)->list[Reading]`, `prune(now,observation_days=30)->int`, `close()->None`. `Page` has `items` and `next_cursor`. Evidence API: `EvidenceStore(root:Path).save(capture,prediction,roi)->str`, `.resolve(id,kind='image')->Path|None`, `.prune(now,days=7)->int`.

- [ ] **1. Write failing tests:**

```python
def test_persistence_and_revision_race(tmp_path, catalog, reading_factory, config_factory):
    store = Store(tmp_path / 'test.sqlite', catalog)
    cfg = store.save_config(config_factory('03'), expected_revision=0)
    reading = reading_factory('03', config_revision=cfg.revision)
    store.save_config(config_factory('03'), expected_revision=cfg.revision)
    assert store.record(reading, expected_revision=cfg.revision) is False
```

Fixtures `catalog`, `config_factory`, `reading_factory` live in `conftest.py` and produce valid shared types; `tmp_path` is pytest's temporary directory. Test committed readings survive closing/reopening; older/out-of-order readings cannot replace latest; future timestamps become unknown; unknown closes monitoring with `data_gap`, not `clear`; 30-day observations and 7-day evidence expire independently. Reject stale admin edits and evidence `../`, symlink escapes and unknown IDs.
- [ ] **2. Run** `python -m pytest backend/tests/test_store.py backend/tests/test_evidence.py -q`; expect missing-module failures.
- [ ] **3. Implement** schema-versioned migrations, WAL, parameterized statements, unique `(camera_id,captured_at,config_revision,model_revision)` keys, write-time revision checks and deterministic cursors `(captured_at,id)`. `record` atomically stores accepted observations and event transitions. Event end reasons distinguish clear from monitoring gaps. Evidence contains source JPEG, mask PNG and composite preview under UUID filenames; save files atomically and publish IDs only after completion. Preserve one latest setup snapshot per camera outside event retention. Resolve and verify containment before any removal; no recursive deletion of arbitrary paths.
- [ ] **4. Run** tests; expect PASS, including two Store connections concurrently attempting configuration revision updates.
- [ ] **5. Commit:** `feat: persist flood observations events and image evidence`.

### Task 3: Bounded HLS Capture and Real Model Adapter

**Files:** Create `backend/flood/capture.py`, `backend/flood/model.py`, `tools/prepare-flood-model.py`, `backend/requirements.txt`, `backend/requirements-dev.txt`, `backend/model-manifest.example.json`, `backend/tests/test_capture.py`, `backend/tests/test_model.py`.

**Interfaces:** `capture_frame(camera:Camera,ffmpeg:str,timeout=20)->Capture`; `CaptureError(reason:str)`. `Segmenter(model_path:Path,device='cpu')`, `.predict(image:PIL.Image,pixel_score:float)->Prediction`; `ModelError(reason:str)`. Preparation CLI: `python tools/prepare-flood-model.py --output runtime/flood/models --model facebook/mask2former-swin-tiny-ade-semantic` produces manifest with model ID, full commit revision, filenames, SHA256, class names, retrieval date and source/license references.

- [ ] **1. Write failing tests:** capture command uses argument array, `shell=False`, timeout 20 and actual catalog URL; timeout terminates/reaps the child; malformed/unchanging playlists report unknown; absent program date time remains null. For synthetic model output verify semantic class grouping, probability normalization, output shape restoration and threshold behavior. These tensors test math only; no mock adapter is available in the production CLI.

```python
def test_model_missing_never_generates_a_prediction(tmp_path):
    with pytest.raises(ModelError, match='model_unavailable'):
        Segmenter(tmp_path / 'missing-model', device='cpu')
```

Also reject empty/missing water labels, NaN logits, untrained/random fallback, and reject extremely dark/blank input as quality unknown rather than clear.
- [ ] **2. Run** `python -m pytest backend/tests/test_capture.py backend/tests/test_model.py -q`; expect missing-module failures.
- [ ] **3. Implement** FFmpeg one-frame JPEG capture with bounded dimensions (maximum width 1280), HTTP/manifest timeouts and stderr reasons that do not disclose secrets. Associate media sequence and source time only when derivable from the same playlist snapshot; do not invent source time. Use AutoImageProcessor and Mask2FormerForUniversalSegmentation loaded locally with `use_safetensors=True`, `trust_remote_code=False`, `eval()` and `torch.inference_mode()`. Sum `class_queries_logits.softmax(-1)` (excluding no-object) times sigmoid mask logits, interpolate to source dimensions and normalize per pixel across classes. Group labels by names, not hardcoded ADE indices. Pin compatible dependency versions in an isolated venv after a successful compatibility check. Download only through explicit preparation; verify weight availability and license terms before downloading, then pin full revision. If the selected weights cannot be safely used, report the specific prerequisite and propose a documented alternative; never mark real inference verified using simulated output.
- [ ] **4. Run** tests; expect PASS. Download/setup requests that exceed sandbox permissions use the normal approval tool. Live capture/inference verification belongs to Task 8, not deterministic unit-test results.
- [ ] **5. Commit:** `feat: capture live camera frames and run pretrained water segmentation`.

### Task 4: Continuous Analysis Worker and Supervisor

**Files:** Create `backend/flood/worker.py`, `backend/tests/test_worker.py`.

**Interfaces:** `run_worker(settings:Settings,stop_event)->None`; CLI `python -m backend.flood.worker --once` for one catalog cycle and default continuous mode. `Scheduler(camera_ids:list[str],interval=60,capture_limit=2,queue_limit=4)` with `.due(now_monotonic)->list[str]`, `.completed(id,now_monotonic)->None`; `InferenceSupervisor(model_path,device,timeout=120)` with `.predict(capture,pixel_score)->Prediction`, `.close()->None`. Health heartbeat persists worker state, dependency/model reasons, actual cycle duration, queue depth and last accepted capture time.

- [ ] **1. Write failing tests** for one camera in-flight at a time, at most two capture children, one inference child, bounded pending queue, no catch-up flood after a slow cycle, SIGTERM cleanup and unknown observations on capture/model timeouts.

```python
def test_wall_clock_change_does_not_repeat_work():
    scheduler = Scheduler(['03', '05'], interval=60, capture_limit=2, queue_limit=4)
    first = scheduler.due(now_monotonic=100)
    for camera_id in first:
        scheduler.completed(camera_id, now_monotonic=100)
    assert not set(first).intersection(scheduler.due(now_monotonic=101))
```

Test restart resets Sequence; config change during inference is discarded by `Store.record`; readings older than 180 seconds at completion never become current. Token/runtime settings never enter logs.
- [ ] **2. Run** `python -m pytest backend/tests/test_worker.py -q`; expect missing-module failures.
- [ ] **3. Implement** monotonic round-robin scheduling over unique configured cameras, latest-only bounded capture queue and a persistent spawned inference child with hard timeout/restart. Do not analyze unconfigured cameras as clear; create setup snapshots on authenticated request separately. Store quality/error observations with null metrics; save event-start/end evidence as appropriate. Keep API unaffected by worker failure. Shutdown reaps all child processes and closes DB handles; heartbeat older than 180 seconds degrades service health.
- [ ] **4. Run** worker tests; expect PASS without depending on live ITIC or model downloads.
- [ ] **5. Commit:** `feat: supervise continuous flood analysis independently of the viewer`.

### Task 5: Read API, Historical Analytics and Configuration

**Files:** Create `backend/flood/analytics.py`, `backend/flood/api.py`, `backend/tests/test_analytics.py`, `backend/tests/test_api.py`.

**Interfaces:** `bucket_readings(readings,ids,start,end,bucket_seconds,fresh_age=180)->list[Bucket]`; `Bucket(start,end,valid_count,unknown_count,monitored_count,active_count,suspect_count,water_mean_pct:float|None,water_max_pct:float|None)`; `create_app(settings:Settings)->FastAPI`. Endpoint names match the spec exactly; add authenticated `POST /api/flood/cameras/{id}/snapshot` for a bounded setup capture, and authenticated `GET /api/flood/cameras/{id}/snapshot` to read it. All JSON response examples and error codes documented in operations guide.

- [ ] **1. Write failing tests** for allowed catalog IDs only, 401 without correct admin token, 409 on stale config revision, forbidden wildcard CORS, 422 on inverted dates/nonfinite coordinates, deterministic pagination, missing evidence 410 vs unknown evidence 404, and no token in responses. Historical boundary test:

```python
def test_active_sample_before_range_counts_until_it_goes_stale(reading_factory):
    r = reading_factory('03', captured_at=990, status='active')
    buckets = bucket_readings([r], ['03'], 1000, 1300, 60, fresh_age=180)
    assert buckets[0].active_count == 1
    assert buckets[-1].active_count == 0
    assert buckets[-1].unknown_count == 1
```

Test exact bucket endpoints, no sample borrowed from the future, mixed valid/unknown samples, shared camera groups without double counts, and null curve metrics in empty buckets.
- [ ] **2. Run** `python -m pytest backend/tests/test_analytics.py backend/tests/test_api.py -q`; expect missing-module failures.
- [ ] **3. Implement** FastAPI schemas, Bearer token verification with constant-time comparison, fixed configured CORS origins, response caching disabled, and latest freshness projection. Query history using half-open `[start,end)`; `readings_for_buckets` reads `[start-180,end]` inclusive of the final endpoint for status counts. Each bucket uses the last sample at or before its end, counted only if fresh and valid; a later unknown invalidates an earlier clear/active sample. Per-camera curve mean/max uses valid observations inside that half-open bucket only. Query limits: at most 30 days, 500 rows per history/event page, at most 720 buckets; reject oversized requests explicitly. Default buckets for 1h/24h/7d/30d: 60/300/1800/3600 seconds. Coverage chart requires a single camera; aggregate counts may span groups. Health exposes availability without filesystem paths or secrets. Snapshot POST respects capture concurrency and timeout.
- [ ] **4. Run** tests; expect PASS, including API reads while inference child is terminated. Add `python -m uvicorn backend.flood.api:app --host 127.0.0.1 --port 8100` startup and settings wiring.
- [ ] **5. Commit:** `feat: expose flood history analytics and protected camera configuration`.

### Task 6: Browser Data Lifecycle, Badges and Navigation

**Files:** Create `scripts/flood-config.js`, `scripts/flood-core.js`, `scripts/flood-client.js`, `scripts/flood-ui.js`, `scripts/navigation.js`, `tests/flood-core.test.cjs`, `tests/flood-client.test.cjs`; modify `index.html`, `styles.css`, `scripts/app.js`, `tools/build.cjs`, `tools/serve.cjs`, `tests/packaging.test.cjs`, `package.json`.

**Interfaces:** `CctvFloodConfig={apiBaseUrl:'http://127.0.0.1:8100',pollMs:15000,freshAgeSeconds:180}` (public, no secret); `CctvFloodCore.label(status)`, `.effective(reading,nowMs)`, `.chartSegments(buckets,valueKey)`; `CctvFloodClient.create({baseUrl,fetchImpl})` returns `.request(path,{signal,method,body,token})`, `.start(onUpdate)`, `.stop()`, `.refresh()`. `CctvFloodUI.init(client)` listens for `cctv:tiles-rendered`, updates badges and opens camera details. `CctvWall.setActive(active:boolean)` suspends/restarts playback and resets auto to false when suspended. `CctvNavigation.navigate({view:'live'|'analyst',cameraId?,groupId?,range?})` publishes `cctv:view-changed`.

- [ ] **1. Write failing tests** for Thai enum labels, unconfigured/null/stale/API failures, numeric zero distinct from missing, duplicate-ID counts, future timestamps and SVG path splitting at null buckets. Client tests resolve an older request after a new one and assert only the new response updates state; visibility and route changes stop polling; retries cannot multiply intervals.

```javascript
test('unknown values do not produce a zero line', () => {
  assert.equal(core.chartSegments([{ water_mean_pct: null }], 'water_mean_pct').length, 0);
  assert.equal(core.chartSegments([{ water_mean_pct: 0 }], 'water_mean_pct').length, 1);
});
```

- [ ] **2. Run** `node --test tests/flood-core.test.cjs tests/flood-client.test.cjs`; expect missing-module failures.
- [ ] **3. Implement** defer script order: existing data/core/player; flood config/core/client; existing app; flood UI/Analyst/editor; navigation initializer. Keep `#test` unchanged. Routes `#live` and `#analyst?camera=03&group=0&range=24h` validate IDs/ranges, support reload and back/forward. Modify `canPlay`, `tick` and keyboard guard in app to require live view; initial Analyst load must never start camera players. `setActive(false)` stops tour, disconnects observation and releases players without losing page/focus/filter state; returning reobserves existing tiles and retains camera position. Emit the tile-rendered event after each render. Badges are separate accessible buttons below footage, never replace playback indicators. Details show metric, score explanation, capture/source timestamps and evidence availability. Fetch uses AbortController, deadline and generation checks; API errors invalidate current status instead of keeping green badges. Build publishes only the expanded public file allowlist; test compares explicit list instead of fixed nine-file count, excludes backend/runtime/env files. Update JS syntax/test scripts.
- [ ] **4. Run** new tests and `npm.cmd run check`; expect PASS, including existing viewer regressions and no stale build output.
- [ ] **5. Commit:** `feat: add live-camera flood status and separate analyst navigation`.

### Task 7: Analyst Charts and ROI Setup

**Files:** Create `scripts/analyst.js`, `scripts/roi-editor.js`, `tests/flood-browser.cjs`; modify `index.html`, `styles.css`, `scripts/flood-ui.js`, `package.json`.

**Interfaces:** `CctvAnalyst.init({client,root})` listens for view changes, uses latest/analytics/events endpoints and renders summary, SVG charts and equivalent tables. `CctvRoiEditor.open(cameraId)` loads config, requests authenticated setup snapshot and submits `{roi,thresholds,enabled,expected_revision}`. Events and snapshots use IDs from API; no arbitrary HTML/file paths.

- [ ] **1. Write failing Playwright tests:** click Analyst from an active auto tour, assert tour stops and all videos release; return and assert same camera page with tour off. Assert charts/tables agree, selected single-camera coverage renders with % axis, unknown buckets split paths, all-camera coverage requests selection, groups deduplicate 13/14, stale/API unavailable and empty history are explicit. Test old filter responses, deep links/back/refresh and `#test` independently.

```javascript
await page.getByRole('link', { name: 'Analyst', exact: true }).click();
assert.equal(await page.locator('#analyst-view').isVisible(), true);
assert.equal(await page.locator('video').evaluateAll(v => v.some(x => x.getAttribute('src'))), false);
```

ROI tests draw on a letterboxed snapshot, resize/rotate the viewport and verify submitted normalized vertices still match source positions; crossing polygons cannot be saved; config 409 preserves unsaved edits with a reload message; token is absent from URL/storage/logs. Test expired evidence messages and keyboard interactions in dialogs. Mock API responses belong only to the test route fixtures.
- [ ] **2. Run** `node tests/flood-browser.cjs`; expect missing view/editor failures.
- [ ] **3. Implement** Analyst with restrained existing mint/navy styles, full-width primary charts, labelled summary counts and event rows. Default 24h; ranges 1h/24h/7d/30d. Display captured times with `Asia/Bangkok` and explain mean/max per bucket; distinguish actual sample absence from zero water. Provide accessible table fallback, keyboard focus restoration and live error announcements. ROI editor uses an SVG viewBox of actual image dimensions with preserveAspectRatio; pointer-to-image mapping uses inverse SVG screen transform, then normalizes vertices. Include undo/reset, explicit save, thresholds and enabled control; token resides only in closure memory, cleared on editor close. Bound image URLs to configured API origin; use textContent for API text. Keep mobile layouts usable at 320/390 and desktop at 768/1440 without page overflow.
- [ ] **4. Run** `node tests/flood-browser.cjs` and `npm.cmd run test:browser`; expect PASS and no page errors. Inspect saved screenshots at all four widths, including ROI/editor states and a chart with gaps; revise visual defects before proceeding.
- [ ] **5. Commit:** `feat: build analyst history charts and per-camera road region setup`.

### Task 8: Startup, Real-Source Verification and Handoff

**Files:** Create `backend/Dockerfile`, `compose.flood.yaml`, `.env.flood.example`, `tools/flood-live-check.py`, `tests/flood-live-browser.cjs`, `docs/flood-operations.md`, `docs/reviews/2026-10-03-flood-validation.md`; modify `README.md`, `.vercelignore`, `backend/requirements*.txt`, `package.json` as needed for verified setup.

**Interfaces:** Compose service names `flood-api`, `flood-worker`; common persistent volume mounted at `/app/runtime/flood`, FFmpeg available in container, API port 8100. `python tools/flood-live-check.py --camera 03 --cycles 2` produces timestamped JSON in ignored `runtime/flood/checks/`; `--all-cameras` measures real capture/inference cycle performance without enabling unreviewed ROIs. `node tests/flood-live-browser.cjs` runs against the actual local API, distinct from mocked browser tests.

- [ ] **1. Write startup/safety tests** proving production commands select real Segmenter, same volume is shared, backend/runtime/env files stay out of static packaging, missing admin token disables writes, and a missing FFmpeg/model leaves API operational with truthful health. No irreversible operations are part of startup. Run tests first and record expected failure for absent startup artifacts.
- [ ] **2. Implement** Docker/Windows-compatible instructions using an isolated `backend/.venv`, explicit model preparation, FFmpeg PATH/config, runtime permissions and API/worker commands. Host API defaults to localhost; Docker publication defaults to `127.0.0.1:8100:8100`. Document CORS origin changes, HTTPS reverse proxy/API base URL, 30/7-day retention, protected ROI setup for every camera, backup/restore with SQLite backup API, shutdown/restart, cadence tuning and model-version/config-version effects. Clarify static Vercel deployment alone does not run the worker. Record dependency/model pins and license references actually checked, never assumed.
- [ ] **3. Verify deterministic checks:** `npm.cmd run check`, `python -m pytest backend/tests -q`, `npm.cmd run test:browser`, `node tests/flood-browser.cjs`, `npm.cmd run build`, `git diff --check`. Expect every required check PASS; a failure must be fixed and rerun before completion claims. Use `docker compose -f compose.flood.yaml config` to verify service/volume configuration where Docker is available.
- [ ] **4. Verify actual pipeline:** capture camera 03 (or report unavailable and choose another catalog camera), visually inspect image and select a road ROI, then run real pretrained inference for at least two fresh captures. Read accepted observations from API, restart API/worker, and verify records and chart rows persist. Keep raw frames/masks/database in ignored runtime; deliver a concise validation report with true outcomes, source/capture times, model revision, ROI, timings and error counts. Do not infer flood precision/recall from ordinary dry-road footage.
- [ ] **5. Measure all 40 source IDs:** capture/inference once per reachable camera, report unconfigured ROI separately, unavailable source counts and elapsed/median/p95 time. Adjust configured interval if 60-second throughput is not achieved; report the measured cadence and freshness effect. A synthetic performance run is not evidence for the live round.
- [ ] **6. Check the actual UI:** run `node tests/flood-live-browser.cjs`, inspect real-data Analyst and badge screenshots, verify chart values match API/SQLite and no secret is exposed. Run existing live-video test if network/source access permits; clearly distinguish upstream unavailability from regressions. Never replace a required live test with a mock and call it passed.
- [ ] **7. Finish documentation and commit:** `feat: package and validate real camera flood analysis`. State which cameras have reviewed ROI, actual throughput, model accuracy evaluation limits, commands to run and any remaining external prerequisite. Use the branch-finishing workflow after final review; do not push/deploy without user authorization.

## Plan Self-Review

Spec coverage is mapped to Tasks 1–8: registry/geometry/status (1), persistence/events/retention (2), real capture/model/quality (3), scheduler/lifecycle (4), API/security/analytics (5), navigation/polling/player cleanup/packaging (6), graphs/tables/editor/accessibility (7), local/Docker operations and real-source evidence (8). Shared class/property names and endpoint paths are used consistently. Each Review Focus condition has a named test in its owning task. Model setup has an explicit verification prerequisite and cannot be replaced by random weights or fabricated results.

## Execution Handoff

Recommend **Native** execution in this session because the tasks share a tightly coupled Reading/config-revision contract and browser lifecycle, so one implementer can preserve continuity. Use `superpowers:executing-plans` after the user reviews this plan and chooses the method; perform one independent final review as prescribed by that skill. Alternatively, **Subagent-driven** execution gives separate implementation/review gates per task at higher context cost, using `superpowers:subagent-driven-development`.

No product code or dependencies have been changed during planning. A worktree is considered at execution time under `superpowers:using-git-worktrees`, using any user preference supplied at handoff.
