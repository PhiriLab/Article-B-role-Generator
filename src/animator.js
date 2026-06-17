'use strict';

/* ====================================================================
 *  Broll animation engine (no dependencies, runs in the renderer).
 *
 *  A "scene" owns the full-page screenshot plus a list of timeline
 *  steps. scene.render(ctx, t) paints the frame at time t (seconds).
 *  The same scene is used for live preview and for frame-by-frame
 *  MP4 export, so output is fully deterministic.
 * ==================================================================== */
(function () {
  const TRANSITION_FRAC = 0.34; // portion of a step spent flying the camera in
  const PAD = 0.28;             // padding around a focused selection
  const HOLD_ZOOM = 0.94;       // gentle ken-burns zoom during the hold

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // --- view = a rectangle of the screenshot mapped to the whole frame ---

  function lerpView(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      w: lerp(a.w, b.w, t),
      h: lerp(a.h, b.h, t)
    };
  }

  function makeClamper(imgW, imgH, aspect) {
    // Keeps a view aspect-correct, no larger than the image, fully inside it.
    return function clampView(v) {
      let w = v.w, h = v.h;
      if (w / h > aspect) w = h * aspect; else h = w / aspect;
      if (w > imgW) { w = imgW; h = w / aspect; }
      if (h > imgH) { h = imgH; w = h * aspect; }
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      let x = cx - w / 2, y = cy - h / 2;
      x = clamp(x, 0, imgW - w);
      y = clamp(y, 0, imgH - h);
      return { x, y, w, h };
    };
  }

  function zoomAround(v, factor, clampView) {
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const w = v.w * factor, h = v.h * factor;
    return clampView({ x: cx - w / 2, y: cy - h / 2, w, h });
  }

  function establishingView(imgW, imgH, aspect) {
    let w = imgW, h = w / aspect;
    if (h > imgH) { h = imgH; w = h * aspect; }
    return { x: (imgW - w) / 2, y: 0, w, h };
  }

  function focusView(bbox, imgW, imgH, aspect, clampView) {
    const cx = bbox.x + bbox.w / 2, cy = bbox.y + bbox.h / 2;
    let w = bbox.w * (1 + PAD * 2);
    let h = bbox.h * (1 + PAD * 2);
    // Don't zoom in further than ~16% of page width, or tiny text explodes.
    const minH = Math.max(imgW * 0.16, bbox.h * 1.6);
    if (h < minH) h = minH;
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    return clampView({ x: cx - w / 2, y: cy - h / 2, w, h });
  }

  // ---- rect mapping from image space to the output frame ----
  function viewMapper(view, outW) {
    const scale = outW / view.w;
    return {
      scale,
      rect(r) {
        return {
          x: (r.x - view.x) * scale,
          y: (r.y - view.y) * scale,
          w: r.w * scale,
          h: r.h * scale
        };
      }
    };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function withAlpha(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#ffd400');
    if (!m) return 'rgba(255,212,0,' + alpha + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' +
      parseInt(m[3], 16) + ',' + alpha + ')';
  }

  /* ------------------------------------------------------------------ *
   *  Style effects. Each receives the drawing context, the mapped
   *  geometry, the effect progress ep (0..1) and the selection config.
   * ------------------------------------------------------------------ */
  const effects = {
    box(ctx, map, sel, ep) {
      const b = map.rect(sel.bbox);
      const pad = 12;
      const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
      const radius = 14;

      // soft highlight fill fading in
      ctx.save();
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.fillStyle = withAlpha(sel.highlightColor, 0.18 * ep);
      ctx.fill();
      ctx.restore();

      // animated border being drawn around the box
      ctx.save();
      const perim = 2 * (w + h);
      ctx.setLineDash([perim]);
      ctx.lineDashOffset = perim * (1 - easeInOut(ep));
      ctx.lineWidth = 6;
      ctx.strokeStyle = sel.borderColor || '#ff2d55';
      ctx.shadowColor = sel.borderColor || '#ff2d55';
      ctx.shadowBlur = 12 * ep;
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.stroke();
      ctx.restore();
    },

    headline(ctx, map, sel, ep) {
      const b = map.rect(sel.bbox);
      const e = easeInOut(ep);
      // translucent highlight wipes in from the left
      ctx.save();
      ctx.fillStyle = withAlpha(sel.highlightColor, 0.30);
      ctx.fillRect(b.x - 6, b.y - 4, (b.w + 12) * e, b.h + 8);
      ctx.restore();
      // bold underline sweeps with it
      ctx.save();
      ctx.fillStyle = sel.borderColor || '#ff2d55';
      const uh = Math.max(5, b.h * 0.12);
      ctx.fillRect(b.x - 6, b.y + b.h + 4, (b.w + 12) * e, uh);
      ctx.restore();
    },

    'read-along'(ctx, map, sel, ep) {
      const rects = (sel.rects && sel.rects.length ? sel.rects : [sel.bbox]);
      const total = rects.reduce((s, r) => s + r.w, 0) || 1;
      const target = ep * total;
      let acc = 0;
      let cursor = null;
      ctx.save();
      ctx.fillStyle = withAlpha(sel.highlightColor, 0.42);
      for (const r0 of rects) {
        const r = map.rect(r0);
        const filled = clamp(target - acc, 0, r0.w) / r0.w;
        if (filled > 0) {
          roundRectPath(ctx, r.x - 2, r.y - 1, r.w * filled + 4, r.h + 2, 4);
          ctx.fill();
          if (filled < 1) cursor = { x: r.x + r.w * filled, y: r.y, h: r.h };
        }
        acc += r0.w;
      }
      ctx.restore();
      // reading cursor at the leading edge
      if (cursor) {
        ctx.save();
        ctx.strokeStyle = sel.borderColor || '#ff2d55';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cursor.x, cursor.y - 2);
        ctx.lineTo(cursor.x, cursor.y + cursor.h + 2);
        ctx.stroke();
        ctx.restore();
      }
    },

    spotlight(ctx, map, sel, ep, ctx2) {
      const b = map.rect(sel.bbox);
      const pad = 16;
      const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
      const radius = 18;
      const dim = 0.66 * clamp(ep / 0.4, 0, 1);

      // darken everything
      ctx.save();
      ctx.fillStyle = 'rgba(8,9,12,' + dim + ')';
      ctx.fillRect(0, 0, ctx2.outW, ctx2.outH);
      ctx.restore();

      // re-light the passage by redrawing the screenshot inside the spotlight
      ctx.save();
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.clip();
      ctx2.drawBase(ctx);
      ctx.restore();

      // glowing rim around the spotlight
      ctx.save();
      ctx.lineWidth = 4;
      ctx.strokeStyle = withAlpha(sel.highlightColor, 0.9);
      ctx.shadowColor = withAlpha(sel.highlightColor, 0.9);
      ctx.shadowBlur = 26 * clamp(ep / 0.4, 0, 1);
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.stroke();
      ctx.restore();
    }
  };

  /* ------------------------------------------------------------------ *
   *  Scene construction
   * ------------------------------------------------------------------ */
  function buildScene(opts) {
    const { image, imgW, imgH, outW, outH, selections } = opts;
    const introDur = Math.max(0, opts.introDur != null ? opts.introDur : 1.2);
    const aspect = outW / outH;
    const clampView = makeClamper(imgW, imgH, aspect);

    const establishing = establishingView(imgW, imgH, aspect);

    const steps = [];
    if (introDur > 0.01) {
      steps.push({ type: 'intro', dur: introDur, toView: establishing });
    }
    let prev = establishing;
    selections.forEach((sel) => {
      const view = focusView(sel.bbox, imgW, imgH, aspect, clampView);
      steps.push({
        type: 'selection',
        dur: Math.max(0.5, sel.durationSec || 3),
        fromView: prev,
        toView: view,
        sel
      });
      prev = view;
    });

    let total = 0;
    steps.forEach((s) => { s.start = total; total += s.dur; });
    if (total <= 0) total = 0.001;

    function drawBaseWith(ctx, view) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, view.x, view.y, view.w, view.h, 0, 0, outW, outH);
    }

    function render(ctx, t) {
      t = clamp(t, 0, total - 1e-4);
      let step = steps[steps.length - 1];
      for (const s of steps) {
        if (t < s.start + s.dur) { step = s; break; }
      }
      const f = clamp((t - step.start) / step.dur, 0, 1);

      let view, ep = 0;
      if (step.type === 'intro') {
        // subtle settle-in zoom on the establishing shot
        view = zoomAround(step.toView, lerp(1.04, 0.99, easeInOut(f)), clampView);
      } else {
        const tf = clamp(f / TRANSITION_FRAC, 0, 1);
        const base = lerpView(step.fromView, step.toView, easeInOut(tf));
        const hold = clamp((f - TRANSITION_FRAC) / (1 - TRANSITION_FRAC), 0, 1);
        view = zoomAround(base, lerp(1.0, HOLD_ZOOM, hold), clampView);
        ep = hold;
      }

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, outW, outH);
      drawBaseWith(ctx, view);

      if (step.type === 'selection') {
        const map = viewMapper(view, outW);
        const fn = effects[step.sel.style] || effects.box;
        fn(ctx, map, step.sel, ep, {
          outW, outH,
          drawBase: (c) => drawBaseWith(c, view)
        });
      }
    }

    return { totalDuration: total, render, steps };
  }

  window.Broll = { buildScene };
})();
