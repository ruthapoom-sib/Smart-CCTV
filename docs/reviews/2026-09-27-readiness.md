# Public CCTV viewer — validation report

Date: 2026-09-27. Scope: the local working tree, before any production deployment.

## Resumed-work final verification

Rechecked the pending quiet-buffering changes on 2026-09-27: `npm run check` passed all 16 Node tests; `npm run test:browser` passed all 40 Chromium checks; `git diff --check` passed. The live run at 11:04:37 UTC (18:04:37 Bangkok) confirmed all four desktop cameras advancing with no uncaught page errors. Reviewed the refreshed desktop and phone screenshots and rebuilt the nine-file `dist/` package with `npm run build`. Local follow-up is complete; production deployment and physical-device validation remain unverified.

## Quiet buffering update

Approved follow-up: transient buffering now uses a steady amber dot and “รอภาพ” in the caption. Connecting, buffering and offline states no longer put text over the footage; buffering no longer dims it. Persistent failures use “สัญญาณขัดข้อง” below the image and continue automatic retries. The autoplay permission prompt remains available over the image when a tap is required.

Reproduced a stale recovery deadline: after a stalled event, video time could advance without a new playing event, leaving the buffering state and deadline active. Media-time updates and the watchdog now clear that deadline when unpaused video advances. Frozen video still times out and retries; player disposal clears the additional event handler. This prevents the reproduced unnecessary reconnect, but does not eliminate interruptions at the public stream source.

Verification after this change: 16 Node tests and 40 Chromium checks pass, including unobscured buffering, recovery without another playing event, persistent freeze/retry and cleanup. Live smoke test at 10:57:18 UTC (17:57:18 Bangkok) recorded all four desktop videos advancing with zero uncaught page errors. Rebuilt the nine-file deployment package successfully. Not deployed.

## Earlier visual-pass validation

Revalidated the latest `index.html` and `styles.css` after the second visual pass on 2026-09-27. The syntax checks and all 12 Node tests pass; all 39 Chromium checks pass with zero uncaught page errors. The live run completed at 10:49:55 UTC (17:49:55 Bangkok): all four desktop cameras (03, 05, 06, 01) were live with advancing video time and no uncaught page errors.

Inspected the refreshed desktop and phone screenshots: captions stay below footage, controls and Thai labels remain readable, and the phone navigation stays at the bottom without covering the camera caption. Automated overflow checks pass at 320, 390, 768 and 1440 px. The latest source was rebuilt successfully into the nine-file `dist/` package. No application changes were needed during this final validation.

Local implementation and packaging are complete. Production deployment and physical-device validation remain separate; the earlier iPhone black/frozen-video report is not established as resolved by these Chromium results.

## Delivered

- A revised Thai interface with four-camera desktop default, single-camera mobile swipe, mobile overview, 1/4/9/16/all layouts, focus mode, keyboard controls and a help dialog.
- Camera-name, intersection-alias and ID search; favorites saved in the current browser; recoverable empty states.
- Playback-based status, bounded connection waits, stalled-playback recovery and cleanup of event handlers, timers and obsolete promises.
- Visibility-driven stream allocation; hidden, focused-away and offline cameras release their players.
- Pinned local HLS library, separated static application files, reproducible tests and a deployment package containing only nine public files.

## Verification

| Check | Result |
|---|---|
| `npm run check` | Pass: JavaScript syntax checks and 16 Node regression tests |
| `npm run test:browser` | Pass: 40 Chromium checks, zero uncaught page errors |
| `npm run test:live` | Pass: actual ITIC video time advances; see timestamped JSON below |
| `npm run build` | Pass: nine allowlisted files in `dist/` |
| Rebuild with stale output | Pass: stale fixture removed; resulting application matches source |
| Responsive widths | 320, 390, 768 and 1440 px: no horizontal page overflow |
| Review fixes | Passive mobile image action, stale accessible status and stale build files fixed and covered by regression checks |
| `git diff --check` | Pass; local Git reports only its existing LF/CRLF conversion warnings |

Browser coverage includes search, Thai input, favorites/reload/removal, corrupt and denied storage, intersections with shared cameras, focus/escape, pagination, auto tour, network recovery, page visibility, mobile lazy playback, camera selection from the overview, self-check and missing player-library fallback. Deterministic browser tests simulate an unavailable stream while running the real HLS player. They are distinct from the live-source test.

Initial failures were observed before fixes: retained video handlers after disposal, late autoplay rejection modifying a stopped tile, missing connection deadline, empty-result pagination, unavailable forced player, and stale build output. A later check also reproduced a missing connection deadline after retrying blocked autoplay, which is fixed.

## Evidence

- [Browser result JSON](evidence/browser-results.json)
- [Live-source result JSON](evidence/live-results.json)
- [Desktop screenshot](evidence/desktop.png)
- [Phone screenshot](evidence/mobile.png)
- [Phone overview screenshot](evidence/mobile-all.png)

The full-page mobile overview screenshot includes cameras below the viewport. Those are intentionally not connected until they become visible.

## Remaining verification outside this environment

Chromium automation and native-player logic tests do not establish compatibility on a physical iPhone/iPad or Smart TV. Test those devices and the final HTTPS deployment before claiming full device support. The 40-camera desktop view has not undergone a long-running hardware/load test; decoder, CPU and network capacity vary by device. Public ITIC streams can be delayed or unavailable independently of this application.

No commit, push or production deployment was performed. The preview and generated `dist/` are available locally.

## Dependency and implementation references

- hls.js remains pinned at 1.7.3, downloaded from `https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js`; SHA-256: `A12E7EE1CD64A69DCDB314157E45DAFCBA705BFB0B1440B7935CB265D374423E`. License retained alongside it.
- [HLS API documentation](https://github.com/video-dev/hls.js/blob/master/docs/API.md)
- [Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [Vercel static configuration](https://vercel.com/docs/project-configuration/vercel-json)
