# Public CCTV viewer improvement

Audience confirmed: people checking traffic on phones and computers.

Keep the existing 40-camera catalog, Thai labels, native iOS playback, paged camera wall, manual-first auto tour and static hosting. Local usage needs no build. Deployment uses a dependency-free copy script to publish only the public files into dist/.

Visual direction: a calm charcoal workspace with clear Thai typography, restrained green accents and camera footage as the primary content. Separate orientation, search/filter controls and the camera wall. Keep labels below footage. Motion is limited to control feedback and camera/layout changes, with reduced-motion support.

Second visual pass after user feedback: use a neutral graphite canvas, teal only for selection and active state, and a compact city wordmark. Content hierarchy: city/navigation, search, a minimal camera toolbar, footage, a two-line caption, then playback controls. Remove enclosing card borders, reduce header height and let phone footage reach the viewport edges. Preserve the entire camera frame with contain sizing. Motion: brief camera entrance, reveal the expand affordance on hover/focus, and a restrained dialog entrance; all disabled by reduced-motion preference.

Implementation scope:
- Search camera names, codes and all intersection aliases; local favorites; clear empty states.
- Responsive camera grid, a one-camera swipe view on phones, accessible controls and an explicit return from focus mode.
- Default desktop view: four cameras for larger footage and fewer simultaneous streams. Existing saved layouts remain respected.
- Status based on active players, not HTTP playlist responses. Bound initial connection waits, recover stalled playback and clear all resources when players stop.
- Play only visible cameras; pause when hidden/offline; restore on return. Handle storage failures and unavailable fullscreen gracefully.
- Keep the pinned HLS library locally with its license. Split static assets into data, pure logic, player lifecycle and UI files for maintenance.
- Regression tests for playback lifecycle, filtering, mobile visibility and keyboard controls; real browser screenshots and a live-source smoke test.

Initial evidence: existing browser load plays HLS successfully; 40 unique cameras. Removed players retain onplaying and onended. Late play promise rejection can change a stopped tile. Initial connection has no timeout. Existing online count only checks playlist HTTP success. New regression tests reproduce these failures before the changes.

Acceptance: no runtime exceptions in tested flows; no horizontal overflow at 320/390/768/1440 pixels; favorites survive reload; zero-result filters recover; streams stop on hide/offline/focus-away; live-source failures remain explicit and do not break other cameras.
