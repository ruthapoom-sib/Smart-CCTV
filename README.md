# CCTV Smart City

A responsive live traffic camera viewer for Chachoengsao, Thailand, covering **40 cameras across 10 intersection groups**. Built with HTML, CSS, and JavaScript, using HLS streams from ITIC and camera listings from [CCS CCTV](https://sites.google.com/view/ccs-cctv).

## Features

- Search cameras by name, road, intersection, or ID.
- Filter intersections and save favorites in your browser.
- Desktop layouts with 1, 4, 9, 16, or all cameras.
- Mobile swipe navigation and an all-camera overview.
- Camera order follows the original intersection list; expanded navigation moves one camera at a time and layout changes preserve the current position.
- Automatic rotation, playback status, and stream recovery.
- Mint and navy SVG logo combining a camera lens and city skyline, used in the header and favicon.

## Run locally

Requires **Node.js 20+**. No dependencies are needed to serve the app.

```sh
npm start
```

Open **http://127.0.0.1:8000**. Set `PORT` to use another port. Live streams require internet access.

## Test

```sh
npm run check
npm ci
npx playwright install chromium
npm run test:browser
npm run test:live
```

Browser tests simulate stream failures; live tests depend on upstream availability. Results are saved in `docs/reviews/evidence/`.

## Build and deploy

```sh
npm run build
```

Publish `dist/` to an HTTPS static host. For Vercel, choose the **Other** framework preset; `vercel.json` includes the build settings. No backend or API keys are required.

## Customize

- `scripts/data.js` — camera groups and stream URLs.
- `styles.css` — responsive styling.
- `assets/favicon.svg` — shared app logo and browser icon.

## Notes

Streams may be delayed or unavailable. No video recording or playback history is provided. Favorites and settings stay in the current browser. Reduce the number of visible cameras if playback slows down.

Keyboard shortcuts: **Left/Right** to navigate, **Space** to toggle rotation, **F** for fullscreen, and **Esc** to exit expanded view or close help.

Developed by **Ruthapoom Sib**. Bundled hls.js license: `vendor/hls-LICENSE`.
