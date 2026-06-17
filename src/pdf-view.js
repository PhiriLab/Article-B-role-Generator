'use strict';

/* ====================================================================
 *  PDF view: renders a PDF with PDF.js into a scrollable column with a
 *  selectable text layer, reports selection geometry in document
 *  coordinates, and stitches all pages into one tall image for capture.
 *
 *  Coordinates: each page is rendered at a scale that makes 1 canvas
 *  pixel == 1 CSS pixel, and pages are stacked with no gaps, so DOM
 *  selection rectangles map 1:1 onto the stitched capture image.
 * ==================================================================== */
(function () {
  const pdfjsLib = window.pdfjsLib;
  if (pdfjsLib) {
    // Worker is vendored locally; if CSP blocks it, PDF.js falls back to
    // a main-thread "fake worker" automatically.
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  const TARGET_WIDTH = 1100; // page render width in px (good for zooming)

  let pagesEl = null;     // container holding the page wrappers
  let onSelection = null; // callback(info|null)
  let pageLayout = [];    // [{ canvas, y0, width, height }]
  let totalHeight = 0;
  let maxWidth = 0;

  function init(containerEl, selectionCallback) {
    pagesEl = containerEl;
    onSelection = selectionCallback;
    document.addEventListener('mouseup', reportSelection);
    document.addEventListener('keyup', reportSelection);
  }

  function clear() {
    if (pagesEl) pagesEl.innerHTML = '';
    pageLayout = [];
    totalHeight = 0;
    maxWidth = 0;
  }

  async function load(data, opts) {
    clear();
    opts = opts || {};
    const doc = await pdfjsLib.getDocument({ data }).promise;
    // Cap pages so the stitched capture image stays within canvas limits.
    const limit = Math.min(doc.numPages, opts.maxPages || doc.numPages);
    let y0 = 0;

    for (let n = 1; n <= limit; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = TARGET_WIDTH / base.width;
      const viewport = page.getViewport({ scale });
      const w = Math.floor(viewport.width);
      const h = Math.floor(viewport.height);

      const wrap = document.createElement('div');
      wrap.className = 'pdf-page';
      wrap.style.width = w + 'px';
      wrap.style.height = h + 'px';

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.className = 'pdf-canvas';
      const ctx = canvas.getContext('2d');
      wrap.appendChild(canvas);

      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';
      textLayer.style.setProperty('--scale-factor', String(scale));
      textLayer.style.width = w + 'px';
      textLayer.style.height = h + 'px';
      wrap.appendChild(textLayer);

      pagesEl.appendChild(wrap);

      await page.render({ canvasContext: ctx, viewport }).promise;

      const textContent = await page.getTextContent();
      await pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport,
        textDivs: []
      }).promise;

      pageLayout.push({ canvas, y0, width: w, height: h });
      y0 += h;
      maxWidth = Math.max(maxWidth, w);
    }
    totalHeight = y0;
    return {
      pageCount: doc.numPages,
      renderedPages: limit,
      truncated: limit < doc.numPages,
      width: maxWidth,
      height: totalHeight
    };
  }

  // Selection -> document coordinates relative to the stacked pages.
  function reportSelection() {
    setTimeout(() => {
      if (!onSelection) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { onSelection(null); return; }

      const text = sel.toString().trim();
      const range = sel.getRangeAt(0);
      // Only act on selections inside the PDF pages.
      if (!pagesEl || !pagesEl.contains(range.commonAncestorContainer)) return;
      if (!text) { onSelection(null); return; }

      const base = pagesEl.getBoundingClientRect();
      const rects = Array.from(range.getClientRects())
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({
          x: r.left - base.left,
          y: r.top - base.top,
          w: r.width,
          h: r.height
        }));
      if (rects.length === 0) { onSelection(null); return; }

      const minX = Math.min(...rects.map((r) => r.x));
      const minY = Math.min(...rects.map((r) => r.y));
      const maxX = Math.max(...rects.map((r) => r.x + r.w));
      const maxY = Math.max(...rects.map((r) => r.y + r.h));

      onSelection({ text, rects, bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } });
    }, 0);
  }

  // Stitch every page canvas into one tall image for the animation.
  function capture() {
    const out = document.createElement('canvas');
    out.width = maxWidth;
    out.height = totalHeight;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, maxWidth, totalHeight);
    for (const p of pageLayout) ctx.drawImage(p.canvas, 0, p.y0);
    return { dataUrl: out.toDataURL('image/png'), width: maxWidth, height: totalHeight };
  }

  window.PdfView = { init, load, clear, capture };
})();
