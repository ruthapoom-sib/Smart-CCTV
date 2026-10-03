# Flood feature validation — 2026-10-03

## Outcome

Implementation adds the visible **Analysis** menu, per-camera water badges, persisted observations/events, charts and tables, ROI setup, a separate supervised worker and local/Docker startup. All view shows 40 readable tiles with at most nine visible live streams. Nothing in this feature branch has been pushed or deployed.

**Real trained-model inference is not verified and the end-to-end live acceptance remains incomplete.** Hugging Face download failed TLS negotiation using both the isolated Python client and Windows HTTP client, including approved network execution. No pretrained weights/revision were acquired, no synthetic result was substituted and no claim of flood accuracy is made. Model preparation must succeed before the real inference/restart/40-camera throughput acceptance can pass.

## Evidence

| Check | Result |
|---|---|
| Python deterministic tests | 38 passed after final review fixes |
| JS unit/packaging/syntax | 24 passed after final review fixes; all 11 app scripts checked |
| Existing viewer Playwright regressions | 93 passed, no uncaught errors |
| New browser fixtures | Navigation/player release, All stream cap, chart/table agreement, null gaps, deep-link/back/reload, evidence expiry, letterboxing/resize ROI geometry, conflict draft preservation, token clearing/storage and 320/390/768/1440 layout passed |
| Real local API/browser | API returned all 40 cameras; Analysis read actual API, model and worker unavailable were explicit |
| Compose configuration | `docker compose -f compose.flood.yaml config --quiet` passed; Docker build/run not performed |
| Library compatibility | Isolated transformers 4.57.6 + torch 2.13.0+cu126 semantic model classes import; CUDA available; actual weights absent |

Captured two real CCS03 frames at approximately 06:33:17 UTC (13:33:17 Thailand), visually inspected the road image, then configured only CCS03 with reviewed normalized ROI `[(.01,.18),(.70,.18),(.69,.92),(.01,.92)]`. Two further actual frames at approximately 06:35:10 UTC were accepted as **unknown/model_unavailable**, with null metrics. Frame source timestamps remain null: FFmpeg acquisition time is known, source clock/provenance is not. The remaining 39 cameras have no enabled reviewed ROI.

The real 40-ID capture diagnostic took **6.234 seconds** with two capture workers: **37 captured, 3 failed** (22, 23, 42). Median capture time was 0.281 seconds, p95 0.549 seconds. This is **capture-only throughput**, not capture plus segmentation or evidence that a 60-second analysis round is achievable. No inference timing/precision/recall is available. CPU/GPU cadence must be measured after model installation.

Local ignored evidence:

- `runtime/flood/checks/20261003T063316672207Z/result.json`: two real CCS03 captures, no trained model.
- `runtime/flood/checks/20261003T063353368407Z/result.json`: all 40 source IDs and capture errors.
- `runtime/flood/checks/20261003T063509448727Z/result.json`: configured CCS03, two accepted unknown observations.
- `runtime/flood/qa/analysis-*.png`, `roi-390.png`: **mock API fixtures**, visually inspected separately from real data.
- `runtime/flood/qa/analysis-live.png`: actual local API screenshot.

The provided protected Vercel preview redirects to Vercel login in available HTTP access; actual deployed UI could not be inspected. Local All regression tests establish the change, not a performance measurement of that protected deployment.

## Remaining acceptance

1. Download the primary Apache-2.0 BEiT pretrained safetensors with `tools/prepare-flood-model.py`; pin actual full revision/hashes in the runtime manifest.
2. Run two fresh real inferences on reviewed CCS03 ROI, inspect source/mask/overlay, read accepted valid values through API/browser and verify them after restart.
3. Run real segmentation for all reachable camera IDs without enabling unreviewed ROIs; record full-round median/p95/cadence and choose deployment capacity/interval accordingly.
4. Configure additional ROIs with reviewed road images and set the hosted HTTPS API URL/origins before publishing the feature.
5. Build/run containers on the intended host; current Docker validation is configuration-only.

This report intentionally separates deterministic fixtures, real capture, real API/error persistence and still-unverified model inference.

## Independent review and fixes

One independent reviewer inspected `4b38ca8..1628bf4`. No Critical or Minor findings; seven Important findings were reproduced with failing regressions and corrected in one fix pass:

1. The supervisor deadline now covers blocking send and complete receive during model initialization/inference. Timeout terminates/reaps the child and releases IPC.
2. Browser timeout and caller cancellation remain active through full JSON/image body consumption.
3. Stale open events close with `data_gap` at the last observed timestamp even without another worker result.
4. Model health requires a fresh supervised success and worker heartbeat, separately reporting installed files.
5. Event evidence has its own cancellation/generation guard; late errors/images cannot replace another event.
6. Retention maintenance runs even when every camera is disabled/unconfigured.
7. Evidence UUID lookup uses an indexed database expression, with a bounded-query regression over 5,000 retained rows.

API was restarted after three real unknown observations; all three remained present with null metrics. Existing live-video check passed: four advancing desktop players and one advancing mobile player, no uncaught errors. Final UI fixtures include evidence-request races in addition to the original coverage.

No reviewer was asked to claim unverified accuracy, weight compatibility/cadence, container runtime or deployed performance. Those external acceptance conditions remain as stated above.
