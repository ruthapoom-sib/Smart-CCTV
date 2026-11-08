# Bright CCTV interface — 2026-10-05

Reworked the existing Live and Analysis interface following the approved Nintendo.com-inspired direction: white surfaces, a red CCTV identity, desktop navigation and search at the top, rounded controls, and larger camera images. Camera footage keeps its full 16:9 area; desktop walls scroll rather than compressing images. Mobile keeps the accessible drawer and single-camera swipe view. Existing GSAP entrance, drawer and content transitions remain available with reduced-motion and missing-library fallbacks.

Further visual refinement adds a full red masthead, warm off-white workspace, larger city typography, network counts, view icons and white camera captions. Top spacing keeps the first camera row and captions visible at 1440×900. Keyboard focus on red surfaces uses white outlines. Latest real-stream screenshots use the `refined-` prefix in `runtime/design-review/`; core, browser, redesign, flood and rain checks passed again after this refinement.

Desktop camera page changes reset vertical scrolling. Short landscape windows scroll the whole page so visible footage can meet the existing player's visibility threshold. Offscreen streams continue to pause. Dialog copy and chart legends were adjusted for readable contrast on white.

## Verification

- `npm run check`: 17 scripts checked; 29 tests passed.
- `npm run build`: 24 public files built successfully.
- `node tests/browser.cjs`: 93 checks passed.
- `node tests/redesign-browser.cjs`: 27 checks passed, including top navigation, 16:9 images, scroll/playback, pagination reset, landscape, drawer accessibility and 320–1440px layouts.
- Flood and rain browser suites passed with mocked analysis data.
- Visibility browser suite passed across 900–1200px heights; All view remained within nine streams.
- Real camera capture: two visible desktop streams and one mobile stream advanced, Anuphan loaded, no page errors. Below-screen streams were paused as intended.
- Independent review findings about contrast, page scrolling and landscape playback were fixed and checked.

## Evidence

- `runtime/design-review/bright-live-desktop.png`
- `runtime/design-review/bright-live-mobile.png`
- `runtime/design-review/bright-drawer.png`
- `runtime/design-review/bright-live-results.json`
- `runtime/design-review/bright-results.json`

Live captures show real streams. Analysis test images use fixtures and do not represent current city conditions. No deployment or git commit was requested.
