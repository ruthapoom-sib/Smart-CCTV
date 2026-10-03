# Real flood and rain pipeline — 2026-10-03

Microsoft's pretrained BEiT ADE20K checkpoint is now installed and runs real supervised segmentation. Hugging Face TLS failed even outside the sandbox; the original checkpoint URL published in Microsoft's unilm README worked.

- Model: `microsoft/unilm/beit-base-ade20k`, MIT license retained with the runtime model.
- Microsoft source revision: `31c5b904ca1bf2afb4c234a6675c683a4e5fc7cd`.
- Original artifact SHA256: `95bba2fea9f5f6e09293463d128d0f9958642c32605f8161f234cd85923be11a`.
- `tools/convert-beit-model.py` uses `weights_only=True`, checks exact artifact hash and class mapping, converts tensors following Hugging Face's converter, validates generated relative-position indices and loads all learned parameters strictly before writing safetensors.

Three real CCS07 captures produced accepted, non-null coverage values. Source, mask and overlay were inspected. The all-camera diagnostic captured and segmented 37/40 registered camera sources in 34.281 seconds on CUDA; sources 22, 23 and 42 were unavailable. Per-camera ROI remains required; this throughput test does not enable unreviewed areas.

Initially reviewed flood ROIs enabled: 03, 07, 08. Rain 07's existing full-frame ROI admitted vehicle motion as rain streaks, so the initial deployment used a static building facade. The user subsequently explicitly requested all cameras and the entire image. Both detectors are now enabled for all 40 registered cameras, with polygon `[(0,0),(1,0),(1,1),(0,1)]`. Previous configurations were backed up under ignored `runtime/detection/config-before-all-*.json`; updates used authenticated, revision-checked API writes and retained existing thresholds. Three fresh consecutive observations are required for rain confirmation; no production readings were synthesized.

Full-frame dry clips from 03/07/36 reproduced the original rain false positives. Detector `v2-full-frame` filters pixel noise, persistent edges, and dense large object motion before counting thin transient streaks. Object suppression requires dark-motion support or a broad undilated component so nearby genuine streaks are retained. Regression cases cover moving vehicles, persistent edges, sparse rain, clustered rain, and rain outside a moving vehicle. The three saved dry clips now classify dry. This is limited regression evidence, not labeled weather accuracy validation.

The configured fleet must still distinguish unavailable sources from dry/clear scenes: 22, 23 and 42 return upstream 404. They remain enabled and are retried. `node tests/detection-all-browser.cjs` verifies full-frame configurations, all 40 analysis rows, fresh actual observations and rendered analytics without fixture API responses.

API, both workers and viewer run via `npm run detect:start`. Logs and private token remain under ignored `runtime/detection`. Model weights/evidence are ignored. Rain runtime files are removed from Git's index while preserving their local copies.

Online connection: `https://detective-seats-elimination-shaped.trycloudflare.com`. Public health and both 40-camera endpoints returned 200 with CORS limited to `https://smart-cctv-beige.vercel.app`; snapshots still require a private token. This temporary tunnel depends on the Windows machine staying on. Its hostname changes when recreated; this is not permanent unattended hosting.

Independent review found launcher singleton/port/stop races and inconsistent configured rain freshness. Regression fixes add a lifetime lock, reject occupied ports, wait for shutdown, and propagate freshness through classification/store/API/browser.

Pipeline operation is verified separately from detector accuracy. General ADE20K segmentation and the rain streak heuristic have not been calibrated against labeled local flooding/rain events. Current dry/clear results establish data flow and persistence, not precision/recall.
