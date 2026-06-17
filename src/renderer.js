'use strict';

/* ====================================================================
 *  UI controller: article loading, selection capture, preview & export.
 * ==================================================================== */

const $ = (sel) => document.querySelector(sel);

const els = {
  urlInput: $('#url-input'),
  loadBtn: $('#load-btn'),
  openPdfBtn: $('#open-pdf-btn'),
  captureBtn: $('#capture-btn'),
  article: $('#article'),
  pdfScroll: $('#pdf-scroll'),
  pdfPages: $('#pdf-pages'),
  pageHint: $('#page-hint'),
  saveBtn: $('#save-selection-btn'),
  pending: $('#pending'),
  list: $('#selection-list'),
  introDur: $('#intro-dur'),
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

const state = {
  mode: 'web',          // 'web' (article webview) | 'pdf' (PDF.js view)
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
  switchTab('page');
}

/* ----------------------- selections ----------------------- */

els.saveBtn.addEventListener('click', () => {
  if (!state.pending) return;
  state.selections.push({
    id: nextId++,
    text: state.pending.text,
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
      durInput.value = sel.durationSec; rebuildScene();
    });
    hlInput.addEventListener('input', () => { sel.highlightColor = hlInput.value; renderCurrentFrame(); });
    bdInput.addEventListener('input', () => { sel.borderColor = bdInput.value; renderCurrentFrame(); });

    node.querySelector('.del').addEventListener('click', () => {
      state.selections = state.selections.filter((s) => s.id !== sel.id);
      renderList();
      rebuildScene();
    });

    els.list.appendChild(node);
  });
}

els.introDur.addEventListener('change', rebuildScene);

/* ----------------------- capture ----------------------- */

els.captureBtn.addEventListener('click', async () => {
  if (state.selections.length === 0) {
    setStatus('Add at least one selection before capturing.');
    return;
  }
  try {
    setStatus('Capturing full page…');
    els.captureBtn.disabled = true;

    let shot;
    if (state.mode === 'pdf') {
      shot = window.PdfView.capture();
    } else {
      const wcId = els.article.getWebContentsId();
      shot = await window.api.captureFullPage(wcId);
    }

    const img = new Image();
    img.onload = () => {
      state.screenshot = { img, w: shot.width, h: shot.height };
      rebuildScene();
      els.previewTab.disabled = false;
      switchTab('preview');
      setStatus('Captured. Press Play to preview, then Export.');
      els.captureBtn.disabled = false;
    };
    img.onerror = () => {
      setStatus('Failed to decode the screenshot.');
      els.captureBtn.disabled = false;
    };
    img.src = shot.dataUrl;
  } catch (err) {
    setStatus('Capture failed: ' + err.message);
    els.captureBtn.disabled = false;
  }
});

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
  const outputPath = await window.api.chooseExportPath();
  if (!outputPath) return;

  stopPlayback();
  const total = state.scene.totalDuration;
  const frames = Math.max(1, Math.ceil(total * FPS));

  // Render to an offscreen canvas so the visible one is untouched.
  const off = document.createElement('canvas');
  off.width = OUT_W; off.height = OUT_H;
  const octx = off.getContext('2d');

  showOverlay(true, 'Exporting…', 'Rendering frames…');

  let dir = null;
  try {
    dir = await window.api.exportBegin();
    for (let i = 0; i < frames; i++) {
      state.scene.render(octx, i / FPS);
      const dataUrl = off.toDataURL('image/png');
      await window.api.exportFrame({ dir, index: i, dataUrl });
      const pct = Math.round(((i + 1) / frames) * 100);
      setExportProgress(pct, 'Rendering frame ' + (i + 1) + ' of ' + frames + '…');
    }
    setExportProgress(100, 'Encoding MP4 (ffmpeg)…');
    await window.api.exportEncode({ dir, fps: FPS, outputPath });
    showOverlay(true, 'Done ✓', 'Saved to ' + outputPath);
    setTimeout(() => showOverlay(false), 1800);
    setStatus('Exported: ' + outputPath);
  } catch (err) {
    if (dir) window.api.exportCancelCleanup(dir);
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
