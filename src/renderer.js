'use strict';

/* ====================================================================
 *  UI controller: article loading, selection capture, preview & export.
 * ==================================================================== */

const $ = (sel) => document.querySelector(sel);

const els = {
  urlInput: $('#url-input'),
  loadBtn: $('#load-btn'),
  openPdfBtn: $('#open-pdf-btn'),
  autoBtn: $('#auto-btn'),
  captureBtn: $('#capture-btn'),
  article: $('#article'),
  pdfScroll: $('#pdf-scroll'),
  pdfPages: $('#pdf-pages'),
  pageHint: $('#page-hint'),
  saveBtn: $('#save-selection-btn'),
  pending: $('#pending'),
  list: $('#selection-list'),
  introDur: $('#intro-dur'),
  targetDur: $('#target-dur'),
  totalReadout: $('#total-readout'),
  fitBtn: $('#fit-btn'),
  voiceToggle: $('#voice-toggle'),
  voiceEng: $('#voice-eng'),
  status: $('#status'),
  tabs: document.querySelectorAll('.tab'),
  previewTab: $('#preview-tab'),
  pageView: $('#page-view'),
  previewView: $('#preview-view'),
  canvas: $('#preview-canvas'),
  playBtn: $('#play-btn'),
  scrub: $('#scrub'),
  timeLabel: $('#time-label'),
  exportBtn: $('#export-btn'),
  overlay: $('#export-overlay'),
  exportBar: $('#export-bar'),
  exportStatus: $('#export-status'),
  exportTitle: $('#export-title'),
  cardTpl: $('#selection-card-template')
};

const OUT_W = 1920, OUT_H = 1080, FPS = 30;
const MIN_TOTAL = 60, MAX_TOTAL = 180; // exported B-roll must be 1–3 minutes

const state = {
  mode: 'web',          // 'web' (article webview) | 'pdf' (PDF.js view)
  ttsEngine: null,      // name of the OS voice engine, or null if none
  pending: null,        // { text, rects, bbox }
  selections: [],       // saved selection configs
  screenshot: null,     // { img, w, h }
  scene: null,
  playing: false,
  rafId: null,
  playStart: 0,         // performance.now() reference
  offset: 0             // seconds into the timeline
};

let nextId = 1;

/* ----------------------- article webview ----------------------- */

els.article.setAttribute('preload', window.api.webviewPreloadPath);

function normalizeUrl(raw) {
  let u = (raw || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function showWeb() {
  els.article.classList.remove('hidden');
  els.pdfScroll.classList.add('hidden');
}
function showPdf() {
  els.article.classList.add('hidden');
  els.pdfScroll.classList.remove('hidden');
}

function loadArticle() {
  const url = normalizeUrl(els.urlInput.value);
  if (!url) return;
  if (/\.pdf(\?|#|$)/i.test(url)) { loadPdfFromUrl(url); return; }
  resetForNewPage();
  state.mode = 'web';
  showWeb();
  setStatus('Loading article…');
  els.article.src = url;
}

async function startPdf(data, name) {
  resetForNewPage();
  state.mode = 'pdf';
  showPdf();
  setStatus('Rendering PDF…');
  try {
    const r = await window.PdfView.load(data, { maxPages: 40 });
    els.captureBtn.disabled = false;
    els.autoBtn.disabled = false;
    const pageInfo = r.truncated
      ? 'first ' + r.renderedPages + ' of ' + r.pageCount + ' pages'
      : r.pageCount + ' page' + (r.pageCount === 1 ? '' : 's');
    setStatus('PDF ready (' + pageInfo + (name ? ' · ' + name : '') +
      '). Highlight a passage to begin.');
  } catch (err) {
    setStatus('Failed to render PDF: ' + err.message);
  }
}

async function loadPdfFromUrl(url) {
  resetForNewPage();
  state.mode = 'pdf';
  showPdf();
  setStatus('Downloading PDF…');
  try {
    const f = await window.api.downloadPdf(url);
    await startPdf(f.data, f.name);
  } catch (err) {
    setStatus('PDF download failed: ' + err.message);
    state.mode = 'web';
    showWeb();
  }
}

els.loadBtn.addEventListener('click', loadArticle);
els.urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadArticle(); });

els.openPdfBtn.addEventListener('click', async () => {
  let f;
  try { f = await window.api.openPdf(); } catch (err) { setStatus('Open failed: ' + err.message); return; }
  if (!f) return;
  startPdf(f.data, f.name);
});

// Selections from the PDF text layer funnel into the same pending pipeline.
window.PdfView.init(els.pdfPages, (info) => { if (state.mode === 'pdf') setPending(info); });

els.article.addEventListener('did-finish-load', () => {
  els.captureBtn.disabled = false;
  setStatus('Article loaded. Highlight a passage to begin.');
});
els.article.addEventListener('did-fail-load', (e) => {
  if (e.errorCode === -3) return; // aborted (e.g. redirect) — ignore
  setStatus('Could not load that page (' + (e.errorDescription || e.errorCode) + ').');
});

// Common pending-selection handler for both the webview and the PDF view.
function setPending(info) {
  state.pending = info;
  if (info && info.text) {
    els.pending.textContent = '“' + info.text + '”';
    els.pending.classList.remove('empty');
    els.saveBtn.disabled = false;
  } else {
    els.pending.textContent = 'No text selected.';
    els.pending.classList.add('empty');
    els.saveBtn.disabled = true;
  }
}

// Selection geometry reported from the injected webview preload.
els.article.addEventListener('ipc-message', (e) => {
  if (e.channel !== 'broll-selection') return;
  if (state.mode === 'web') setPending(e.args[0]);
});

function resetForNewPage() {
  state.pending = null;
  state.selections = [];
  state.screenshot = null;
  state.scene = null;
  stopPlayback();
  window.PdfView.clear();
  renderList();
  els.pending.textContent = 'No text selected.';
  els.pending.classList.add('empty');
  els.saveBtn.disabled = true;
  els.previewTab.disabled = true;
  els.exportBtn.disabled = true;
  els.playBtn.disabled = true;
  els.scrub.disabled = true;
  els.autoBtn.disabled = true;
  switchTab('page');
}

/* ----------------------- selections ----------------------- */

els.saveBtn.addEventListener('click', () => {
  if (!state.pending) return;
  state.selections.push({
    id: nextId++,
    text: state.pending.text,
    narration: state.pending.text,
    rects: state.pending.rects,
    bbox: state.pending.bbox,
    style: 'headline',
    durationSec: 3,
    highlightColor: '#ffd400',
    borderColor: '#ff2d55'
  });
  // clear pending so the same selection isn't queued twice
  state.pending = null;
  els.pending.textContent = 'Saved! Highlight another passage.';
  els.pending.classList.add('empty');
  els.saveBtn.disabled = true;
  renderList();
  rebuildScene();
  setStatus(state.selections.length + ' selection(s) queued.');
});

function renderList() {
  els.list.innerHTML = '';
  state.selections.forEach((sel, i) => {
    const node = els.cardTpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.card-index').textContent = String(i + 1);
    node.querySelector('.card-text').textContent = sel.text;

    const styleSel = node.querySelector('.style-select');
    const durInput = node.querySelector('.dur-input');
    const hlInput = node.querySelector('.hl-input');
    const bdInput = node.querySelector('.bd-input');

    styleSel.value = sel.style;
    durInput.value = sel.durationSec;
    hlInput.value = sel.highlightColor;
    bdInput.value = sel.borderColor;

    styleSel.addEventListener('change', () => { sel.style = styleSel.value; rebuildScene(); });
    durInput.addEventListener('change', () => {
      sel.durationSec = Math.max(0.5, parseFloat(durInput.value) || 3);
      durInput.value = sel.durationSec; rebuildScene(); updateTotalReadout();
    });
    hlInput.addEventListener('input', () => { sel.highlightColor = hlInput.value; renderCurrentFrame(); });
    bdInput.addEventListener('input', () => { sel.borderColor = bdInput.value; renderCurrentFrame(); });

    const narrInput = node.querySelector('.narr-input');
    narrInput.value = sel.narration || '';
    narrInput.addEventListener('input', () => { sel.narration = narrInput.value; });

    node.querySelector('.del').addEventListener('click', () => {
      state.selections = state.selections.filter((s) => s.id !== sel.id);
      renderList();
      rebuildScene();
      updateTotalReadout();
    });

    els.list.appendChild(node);
  });
  updateTotalReadout();
}

els.introDur.addEventListener('change', () => { rebuildScene(); updateTotalReadout(); });

/* ----------------------- duration window (1–3 min) ----------------------- */

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.round(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}

// Total length independent of capture, mirroring how buildScene sums steps.
function computeTotal() {
  const intro = parseFloat(els.introDur.value) || 0;
  const sum = state.selections.reduce((acc, x) => acc + Math.max(0.5, x.durationSec || 0), 0);
  return (intro > 0.01 ? intro : 0) + sum;
}

function updateTotalReadout() {
  const total = computeTotal();
  els.totalReadout.textContent = fmtTime(total);
  const inRange = total >= MIN_TOTAL && total <= MAX_TOTAL;
  els.totalReadout.classList.toggle('in-range', state.selections.length > 0 && inRange);
  els.totalReadout.classList.toggle('out-range', state.selections.length > 0 && !inRange);
  els.fitBtn.disabled = state.selections.length === 0;
  els.totalReadout.title = inRange
    ? 'Within the 1–3 minute window'
    : 'Outside 1–3 min — use “Fit to target” before exporting';
}

// Scale every step's duration so the total lands on the chosen target.
function fitToTarget() {
  if (state.selections.length === 0) return;
  let target = parseFloat(els.targetDur.value) || 90;
  target = Math.max(MIN_TOTAL, Math.min(MAX_TOTAL, target));
  els.targetDur.value = target;

  const intro = parseFloat(els.introDur.value) || 0;
  const minSum = state.selections.length * 0.5;
  let budget = Math.max(minSum, target - (intro > 0.01 ? intro : 0));
  const curSum = state.selections.reduce((a, x) => a + Math.max(0.5, x.durationSec || 0), 0) || 1;
  const k = budget / curSum;
  state.selections.forEach((x) => {
    x.durationSec = Math.max(0.5, Math.round(Math.max(0.5, x.durationSec || 0) * k * 10) / 10);
  });

  renderList();
  rebuildScene();
  setStatus('Fit step durations to ' + fmtTime(computeTotal()) + ' (target ' + fmtTime(target) + ').');
}

els.fitBtn.addEventListener('click', fitToTarget);
els.targetDur.addEventListener('change', updateTotalReadout);

/* ----------------------- capture ----------------------- */

async function doCapture() {
  if (state.selections.length === 0) {
    setStatus('Add or auto-detect at least one selection before capturing.');
    return false;
  }
  setStatus('Capturing full page…');
  els.captureBtn.disabled = true;
  try {
    let shot;
    if (state.mode === 'pdf') {
      shot = window.PdfView.capture();
    } else {
      const wcId = els.article.getWebContentsId();
      shot = await window.api.captureFullPage(wcId);
    }

    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { state.screenshot = { img, w: shot.width, h: shot.height }; resolve(); };
      img.onerror = () => reject(new Error('Failed to decode the screenshot.'));
      img.src = shot.dataUrl;
    });

    rebuildScene();
    els.previewTab.disabled = false;
    switchTab('preview');
    setStatus('Captured. Press Play to preview, then Export.');
    return true;
  } catch (err) {
    setStatus('Capture failed: ' + err.message);
    return false;
  } finally {
    els.captureBtn.disabled = false;
  }
}

els.captureBtn.addEventListener('click', doCapture);

// One-click: detect the paper's key highlights, capture, and fit to target.
async function autoHighlight() {
  if (state.mode !== 'pdf') {
    setStatus('Auto-highlight currently supports PDFs. Load a PDF to use it.');
    return;
  }
  const info = window.PdfView.getTextItems();
  const hs = window.Highlights.fromTextItems(info);
  if (!hs.length) {
    setStatus('Could not detect key highlights automatically — try highlighting manually.');
    return;
  }
  state.selections = hs.map((h) => ({
    id: nextId++,
    text: h.text,
    narration: h.text,
    rects: h.rects,
    bbox: h.bbox,
    style: h.style,
    durationSec: 8,
    highlightColor: '#ffd400',
    borderColor: '#ff2d55'
  }));
  renderList();
  setStatus(hs.length + ' key highlights detected. Capturing…');
  const ok = await doCapture();
  if (ok) {
    fitToTarget();
    setStatus(hs.length + ' key highlights · ' + fmtTime(computeTotal()) + ' digest ready. Press Play, then Export.');
  }
}

els.autoBtn.addEventListener('click', autoHighlight);

function rebuildScene() {
  if (!state.screenshot || state.selections.length === 0) {
    state.scene = null;
    return;
  }
  state.scene = window.Broll.buildScene({
    image: state.screenshot.img,
    imgW: state.screenshot.w,
    imgH: state.screenshot.h,
    outW: OUT_W,
    outH: OUT_H,
    selections: state.selections,
    introDur: parseFloat(els.introDur.value) || 0
  });
  state.offset = Math.min(state.offset, state.scene.totalDuration);
  els.scrub.disabled = false;
  els.playBtn.disabled = false;
  els.exportBtn.disabled = false;
  renderCurrentFrame();
  updateTimeLabel();
}

/* ----------------------- preview playback ----------------------- */

const ctx = els.canvas.getContext('2d');

function renderCurrentFrame() {
  if (!state.scene) return;
  state.scene.render(ctx, state.offset);
}

function updateTimeLabel() {
  const total = state.scene ? state.scene.totalDuration : 0;
  els.timeLabel.textContent = state.offset.toFixed(1) + 's / ' + total.toFixed(1) + 's';
  els.scrub.value = total > 0 ? Math.round((state.offset / total) * 1000) : 0;
}

function tick() {
  if (!state.playing || !state.scene) return;
  const now = performance.now();
  state.offset = (now - state.playStart) / 1000;
  if (state.offset >= state.scene.totalDuration) {
    state.offset = state.scene.totalDuration;
    renderCurrentFrame();
    updateTimeLabel();
    stopPlayback();
    return;
  }
  renderCurrentFrame();
  updateTimeLabel();
  state.rafId = requestAnimationFrame(tick);
}

function startPlayback() {
  if (!state.scene) return;
  if (state.offset >= state.scene.totalDuration - 1e-3) state.offset = 0;
  state.playing = true;
  els.playBtn.textContent = '❚❚ Pause';
  state.playStart = performance.now() - state.offset * 1000;
  state.rafId = requestAnimationFrame(tick);
}

function stopPlayback() {
  state.playing = false;
  els.playBtn.textContent = '▶ Play';
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
}

els.playBtn.addEventListener('click', () => {
  if (state.playing) stopPlayback(); else startPlayback();
});

els.scrub.addEventListener('input', () => {
  if (!state.scene) return;
  stopPlayback();
  state.offset = (els.scrub.value / 1000) * state.scene.totalDuration;
  renderCurrentFrame();
  updateTimeLabel();
});

/* ----------------------- tabs ----------------------- */

function switchTab(view) {
  els.tabs.forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  els.pageView.classList.toggle('active', view === 'page');
  els.previewView.classList.toggle('active', view === 'preview');
}
els.tabs.forEach((t) => {
  t.addEventListener('click', () => { if (!t.disabled) switchTab(t.dataset.view); });
});

/* ----------------------- export ----------------------- */

els.exportBtn.addEventListener('click', async () => {
  if (!state.scene) return;
  stopPlayback();

  const voiceOn = els.voiceToggle.checked && !!state.ttsEngine;
  let narrDir = null;       // temp dir holding narration wavs
  let narrByIndex = {};     // selection index -> wav path

  try {
    // 1) Voiceover: synthesize narration first so step lengths can fit speech.
    if (voiceOn) {
      showOverlay(true, 'Exporting…', 'Generating narration…');
      narrDir = await window.api.exportBegin();
      const items = state.selections.map((s, i) => ({ index: i, text: (s.narration || s.text || '').trim() }))
        .filter((it) => it.text);
      const { engine, results } = await window.api.ttsSynthesize({ dir: narrDir, items });
      if (engine && results.length) {
        results.forEach((r) => {
          if (r.wav && r.duration > 0) {
            narrByIndex[r.index] = r.wav;
            // step must be long enough to speak the line (+ a short tail)
            const need = r.duration + 0.6;
            if (state.selections[r.index]) {
              state.selections[r.index].durationSec = Math.max(state.selections[r.index].durationSec, +need.toFixed(2));
            }
          }
        });
        renderList();
        rebuildScene();
        updateTotalReadout();
      }
    }

    // 2) Enforce the 1–3 minute window (after any narration adjustment).
    const total = state.scene.totalDuration;
    if (total < MIN_TOTAL || total > MAX_TOTAL) {
      showOverlay(false);
      if (narrDir) window.api.exportCancelCleanup(narrDir);
      setStatus('Length is ' + fmtTime(total) + ' — must be between 1:00 and 3:00. ' +
        (total < MIN_TOTAL ? 'Add highlights or raise durations' : 'Remove highlights or lower durations') +
        ', then export again.');
      els.fitBtn.classList.add('attention');
      setTimeout(() => els.fitBtn.classList.remove('attention'), 1500);
      return;
    }

    const outputPath = await window.api.chooseExportPath();
    if (!outputPath) { showOverlay(false); if (narrDir) window.api.exportCancelCleanup(narrDir); return; }

    const frames = Math.max(1, Math.ceil(total * FPS));
    const off = document.createElement('canvas');
    off.width = OUT_W; off.height = OUT_H;
    const octx = off.getContext('2d');

    // 3) Render frames -> silent MP4.
    showOverlay(true, 'Exporting…', 'Rendering frames…');
    const dir = await window.api.exportBegin();
    try {
      for (let i = 0; i < frames; i++) {
        state.scene.render(octx, i / FPS);
        await window.api.exportFrame({ dir, index: i, dataUrl: off.toDataURL('image/png') });
        setExportProgress(Math.round(((i + 1) / frames) * 100), 'Rendering frame ' + (i + 1) + ' of ' + frames + '…');
      }
      setExportProgress(100, 'Encoding MP4 (ffmpeg)…');
      await window.api.exportEncode({ dir, fps: FPS, outputPath });
    } catch (e) {
      window.api.exportCancelCleanup(dir);
      throw e;
    }

    // 4) Voiceover: assemble a timeline-aligned track and mux it in.
    if (voiceOn && Object.keys(narrByIndex).length) {
      setExportProgress(100, 'Adding voiceover…');
      const intro = parseFloat(els.introDur.value) || 0;
      const segments = [];
      if (intro > 0.01) segments.push({ len: intro, wav: null });
      state.selections.forEach((s, i) => {
        segments.push({ len: Math.max(0.5, s.durationSec), wav: narrByIndex[i] || null });
      });
      await window.api.muxAudio({ dir: narrDir, videoPath: outputPath, outputPath, segments });
      narrDir = null; // muxAudio cleans it up
    } else if (narrDir) {
      window.api.exportCancelCleanup(narrDir);
      narrDir = null;
    }

    showOverlay(true, 'Done ✓', 'Saved to ' + outputPath);
    setTimeout(() => showOverlay(false), 1800);
    setStatus('Exported' + (voiceOn ? ' with voiceover' : '') + ': ' + outputPath);
  } catch (err) {
    if (narrDir) window.api.exportCancelCleanup(narrDir);
    showOverlay(true, 'Export failed', err.message);
    setTimeout(() => showOverlay(false), 3000);
    setStatus('Export failed: ' + err.message);
  }
});

function showOverlay(show, title, status) {
  els.overlay.classList.toggle('hidden', !show);
  if (title) els.exportTitle.textContent = title;
  if (status) els.exportStatus.textContent = status;
  if (show && title === 'Exporting…') setExportProgress(0, status);
}
function setExportProgress(pct, status) {
  els.exportBar.style.width = pct + '%';
  if (status) els.exportStatus.textContent = status;
}

/* ----------------------- misc ----------------------- */
function setStatus(msg) { els.status.textContent = msg; }

// Initialise the total readout on load.
updateTotalReadout();

// Detect the OS voice engine and configure the voiceover toggle.
(async () => {
  try {
    const eng = await window.api.ttsAvailable();
    state.ttsEngine = eng;
    if (eng) {
      els.voiceToggle.checked = true;
      els.voiceEng.textContent = '(' + eng + ')';
    } else {
      els.voiceToggle.checked = false;
      els.voiceToggle.disabled = true;
      els.voiceEng.textContent = '— no system voice found';
    }
  } catch (_) {
    els.voiceToggle.disabled = true;
  }
})();
