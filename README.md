# 🎬 Article B-roll Generator

A desktop app that turns any web article into animated **B-roll** video. Load an
article, highlight the passages you care about, pick an animation style for each,
and export the result as an MP4 — the camera zooms into the page and reveals each
saved selection in sequence.

Built with **Electron** + an HTML canvas animation engine, encoded to MP4 with a
bundled **ffmpeg** (`ffmpeg-static`, no system install required).

---

## How it works

1. **Paste an article URL** in the top bar and click **Load**.
2. **Highlight a passage** in the page, then click **＋ Save selection** in the
   right sidebar. Repeat for as many passages as you like — they queue up as cards.
3. For each saved selection, choose:
   - **Animation style** (see below)
   - **Duration** (seconds the step is on screen)
   - **Highlight color** and **Border color**
4. Click **Capture page** — the app takes a full-length screenshot of the article
   and builds the animation.
5. Switch to the **B-roll preview** tab, press **▶ Play** or scrub the timeline.
6. Click **⬇ Export MP4** and choose where to save. Done.

## Animation styles

| Style | What it does |
|-------|--------------|
| **Headline reveal** | Zooms into the heading; a highlight + underline wipe in left-to-right. |
| **Read-along** | Camera focuses the passage; a marker highlight sweeps across the text line by line, with a reading cursor — as if it's being read aloud. |
| **Spotlight** | Dims the whole page and shines a soft spotlight on the passage. |
| **Box call-out** | Zooms in and draws an animated rounded box around the passage. |

An adjustable **intro shot** establishes the top of the article before the first
selection.

---

## Running

```bash
npm install      # installs Electron + bundled ffmpeg
npm start        # launches the app
```

### Building a distributable (optional)

```bash
npm run dist     # uses electron-builder -> dmg / nsis / AppImage
```

---

## Notes & limitations

- The full-page screenshot is captured via the Chrome DevTools Protocol at
  CSS-pixel scale, so saved selection rectangles line up exactly with the image.
- Extremely tall pages are clamped to ~16,384px (a Chromium texture limit);
  selections below that point won't be captured. Most articles are well within range.
- Selections are measured when you click *Save selection*. If the page reflows
  afterwards (lazy-loaded images, etc.), capture the page before scrolling far —
  for best results, save selections then capture promptly.
- Export renders deterministically frame-by-frame at 30fps and encodes with
  libx264 (`yuv420p`, faststart) for broad compatibility.

---

## Project layout

```
src/
  main.js             Electron main process: full-page capture (CDP) + MP4 export (ffmpeg)
  preload.js          Secure bridge (contextIsolation) exposing window.api
  webview-preload.js  Injected into the article page; reports selection geometry
  index.html          UI
  styles.css          Styling
  renderer.js         UI controller: loading, selections, preview, export
  animator.js         The animation engine (camera + per-style effects)
```
