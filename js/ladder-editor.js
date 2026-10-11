/* ==========================================================================
   ladder-editor.js  -  visual, editable ladder diagram (SVG)
   --------------------------------------------------------------------------
   * Renders every rung of the selected section as SVG, with live power flow
     (green) and live values on contacts, timers, counters, comparators.
   * Editing happens on a DRAFT copy of the program.  "Compile / Apply" runs
     the checker (undefined tags, duplicate coils, type mismatch ...) and, if
     clean, hot-swaps the draft into the running PLC (online edit - timer and
     counter state is kept).
   * Insert elements by drag & drop from the palette, or click a palette item
     (it arms) and click a "+" drop zone.  Parallel branches (OR), delete,
     replace type, change tag / presets, add/delete/move rungs and sections,
     rung comments + bookmarks, undo / redo, JSON import/export, reset.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};
  const U = P.UI, h = U.h, esc = U.esc;

  /* ---- geometry ---- */
  const G = 14, GAP = 6, RAIL = 10, STARTX = 22;
  const SIZES = {
    contact: { w: 116, h: 58, wy: 34 }, cmp: { w: 132, h: 62, wy: 36 }, coil: { w: 116, h: 58, wy: 34 },
    block: { w: 156, h: 82, wy: 24 }, math: { w: 176, h: 64, wy: 26 }, pid: { w: 176, h: 92, wy: 26 }
  };
  const sizeOf = n => {
    if (['no', 'nc', 'pos', 'neg'].includes(n.t)) return SIZES.contact;
    if (n.t === 'cmp') return SIZES.cmp;
    if (['coil', 'ncoil', 'set', 'reset'].includes(n.t)) return SIZES.coil;
    if (['ton', 'tof', 'tp', 'ctu', 'ctd'].includes(n.t)) return SIZES.block;
    if (n.t === 'math') return SIZES.math;
    return SIZES.pid;
  };
  const COND_TYPES = ['no', 'nc', 'pos', 'neg', 'cmp'], OUT_TYPES = ['coil', 'ncoil', 'set', 'reset', 'ton', 'tof', 'tp', 'ctu', 'ctd', 'math', 'pid'];
  const NAMES = { no: 'NO contact', nc: 'NC contact', pos: 'Rising edge', neg: 'Falling edge', cmp: 'Compare', coil: 'Coil', ncoil: 'Negated coil', set: 'Set (latch)', reset: 'Reset (unlatch)', ton: 'TON timer', tof: 'TOF timer', tp: 'TP pulse', ctu: 'CTU counter', ctd: 'CTD counter', math: 'Math / MOV', pid: 'PID block' };
  const SHORT = { no: '\u2524 \u251c', nc: '\u2524/\u251c', pos: '\u2524P\u251c', neg: '\u2524N\u251c', cmp: 'a>b', coil: '( )', ncoil: '(/)', set: '(S)', reset: '(R)', ton: 'TON', tof: 'TOF', tp: 'TP', ctu: 'CTU', ctd: 'CTD', math: 'f(x)', pid: 'PID' };
  const GROUPS = { contact: ['no', 'nc', 'pos', 'neg'], coil: ['coil', 'ncoil', 'set', 'reset'], timer: ['ton', 'tof', 'tp'], counter: ['ctu', 'ctd'] };

  /* ------------------------------------------------------------------ layout */
  function lay(n) {
    if (n.t === 'ser') {
      const parts = n.items.map(lay);
      if (!parts.length) return { n, kind: 'ser', parts, w: 44, h: 44, wy: 22 };
      let wy = 0, below = 0; parts.forEach(p => { wy = Math.max(wy, p.wy); below = Math.max(below, p.h - p.wy); });
      return { n, kind: 'ser', parts, w: parts.reduce((a, p) => a + p.w, 0), h: wy + below, wy };
    }
    if (n.t === 'par') {
      const parts = n.items.map(lay); if (!parts.length) return { n, kind: 'ser', parts: [], w: 44, h: 44, wy: 22 };
      let y = 0; parts.forEach(p => { p.dy = y; y += p.h + GAP; });
      return { n, kind: 'par', parts, w: Math.max(...parts.map(p => p.w)) + 2 * G, h: y - GAP, wy: parts[0].wy };
    }
    const s = sizeOf(n); return { n, kind: 'leaf', w: s.w, h: s.h, wy: s.wy };
  }

  class LadderEditor {
    /** ctx = { sim, canEdit(), saveProgram(p), onChange?() } */
    constructor(root, ctx) {
      this.root = root; this.ctx = ctx; this.sim = ctx.sim;
      this.draft = P.Program.clone(this.sim.plc.program); P.Program.normalize(this.draft);
      this.secIdx = 0; this.sel = null; this.tool = null; this.dirty = false;
      this.undo = []; this.redo = []; this.flowNodes = []; this.lvNodes = [];
      this.build();
      this.render();
    }

    get plc() { return this.sim.plc; }
    get tags() { return this.sim.tags; }
    get section() { return this.draft.sections[Math.min(this.secIdx, this.draft.sections.length - 1)]; }
    can() { return this.ctx.canEdit(); }

    /* ------------------------------------------------------------ skeleton */
    build() {
      const R = this.root; R.innerHTML = ''; R.classList.add('le');
      this.dl = h('datalist', { id: 'le-tags' });
      this.btn = (label, fn, cls, title) => h('button', { class: 'btn ' + (cls || ''), onclick: fn, title: title || '' }, label);
      this.runBtn = this.btn('\u25b6 Run', () => { this.plc.run(); this.sim.paused = false; this.refreshBar(); }, 'ok');
      this.stopBtn = this.btn('\u25a0 Stop', () => { this.plc.stop(); this.refreshBar(); }, 'bad');
      this.pauseBtn = this.btn('\u23f8 Pause', () => { this.sim.paused = !this.sim.paused; this.refreshBar(); });
      this.stepBtn = this.btn('\u23ed Single scan', () => { this.sim.paused = true; this.sim.step(); this.refreshBar(); this.update(); }, '', 'Execute exactly one PLC scan');
      this.undoBtn = this.btn('\u21b6 Undo', () => this.doUndo()); this.redoBtn = this.btn('\u21b7 Redo', () => this.doRedo());
      this.applyBtn = this.btn('\u2714 Compile / Apply', () => this.apply(), 'primary', 'Check the draft and download it into the running PLC');
      this.status = h('span', { class: 'le-status' });
      this.modeLab = h('span', { class: 'le-mode' });
      this.speedSel = h('select', { title: 'Simulation speed', onchange: e => { this.sim.speed = parseFloat(e.target.value); } }, P.SIM.speeds.map(s => h('option', { value: s }, s + 'x')));
      this.speedSel.value = String(this.sim.speed);
      this.scanIn = h('input', { type: 'number', min: 10, max: 200, step: 10, value: this.plc.scanMs, style: { width: '64px' }, title: 'PLC scan time (ms of simulated time)', onchange: e => { this.plc.scanMs = Math.max(10, Math.min(200, parseInt(e.target.value) || 50)); } });
      const tb = h('div', { class: 'le-toolbar' },
        this.runBtn, this.stopBtn, this.pauseBtn, this.stepBtn, this.modeLab,
        h('span', { class: 'sep' }), h('label', null, 'Speed ', this.speedSel), h('label', null, 'Scan ', this.scanIn, ' ms'),
        h('span', { class: 'sep' }), this.undoBtn, this.redoBtn, this.applyBtn, this.status,
        h('span', { class: 'sp' }),
        this.btn('\u2b07 Save JSON', () => this.exportJSON()), this.btn('\u2b06 Load JSON', () => this.importJSON()), this.btn('\u27f2 Reset to default program', () => this.resetDefault(), 'bad'));
      this.secList = h('div', { class: 'le-secs' });
      this.palette = h('div', { class: 'le-pal' });
      this.center = h('div', { class: 'le-center' });
      this.props = h('div', { class: 'le-props' });
      this.ro = h('div', { class: 'le-ro' }, 'Read-only: sign in as Engineer or Admin to edit logic.');
      R.append(this.dl, tb, this.ro, this.secList, h('div', { class: 'le-main' }, h('div', { class: 'le-side' }, this.palette), this.center, this.props));
      this.buildPalette();
      // delegated events
      this.center.addEventListener('click', e => this.onClick(e));
      this.center.addEventListener('dragover', e => { const z = e.target.closest('[data-dz]'); if (z) { e.preventDefault(); z.classList.add('hot'); } });
      this.center.addEventListener('dragleave', e => { const z = e.target.closest('[data-dz]'); if (z) z.classList.remove('hot'); });
      this.center.addEventListener('drop', e => { const z = e.target.closest('[data-dz]'); if (z) { e.preventDefault(); const t = e.dataTransfer.getData('text/plain'); this.dropAt(z.dataset.dz, t); } });
      this.keyHandler = e => {
        if (!this.root.isConnected || !this.root.offsetParent) return;
        if (/INPUT|SELECT|TEXTAREA/.test((e.target.tagName || ''))) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.deleteSel(); }
        else if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.doUndo(); }
        else if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); this.doRedo(); }
        else if (e.key === 'Escape') { this.tool = null; this.sel = null; this.refreshPalette(); this.renderProps(); this.markSel(); }
      };
      document.addEventListener('keydown', this.keyHandler);
      this.refreshBar();
    }

    buildPalette() {
      const mk = (t, label) => {
        const b = h('button', { class: 'pal-item', draggable: 'true', dataset: { t }, title: label || NAMES[t], onclick: () => this.armTool(t) },
          h('span', { class: 'ps' }, SHORT[t] || t), h('span', { class: 'pn' }, label || NAMES[t]));
        b.addEventListener('dragstart', e => { if (!this.can()) { e.preventDefault(); return; } e.dataTransfer.setData('text/plain', t); this.root.classList.add('dragging'); });
        b.addEventListener('dragend', () => this.root.classList.remove('dragging'));
        return b;
      };
      this.palette.append(h('h4', null, 'Contacts'), h('div', { class: 'pal-grid' }, COND_TYPES.map(t => mk(t))),
        h('h4', null, 'Outputs / blocks'), h('div', { class: 'pal-grid' }, OUT_TYPES.map(t => mk(t))),
        h('h4', null, 'Structure'), h('div', { class: 'pal-grid' }, [mk('branch', 'Parallel branch (OR)')]),
        h('p', { class: 'hint' }, 'Drag an item onto a \u201c+\u201d zone, or click an item then click a \u201c+\u201d. Select an element to edit it; Del deletes.'));
    }
    refreshPalette() { this.palette.querySelectorAll('.pal-item').forEach(b => b.classList.toggle('armed', b.dataset.t === this.tool)); this.root.classList.toggle('armed', !!this.tool && this.tool !== 'branch'); }
    armTool(t) {
      if (!this.can()) return U.toast('Read-only: Engineer or Admin role required', 'err');
      if (t === 'branch') { this.makeBranch(); return; }
      this.tool = this.tool === t ? null : t; this.refreshPalette();
    }

    refreshBar() {
      const run = this.plc.mode === 'run';
      this.modeLab.textContent = run ? (this.sim.paused ? 'RUN (paused)' : 'RUN') : 'STOP';
      this.modeLab.className = 'le-mode ' + (run ? (this.sim.paused ? 'paused' : 'run') : 'stop');
      this.pauseBtn.textContent = this.sim.paused ? '\u25b6 Resume' : '\u23f8 Pause';
      this.undoBtn.disabled = !this.undo.length; this.redoBtn.disabled = !this.redo.length;
      this.status.textContent = this.dirty ? '\u25cf unapplied changes' : '\u2713 draft = running program'; this.status.className = 'le-status' + (this.dirty ? ' dirty' : '');
      this.ro.style.display = this.can() ? 'none' : 'block'; this.root.classList.toggle('readonly', !this.can());
      this.speedSel.value = String(this.sim.speed);
    }

    /* ------------------------------------------------------------ render */
    render() {
      this.dl.innerHTML = ''; this.tags.list.forEach(t => this.dl.appendChild(h('option', { value: t.name }, t.desc)));
      this.renderSections(); this.renderRungs(); this.renderProps(); this.refreshBar(); this.refreshPalette();
    }
    renderSections() {
      const L = this.secList; L.innerHTML = '';
            this.draft.sections.forEach((s, i) => L.appendChild(h('button', { class: 'sec-tab' + (i === this.secIdx ? ' on' : ''), onclick: () => { this.secIdx = i; this.sel = null; this.render(); } }, h('b', null, s.name), h('small', null, ' ' + s.rungs.length))));
      if (this.can()) L.appendChild(h('div', { class: 'sec-ops' },
        this.btn('+ Section', async () => { const n = await U.promptBox('New section', 'Section name', 'New section'); if (n) this.mutate(d => { d.sections.push({ id: 's' + (d.nextId++), name: n, desc: '', rungs: [] }); this.secIdx = d.sections.length - 1; }); }),
        this.btn('Rename', async () => { const n = await U.promptBox('Rename section', 'Name', this.section.name); if (n) this.mutate(() => { this.section.name = n; }); }),
        this.btn('\u25b2', () => this.mutate(d => { const i = this.secIdx; if (i > 0) { [d.sections[i - 1], d.sections[i]] = [d.sections[i], d.sections[i - 1]]; this.secIdx--; } }), '', 'Move section up'),
        this.btn('\u25bc', () => this.mutate(d => { const i = this.secIdx; if (i < d.sections.length - 1) { [d.sections[i + 1], d.sections[i]] = [d.sections[i], d.sections[i + 1]]; this.secIdx++; } }), '', 'Move section down'),
        this.btn('Delete', async () => { if (this.draft.sections.length < 2) return U.toast('Keep at least one section', 'err'); if (await U.confirmBox('Delete section "' + this.section.name + '" and its rungs?')) this.mutate(d => { d.sections.splice(this.secIdx, 1); this.secIdx = 0; }); }, 'bad')));
    }

    renderRungs() {
      const C = this.center, scroll = C.scrollTop; C.innerHTML = ''; this.flowNodes = []; this.lvNodes = [];
      const sec = this.section; if (!sec) return;
      C.appendChild(h('div', { class: 'sec-head' }, h('h3', null, sec.name),
        h('input', { class: 'sec-desc', value: sec.desc || '', placeholder: 'Section description...', disabled: !this.can(), onchange: e => this.mutate(() => { sec.desc = e.target.value; }) })));
      sec.rungs.forEach((r, i) => C.appendChild(this.rungView(sec, r, i)));
      if (this.can()) C.appendChild(h('div', { class: 'add-rung' }, this.btn('+ Add rung', () => this.addRung(sec.rungs.length), 'primary')));
      // collect live-update nodes
      C.querySelectorAll('[data-f]').forEach(el => { const [k, id] = el.dataset.f.split(':'); this.flowNodes.push({ el, k, id }); });
      C.querySelectorAll('[data-lv]').forEach(el => { this.lvNodes.push({ el, tag: el.dataset.lv, bool: el.dataset.b === '1' }); });
      C.scrollTop = scroll; this.markSel(); this.update();
    }

    rungView(sec, r, i) {
      const cond = lay(r.cond), outs = r.outs.map(lay);
      const base = Math.max(cond.wy, outs[0] ? outs[0].wy : 0);
      const condTop = base - cond.wy; let outTop = outs[0] ? base - outs[0].wy : 0;
      let outsH = 0; const outPos = outs.map(o => { const y = outTop + outsH; outsH += o.h + GAP; return y; });
      const outW = outs.length ? Math.max(...outs.map(o => o.w)) : 90;
      const busX = STARTX + cond.w + 34, outX = busX + 26, W = outX + outW + 30;
      const H = Math.max(condTop + cond.h, outTop + Math.max(outsH - GAP, 40)) + 34;
      const S = []; const wy = base;
      S.push(`<line class="rail" x1="${RAIL}" y1="4" x2="${RAIL}" y2="${H - 4}"/><line class="rail" x1="${W - RAIL}" y1="4" x2="${W - RAIL}" y2="${H - 4}"/>`);
      S.push(`<line class="w" data-f="i:${r.cond.id}" x1="${RAIL}" y1="${wy}" x2="${STARTX}" y2="${wy}"/>`);
      this.drawNode(cond, STARTX, condTop, S);
      S.push(`<line class="w" data-f="o:${r.cond.id}" x1="${STARTX + cond.w}" y1="${wy}" x2="${busX}" y2="${wy}"/>`);
      if (outs.length) {
        const y1 = outPos[0] + outs[0].wy, y2 = outPos[outs.length - 1] + outs[outs.length - 1].wy;
        S.push(`<line class="w" data-f="o:${r.cond.id}" x1="${busX}" y1="${Math.min(wy, y1)}" x2="${busX}" y2="${Math.max(wy, y2)}"/>`);
        outs.forEach((o, k) => {
          const oy = outPos[k] + o.wy;
          S.push(`<line class="w" data-f="i:${o.n.id}" x1="${busX}" y1="${oy}" x2="${outX}" y2="${oy}"/>`);
          this.drawLeaf(o, outX, outPos[k], S);
          S.push(`<line class="w" data-f="o:${o.n.id}" x1="${outX + o.w}" y1="${oy}" x2="${W - RAIL}" y2="${oy}"/>`);
        });
      } else S.push(`<line class="w" data-f="o:${r.cond.id}" x1="${busX}" y1="${wy}" x2="${W - RAIL}" y2="${wy}"/>`);
      const dzY = outs.length ? outPos[outs.length - 1] + outs[outs.length - 1].h + 2 : wy + 4;
      S.push(`<g class="dz" data-dz="out:${r.id}"><rect x="${outX}" y="${dzY}" width="${Math.max(outW, 90)}" height="22" rx="4"/><text x="${outX + Math.max(outW, 90) / 2}" y="${dzY + 15}" text-anchor="middle">+ output</text></g>`);
      const svg = `<svg class="rung-svg" width="${W}" height="${Math.max(H, dzY + 30)}" viewBox="0 0 ${W} ${Math.max(H, dzY + 30)}">${S.join('')}</svg>`;
      const idx = i + 1;
      return h('div', { class: 'rung' + (r.bookmark ? ' bm' : ''), dataset: { rung: r.id } },
        h('div', { class: 'rung-h' },
          h('span', { class: 'rn', title: 'Click to insert the armed element at the end of this rung', onclick: () => this.insertAtRung(r) }, 'Rung ' + idx),
          h('input', { class: 'rc', value: r.comment || '', placeholder: 'Rung comment...', disabled: !this.can(), onchange: e => this.mutate(() => { r.comment = e.target.value; }) }),
          h('span', { class: 'rb' },
            h('button', { class: 'ib' + (r.bookmark ? ' on' : ''), title: 'Bookmark', onclick: () => this.mutate(() => { r.bookmark = !r.bookmark; }) }, '\u2605'),
            this.can() ? [h('button', { class: 'ib', title: 'Move up', onclick: () => this.moveRung(r, -1) }, '\u25b2'), h('button', { class: 'ib', title: 'Move down', onclick: () => this.moveRung(r, 1) }, '\u25bc'),
              h('button', { class: 'ib', title: 'Insert rung below', onclick: () => this.addRung(sec.rungs.indexOf(r) + 1) }, '\u2795'),
              h('button', { class: 'ib bad', title: 'Delete rung', onclick: () => this.mutate(() => { sec.rungs.splice(sec.rungs.indexOf(r), 1); }) }, '\u2716')] : null)),
        h('div', { class: 'rung-body', html: svg }));
    }

    /* ---- recursive drawing ---- */
    drawNode(L, x, y, S) {
      if (L.kind === 'leaf') return this.drawLeaf(L, x, y, S);
      if (L.kind === 'ser') {
        if (!L.parts.length) {
          S.push(`<line class="w" data-f="o:${L.n.id}" x1="${x}" y1="${y + L.wy}" x2="${x + L.w}" y2="${y + L.wy}"/>`);
          S.push(this.dz(L.n.id, 0, x + L.w / 2 - 9, y + L.wy - 13)); return;
        }
        let cx = x;
        L.parts.forEach((p, k) => { S.push(this.dz(L.n.id, k, cx - 9, y + L.wy - 40, true)); this.drawNode(p, cx, y + L.wy - p.wy, S); cx += p.w; });
        S.push(this.dz(L.n.id, L.parts.length, cx - 9, y + L.wy - 40, true));
        return;
      }
      // parallel group
      const wyAbs = y + L.wy, lastWy = y + L.parts[L.parts.length - 1].dy + L.parts[L.parts.length - 1].wy;
      S.push(`<line class="w" data-f="i:${L.n.id}" x1="${x + G / 2}" y1="${wyAbs}" x2="${x + G / 2}" y2="${lastWy}"/>`);
      S.push(`<line class="w" data-f="o:${L.n.id}" x1="${x + L.w - G / 2}" y1="${wyAbs}" x2="${x + L.w - G / 2}" y2="${lastWy}"/>`);
      L.parts.forEach(p => {
        const by = y + p.dy, wyb = by + p.wy, id = p.n.id;
        S.push(`<line class="w" data-f="i:${L.n.id}" x1="${x}" y1="${wyb}" x2="${x + G}" y2="${wyb}"/>`);
        this.drawNode(p, x + G, by, S);
        S.push(`<line class="w" data-f="o:${id}" x1="${x + G + p.w}" y1="${wyb}" x2="${x + L.w}" y2="${wyb}"/>`);
      });
    }
    dz(serId, idx, x, y, tall) {
      return `<g class="dz" data-dz="ser:${serId}:${idx}"><rect x="${x}" y="${y + (tall ? 20 : 0)}" width="18" height="26" rx="4"/><text x="${x + 9}" y="${y + (tall ? 20 : 0) + 18}" text-anchor="middle">+</text></g>`;
    }
    val(name) { return esc(name); }
    lv(tag, bool, x, y, anchor) { return `<text class="lv" data-lv="${esc(tag)}" data-b="${bool ? 1 : 0}" x="${x}" y="${y}" text-anchor="${anchor || 'middle'}">.</text>`; }
    lbl(txt, x, y, cls, anchor) { return `<text class="${cls || 'tg'}" x="${x}" y="${y}" text-anchor="${anchor || 'middle'}">${esc(String(txt).length > 17 ? String(txt).slice(0, 16) + '\u2026' : txt)}</text>`; }

    drawLeaf(L, x, y, S) {
      const n = L.n, wy = y + L.wy, w = L.w, cx = x + w / 2, id = n.id, T = n.tag || '?';
      const g = [`<g class="el" data-id="${id}"><title>${esc(this.describe(n))}</title><rect class="hit" x="${x + 1}" y="${y}" width="${w - 2}" height="${L.h}" rx="5"/>`];
      const stub = (x1, x2, f) => `<line class="w" data-f="${f}:${id}" x1="${x1}" y1="${wy}" x2="${x2}" y2="${wy}"/>`;
      if (['no', 'nc', 'pos', 'neg'].includes(n.t)) {
        g.push(stub(x, cx - 12, 'i'), stub(cx + 12, x + w, 'o'));
        g.push(`<line class="sym" data-f="o:${id}" x1="${cx - 12}" y1="${wy - 13}" x2="${cx - 12}" y2="${wy + 13}"/><line class="sym" data-f="o:${id}" x1="${cx + 12}" y1="${wy - 13}" x2="${cx + 12}" y2="${wy + 13}"/>`);
        if (n.t === 'nc') g.push(`<line class="sym" data-f="o:${id}" x1="${cx - 8}" y1="${wy + 11}" x2="${cx + 8}" y2="${wy - 11}"/>`);
        if (n.t === 'pos' || n.t === 'neg') g.push(`<text class="sl" x="${cx}" y="${wy + 5}" text-anchor="middle">${n.t === 'pos' ? 'P' : 'N'}</text>`);
        g.push(this.lbl(T, cx, y + 13, n.tag ? 'tg' : 'tg err'), this.lv(T, true, cx, y + 53));
      } else if (n.t === 'cmp') {
        g.push(stub(x, x + 8, 'i'), stub(x + w - 8, x + w, 'o'));
        g.push(`<rect class="box" data-f="o:${id}" x="${x + 8}" y="${y + 6}" width="${w - 16}" height="${L.h - 12}" rx="4"/>`);
        g.push(`<text class="bt" x="${cx}" y="${y + 20}" text-anchor="middle">${esc(this.fmtOperand(n.a))} ${esc(n.op)} ${esc(this.fmtOperand(n.b))}</text>`);
        g.push(this.cmpLive(n, cx, y + 36, y + 51));
      } else if (['coil', 'ncoil', 'set', 'reset'].includes(n.t)) {
        g.push(stub(x, cx - 14, 'i'), stub(cx + 14, x + w, 'o'));
        g.push(`<path class="sym" data-f="i:${id}" d="M ${cx - 10} ${wy - 14} Q ${cx - 18} ${wy} ${cx - 10} ${wy + 14}"/><path class="sym" data-f="i:${id}" d="M ${cx + 10} ${wy - 14} Q ${cx + 18} ${wy} ${cx + 10} ${wy + 14}"/>`);
        const ch = { coil: '', ncoil: '/', set: 'S', reset: 'R' }[n.t];
        if (ch) g.push(`<text class="sl" x="${cx}" y="${wy + 5}" text-anchor="middle">${ch}</text>`);
        g.push(this.lbl(T, cx, y + 13, n.tag ? 'tg' : 'tg err'), this.lv(T, true, cx, y + 53));
      } else if (['ton', 'tof', 'tp', 'ctu', 'ctd'].includes(n.t)) {
        const timer = ['ton', 'tof', 'tp'].includes(n.t);
        g.push(stub(x, x + 10, 'i'), stub(x + w - 10, x + w, 'o'));
        g.push(`<rect class="box" data-f="i:${id}" x="${x + 10}" y="${y + 2}" width="${w - 20}" height="${L.h - 6}" rx="4"/>`);
        g.push(`<text class="bh" x="${cx}" y="${y + 17}" text-anchor="middle">${n.t.toUpperCase()}  ${esc(T.length > 14 ? T.slice(0, 13) + '\u2026' : T)}</text>`);
        const pre = n.presetTag ? n.presetTag : (n.preset !== undefined ? n.preset : 0);
        if (timer) {
          g.push(`<text class="bt" x="${x + 16}" y="${y + 36}">PT</text>` + (n.presetTag ? this.lv(n.presetTag, false, x + w - 16, y + 36, 'end') : `<text class="bt" x="${x + w - 16}" y="${y + 36}" text-anchor="end">${esc(pre)} ms</text>`));
          g.push(`<text class="bt" x="${x + 16}" y="${y + 52}">ET</text>` + this.lv(T + '.ACC', false, x + w - 16, y + 52, 'end'));
          g.push(`<text class="bt" x="${x + 16}" y="${y + 68}">Q</text>` + this.lv(T + '.Q', true, x + w - 16, y + 68, 'end'));
        } else {
          g.push(`<text class="bt" x="${x + 16}" y="${y + 36}">PV</text>` + (n.presetTag ? this.lv(n.presetTag, false, x + w - 16, y + 36, 'end') : `<text class="bt" x="${x + w - 16}" y="${y + 36}" text-anchor="end">${esc(pre)}</text>`));
          g.push(`<text class="bt" x="${x + 16}" y="${y + 52}">CV</text>` + this.lv(T + '.CV', false, x + w - 16, y + 52, 'end'));
          g.push(`<text class="bt" x="${x + 16}" y="${y + 68}">${n.t === 'ctu' ? 'RES' : 'LD'}</text><text class="bt" x="${x + w - 16}" y="${y + 68}" text-anchor="end">${esc(n.reset || '-')}</text>`);
        }
      } else if (n.t === 'math') {
        g.push(stub(x, x + 10, 'i'), stub(x + w - 10, x + w, 'o'));
        g.push(`<rect class="box" data-f="i:${id}" x="${x + 10}" y="${y + 2}" width="${w - 20}" height="${L.h - 6}" rx="4"/>`);
        const un = ['abs', 'sqrt', 'mov'].includes(n.op);
        g.push(`<text class="bh" x="${cx}" y="${y + 17}" text-anchor="middle">${n.op === 'mov' ? 'MOV' : 'MATH ' + esc(n.op)}</text>`);
        g.push(`<text class="bt" x="${cx}" y="${y + 33}" text-anchor="middle">${esc(this.fmtOperand(n.a))}${un ? '' : ' ' + esc(n.op) + ' ' + esc(this.fmtOperand(n.b))}</text>`);
        g.push(`<text class="bt" x="${cx}" y="${y + 48}" text-anchor="middle">\u2192 ${esc(n.dest || '?')}</text>`);
      } else if (n.t === 'pid') {
        g.push(stub(x, x + 10, 'i'), stub(x + w - 10, x + w, 'o'));
        g.push(`<rect class="box" data-f="i:${id}" x="${x + 10}" y="${y + 2}" width="${w - 20}" height="${L.h - 6}" rx="4"/>`);
        g.push(`<text class="bh" x="${cx}" y="${y + 17}" text-anchor="middle">PID  ${esc(T)}</text>`);
        [['PV', n.pv], ['SP', n.sp], ['OUT', n.out]].forEach((r, k) => { g.push(`<text class="bt" x="${x + 16}" y="${y + 36 + k * 16}">${r[0]}</text>` + this.lv(r[1] || '', false, x + w - 16, y + 36 + k * 16, 'end')); });
      }
      g.push('</g>');
      S.push(g.join(''));
    }
    fmtOperand(o) { return o === undefined || o === null || o === '' ? '?' : String(o).length > 12 ? String(o).slice(0, 11) + '\u2026' : o; }
    cmpLive(n, cx, y1, y2) {
      const one = (o, x) => (o === undefined || o === '' || /^-?\d+(\.\d+)?$/.test(String(o))) ? `<text class="lv" x="${x}" y="${y1}" text-anchor="middle">${esc(o)}</text>` : this.lv(o, false, x, y1);
      return one(n.a, cx - 28) + one(n.b, cx + 28);
    }
    describe(n) {
      const d = nm => { const t = this.tags.tag(nm); return t ? `${nm}: ${t.desc || ''} [${t.addr}]` : nm || '(no tag)'; };
      if (n.tag) return NAMES[n.t] + ' - ' + d(n.tag);
      if (n.t === 'cmp') return `Compare ${n.a} ${n.op} ${n.b}`;
      if (n.t === 'math') return `${n.op}: ${n.a}, ${n.b} -> ${n.dest}`;
      return NAMES[n.t] || n.t;
    }

    /* ------------------------------------------------------------ live update */
    update() {
      if (!this.root.isConnected) return;
      const fi = this.plc.flowIn, fo = this.plc.flowOut;
      for (const f of this.flowNodes) {
        const on = (f.k === 'i' ? fi[f.id] : fo[f.id]) === true;
        if (f.el._on !== on) { f.el._on = on; f.el.classList.toggle('on', on); }
      }
      for (const l of this.lvNodes) {
        const t = this.tags.tag(l.tag); let txt = '';
        if (t) { const v = t.v; txt = v === true ? '1' : v === false ? '0' : (Number.isInteger(v) ? String(v) : v.toFixed(1)); if (t.forced) txt += ' F'; }
        if (l.el._t !== txt) { l.el._t = txt; l.el.textContent = txt; if (l.bool && t) { l.el.classList.toggle('t1', !!t.v); l.el.classList.toggle('forced', t.forced); } else if (t) l.el.classList.toggle('forced', t.forced); }
      }
      this.refreshBar();
    }

    /* ------------------------------------------------------------ selection / properties */
    onClick(e) {
      const dz = e.target.closest('[data-dz]');
      if (dz) { if (this.tool) this.dropAt(dz.dataset.dz, this.tool); return; }
      const el = e.target.closest('[data-id]');
      if (el) { this.sel = el.dataset.id; this.markSel(); this.renderProps(); } else if (!e.target.closest('input,button')) { this.sel = null; this.markSel(); this.renderProps(); }
    }
    markSel() { this.center.querySelectorAll('.el.sel').forEach(e => e.classList.remove('sel')); if (this.sel) { const e = this.center.querySelector(`.el[data-id="${this.sel}"]`); if (e) e.classList.add('sel'); } }

    find(id) {
      for (const sec of this.draft.sections) for (const rung of sec.rungs) {
        const walk = (node, parent) => {
          if (node.id === id) return { node, parent, rung, sec, kind: 'cond' };
          if (node.items) for (const c of node.items) { const r = walk(c, node); if (r) return r; }
          return null;
        };
        const r = walk(rung.cond, null); if (r) return r;
        const o = rung.outs.find(x => x.id === id); if (o) return { node: o, parent: null, rung, sec, kind: 'out' };
      }
      return null;
    }

    renderProps() {
      const P_ = this.props; P_.innerHTML = '';
      const f = this.sel && this.find(this.sel);
      if (!f) { P_.append(h('h4', null, 'Properties'), h('p', { class: 'hint' }, 'Select a contact, coil or block to edit its tag, presets and type. Use Force to override a tag while the PLC runs.'), this.bookmarksView()); return; }
      const n = f.node, ro = !this.can();
      const tagField = (label, field, hint) => {
        const inp = h('input', { list: 'le-tags', value: n[field] === undefined ? '' : n[field], disabled: ro, spellcheck: 'false', onchange: e => this.setField(n, field, e.target.value.trim()) });
        const ok = !n[field] || this.tags.has(n[field]) || /^-?\d+(\.\d+)?$/.test(String(n[field])) || String(n[field]).includes('.');
        const wrap = h('div', { class: 'fld' }, h('label', null, label), inp);
        if (!ok) { inp.classList.add('err'); wrap.append(h('div', { class: 'hint err' }, 'Undefined tag. ', ro ? null : h('button', { class: 'btn', onclick: () => this.createTag(n[field], hint) }, 'Create ' + (hint || 'BOOL') + ' tag'))); }
        return wrap;
      };
      const numField = (label, field, suffix) => h('div', { class: 'fld' }, h('label', null, label), h('input', { type: 'number', value: n[field] === undefined ? 0 : n[field], disabled: ro, onchange: e => this.setField(n, field, parseFloat(e.target.value) || 0) }), suffix ? h('small', null, suffix) : null);
      const selField = (label, field, opts) => h('div', { class: 'fld' }, h('label', null, label), h('select', { disabled: ro, onchange: e => this.setField(n, field, e.target.value) }, opts.map(o => h('option', { value: o, selected: n[field] === o }, o))));
      const body = [h('h4', null, NAMES[n.t] || n.t), h('div', { class: 'hint' }, 'Section ' + f.sec.name + ', rung ' + (f.sec.rungs.indexOf(f.rung) + 1))];
      const grp = Object.keys(GROUPS).find(k => GROUPS[k].includes(n.t));
      if (grp) body.push(h('div', { class: 'fld' }, h('label', null, 'Replace with'), h('select', { disabled: ro, onchange: e => this.replaceType(n, e.target.value) }, GROUPS[grp].map(t => h('option', { value: t, selected: t === n.t }, NAMES[t])))));
      if (['no', 'nc', 'pos', 'neg', 'coil', 'ncoil', 'set', 'reset'].includes(n.t)) body.push(tagField('Tag (BOOL)', 'tag', 'BOOL'));
      if (n.t === 'cmp') body.push(tagField('Operand A (tag or number)', 'a', 'REAL'), selField('Operator', 'op', ['==', '!=', '>', '>=', '<', '<=']), tagField('Operand B (tag or number)', 'b', 'REAL'));
      if (['ton', 'tof', 'tp'].includes(n.t)) body.push(h('div', { class: 'fld' }, h('label', null, 'Instance name'), h('input', { value: n.tag, disabled: ro, onchange: e => this.setField(n, 'tag', e.target.value.trim()) })), numField('Preset', 'preset', 'ms'), tagField('Preset from tag (optional)', 'presetTag', 'INT'));
      if (['ctu', 'ctd'].includes(n.t)) body.push(h('div', { class: 'fld' }, h('label', null, 'Instance name'), h('input', { value: n.tag, disabled: ro, onchange: e => this.setField(n, 'tag', e.target.value.trim()) })), numField('Preset', 'preset', 'counts'), tagField('Preset from tag (optional)', 'presetTag', 'INT'), tagField(n.t === 'ctu' ? 'Reset tag' : 'Load tag', 'reset', 'BOOL'));
      if (n.t === 'math') body.push(selField('Operation', 'op', ['mov', '+', '-', '*', '/', 'mod', 'min', 'max', 'abs', 'sqrt']), tagField('Operand A', 'a', 'REAL'), tagField('Operand B', 'b', 'REAL'), tagField('Destination', 'dest', 'REAL'));
      if (n.t === 'pid') body.push(h('div', { class: 'fld' }, h('label', null, 'Instance name'), h('input', { value: n.tag, disabled: ro, onchange: e => this.setField(n, 'tag', e.target.value.trim()) })), tagField('PV', 'pv', 'REAL'), tagField('SP', 'sp', 'REAL'), tagField('Output', 'out', 'REAL'), tagField('Kp', 'kp', 'REAL'), tagField('Ki', 'ki', 'REAL'), tagField('Kd', 'kd', 'REAL'), tagField('Auto (BOOL)', 'auto', 'BOOL'), tagField('Manual output', 'man', 'REAL'));
      // live value + force
      const tagName = n.tag || n.dest;
      const t = tagName && this.tags.tag(tagName);
      if (t && !['ton', 'tof', 'tp', 'ctu', 'ctd', 'pid'].includes(n.t)) {
        body.push(h('div', { class: 'force' }, h('b', null, t.name), ' = ', h('span', { class: 'lvv', dataset: { live: t.name } }, String(t.v)), t.forced ? h('span', { class: 'frc' }, ' FORCED') : null, h('div', { class: 'hint' }, t.desc + ' [' + t.addr + ']'),
          this.can() ? h('div', { class: 'btnrow' }, t.type === 'BOOL' ? [h('button', { class: 'btn bad', onclick: () => { this.tags.force(t.name, true, 'ladder'); this.renderProps(); } }, 'Force ON'), h('button', { class: 'btn bad', onclick: () => { this.tags.force(t.name, false, 'ladder'); this.renderProps(); } }, 'Force OFF')] : h('button', { class: 'btn bad', onclick: async () => { const v = await U.promptBox('Force ' + t.name, 'Value', String(t.v)); if (v !== null) { this.tags.force(t.name, parseFloat(v) || 0, 'ladder'); this.renderProps(); } } }, 'Force value\u2026'), h('button', { class: 'btn', disabled: !t.forced, onclick: () => { this.tags.force(t.name, null, 'ladder'); this.renderProps(); } }, 'Release')) : null));
      }
      if (tagName) body.push(h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => P.bus.emit('xref', n.tag || n.dest) }, 'Cross-reference\u2026')));
      if (!ro) body.push(h('div', { class: 'btnrow' }, h('button', { class: 'btn bad', onclick: () => this.deleteSel() }, 'Delete element'), h('button', { class: 'btn', onclick: () => this.makeBranch() }, 'Parallel branch')));
      P_.append(...body);
    }
    bookmarksView() {
      const items = [];
      this.draft.sections.forEach((s, si) => s.rungs.forEach((r, ri) => { if (r.bookmark) items.push(h('button', { class: 'sec-item', onclick: () => this.jump(r.id) }, h('b', null, '\u2605 ' + s.name + ' / ' + (ri + 1)), h('small', null, r.comment || ''))); }));
      return h('div', null, h('h4', null, 'Bookmarks'), items.length ? items : h('p', { class: 'hint' }, 'Click \u2605 in a rung header to bookmark it.'));
    }
    setField(n, field, v) {
      this.mutate(() => { if (['preset'].includes(field)) n[field] = v; else if (field === 'op' || field === 'tag' || field === 'dest' || field === 'out' || field === 'a' || field === 'b' || field === 'presetTag' || field === 'reset' || field === 'pv' || field === 'sp' || field === 'kp' || field === 'ki' || field === 'kd' || field === 'auto' || field === 'man') { const num = (field === 'a' || field === 'b') && v !== '' && /^-?\d+(\.\d+)?$/.test(v); n[field] = num ? parseFloat(v) : v; } else n[field] = v; });
      if (field === 'presetTag' && !v) { /* ok */ }
      this.renderProps();
    }
    replaceType(n, t) { this.mutate(() => { n.t = t; }); this.renderProps(); }
    createTag(name, type) {
      if (!name || this.tags.has(name)) return;
      this.tags.add({ name, type: type || 'BOOL', addr: type === 'REAL' ? '%MD' + (200 + this.tags.list.length) : type === 'INT' ? '%MW' + (200 + this.tags.list.length) : '%MX9.' + (this.tags.list.length % 8), desc: 'Created in ladder editor' });
      P.bus.emit('audit', { action: 'TAG_CREATE', detail: name + ' (' + (type || 'BOOL') + ')' }); P.bus.emit('tagsedited');
      this.render();
    }

    /* ------------------------------------------------------------ mutation core */
    snapshot() { return JSON.stringify(this.draft); }
    mutate(fn) {
      if (!this.can()) { U.toast('Read-only: Engineer or Admin role required', 'err'); return; }
      this.undo.push(this.snapshot()); if (this.undo.length > 100) this.undo.shift(); this.redo = [];
      fn(this.draft);
      this.draft.sections.forEach(s => s.rungs.forEach(r => this.cleanup(r)));
      P.Program.normalize(this.draft);
      this.dirty = true; this.render(); if (this.ctx.onChange) this.ctx.onChange();
    }
    doUndo() { if (!this.undo.length) return; this.redo.push(this.snapshot()); this.draft = JSON.parse(this.undo.pop()); this.dirty = true; this.sel = null; this.render(); if (this.ctx.onChange) this.ctx.onChange(); }
    doRedo() { if (!this.redo.length) return; this.undo.push(this.snapshot()); this.draft = JSON.parse(this.redo.pop()); this.dirty = true; this.sel = null; this.render(); if (this.ctx.onChange) this.ctx.onChange(); }

    /** Remove empty / single-child groups after structural edits. */
    cleanup(rung) {
      const fix = node => {
        if (!node.items) return node;
        node.items = node.items.map(fix).filter(c => !(c.items && c.items.length === 0));
        if (node.t === 'ser') { const flat = []; node.items.forEach(c => { if (c.t === 'ser') flat.push(...c.items); else flat.push(c); }); node.items = flat; }
        if (node.t === 'par') {
          if (node.items.length === 1) return node.items[0];
        }
        return node;
      };
      rung.cond = fix(rung.cond);
      if (rung.cond.t !== 'ser') rung.cond = { t: 'ser', id: 'c' + Math.random().toString(36).slice(2, 7), items: [rung.cond] };
      // par directly nested in par with single ser child etc. handled by normalize
    }

    uniqueInst(prefix) { const used = new Set(); P.Program.forEach(this.draft, el => { if (el.tag) used.add(el.tag); }); let i = 1; while (used.has(prefix + i)) i++; return prefix + i; }
    mkEl(t) {
      const e = { t };
      if (['no', 'nc', 'pos', 'neg', 'coil', 'ncoil', 'set', 'reset'].includes(t)) e.tag = '';
      if (t === 'cmp') { e.op = '>'; e.a = ''; e.b = 0; }
      if (['ton', 'tof', 'tp'].includes(t)) { e.tag = this.uniqueInst('T_NEW'); e.preset = 1000; }
      if (['ctu', 'ctd'].includes(t)) { e.tag = this.uniqueInst('C_NEW'); e.preset = 10; e.reset = ''; }
      if (t === 'math') { e.op = 'mov'; e.a = 0; e.b = 0; e.dest = ''; }
      if (t === 'pid') Object.assign(e, { tag: this.uniqueInst('PID_NEW'), pv: '', sp: '', out: '', kp: '', ki: '', kd: '', auto: '', man: '', min: 0, max: 100 });
      return e;
    }
    dropAt(code, tool) {
      if (!this.can()) return U.toast('Read-only: Engineer or Admin role required', 'err');
      if (!tool || tool === 'branch') return;
      const parts = code.split(':');
      if (parts[0] === 'ser') {
        if (!COND_TYPES.includes(tool)) return U.toast('Outputs and blocks go on the right-hand side of the rung (the "+ output" zone).', 'err');
        const id = parts[1], idx = parseInt(parts[2]); const el = this.mkEl(tool);
        this.mutate(d => { const f = this.find2(d, id); if (f) f.items.splice(idx, 0, el); });
        this.sel = el.id;
      } else if (parts[0] === 'out') {
        if (!OUT_TYPES.includes(tool)) return U.toast('Contacts and comparators go on the left-hand side (condition).', 'err');
        const el = this.mkEl(tool);
        this.mutate(d => { d.sections.forEach(s => s.rungs.forEach(r => { if (r.id === parts[1]) r.outs.push(el); })); });
        this.sel = el.id;
      }
      this.tool = null; this.refreshPalette(); this.render();
    }
    find2(d, id) { let res = null; const walk = n => { if (n.id === id) res = n; (n.items || []).forEach(walk); }; d.sections.forEach(s => s.rungs.forEach(r => walk(r.cond))); return res; }
    insertAtRung(r) {
      if (!this.tool || !this.can()) return;
      if (COND_TYPES.includes(this.tool)) this.dropAt('ser:' + r.cond.id + ':' + r.cond.items.length, this.tool); else this.dropAt('out:' + r.id, this.tool);
    }
    addRung(at) {
      this.mutate(d => { const sec = d.sections[this.secIdx]; sec.rungs.splice(at, 0, { id: 'r' + (d.nextId++), comment: '', cond: { t: 'ser', items: [] }, outs: [] }); });
    }
    moveRung(r, dir) { this.mutate(d => { const rs = d.sections[this.secIdx].rungs, i = rs.findIndex(x => x.id === r.id), j = i + dir; if (j >= 0 && j < rs.length) { [rs[i], rs[j]] = [rs[j], rs[i]]; } }); }
    deleteSel() {
      if (!this.sel || !this.can()) return; const id = this.sel;
      this.mutate(d => {
        d.sections.forEach(s => s.rungs.forEach(r => {
          const o = r.outs.findIndex(x => x.id === id); if (o >= 0) r.outs.splice(o, 1);
          const walk = n => { if (n.items) { const i = n.items.findIndex(c => c.id === id); if (i >= 0) n.items.splice(i, 1); else n.items.forEach(walk); } }; walk(r.cond);
        }));
      });
      this.sel = null; this.renderProps();
    }
    /** Parallel branch: wrap the selected contact in a par group, or add a branch to its group. */
    makeBranch() {
      if (!this.can()) return U.toast('Read-only: Engineer or Admin role required', 'err');
      if (!this.sel) return U.toast('Select a contact first, then click "Parallel branch".', 'err');
      const f = this.find(this.sel); if (!f || f.kind !== 'cond') return U.toast('Branches are made on the condition side (left of the coil).', 'err');
      const nu = this.mkEl('no'); const id = this.sel;
      this.mutate(d => {
        const walk = (n, parent, gp) => {
          if (n.id === id && parent) {
            if (gp && gp.t === 'par' && parent.t === 'ser') { gp.items.push({ t: 'ser', items: [nu] }); }
            else { const i = parent.items.indexOf(n); parent.items[i] = { t: 'par', items: [{ t: 'ser', items: [n] }, { t: 'ser', items: [nu] }] }; }
            return true;
          }
          if (n.items) for (const c of n.items) if (walk(c, n, parent)) return true;
          return false;
        };
        d.sections.forEach(s => s.rungs.forEach(r => walk(r.cond, null, null)));
      });
      this.sel = nu.id; this.renderProps(); this.markSel();
    }

    /** Jump to a rung (and optionally an element) from cross-reference, errors or bookmarks. */
    jump(rungId, elId) {
      this.draft.sections.forEach((s, i) => { if (s.rungs.some(r => r.id === rungId)) this.secIdx = i; });
      if (elId) this.sel = elId; this.render();
      const r = this.center.querySelector(`[data-rung="${rungId}"]`);
      if (r) { r.scrollIntoView({ block: 'center', behavior: 'smooth' }); r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 1600); }
    }

    /* ------------------------------------------------------------ compile / apply / files */
    apply() {
      if (!this.can()) return U.toast('Read-only: Engineer or Admin role required', 'err');
      P.Program.normalize(this.draft);
      this.draft.sections.forEach(s => s.rungs.forEach(r => this.ensureInst(r)));
      const res = this.plc.compile(this.draft);
      if (res.errors.length) {
        U.modal({
          title: 'Compile failed - ' + res.errors.length + ' error(s). Running program unchanged.', wide: true,
          body: h('div', null, h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Section'), h('th', null, 'Rung'), h('th', null, 'Problem')),
            res.errors.map(e => h('tr', { class: 'clk', onclick: () => { document.querySelector('.modal-back') && document.querySelector('.modal-back').remove(); const rg = this.findRungByPos(e.section, e.rung); if (rg) this.jump(rg.id, e.id); } }, h('td', null, e.section), h('td', null, e.rung), h('td', null, e.msg)))),
            res.warnings.length ? h('p', { class: 'hint' }, res.warnings.length + ' warning(s): ' + res.warnings.map(w => w.msg).join('; ')) : null,
            h('p', { class: 'hint' }, 'Click an error to jump to the rung.'))
        });
        P.bus.emit('audit', { action: 'LADDER_APPLY_FAILED', detail: res.errors.length + ' errors' });
        return false;
      }
      this.plc.load(P.Program.clone(this.draft), true);
      this.ctx.saveProgram(this.draft); this.dirty = false;
      P.bus.emit('audit', { action: 'LADDER_APPLY', detail: JSON.stringify(P.Program.stats(this.draft)) });
      U.toast('Applied to running PLC' + (res.warnings.length ? ' (' + res.warnings.length + ' warning(s): ' + res.warnings[0].msg + ')' : ''), res.warnings.length ? 'warn' : 'ok');
      this.render(); P.bus.emit('program:applied'); return true;
    }
    ensureInst(r) { /* aux tags for new timers/counters are created by plc.load */ }
    findRungByPos(secName, num) { const s = this.draft.sections.find(x => x.name === secName); return s ? s.rungs[num - 1] : null; }
    exportJSON() { U.download('beverage-plant-program.json', JSON.stringify(this.draft, null, 1), 'application/json'); P.bus.emit('audit', { action: 'LADDER_EXPORT', detail: '' }); }
    async importJSON() {
      if (!this.can()) return U.toast('Read-only: Engineer or Admin role required', 'err');
      const f = await U.pickFile('.json'); if (!f) return;
      try {
        const p = JSON.parse(f.text); if (!p.sections || !Array.isArray(p.sections)) throw new Error('missing "sections" array');
        P.Program.normalize(p);
        this.mutate(d => { Object.keys(d).forEach(k => delete d[k]); Object.assign(d, p); }); this.secIdx = 0;
        U.toast('Program loaded as draft. Review and press Compile / Apply.', 'ok'); P.bus.emit('audit', { action: 'LADDER_IMPORT', detail: f.name });
      } catch (e) { U.toast('Invalid program file: ' + e.message, 'err'); }
    }
    async resetDefault() {
      if (!this.can()) return U.toast('Read-only: Engineer or Admin role required', 'err');
      if (!(await U.confirmBox('Replace the program with the default plant program? Your edits will be lost (use Save JSON or a version snapshot first).', 'Reset'))) return;
      this.undo.push(this.snapshot()); this.draft = P.Program.clone(g.PLANT_DEFAULTS.program); P.Program.normalize(this.draft); this.secIdx = 0; this.sel = null;
      this.plc.load(P.Program.clone(this.draft), false); this.ctx.saveProgram(this.draft); this.dirty = false; this.render();
      P.bus.emit('audit', { action: 'LADDER_RESET', detail: 'default program restored' }); U.toast('Default program restored', 'ok'); P.bus.emit('program:applied');
    }
    /** Replace draft from outside (version restore, search/replace) */
    setDraft(p, dirty) { this.undo.push(this.snapshot()); this.draft = P.Program.normalize(P.Program.clone(p)); this.dirty = dirty !== false; this.sel = null; this.render(); }
    destroy() { document.removeEventListener('keydown', this.keyHandler); }
  }

  P.LadderEditor = LadderEditor; P.LADDER = { NAMES, lay };
})(typeof window !== 'undefined' ? window : globalThis);
