# Cameras 30, 40 and 41: visible footage remained paused

The reported message, “เลื่อนมาที่กล้องเพื่อดูภาพสด”, was the initial lazy-loading placeholder. The streams themselves returned HTTP 200, contained H.264 video, and played normally when selected individually.

Reproduced in the All camera wall at 1440×1000: the first nine eligible tiles in catalog order consumed all player slots. A partially clipped top row took four slots, leaving fully visible cameras 30, 40 and 41 paused below it. Taller viewports could show more than nine complete screens.

The wall now ranks the visible video area before allocating nine player slots. Equal-visibility rows follow the scroll direction so newly entered footage receives priority. Passive scroll events schedule one reconciliation per animation frame, and outgoing players are released before replacement players start. The cap and existing focus/swipe behavior are preserved.

Validation:

- `node tests/visibility-browser.cjs`: reproduces the old failure, passes the fix at viewport heights 900, 1000, 1080 and 1200, including upward scrolling and the nine-player limit.
- `npm run check`: 29 tests passed; `node tests/browser.cjs`: 93 checks passed; redesign browser: 22 checks passed; flood browser passed.
- `npm run build`: 24 public files.
- Real playback after the fix: cameras 30, 40 and 41 advanced in both desktop All view at 1440×1000 and mobile swipe view; no page errors. Evidence: `runtime/design-review/cameras-30-40-41.json` and `.png`.

Changes apply to this local workspace/build; no remote deployment was performed.
