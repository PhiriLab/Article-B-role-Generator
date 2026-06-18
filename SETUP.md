# Setup & Testing Guide

Article B-roll Generator is a **desktop GUI app** (built with Electron). Run it on
your own computer — macOS, Windows, or Linux with a display. It will not run in a
headless/cloud shell.

---

## 1. Install Node.js

You need **Node.js 18 or newer**. Get it from <https://nodejs.org> (the LTS build
is fine). Verify:

```bash
node --version
```

## 2. Get the code

```bash
git clone https://github.com/PhiriLab/Article-B-role-Generator.git
cd Article-B-role-Generator
git checkout claude/nice-franklin-v3qbav
```

## 3. Launch

**One command (recommended):** the launcher installs dependencies on first run,
then starts the app.

- macOS / Linux:
  ```bash
  ./run.sh
  ```
- Windows (double-click `run.bat`, or from a terminal):
  ```bat
  run.bat
  ```

**Or do it manually:**

```bash
npm install     # first time only — pulls Electron + bundled ffmpeg
npm start
```

> The bundled `ffmpeg-static` means you do **not** need to install ffmpeg yourself.

A window titled **Article B-roll Generator** opens.

---

## 4. Test with an article or PDF

You can load **either** a web article (URL) **or** a PDF:

- **Web article:** paste the URL and click **Load**.
- **PDF:** click **Open PDF…** to choose a local file, or paste a direct `.pdf`
  URL and click **Load** (it downloads, then renders). PDFs are rendered with a
  selectable text layer, so highlighting works just like on a web page. Large PDFs
  are capped to the first 40 pages for the capture.

### Auto-highlight & voiceover (PDF digests)

- **✨ Auto-highlight** (PDFs): one click detects the paper's title, abstract, and
  key sections, queues them as styled selections, captures, and fits the result to
  your **target length** (the 1–3 minute window is enforced on export).
- **Voiceover**: toggle it on to narrate each highlight with your computer's voice
  (macOS `say`, Windows SAPI, Linux `espeak-ng`). Edit the **Narration** text on
  each card. On **Linux** install a voice first: `sudo apt install espeak-ng`. If no
  voice engine is found the toggle is disabled and export stays silent.

Then:

1. **Load the article URL** (a news story, blog post, or Wikipedia page) and wait
   for it to render — or open a PDF as above.
2. **Drag-select a passage** of text in the page. It shows up in the right
   sidebar — click **＋ Save selection**. Repeat for a few passages (try a
   heading and a body paragraph).
3. On each selection card choose a **style** and adjust **duration**,
   **highlight color**, and **border color**:
   - **Headline reveal** – zoom into the heading with a wipe-in highlight
   - **Read-along** – marker sweeps across the text line by line
   - **Spotlight** – dims the page, spotlights the passage
   - **Box call-out** – zoom in and draw a box around the passage
4. Click **Capture page** (top right). The app screenshots the full article and
   switches to the **B-roll preview** tab.
5. Press **▶ Play** or drag the scrubber to preview.
6. Click **⬇ Export MP4**, choose a location, and it renders and saves the video.

---

## Tips for a clean first test

- Pick an article that **loads fully without a paywall or cookie banner** over the
  text — those overlays get captured in the screenshot too. A plain blog post or a
  Wikipedia article works well.
- **Save your selections, then click Capture promptly.** Selections are measured at
  save time, so avoid scrolling or resizing a lot between saving and capturing.
- Start with **2–3 short selections** so your first export finishes quickly.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `electron: command not found` / app won't start | Run `npm install` first (or use the launcher). |
| Linux, running as **root**: app exits with a sandbox error | Start with `npm start -- --no-sandbox`. On a normal user account this isn't needed. |
| Page won't load | Check the URL is reachable in a normal browser; some sites block embedding or require login. |
| Export fails | Make sure you captured the page first and have at least one saved selection. |

---

## Building a standalone installer (optional)

To produce a distributable app (`.dmg` / `.exe` / `.AppImage`):

```bash
npm run dist
```

Output lands in `dist/`.
