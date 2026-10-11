/* ==========================================================================
   storage.js  -  persistence layer
   --------------------------------------------------------------------------
   * Store      : safe localStorage wrapper (JSON, prefix "bevplant.")
   * Audit      : who did what and when (login, ladder edit, tag change, force,
                  setpoint change, alarm acknowledge ...) + CSV export
   * Versions   : named snapshots of program + tag definitions, diff, restore
   * Hist       : data historian - memory ring buffer + IndexedDB persistence,
                  range queries (1 min / 1 h / shift) for zoom & pan charts
   Everything is wrapped in try/catch: private-mode browsers or file://
   restrictions must never break the simulator.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};
  const PFX = 'bevplant.';

  const Store = {
    ok: (() => { try { g.localStorage.setItem(PFX + 't', '1'); g.localStorage.removeItem(PFX + 't'); return true; } catch (e) { return false; } })(),
    mem: {},
    get(k, def) {
      try { const s = this.ok ? g.localStorage.getItem(PFX + k) : this.mem[k]; return s == null ? def : JSON.parse(s); } catch (e) { return def; }
    },
    set(k, v) {
      try { const s = JSON.stringify(v); if (this.ok) g.localStorage.setItem(PFX + k, s); else this.mem[k] = s; return true; } catch (e) { return false; }
    },
    del(k) { try { if (this.ok) g.localStorage.removeItem(PFX + k); delete this.mem[k]; } catch (e) { /* ignore */ } }
  };

  /* --------------------------------- session --------------------------------- */
  P.session = { user: '', role: '', canEdit() { return this.role === 'Engineer' || this.role === 'Admin'; }, isAdmin() { return this.role === 'Admin'; } };

  /* --------------------------------- audit trail --------------------------------- */
  const Audit = {
    list: Store.get('audit', []),
    log(action, detail) {
      const e = { ts: Date.now(), user: P.session.user || '-', role: P.session.role || '-', action, detail: String(detail || '') };
      this.list.push(e); if (this.list.length > 1500) this.list.splice(0, this.list.length - 1500);
      this.dirty = true; P.bus.emit('audit:added', e); return e;
    },
    flush() { if (this.dirty) { Store.set('audit', this.list); this.dirty = false; } },
    clear() { this.list = []; this.dirty = true; this.flush(); },
    toCSV() {
      const q = s => '"' + String(s).replace(/"/g, '""') + '"';
      return ['timestamp,user,role,action,detail'].concat(this.list.map(e => [q(new Date(e.ts).toISOString()), q(e.user), q(e.role), q(e.action), q(e.detail)].join(','))).join('\r\n');
    }
  };
  P.bus.on('audit', e => Audit.log(e.action, e.detail));
  P.bus.on('tagchange', e => { if (e.source === 'tagtable' || e.source === 'setpoint') Audit.log(e.source === 'setpoint' ? 'SETPOINT_CHANGE' : 'TAG_CHANGE', `${e.name}: ${e.old} -> ${e.value}`); });
  P.bus.on('force', e => Audit.log(e.forced ? 'FORCE_ON' : 'FORCE_OFF', e.name + (e.forced ? ' = ' + e.value : '')));
  setInterval(() => Audit.flush(), 4000);

  /* --------------------------------- program / tag persistence --------------------------------- */
  const Prog = {
    loadProgram() { return Store.get('program', null) || P.Program.clone(g.PLANT_DEFAULTS.program); },
    saveProgram(p) { Store.set('program', p); },
    loadTags() { return Store.get('tags', null) || JSON.parse(JSON.stringify(g.PLANT_DEFAULTS.tags)); },
    saveTags(defs) { Store.set('tags', defs); },
    resetDefaults() { Store.del('program'); Store.del('tags'); }
  };

  /* --------------------------------- version history --------------------------------- */
  const Versions = {
    list() { return Store.get('versions', []); },
    save(name, program, tagDefs) {
      const l = this.list();
      l.push({ id: 'v' + Date.now(), name: name || 'Snapshot', ts: Date.now(), user: P.session.user || '-', program: P.Program.clone(program), tags: tagDefs });
      while (l.length > 12) l.shift();               // keep storage small
      Store.set('versions', l);
      Audit.log('VERSION_SAVE', name);
    },
    get(id) { return this.list().find(v => v.id === id); },
    remove(id) { Store.set('versions', this.list().filter(v => v.id !== id)); },
    /** Compare two snapshots (program rungs and tag definitions). */
    diff(a, b) {
      const res = { rungs: [], tags: [] };
      const flat = v => { const m = {}; v.program.sections.forEach(s => s.rungs.forEach((r, i) => { m[r.id] = { sec: s.name, idx: i + 1, json: JSON.stringify([r.cond, r.outs, r.comment]), st: P.toST({ sections: [{ name: s.name, rungs: [r] }] }).split('\n').slice(1).join(' ').trim() }; })); return m; };
      const A = flat(a), B = flat(b);
      Object.keys(B).forEach(id => { if (!A[id]) res.rungs.push({ kind: 'added', sec: B[id].sec, idx: B[id].idx, text: B[id].st }); else if (A[id].json !== B[id].json) res.rungs.push({ kind: 'changed', sec: B[id].sec, idx: B[id].idx, text: B[id].st, was: A[id].st }); });
      Object.keys(A).forEach(id => { if (!B[id]) res.rungs.push({ kind: 'removed', sec: A[id].sec, idx: A[id].idx, text: A[id].st }); });
      const ta = {}, tb = {}; a.tags.forEach(t => { ta[t.name] = t; }); b.tags.forEach(t => { tb[t.name] = t; });
      Object.keys(tb).forEach(n => { if (!ta[n]) res.tags.push({ kind: 'added', name: n }); else if (JSON.stringify(ta[n]) !== JSON.stringify(tb[n])) res.tags.push({ kind: 'changed', name: n }); });
      Object.keys(ta).forEach(n => { if (!tb[n]) res.tags.push({ kind: 'removed', name: n }); });
      return res;
    }
  };

  /* --------------------------------- data historian --------------------------------- */
  const HIST_CH = [   // channel key, tag, label, unit
    ['tt', 'AI_TT201', 'Pasteurizer temp TT-201', 'degC'], ['sp', 'TT_SP', 'Temperature setpoint', 'degC'], ['heat', 'AO_HEATER', 'Heater output', '%'],
    ['pt', 'AI_PT201', 'Pressure PT-201', 'bar'], ['l101', 'AI_LT101', 'Syrup level LT-101', '%'], ['l102', 'AI_LT102', 'Water level LT-102', '%'],
    ['l201', 'AI_LT201', 'Pasteurizer level LT-201', '%'], ['l301', 'AI_LT301', 'Filler bowl LT-301', '%'], ['wt', 'AI_WT103', 'Mixer weight WT-103', 'kg'],
    ['spd', 'AI_CONV_SPD', 'Conveyor speed', '%'], ['kw', 'AI_KW', 'Plant power', 'kW'], ['gas', 'AI_GAS_PPM', 'Gas', 'ppm']
  ];
  const Hist = {
    ch: HIST_CH, mem: [], db: null, pending: [], maxMem: 40000, lastRate: 0, rateRef: { n: 0, t: 0 },
    open() {
      if (!P.FEATURES.historian || !g.indexedDB) return;
      try {
        const rq = g.indexedDB.open('bevplant-hist', 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore('s', { keyPath: 't' }); };
        rq.onsuccess = () => { this.db = rq.result; this.loadRecent(); };
        rq.onerror = () => { this.db = null; };
      } catch (e) { this.db = null; }
    },
    loadRecent() {
      try {
        const tx = this.db.transaction('s', 'readonly'), st = tx.objectStore('s'), out = [];
        st.openCursor(null, 'prev').onsuccess = ev => {
          const c = ev.target.result;
          if (c && out.length < 3600) { out.push(c.value); c.continue(); }
          else { out.reverse(); this.prior = out; P.bus.emit('hist:loaded', out.length); }
        };
      } catch (e) { /* ignore */ }
    },
    /** Record one sample (called every simulated second). */
    sample(clockMs, tags, rate) {
      const s = { t: clockMs, r: rate };
      HIST_CH.forEach(c => { s[c[0]] = Math.round(tags.num(c[1]) * 100) / 100; });
      this.mem.push(s); if (this.mem.length > this.maxMem) this.mem.splice(0, this.mem.length - this.maxMem);
      this.pending.push(s);
    },
    flush() {
      if (!this.db || !this.pending.length) return;
      try {
        const tx = this.db.transaction('s', 'readwrite'), st = tx.objectStore('s');
        this.pending.forEach(s => st.put(s)); this.pending = [];
        // trim: keep ~100k newest
        st.count().onsuccess = ev => { const n = ev.target.result; if (n > 100000) { let k = n - 100000; st.openCursor().onsuccess = e2 => { const c = e2.target.result; if (c && k-- > 0) { c.delete(); c.continue(); } }; } };
      } catch (e) { this.pending = []; }
    },
    /** Samples between t0 and t1 (clock ms), downsampled to <= maxPts */
    range(t0, t1, maxPts) {
      let src = this.mem;
      if (this.prior && this.prior.length && this.mem.length && t0 < this.mem[0].t) src = this.prior.filter(s => s.t < this.mem[0].t).concat(this.mem);
      else if (this.prior && !this.mem.length) src = this.prior;
      const out = src.filter(s => s.t >= t0 && s.t <= t1);
      if (out.length <= maxPts) return out;
      const k = out.length / maxPts, r = [];
      for (let i = 0; i < maxPts; i++) r.push(out[Math.floor(i * k)]);
      return r;
    },
    clear() { this.mem = []; this.prior = []; this.pending = []; if (this.db) { try { this.db.transaction('s', 'readwrite').objectStore('s').clear(); } catch (e) { /* ignore */ } } }
  };
  setInterval(() => Hist.flush(), 5000);

  P.Store = Store; P.Audit = Audit; P.Prog = Prog; P.Versions = Versions; P.Hist = Hist;
})(typeof window !== 'undefined' ? window : globalThis);
