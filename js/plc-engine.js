/* ==========================================================================
   plc-engine.js  -  PLC scan-cycle engine
   --------------------------------------------------------------------------
   One scan = (1) read inputs  (2) execute logic rung by rung  (3) write outputs
   The program is a JSON tree:

     program  = { sections:[ section ], sfc:{...} }
     section  = { id, name, desc, rungs:[ rung ] }
     rung     = { id, comment, bookmark, cond:node, outs:[ output ] }
     node     = { t:'ser', items:[node...] }        AND  (series)
              | { t:'par', items:[node...] }        OR   (parallel branches)
              | { t:'no'|'nc'|'pos'|'neg', tag }    contacts (pos/neg = edge)
              | { t:'cmp', op, a, b }               comparator (== != > >= < <=)
     output   = coil | ncoil | set | reset          { t, tag }
              | ton | tof | tp                      { t, tag(instance), preset | presetTag }
              | ctu | ctd                           { t, tag(instance), preset | presetTag, reset }
              | math                                { t, op, a, b, dest }
              | pid                                 { t, tag, pv, sp, out, kp, ki, kd, auto, man }

   Operands (a, b, preset...) are either a number or a tag name.
   Every node has a unique id so the editor can show live power flow.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};

  const CONTACTS = ['no', 'nc', 'pos', 'neg'];
  const TIMERS = ['ton', 'tof', 'tp'];
  const COUNTERS = ['ctu', 'ctd'];
  const WRITERS = ['coil', 'ncoil', 'set', 'reset'];
  const isNumStr = s => typeof s === 'number' || (typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s.trim()));

  /* ------------------------------------------------------------------
     Program helpers (used by engine, editor, xref, compile, tests)
     ------------------------------------------------------------------ */
  const Program = {
    clone: o => JSON.parse(JSON.stringify(o)),

    /** Make sure every node has an id and every rung has the expected shape. */
    normalize(prog) {
      let n = prog.nextId || 1;
      const nid = () => 'e' + (n++);
      const fixNode = node => {
        if (!node.id) node.id = nid();
        if (node.t === 'ser' || node.t === 'par') { node.items = node.items || []; node.items.forEach(fixNode); }
      };
      (prog.sections || []).forEach(sec => {
        if (!sec.id) sec.id = 's' + (n++);
        sec.rungs = sec.rungs || [];
        sec.rungs.forEach(r => {
          if (!r.id) r.id = 'r' + (n++);
          r.cond = r.cond || { t: 'ser', items: [] };
          if (r.cond.t !== 'ser') r.cond = { t: 'ser', items: [r.cond] };
          fixNode(r.cond);
          r.outs = r.outs || [];
          r.outs.forEach(o => { if (!o.id) o.id = nid(); });
        });
      });
      prog.nextId = n;
      return prog;
    },

    /** Visit every element. fn(el, ctx) with ctx = {section, rung, kind:'cond'|'out'|'group'} */
    forEach(prog, fn) {
      const walk = (node, ctx) => {
        fn(node, ctx);
        if (node.items) node.items.forEach(ch => walk(ch, ctx));
      };
      prog.sections.forEach(section => section.rungs.forEach(rung => {
        walk(rung.cond, { section, rung, kind: 'cond' });
        rung.outs.forEach(o => fn(o, { section, rung, kind: 'out' }));
      }));
    },

    /** Tags an element touches: [{name, role:'read'|'write'|'inst', field}] */
    tagsOf(el) {
      const r = [], add = (name, role, field) => { if (name !== undefined && name !== null && name !== '' && !isNumStr(name)) r.push({ name: String(name), role, field }); };
      if (CONTACTS.includes(el.t)) add(el.tag, 'read', 'tag');
      else if (el.t === 'cmp') { add(el.a, 'read', 'a'); add(el.b, 'read', 'b'); }
      else if (WRITERS.includes(el.t)) add(el.tag, 'write', 'tag');
      else if (TIMERS.includes(el.t)) { add(el.tag, 'inst', 'tag'); add(el.presetTag, 'read', 'presetTag'); }
      else if (COUNTERS.includes(el.t)) { add(el.tag, 'inst', 'tag'); add(el.presetTag, 'read', 'presetTag'); add(el.reset, 'read', 'reset'); }
      else if (el.t === 'math') { add(el.a, 'read', 'a'); add(el.b, 'read', 'b'); add(el.dest, 'write', 'dest'); }
      else if (el.t === 'pid') {
        add(el.tag, 'inst', 'tag'); ['pv', 'sp', 'kp', 'ki', 'kd', 'auto', 'man'].forEach(f => add(el[f], 'read', f)); add(el.out, 'write', 'out');
      }
      return r;
    },

    /** Replace tag name everywhere in the program. Returns number of replacements. */
    replaceTag(prog, from, to) {
      let n = 0;
      Program.forEach(prog, el => {
        ['tag', 'a', 'b', 'dest', 'presetTag', 'reset', 'pv', 'sp', 'out', 'kp', 'ki', 'kd', 'auto', 'man'].forEach(f => {
          if (el[f] === from) { el[f] = to; n++; }
        });
      });
      return n;
    },

    /** Find every use of a tag: [{section, rung, rungIndex, el, role, field}] */
    xref(prog, name) {
      const out = [];
      prog.sections.forEach(section => section.rungs.forEach((rung, ri) => {
        const visit = (el, kind) => Program.tagsOf(el).forEach(u => {
          if (u.name === name) out.push({ section, rung, rungIndex: ri, el, role: u.role, field: u.field, kind });
          else if (u.name.split('.')[0] === name) out.push({ section, rung, rungIndex: ri, el, role: u.role, field: u.field, kind, via: u.name });
        });
        const walk = n => { visit(n, 'cond'); (n.items || []).forEach(walk); };
        walk(rung.cond); rung.outs.forEach(o => visit(o, 'out'));
      }));
      return out;
    },

    /** Count elements / rungs */
    stats(prog) {
      let rungs = 0, elems = 0;
      prog.sections.forEach(s => { rungs += s.rungs.length; });
      Program.forEach(prog, el => { if (el.t !== 'ser' && el.t !== 'par') elems++; });
      return { sections: prog.sections.length, rungs, elements: elems };
    }
  };

  /* ------------------------------------------------------------------
     PLC class
     ------------------------------------------------------------------ */
  class PLC {
    constructor(tags) {
      this.tags = tags;
      this.program = { sections: [] };
      this.scanMs = P.SIM ? P.SIM.scanMs : 50;
      this.mode = 'stop';           // 'run' | 'stop'
      this.io = null;               // { readInputs(dt), writeOutputs(dt) }  (process model hook)
      this.scanCount = 0;
      this.lastScanMs = 0;          // measured CPU time of last scan (real ms)
      this.maxScanMs = 0;
      this.resetState();
    }

    resetState() {
      this.st = { timers: {}, counters: {}, pid: {}, edges: {}, math: {} };
      this.flowIn = {}; this.flowOut = {};
      this.dt = this.scanMs;
    }

    /** Load / replace the running program (online edit keeps timer & counter state). */
    load(program, keepState) {
      this.program = Program.normalize(program);
      if (!keepState) this.resetState();
      this._ensureAux();
      this.cache = new Map();
    }

    _ensureAux() {
      Program.forEach(this.program, el => {
        if (TIMERS.includes(el.t)) this.tags.ensureAux(el.tag, 'timer');
        if (COUNTERS.includes(el.t)) this.tags.ensureAux(el.tag, 'counter');
      });
    }

    run() { this.mode = 'run'; P.bus.emit('plcmode', 'run'); }
    stop() {
      this.mode = 'stop';
      // PLC in STOP: every physical output de-energised
      this.tags.list.forEach(t => { if (/^%Q/.test(t.addr) && !t.forced) t.v = t.type === 'BOOL' ? false : 0; });
      P.bus.emit('plcmode', 'stop');
    }

    /* ---------- operand access ---------- */
    r(op) {            // read operand (number | tag name) as number
      if (typeof op === 'number') return op;
      if (op === undefined || op === null || op === '') return 0;
      if (isNumStr(op)) return parseFloat(op);
      const t = this.tags.map.get(op);
      if (!t) return 0;
      return t.v === true ? 1 : t.v === false ? 0 : t.v;
    }
    rb(name) {         // read BOOL
      const t = this.tags.map.get(name); return t ? !!t.v : false;
    }
    w(name, val) {     // write tag (ignored when forced)
      const t = this.tags.map.get(name); if (!t || t.forced) return;
      t.v = P.coerce(t.type, val);
    }
    wAux(inst, suffix, val) { const t = this.tags.map.get(inst + '.' + suffix); if (t && !t.forced) t.v = P.coerce(t.type, val); }

    /* ---------- scan cycle ---------- */
    /** Execute one complete scan. dt = simulated milliseconds since last scan. */
    scan(dt) {
      if (this.mode !== 'run') return;
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this.dt = dt || this.scanMs;
      if (this.io && this.io.readInputs) this.io.readInputs(this.dt);           // 1. inputs
      this.forceAll();
      this.flowIn = {}; this.flowOut = {};
      for (const sec of this.program.sections) {                                  // 2. logic
        if (sec.enabled === false) continue;
        for (const rung of sec.rungs) this.execRung(rung);
      }
      this.forceAll();                                                            // 3. outputs
      if (this.io && this.io.writeOutputs) this.io.writeOutputs(this.dt);
      this.scanCount++;
      this.lastScanMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      if (this.lastScanMs > this.maxScanMs) this.maxScanMs = this.lastScanMs;
    }

    forceAll() { const l = this.tags.list; for (let i = 0; i < l.length; i++) { const t = l[i]; if (t.forced) t.v = t.fv; } }

    execRung(rung) {
      const p = this.evalNode(rung.cond, true);
      this.flowOut[rung.id] = p;
      for (const o of rung.outs) this.execOut(o, p);
    }

    /* ---------- condition evaluation (no short-circuit: edges and flow must update) ---------- */
    evalNode(n, pin) {
      this.flowIn[n.id] = pin;
      let out;
      switch (n.t) {
        case 'ser': { out = pin; for (const ch of n.items) out = this.evalNode(ch, out); break; }
        case 'par': { out = false; for (const ch of n.items) { const o = this.evalNode(ch, pin); out = out || o; } if (!n.items.length) out = pin; break; }
        case 'no': out = pin && this.rb(n.tag); break;
        case 'nc': out = pin && !this.rb(n.tag); break;
        case 'pos': case 'neg': {
          const cur = this.rb(n.tag), prev = this.st.edges[n.id];
          this.st.edges[n.id] = cur;
          const hit = prev === undefined ? false : (n.t === 'pos' ? (cur && !prev) : (!cur && prev));
          out = pin && hit; break;
        }
        case 'cmp': out = pin && this.compare(n.op, this.r(n.a), this.r(n.b)); break;
        default: out = pin;
      }
      this.flowOut[n.id] = out;
      return out;
    }

    compare(op, a, b) {
      switch (op) {
        case '==': return a === b; case '!=': return a !== b;
        case '>': return a > b; case '>=': return a >= b;
        case '<': return a < b; case '<=': return a <= b;
        default: return false;
      }
    }

    /* ---------- output / function-block execution ---------- */
    execOut(o, p) {
      this.flowIn[o.id] = p; this.flowOut[o.id] = p;
      switch (o.t) {
        case 'coil': this.w(o.tag, p); break;
        case 'ncoil': this.w(o.tag, !p); break;
        case 'set': if (p) this.w(o.tag, true); break;
        case 'reset': if (p) this.w(o.tag, false); break;
        case 'ton': case 'tof': case 'tp': this.execTimer(o, p); break;
        case 'ctu': case 'ctd': this.execCounter(o, p); break;
        case 'math': if (p) this.execMath(o); break;
        case 'pid': this.execPID(o, p); break;
      }
    }

    presetOf(o) { return o.presetTag ? this.r(o.presetTag) : (typeof o.preset === 'number' ? o.preset : parseFloat(o.preset) || 0); }

    execTimer(o, inp) {
      const st = this.st.timers[o.tag] || (this.st.timers[o.tag] = { acc: 0, q: false, prev: false });
      const pre = this.presetOf(o), dt = this.dt;
      if (o.t === 'ton') {
        if (inp) { st.acc = Math.min(st.acc + dt, 2147483647); st.q = st.acc >= pre; } else { st.acc = 0; st.q = false; }
      } else if (o.t === 'tof') {
        if (inp) { st.q = true; st.acc = 0; }
        else if (st.q) { st.acc += dt; if (st.acc >= pre) { st.q = false; st.acc = pre; } }
      } else { // tp - one-shot pulse of fixed length on rising edge
        if (inp && !st.prev && !st.q) { st.q = true; st.acc = 0; }
        if (st.q) { st.acc += dt; if (st.acc >= pre) { st.q = false; st.acc = pre; } }
        if (!inp && !st.q) st.acc = 0;
      }
      st.prev = inp;
      this.wAux(o.tag, 'Q', st.q); this.wAux(o.tag, 'ACC', Math.round(st.acc)); this.wAux(o.tag, 'PRE', Math.round(pre));
    }

    execCounter(o, inp) {
      const st = this.st.counters[o.tag] || (this.st.counters[o.tag] = { cv: 0, prev: false, q: false });
      const pre = this.presetOf(o);
      const rst = o.reset ? this.r(o.reset) !== 0 : false;
      if (o.t === 'ctu') {
        if (rst) st.cv = 0;
        else if (inp && !st.prev) st.cv = Math.min(st.cv + 1, 32767);
        st.q = st.cv >= pre;
      } else { // ctd : 'reset' acts as LOAD
        if (rst) st.cv = pre;
        else if (inp && !st.prev) st.cv = Math.max(st.cv - 1, -32768);
        st.q = st.cv <= 0;
      }
      st.prev = inp;
      this.wAux(o.tag, 'CV', st.cv); this.wAux(o.tag, 'Q', st.q);
    }

    execMath(o) {
      const a = this.r(o.a), b = this.r(o.b); let v = 0;
      switch (o.op) {
        case '+': v = a + b; break; case '-': v = a - b; break; case '*': v = a * b; break;
        case '/': v = b !== 0 ? a / b : 0; break;
        case 'mod': v = b !== 0 ? a % b : 0; break;
        case 'min': v = Math.min(a, b); break; case 'max': v = Math.max(a, b); break;
        case 'abs': v = Math.abs(a); break; case 'sqrt': v = a >= 0 ? Math.sqrt(a) : 0; break;
        case 'mov': default: v = a;
      }
      this.w(o.dest, v);
    }

    /** PID: positional form, derivative on measurement, anti-windup, bumpless manual. */
    execPID(o, p) {
      const st = this.st.pid[o.tag] || (this.st.pid[o.tag] = { i: 0, prevPv: null, d: 0 });
      const min = o.min !== undefined ? o.min : 0, max = o.max !== undefined ? o.max : 100;
      if (!p) { st.i = 0; st.prevPv = null; this.w(o.out, 0); return; }
      const dt = Math.max(this.dt / 1000, 1e-3);
      const pv = this.r(o.pv), sp = this.r(o.sp), kp = this.r(o.kp), ki = this.r(o.ki), kd = this.r(o.kd);
      const e = sp - pv, auto = o.auto ? this.r(o.auto) !== 0 : true;
      if (!auto) {                                         // manual: track output so the switch is bumpless
        const m = Math.min(max, Math.max(min, this.r(o.man)));
        st.i = Math.min(max, Math.max(min, m - kp * e)); st.prevPv = pv; this.w(o.out, m); return;
      }
      let d = 0;
      if (st.prevPv !== null && kd) { const raw = -kd * (pv - st.prevPv) / dt; st.d += (dt / (1 + dt)) * (raw - st.d); d = st.d; /* first-order filter, Tf = 1 s */ }
      st.prevPv = pv;
      const pTerm = kp * e;
      let u = pTerm + st.i + d;
      const uSat = Math.min(max, Math.max(min, u));
      // conditional integration (anti-windup): only integrate when not saturating further
      if (!((u > max && e > 0) || (u < min && e < 0))) st.i += ki * e * dt;
      st.i = Math.min(max, Math.max(min, st.i));
      u = pTerm + st.i + d;
      this.w(o.out, Math.min(max, Math.max(min, u)));
      void uSat;
    }

    /* ---------- compile / validate (used by the editor "Apply" button) ---------- */
    /** Returns {errors:[{msg,section,rung,id}], warnings:[...]} for a program against the tag DB. */
    compile(prog) { return compile(prog, this.tags); }
  }

  /* ------------------------------------------------------------------
     Compile checks: undefined tags, duplicate coils, type mismatch,
     writes to inputs, duplicate timer/counter instances, bad presets
     ------------------------------------------------------------------ */
  function compile(prog, tags) {
    const errors = [], warnings = [];
    const err = (msg, ctx, el) => errors.push({ msg, section: ctx.section.name, rung: ctx.section.rungs.indexOf(ctx.rung) + 1, id: el && el.id });
    const warn = (msg, ctx, el) => warnings.push({ msg, section: ctx.section.name, rung: ctx.section.rungs.indexOf(ctx.rung) + 1, id: el && el.id });
    const writers = {}, insts = {}, mathDest = {};
    const instNames = new Set();
    Program.forEach(prog, el => { if (TIMERS.includes(el.t) || COUNTERS.includes(el.t)) instNames.add(el.tag); });

    Program.forEach(prog, (el, ctx) => {
      if (el.t === 'ser' || el.t === 'par') return;
      // empty fields
      const need = CONTACTS.includes(el.t) || WRITERS.includes(el.t) || TIMERS.includes(el.t) || COUNTERS.includes(el.t) || el.t === 'pid';
      if (need && !el.tag) { err(`${el.t.toUpperCase()} has no tag assigned`, ctx, el); return; }
      if (el.t === 'cmp' && (el.a === '' || el.a === undefined || el.b === '' || el.b === undefined)) err('Comparator operand missing', ctx, el);
      if (el.t === 'math' && !el.dest) err('Math block has no destination tag', ctx, el);

      Program.tagsOf(el).forEach(u => {
        const base = u.name.split('.')[0];
        if (u.role === 'inst') return;
        const t = tags.map.get(u.name);
        if (!t) {
          if (u.name.includes('.') && instNames.has(base)) return;           // T1.Q style reference to an instance
          err(`Undefined tag "${u.name}"`, ctx, el); return;
        }
        // type checks
        if ((CONTACTS.includes(el.t) || WRITERS.includes(el.t)) && t.type !== 'BOOL') err(`Type mismatch: ${el.t.toUpperCase()} needs a BOOL tag but "${u.name}" is ${t.type}`, ctx, el);
        if (el.t === 'cmp' && t.type === 'BOOL') warn(`Comparator uses BOOL tag "${u.name}"`, ctx, el);
        if (el.t === 'math' && u.role === 'write' && t.type === 'BOOL') err(`Type mismatch: math destination "${u.name}" is BOOL`, ctx, el);
        if (el.t === 'pid' && u.role === 'read' && ['kp', 'ki', 'kd', 'pv', 'sp'].includes(u.field) && t.type === 'BOOL') err(`Type mismatch: PID ${u.field} "${u.name}" is BOOL`, ctx, el);
        if (el.t === 'pid' && u.role === 'write' && t.type !== 'REAL') warn(`PID output "${u.name}" should be REAL`, ctx, el);
        if (u.role === 'write') {
          if (t.addr && /^%I/.test(t.addr)) err(`Logic writes to input tag "${u.name}" (${t.addr})`, ctx, el);
          if (t.forced) warn(`Tag "${u.name}" is currently forced`, ctx, el);
        }
      });

      // duplicate coils / destinations
      if (el.t === 'coil' || el.t === 'ncoil') { if (el.tag) (writers[el.tag] = writers[el.tag] || []).push({ el, ctx }); }
      // several MOV/math blocks may legitimately write one tag (state-machine pattern) -> warning only
      if (el.t === 'math' && el.dest) (mathDest[el.dest] = mathDest[el.dest] || []).push({ el, ctx });
      if (el.t === 'pid' && el.out) (writers[el.out] = writers[el.out] || []).push({ el, ctx });
      // duplicate instances
      if (TIMERS.includes(el.t) || COUNTERS.includes(el.t)) (insts[el.tag] = insts[el.tag] || []).push({ el, ctx });
      if ((TIMERS.includes(el.t) || COUNTERS.includes(el.t)) && !el.presetTag && !(parseFloat(el.preset) >= 0)) err('Preset must be a number >= 0', ctx, el);
    });

    Object.keys(writers).forEach(k => {
      if (writers[k].length > 1) writers[k].slice(1).forEach(w => err(`Duplicate coil/destination for "${k}" (also driven in ${writers[k][0].ctx.section.name} rung ${writers[k][0].ctx.section.rungs.indexOf(writers[k][0].ctx.rung) + 1})`, w.ctx, w.el));
    });
    Object.keys(mathDest).forEach(k => {
      if (mathDest[k].length > 1 && !(mathDest[k].every(w => w.el.op === 'mov')) ) mathDest[k].slice(1).forEach(w => warn(`"${k}" is written by ${mathDest[k].length} math blocks (last executed wins)`, w.ctx, w.el));
      if (writers[k]) mathDest[k].forEach(w => err(`"${k}" is driven by both a coil and a math block`, w.ctx, w.el));
    });
    Object.keys(insts).forEach(k => {
      if (insts[k].length > 1) insts[k].slice(1).forEach(w => err(`Duplicate timer/counter instance "${k}"`, w.ctx, w.el));
    });
    return { errors, warnings };
  }

  /* ------------------------------------------------------------------
     Structured Text generator (read-only view of the same logic)
     ------------------------------------------------------------------ */
  function condToST(n) {
    switch (n.t) {
      case 'ser': return n.items.length ? n.items.map(c => { const s = condToST(c); return c.t === 'par' ? s : s; }).join(' AND ') : 'TRUE';
      case 'par': return '(' + n.items.map(condToST).join(' OR ') + ')';
      case 'no': return n.tag || '?';
      case 'nc': return 'NOT ' + (n.tag || '?');
      case 'pos': return 'R_TRIG(' + (n.tag || '?') + ')';
      case 'neg': return 'F_TRIG(' + (n.tag || '?') + ')';
      case 'cmp': return '(' + (n.a === '' ? '?' : n.a) + ' ' + (n.op === '==' ? '=' : n.op === '!=' ? '<>' : n.op) + ' ' + (n.b === '' ? '?' : n.b) + ')';
      default: return '?';
    }
  }
  function outToST(o, cond) {
    const pre = o.presetTag || (o.preset !== undefined ? o.preset : 0);
    switch (o.t) {
      case 'coil': return `${o.tag} := ${cond};`;
      case 'ncoil': return `${o.tag} := NOT (${cond});`;
      case 'set': return `IF ${cond} THEN ${o.tag} := TRUE; END_IF;`;
      case 'reset': return `IF ${cond} THEN ${o.tag} := FALSE; END_IF;`;
      case 'ton': case 'tof': case 'tp': return `${o.tag}(IN := ${cond}, PT := ${o.presetTag ? 'DINT_TO_TIME(' + o.presetTag + ')' : 'T#' + pre + 'ms'}); (* ${o.t.toUpperCase()} *)`;
      case 'ctu': return `${o.tag}(CU := ${cond}, R := ${o.reset || 'FALSE'}, PV := ${pre});`;
      case 'ctd': return `${o.tag}(CD := ${cond}, LD := ${o.reset || 'FALSE'}, PV := ${pre});`;
      case 'math': {
        const bin = { '+': '+', '-': '-', '*': '*', '/': '/', mod: 'MOD' };
        let ex;
        if (bin[o.op]) ex = `${o.a} ${bin[o.op]} ${o.b}`;
        else if (o.op === 'min' || o.op === 'max') ex = `${o.op.toUpperCase()}(${o.a}, ${o.b})`;
        else if (o.op === 'abs' || o.op === 'sqrt') ex = `${o.op.toUpperCase()}(${o.a})`;
        else ex = `${o.a}`;
        return `IF ${cond} THEN ${o.dest} := ${ex}; END_IF;`;
      }
      case 'pid': return `${o.tag}(EN := ${cond}, PV := ${o.pv}, SP := ${o.sp}, KP := ${o.kp}, KI := ${o.ki}, KD := ${o.kd}, AUTO := ${o.auto || 'TRUE'}, MAN := ${o.man || '0.0'}, OUT => ${o.out});`;
      default: return '(* ' + o.t + ' *)';
    }
  }
  function toST(prog, sectionId) {
    const lines = [];
    prog.sections.forEach(sec => {
      if (sectionId && sec.id !== sectionId) return;
      lines.push(`(* ===== ${sec.name.toUpperCase()}${sec.desc ? ' - ' + sec.desc : ''} ===== *)`);
      sec.rungs.forEach((r, i) => {
        if (r.comment) lines.push(`(* Rung ${i + 1}: ${r.comment} *)`);
        const cond = condToST(r.cond);
        r.outs.forEach(o => lines.push(outToST(o, cond)));
        lines.push('');
      });
    });
    return lines.join('\n');
  }

  P.PLC = PLC; P.Program = Program; P.compileProgram = compile; P.toST = toST; P.condToST = condToST;
  P.PLC_CONST = { CONTACTS, TIMERS, COUNTERS, WRITERS };
})(typeof window !== 'undefined' ? window : globalThis);
