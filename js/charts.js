/* ==========================================================================
   charts.js - dependency-free canvas charts (works offline, no CDN needed)
     TimeChart : multi-series trend, 2 y-axes, wheel zoom, drag pan, hover readout
     bars()    : bar chart (vertical)   pareto() : bars + cumulative % line
     seqChart(): sample-number chart with horizontal limit lines (SPC)
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};
  const css = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n) || d).trim() || d;
  const pad2 = n => String(n).padStart(2, '0');
  const tfmt = (ms, span) => { const d = new Date(ms); return span > 7200000 ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); };

  function setup(canvas, hCss) {
    const dpr = Math.max(1, g.devicePixelRatio || 1), w = canvas.clientWidth || 600, hh = hCss || 220;
    canvas.style.height = hh + 'px';
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, hh);
    return { c, w, h: hh };
  }
  function niceRange(min, max) {
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    if (max - min < 1e-9) { max = min + 1; }
    const span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / 4))), m = span / 4 / step;
    const st = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * step;
    return [Math.floor(min / st) * st, Math.ceil(max / st) * st, st];
  }

  class TimeChart {
    /** opts: {height, series:[{key,label,color,axis(0|1),min,max}], source:(t0,t1)=>samples, title} */
    constructor(canvas, opts) {
      this.cv = canvas; this.o = opts; this.view = null; this.live = true; this.span = opts.span || 120000; this.hover = null; this.drag = null;
      canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.25 : 0.8, this.xToT(e.offsetX)); }, { passive: false });
      canvas.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, v: this.cur() }; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointermove', e => {
        if (this.drag) { const v = this.drag.v, dt = (e.clientX - this.drag.x) / (this.cv.clientWidth - 80) * (v.t1 - v.t0); this.view = { t0: v.t0 - dt, t1: v.t1 - dt }; this.live = false; }
        this.hover = e.offsetX; this.draw();
      });
      canvas.addEventListener('pointerup', () => { this.drag = null; });
      canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
      canvas.addEventListener('dblclick', () => { this.live = true; this.draw(); });
    }
    cur() { if (this.live || !this.view) { const now = this.o.now ? this.o.now() : Date.now(); return { t0: now - this.span, t1: now }; } return this.view; }
    xToT(x) { const v = this.cur(); return v.t0 + (x - 50) / Math.max(1, this.cv.clientWidth - 80) * (v.t1 - v.t0); }
    zoom(f, at) { const v = this.cur(), a = at || (v.t0 + v.t1) / 2; this.view = { t0: a - (a - v.t0) * f, t1: a + (v.t1 - a) * f }; this.live = false; this.span = this.view.t1 - this.view.t0; this.draw(); }
    setSpan(ms) { this.span = ms; this.live = true; this.draw(); }
    draw() {
      const { c, w, h } = setup(this.cv, this.o.height || 230), o = this.o, v = this.cur();
      const ink = css('--ink', '#222'), mute = css('--mute', '#666'), grid = css('--line2', '#ddd');
      const L = 50, R = 40, T = 10, B = 22, pw = w - L - R, ph = h - T - B;
      const data = o.source(v.t0, v.t1, Math.max(50, Math.floor(pw)));
      // axis ranges
      const ax = [[Infinity, -Infinity], [Infinity, -Infinity]];
      o.series.forEach(s => { const a = s.axis || 0; if (s.min !== undefined) ax[a][0] = Math.min(ax[a][0], s.min); if (s.max !== undefined) ax[a][1] = Math.max(ax[a][1], s.max); data.forEach(d => { const val = d[s.key]; if (val < ax[a][0]) ax[a][0] = val; if (val > ax[a][1]) ax[a][1] = val; }); });
      const rg = ax.map(a => (isFinite(a[0]) ? niceRange(a[0], a[1]) : [0, 1, 0.25]));
      const X = t => L + (t - v.t0) / (v.t1 - v.t0) * pw, Y = (val, a) => T + ph - (val - rg[a][0]) / (rg[a][1] - rg[a][0] || 1) * ph;
      c.font = '11px sans-serif'; c.lineWidth = 1;
      // grid + left labels
      c.strokeStyle = grid; c.fillStyle = mute; c.textAlign = 'right';
      for (let val = rg[0][0]; val <= rg[0][1] + 1e-9; val += rg[0][2] || 1) { const y = Y(val, 0); c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); c.fillText(+val.toFixed(2), L - 4, y + 4); if (!rg[0][2]) break; }
      if (o.series.some(s => s.axis === 1)) { c.textAlign = 'left'; for (let val = rg[1][0]; val <= rg[1][1] + 1e-9; val += rg[1][2] || 1) { c.fillText(+val.toFixed(2), L + pw + 4, Y(val, 1) + 4); if (!rg[1][2]) break; } }
      c.textAlign = 'center'; for (let i = 0; i <= 5; i++) { const t = v.t0 + (v.t1 - v.t0) * i / 5, x = L + pw * i / 5; c.strokeStyle = grid; c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke(); c.fillText(tfmt(t, v.t1 - v.t0), x, h - 6); }
      c.strokeStyle = css('--line', '#999'); c.strokeRect(L, T, pw, ph);
      // series
      c.save(); c.beginPath(); c.rect(L, T, pw, ph); c.clip();
      o.series.forEach(s => {
        c.strokeStyle = s.color; c.lineWidth = 1.8; c.setLineDash(s.dash ? [5, 4] : []); c.beginPath(); let first = true;
        data.forEach(d => { const x = X(d.t), y = Y(d[s.key], s.axis || 0); if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y); }); c.stroke();
      }); c.setLineDash([]); c.restore();
      // hover readout
      if (this.hover !== null && this.hover > L && this.hover < L + pw && data.length) {
        const t = this.xToT(this.hover); let best = data[0]; data.forEach(d => { if (Math.abs(d.t - t) < Math.abs(best.t - t)) best = d; });
        const x = X(best.t); c.strokeStyle = ink; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke(); c.setLineDash([]);
        const lines = [tfmt(best.t, 0)].concat(o.series.map(s => s.label + ': ' + (+best[s.key]).toFixed(1)));
        const bw = Math.max(...lines.map(l => c.measureText(l).width)) + 12, bx = x + 8 + bw > L + pw ? x - bw - 8 : x + 8;
        c.fillStyle = css('--card', '#fff'); c.strokeStyle = css('--line', '#999'); c.fillRect(bx, T + 4, bw, lines.length * 14 + 6); c.strokeRect(bx, T + 4, bw, lines.length * 14 + 6);
        c.fillStyle = ink; c.textAlign = 'left'; lines.forEach((l, i) => c.fillText(l, bx + 6, T + 17 + i * 14));
      }
      if (!data.length) { c.fillStyle = mute; c.textAlign = 'center'; c.fillText('No data in this range yet', L + pw / 2, T + ph / 2); }
      if (o.title) { c.fillStyle = ink; c.textAlign = 'left'; c.font = 'bold 12px sans-serif'; c.fillText(o.title, L + 4, T + 12); }
    }
  }

  function bars(canvas, o) {
    const { c, w, h } = setup(canvas, o.height || 200), n = o.values.length; const L = 46, B = 40, T = 14, R = 10, pw = w - L - R, ph = h - T - B;
    const max = Math.max(o.max || 0, ...o.values, 1e-6), rg = niceRange(0, max);
    c.font = '11px sans-serif'; c.fillStyle = css('--mute', '#666'); c.strokeStyle = css('--line2', '#ddd'); c.textAlign = 'right';
    for (let v = 0; v <= rg[1] + 1e-9; v += rg[2]) { const y = T + ph - v / rg[1] * ph; c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); c.fillText(+v.toFixed(2), L - 4, y + 4); }
    const bw = pw / Math.max(n, 1);
    o.values.forEach((v, i) => {
      const bh = v / rg[1] * ph, x = L + i * bw + bw * 0.15; c.fillStyle = (o.colors && o.colors[i]) || css('--accent', '#1f5f8b'); c.fillRect(x, T + ph - bh, bw * 0.7, bh);
      c.fillStyle = css('--ink', '#222'); c.textAlign = 'center'; c.fillText(o.fmt ? o.fmt(v) : +v.toFixed(1), x + bw * 0.35, T + ph - bh - 3);
      c.fillStyle = css('--mute', '#666'); const lab = String(o.labels[i]); c.fillText(lab.length > 14 ? lab.slice(0, 13) + '\u2026' : lab, x + bw * 0.35, h - B + 14);
    });
    (o.lines || []).forEach(l => { const y = T + ph - l.v / rg[1] * ph; c.strokeStyle = l.color; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); c.setLineDash([]); c.fillStyle = l.color; c.textAlign = 'right'; c.fillText(l.label, L + pw, y - 3); });
    if (o.unit) { c.save(); c.translate(11, T + ph / 2); c.rotate(-Math.PI / 2); c.fillStyle = css('--mute', '#666'); c.textAlign = 'center'; c.fillText(o.unit, 0, 0); c.restore(); }
    if (!n) { c.fillStyle = css('--mute', '#666'); c.textAlign = 'center'; c.fillText('No data yet', w / 2, h / 2); }
  }

  function pareto(canvas, o) {
    const total = o.values.reduce((a, b) => a + b, 0) || 1; bars(canvas, o);
    const { c, w, h } = { c: canvas.getContext('2d'), w: canvas.clientWidth, h: o.height || 200 }; const L = 46, B = 40, T = 14, R = 10, pw = w - L - R, ph = h - T - B, bw = pw / Math.max(o.values.length, 1);
    let cum = 0; c.strokeStyle = css('--bad', '#c00'); c.lineWidth = 2; c.beginPath();
    o.values.forEach((v, i) => { cum += v; const x = L + i * bw + bw * 0.5, y = T + ph - cum / total * ph; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    cum = 0; c.fillStyle = css('--bad', '#c00'); o.values.forEach((v, i) => { cum += v; c.beginPath(); c.arc(L + i * bw + bw * 0.5, T + ph - cum / total * ph, 3, 0, 7); c.fill(); });
    c.textAlign = 'left'; c.fillText('cumulative % (right = 100 %)', L + 6, T + 10);
  }

  /** SPC / run chart: points vs sample number with horizontal lines */
  function seqChart(canvas, o) {
    const { c, w, h } = setup(canvas, o.height || 220), L = 50, R = 70, T = 12, B = 22, pw = w - L - R, ph = h - T - B, y = o.y || [];
    const lines = o.lines || []; let lo = Math.min(...y, ...lines.map(l => l.v)), hi = Math.max(...y, ...lines.map(l => l.v)); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    const Y = v => T + ph - (v - lo) / (hi - lo) * ph, X = i => L + (y.length > 1 ? i / (y.length - 1) : 0.5) * pw;
    c.font = '11px sans-serif'; c.strokeStyle = css('--line2', '#ddd'); c.fillStyle = css('--mute', '#666'); c.textAlign = 'right';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, yy = Y(v); c.beginPath(); c.moveTo(L, yy); c.lineTo(L + pw, yy); c.stroke(); c.fillText(v.toFixed(1), L - 4, yy + 4); }
    lines.forEach(l => { c.strokeStyle = l.color; c.setLineDash(l.dash === false ? [] : [6, 4]); c.lineWidth = 1.5; c.beginPath(); c.moveTo(L, Y(l.v)); c.lineTo(L + pw, Y(l.v)); c.stroke(); c.setLineDash([]); c.fillStyle = l.color; c.textAlign = 'left'; c.fillText(l.label + ' ' + l.v.toFixed(1), L + pw + 4, Y(l.v) + 4); });
    c.strokeStyle = css('--accent', '#1f5f8b'); c.lineWidth = 1.5; c.beginPath(); y.forEach((v, i) => i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))); c.stroke();
    y.forEach((v, i) => { const out = lines.some(l => (l.limit === 'hi' && v > l.v) || (l.limit === 'lo' && v < l.v)); c.fillStyle = out ? css('--bad', '#c00') : css('--accent', '#1f5f8b'); c.beginPath(); c.arc(X(i), Y(v), out ? 3.5 : 2.2, 0, 7); c.fill(); });
    if (!y.length) { c.fillStyle = css('--mute', '#666'); c.textAlign = 'center'; c.fillText('No samples yet - run the filler', w / 2, h / 2); }
  }

  /** Simple step-response style line chart from arrays: series [{label,color,y:[]}], dt seconds */
  function lineArr(canvas, o) {
    const { c, w, h } = setup(canvas, o.height || 220), L = 44, R = 12, T = 12, B = 22, pw = w - L - R, ph = h - T - B;
    let lo = Infinity, hi = -Infinity; o.series.forEach(s => s.y.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); })); if (!isFinite(lo)) { lo = 0; hi = 1; }
    const rg = niceRange(lo, hi), n = Math.max(...o.series.map(s => s.y.length), 2), Y = v => T + ph - (v - rg[0]) / (rg[1] - rg[0]) * ph, X = i => L + i / (n - 1) * pw;
    c.font = '11px sans-serif'; c.strokeStyle = css('--line2', '#ddd'); c.fillStyle = css('--mute', '#666'); c.textAlign = 'right';
    for (let v = rg[0]; v <= rg[1] + 1e-9; v += rg[2]) { c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(L + pw, Y(v)); c.stroke(); c.fillText(+v.toFixed(2), L - 4, Y(v) + 4); }
    c.textAlign = 'center'; for (let i = 0; i <= 4; i++) c.fillText(Math.round(i / 4 * (n - 1) * (o.dt || 1)) + 's', L + pw * i / 4, h - 6);
    o.series.forEach(s => { c.strokeStyle = s.color; c.lineWidth = 1.8; c.setLineDash(s.dash ? [5, 4] : []); c.beginPath(); s.y.forEach((v, i) => i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))); c.stroke(); }); c.setLineDash([]);
  }

  P.Charts = { TimeChart, bars, pareto, seqChart, lineArr };
})(typeof window !== 'undefined' ? window : globalThis);
