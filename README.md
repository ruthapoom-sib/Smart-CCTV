# CCTV Smart City

A responsive live traffic camera viewer for Chachoengsao, Thailand, covering **40 cameras across 10 intersection groups**. Built with HTML, CSS, and JavaScript, using HLS streams from ITIC and camera listings from [CCS CCTV](https://sites.google.com/view/ccs-cctv).

## Features

- Search cameras by name, road, intersection, or ID.
- Filter intersections and save favorites in your browser.
- Desktop layouts with 1, 4, 9, 16, or all cameras.
- Mobile swipe navigation and an all-camera overview.
- Camera order follows the original intersection list; expanded navigation moves one camera at a time and layout changes preserve the current position.
- Automatic rotation, playback status, and stream recovery.
- Separate **Analysis** navigation for water status, historical charts, events and per-camera road ROI setup.
- All-camera overview uses readable scrolling tiles and at most nine visible streams.
- Mint and navy SVG logo combining a camera lens and city skyline, used in the header and favicon.

## Run locally

Requires **Node.js 20+**. No dependencies are needed to serve the app.

```sh
npm start
```

Open **http://127.0.0.1:8000**. Set `PORT` to use another port. Live streams require internet access.

After installing the backend dependencies and verified model, `npm run detect:start` starts the API, flood worker, rain worker and viewer together in the background. `npm run detect:status` checks the supervisor; `npm run detect:stop` stops its processes. The private ROI token is in ignored `runtime/detection/admin-token.txt`.

The current online viewer connects to the local detection host through an HTTPS Quick Tunnel. The Windows machine, detectors and tunnel must remain running. This is a temporary online connection; restarting the tunnel changes its URL and requires updating both public config files and redeploying. Use a persistent backend or named tunnel for unattended operation.

For real camera segmentation and persisted results, start the separate Python API and worker using [flood operations](docs/flood-operations.md). Static Vercel hosting alone cannot run analysis; configure a persistent backend with pretrained model files and reviewed camera ROIs. See [validation and remaining prerequisites](docs/reviews/2026-10-03-flood-validation.md).

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
