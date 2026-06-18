'use strict';

// Runs inside the loaded article page. It watches the user's text
// selection and reports the selected text plus the geometry of every
// line rectangle (in document coordinates) back to the host renderer.

const { ipcRenderer } = require('electron');

function describeSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const text = sel.toString().trim();
  if (!text) return null;

  const range = sel.getRangeAt(0);
  const clientRects = Array.from(range.getClientRects())
    // Ignore zero-area rects that some browsers emit between lines.
    .filter((r) => r.width > 1 && r.height > 1);

  if (clientRects.length === 0) return null;

  // Convert viewport-relative rects to document-relative coordinates so
  // they line up with a full-page screenshot captured at scale 1.
  const sx = window.scrollX || window.pageXOffset || 0;
  const sy = window.scrollY || window.pageYOffset || 0;

  const rects = clientRects.map((r) => ({
    x: r.left + sx,
    y: r.top + sy,
    w: r.width,
    h: r.height
  }));

  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));

  return {
    text,
    rects,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  };
}

let lastSent = null;

function report() {
  const info = describeSelection();
  const serialized = info ? JSON.stringify(info) : null;
  if (serialized === lastSent) return;
  lastSent = serialized;
  ipcRenderer.sendToHost('broll-selection', info);
}

document.addEventListener('mouseup', () => setTimeout(report, 0));
document.addEventListener('keyup', () => setTimeout(report, 0));
document.addEventListener('selectionchange', () => setTimeout(report, 60));
