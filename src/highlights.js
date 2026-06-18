'use strict';

/* ====================================================================
 *  Auto-highlight: turn a document's text geometry into a short list of
 *  "key highlight" selections (title, abstract, key-point sections, …),
 *  each with on-page rectangles and a suggested animation style.
 *
 *  Pure functions over text items { str, page, x, y, w, h } in image
 *  coordinates — no DOM — so it works for PDFs and is unit-testable.
 * ==================================================================== */
(function () {
  const MAX_HIGHLIGHTS = 6;

  // Section headings that usually mark the "key" content of a paper.
  const HEADINGS = [
    /^abstract\b/i,
    /^(key (points|messages|practice points|learning points))\b/i,
    /^highlights\b/i,
    /^(clinical )?implications\b/i,
    /^(conclusions?|summary)\b/i,
    /^background\b/i,
    /^introduction\b/i
  ];

  function median(xs) {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  function unionRects(rects) {
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // Group raw text items into visual lines.
  function buildLines(items) {
    const sorted = items.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
    const lines = [];
    let cur = null;
    for (const it of sorted) {
      if (cur && it.page === cur.page && Math.abs(it.y - cur.refY) <= Math.max(it.h, cur.refH) * 0.6) {
        cur.items.push(it);
      } else {
        cur = { page: it.page, refY: it.y, refH: it.h, items: [it] };
        lines.push(cur);
      }
    }
    for (const ln of lines) {
      ln.items.sort((a, b) => a.x - b.x);
      ln.text = ln.items.map((i) => i.str).join('').replace(/\s+/g, ' ').trim();
      ln.fontH = median(ln.items.map((i) => i.h));
      ln.rects = ln.items.filter((i) => i.w > 1 && i.h > 1).map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }));
      ln.bbox = ln.rects.length ? unionRects(ln.rects) : { x: 0, y: 0, w: 0, h: 0 };
    }
    return lines.filter((l) => l.rects.length && l.text);
  }

  function isHeading(text) {
    return text.length < 42 && HEADINGS.some((re) => re.test(text));
  }

  function mkSel(lines, style) {
    const rects = [];
    lines.forEach((l) => l.rects.forEach((r) => rects.push(r)));
    return {
      text: lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 140),
      rects,
      bbox: unionRects(rects),
      style
    };
  }

  // Lines following a heading, up to a few lines / a character budget.
  function passageAfter(lines, headingIdx) {
    const collected = [];
    let chars = 0;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      const ln = lines[i];
      if (isHeading(ln.text)) break;
      if (ln.page > lines[headingIdx].page + 1) break;
      collected.push(ln);
      chars += ln.text.length;
      if (collected.length >= 4 || chars >= 320) break;
    }
    return collected;
  }

  function fromTextItems(info) {
    const lines = buildLines(info.items);
    if (!lines.length) return [];
    const out = [];

    // --- Title: the largest-font contiguous lines near the top of page 1 ---
    const p1 = lines.filter((l) => l.page === 1).slice(0, 18);
    if (p1.length) {
      const maxF = Math.max(...p1.map((l) => l.fontH));
      const startI = p1.findIndex((l) => l.fontH >= maxF * 0.9 && l.text.length > 4);
      if (startI >= 0) {
        const title = [];
        for (let i = startI; i < p1.length; i++) {
          if (p1[i].fontH >= maxF * 0.8 && p1[i].text.length > 2) title.push(p1[i]);
          else if (title.length) break;
        }
        if (title.length) out.push(mkSel(title, 'headline'));
      }
    }

    // --- Key sections by heading keyword ---
    for (let i = 0; i < lines.length && out.length < MAX_HIGHLIGHTS; i++) {
      if (!isHeading(lines[i].text)) continue;
      const pass = passageAfter(lines, i);
      if (pass.length) out.push(mkSel(pass, 'read-along'));
    }

    // --- Fallback: not enough structure found, sample body paragraphs ---
    if (out.length < 3) {
      const body = lines.filter((l) => l.text.length > 60);
      const step = Math.max(1, Math.ceil(body.length / 4));
      for (let i = 0; i < body.length && out.length < 4; i += step) {
        out.push(mkSel([body[i]], 'box'));
      }
    }

    // --- Assign animation styles: title first, then cycle the rest ---
    const cycle = ['read-along', 'spotlight', 'box'];
    out.forEach((s, idx) => { s.style = idx === 0 ? 'headline' : cycle[(idx - 1) % cycle.length]; });

    return out.slice(0, MAX_HIGHLIGHTS);
  }

  window.Highlights = { fromTextItems };
})();
