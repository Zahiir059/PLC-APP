/* ==========================================================================
   production.js  -  MES-style layer on top of the PLC
   --------------------------------------------------------------------------
   Recipes (CRUD), production orders, batch tracking + genealogy (carton and
   pallet barcodes), shift KPIs / OEE, downtime with reason codes, quality
   (reject reasons, SPC), bottleneck analysis, energy + cost, equipment health
   and the maintenance schedule.
   Recipe values are written into PLC tags (REC_*), the PLC does the control.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};
  const pad = (n, w) => String(n).padStart(w, '0');

  const DEFAULT_RECIPES = [
    { id: 1, name: 'Cola', syrup: 18, temp: 85, fill: 330, cansCtn: 6, ctnPlt: 4, batchKg: 40, holdS: 10 },
    { id: 2, name: 'Orange', syrup: 22, temp: 80, fill: 330, cansCtn: 6, ctnPlt: 4, batchKg: 40, holdS: 10 },
    { id: 3, name: 'Energy Drink', syrup: 15, temp: 88, fill: 250, cansCtn: 4, ctnPlt: 6, batchKg: 30, holdS: 12 }
  ];
  const DOWN_REASONS = ['Jam', 'No material', 'Changeover', 'Maintenance', 'Trip / E-stop', 'Unassigned'];
  const REJ_LABEL = { underfill: 'Underfill', nocap: 'No cap', nolabel: 'Label missing', hitemp: 'High temperature' };

  class Production {
    constructor(sim) {
      this.sim = sim; this.tags = sim.tags; this.plant = sim.plant;
      this.recipes = (P.Store && P.Store.get('recipes', null)) || JSON.parse(JSON.stringify(DEFAULT_RECIPES));
      this.batches = []; this.cartons = []; this.pallets = [];
      this.curBatch = null; this.prevStep = 0; this.prevCans = 0;
      this.tariff = (P.Store && P.Store.get('tariff', null)) || P.SIM.tariffPKR;
      this.order = { target: 60, product: '', startClock: 0, id: 1 };
      this.newShift(true);
      this.rejSeries = []; this.rateSeries = []; this.lastRate = { n: 0, t: 0 };
      this.maint = (P.Store && P.Store.get('maint', null)) || null;
      this.demand = []; this.peakKW = 0;
      this.canCount = 0; this.prevDelivered = 0;
      // plant events -> genealogy
      this.plant.onEvent = e => this.onPlantEvent(e);
      sim.every(100, () => this.fast());
      sim.every(1000, ms => this.slow(ms));
      this.applyRecipe(this.recipes[0], true);
    }

    /* ------------------------------ recipes ------------------------------ */
    recipeById(id) { return this.recipes.find(r => r.id === id); }
    saveRecipes() { P.Store && P.Store.set('recipes', this.recipes); }
    nextRecipeId() { return this.recipes.reduce((a, r) => Math.max(a, r.id), 0) + 1; }
    locked() { const s = this.tags.get('SEQ_STEP'); return s >= 20 && s <= 80; }
    /** Load a recipe into the PLC tags. Refused while a batch is in progress (steps 20-80). */
    applyRecipe(r, force) {
      if (!force && this.locked()) return false;
      const T = this.tags, w = (n, v) => { const t = T.tag(n); if (t) t.v = P.coerce(t.type, v); };
      w('REC_ID', r.id); w('REC_BATCH_KG', r.batchKg); w('REC_SYRUP_PCT', r.syrup); w('REC_TEMP_SP', r.temp);
      w('REC_FILL_ML', r.fill); w('REC_CANS_CTN', r.cansCtn); w('REC_CTN_PLT', r.ctnPlt); w('REC_HOLD_S', r.holdS);
      if (T.get('SEQ_STEP') === 0) w('TT_SP', r.temp);
      this.order.product = r.name;
      return true;
    }
    currentRecipe() { return this.recipeById(this.tags.get('REC_ID')) || this.recipes[0]; }

    /* ------------------------------ production order ------------------------------ */
    newOrder(target, user) {
      const T = this.tags; T.set('ORDER_TARGET', target); T.set('M_NEW_ORDER', true, 'hmi');
      this.order = { target, product: this.currentRecipe().name, startClock: this.sim.clock(), id: this.order.id + 1 };
      this.orderBase = { rejects: this.plant.totalRejects() };
      P.bus.emit('audit', { action: 'NEW_ORDER', detail: `${this.order.product} x ${target} cans` });
    }
    orderProgress() { const n = this.tags.get('CAN_PACKED.CV'), t = this.tags.get('ORDER_TARGET'); return { done: n, target: t, pct: t ? Math.min(100, 100 * n / t) : 0 }; }

    /* ------------------------------ plant events (genealogy) ------------------------------ */
    onPlantEvent(e) {
      if (e.type === 'barcode') {
        const b = this.curBatch || this.batches[this.batches.length - 1];
        const n = this.cartons.length + 1;
        const c = { code: `CTN-${b ? b.id.slice(2) : '0000'}-${pad(n, 4)}`, batch: b ? b.id : '-', t: this.sim.clock(), pallet: null, cans: this.tags.get('REC_CANS_CTN') };
        this.cartons.push(c); if (b) b.cartons.push(c.code);
      } else if (e.type === 'pallet') {
        const per = this.tags.get('REC_CTN_PLT'), un = this.cartons.filter(c => !c.pallet).slice(0, per);
        const d = new Date(this.sim.clock()), id = `PLT-${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}-${pad(this.pallets.length + 1, 3)}`;
        un.forEach(c => { c.pallet = id; });
        const b = this.curBatch || this.batches[this.batches.length - 1];
        this.pallets.push({ id, t: this.sim.clock(), cartons: un.map(c => c.code), batches: [...new Set(un.map(c => c.batch))] });
        if (b) b.pallets.push(id);
      } else if (e.type === 'reject') { if (this.curBatch) this.curBatch.rejects++; }
    }

    /* ------------------------------ 100 ms bookkeeping ------------------------------ */
    fast() {
      const T = this.tags, step = T.get('SEQ_STEP'), clock = this.sim.clock();
      // batch start: entering step 20
      if (step === 20 && this.prevStep !== 20) {
        const no = T.get('BATCH_CNT.CV'), r = this.currentRecipe();
        this.curBatch = { id: 'B-' + pad(no, 4), no, product: r.name, recipe: Object.assign({}, r), start: clock, end: null, qty: 0, rejects: 0, cartons: [], pallets: [], tmax: 0, tsum: 0, tn: 0, kwh0: this.totalKWh(), kwh: 0, syrup0: this.plant.totals.syrupKg, water0: this.plant.totals.waterKg, syrupKg: 0, waterKg: 0, lotSyrup: 'SY-' + pad(Math.floor(this.sim.simMs / 1e5) % 900 + 100, 3), orderId: this.order.id };
        this.batches.push(this.curBatch);
        P.bus.emit('audit', { action: 'BATCH_START', detail: this.curBatch.id + ' ' + r.name });
      }
      if (this.curBatch) {
        const b = this.curBatch, cans = T.get('CAN_PACKED.CV');
        if (cans > this.prevCans) b.qty += cans - this.prevCans;
        if (step >= 70 && step <= 80) { const tt = T.get('AI_TT201'); b.tmax = Math.max(b.tmax, tt); b.tsum += tt; b.tn++; }
        b.syrupKg = this.plant.totals.syrupKg - b.syrup0; b.waterKg = this.plant.totals.waterKg - b.water0; b.kwh = this.totalKWh() - b.kwh0;
        if (step === 90 && this.prevStep !== 90) { b.end = clock; b.avgT = b.tn ? b.tsum / b.tn : 0; P.bus.emit('audit', { action: 'BATCH_END', detail: `${b.id} qty ${b.qty}` }); this.curBatch = null; }
      }
      this.prevCans = T.get('CAN_PACKED.CV');
      this.prevStep = step;
      this.tags.set('REJ_RATE', this.plant.rejectRate(), 'process');
      this.kpiTick(100);
    }

    totalKWh() { const e = this.plant.energy; return Object.keys(e).reduce((a, k) => a + e[k], 0); }

    /* ------------------------------ shift / OEE / downtime ------------------------------ */
    newShift(initial) {
      if (!initial && this.shift && this.shift.started) { this.shifts = this.shifts || []; this.shifts.push(Object.assign({}, this.shift, { endClock: this.sim.clock() })); }
      this.shift = { start: this.sim ? this.sim.clock() : Date.now(), started: false, plannedMs: 0, runMs: 0, prodMs: 0, goodBase: this.plant.stats.delivered, rejBase: this.plant.totalRejects(), filledBase: this.plant.stats.filled, kwhBase: this.totalKWh(), syrupBase: this.plant.totals.syrupKg, waterBase: this.plant.totals.waterKg, alarmBase: 0, cartonBase: this.cartons.length };
      if (!initial) this.downtime = [];
      this.downtime = this.downtime || []; this.openDown = null;
    }
    running() {
      const T = this.tags;
      return T.get('PLANT_RUN') && T.get('SAFE_OK') && !T.get('LINE_FAULT') && !T.get('DOSE_FAULT');
    }
    kpiTick(ms) {
      const T = this.tags, s = this.shift;
      if (!s.started) { if (T.get('PLANT_RUN')) { s.started = true; s.start = this.sim.clock(); } else return; }
      s.plannedMs += ms;
      const run = this.running();
      if (run) s.runMs += ms;
      if (run && T.get('PROD_EN')) s.prodMs += ms;
      // downtime episodes
      if (!run) {
        if (!this.openDown) this.openDown = { start: this.sim.clock(), ms: 0, reason: this.autoReason(), auto: true, open: true };
        this.openDown.ms += ms;
        if (this.openDown.ms >= 3000 && !this.openDown.logged) { this.openDown.logged = true; this.downtime.push(this.openDown); }
        if (this.openDown.auto && this.autoReason() !== 'Unassigned') this.openDown.reason = this.autoReason();
      } else if (this.openDown) { this.openDown.open = false; this.openDown.end = this.sim.clock(); this.openDown = null; }
    }
    autoReason() {
      const T = this.tags;
      if (T.get('I_JAM') || T.get('I_OL_CONV')) return 'Jam';
      if (T.get('LSLL_101') || T.get('LSLL_102') || T.get('DOSE_FAULT')) return 'No material';
      if (T.get('TRIP')) return 'Trip / E-stop';
      return 'Unassigned';
    }
    setDownReason(ev, reason) { ev.reason = reason; ev.auto = false; P.bus.emit('audit', { action: 'DOWNTIME_REASON', detail: reason }); }
    downtimePareto() {
      const m = {}; DOWN_REASONS.forEach(r => { m[r] = 0; });
      this.downtime.forEach(d => { m[d.reason] = (m[d.reason] || 0) + d.ms / 60000; });
      return Object.keys(m).map(k => ({ reason: k, min: m[k] })).filter(x => x.min > 0).sort((a, b) => b.min - a.min);
    }
    downMs() { return this.downtime.reduce((a, d) => a + d.ms, 0); }

    oee() {
      const s = this.shift, p = this.plant.stats, idealPerMin = P.SIM.idealCansPerMin;
      const produced = p.filled - s.filledBase, rej = this.plant.totalRejects() - s.rejBase, good = p.delivered - s.goodBase;
      const avail = s.plannedMs ? Math.min(1, s.runMs / s.plannedMs) : 0;
      const perf = s.prodMs ? Math.min(1, produced / (s.prodMs / 60000 * idealPerMin)) : 0;
      const qual = (good + rej) ? good / (good + rej) : 1;
      return { avail, perf, qual, oee: avail * perf * qual, produced, good, rej, plannedMin: s.plannedMs / 60000, runMin: s.runMs / 60000, downMin: this.downMs() / 60000, prodMin: s.prodMs / 60000, cansPerMin: s.prodMs ? good / (s.prodMs / 60000) : 0 };
    }

    /* ------------------------------ 1 s bookkeeping: trends, rate, demand, maintenance ------------------------------ */
    slow(ms) {
      const clock = this.sim.clock(), p = this.plant.stats;
      // production rate (cans/min over last 60 s)
      const o = this.lastRate;
      if (ms - o.t >= 60000 || !o.t) { this.lastRate = { n: p.delivered, t: ms, rate: o.t ? (p.delivered - o.n) / ((ms - o.t) / 60000) : 0 }; }
      const shortRate = this.rateSeries.length ? this.rateSeries : null; void shortRate;
      this.cur = this.cur || { n: p.delivered, t: ms, rate: 0 };
      if (ms - this.cur.t >= 30000) { this.cur = { n: p.delivered, t: ms, rate: (p.delivered - this.cur.n) / ((ms - this.cur.t) / 60000) }; }
      if (P.Hist) P.Hist.sample(clock, this.tags, this.cur.rate || 0);
      if (ms % 30000 < 1000) this.rejSeries.push({ t: clock, rate: this.plant.rejectRate(), total: this.plant.totalRejects() });
      if (this.rejSeries.length > 400) this.rejSeries.shift();
      // 15-minute demand window
      this.demand.push({ t: ms, kw: this.plant.powerKW }); while (this.demand.length && this.demand[0].t < ms - 900000) this.demand.shift();
      const avg = this.demand.reduce((a, d) => a + d.kw, 0) / this.demand.length; if (avg > this.peakKW) this.peakKW = avg;
      this.maintTick();
    }
    rate() { return (this.cur && this.cur.rate) || 0; }

    /* ------------------------------ quality ------------------------------ */
    spc() {
      const x = this.plant.stats.fillSamples, n = x.length, target = this.currentRecipe().fill;
      if (n < 3) return { x, mean: target, ucl: target * 1.03, lcl: target * 0.97, target, sd: 0, cpk: 0, usl: target * 1.03, lsl: target * 0.97 };
      const mean = x.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1));
      const usl = target * 1.03, lsl = target * 0.97;
      return { x, mean, sd, target, ucl: mean + 3 * sd, lcl: mean - 3 * sd, usl, lsl, cpk: sd ? Math.min((usl - mean) / (3 * sd), (mean - lsl) / (3 * sd)) : 0 };
    }

    /* ------------------------------ bottleneck / cycle times ------------------------------ */
    cycleTimes() {
      const s = this.plant.stats, f = (busy, n) => n > 2 ? busy / n / 1000 : 0;
      const rows = [
        { id: 'Filler', ct: f(s.busy.FILL, s.cnt.FILL) }, { id: 'Capper', ct: f(s.busy.CAP, s.cnt.CAP) },
        { id: 'Labeler', ct: f(s.busy.LABEL, s.cnt.LABEL) }, { id: 'Conveyor index', ct: f(s.busy.CONV, s.cnt.FILL) },
        { id: 'Inspection', ct: s.cnt.INSP > 2 ? 0.4 : 0 }
      ];
      const cycle = rows.filter(r => r.id === 'Filler' || r.id === 'Conveyor index').reduce((a, r) => a + r.ct, 0);
      const takt = 60 / P.SIM.idealCansPerMin;
      return { rows, cycle, takt, bottleneck: rows.reduce((a, b) => b.ct > a.ct ? b : a, rows[0]).id };
    }

    /* ------------------------------ energy ------------------------------ */
    energyByMachine() {
      const e = this.plant.energy, rows = P.EQUIP.map(q => ({ id: q.id, name: q.name, kwh: e[q.id], kw: this.plant.eq[q.id].kw }));
      rows.push({ id: 'UTIL', name: 'Utilities (air, lighting, controls)', kwh: e.UTIL, kw: P.UTIL_KW });
      return rows;
    }
    pf() { const k = this.plant.powerKW, q = this.plant.kvar; return k > 0 ? k / Math.sqrt(k * k + q * q) : 1; }
    setTariff(v) { this.tariff = v; P.Store && P.Store.set('tariff', v); P.bus.emit('audit', { action: 'TARIFF_CHANGE', detail: v + ' PKR/kWh' }); }

    /* ------------------------------ equipment health + maintenance ------------------------------ */
    initMaint() {
      const now = this.sim.clock(), day = 86400000;
      this.maint = [
        { id: 1, equip: 'P101', task: 'Lubricate bearings / check seal', everyDays: 30, due: now + 2 * day, last: null },
        { id: 2, equip: 'P103', task: 'Inspect impeller and coupling', everyDays: 90, due: now + 20 * day, last: null },
        { id: 3, equip: 'AGIT', task: 'Gearbox oil change', everyDays: 180, due: now + 45 * day, last: null },
        { id: 4, equip: 'HEATER', task: 'Descale heat exchanger', everyDays: 60, due: now - 1 * day, last: null },
        { id: 5, equip: 'CONV', task: 'Belt tension and chain lubrication', everyDays: 30, due: now + 5 * day, last: null },
        { id: 6, equip: 'FILL', task: 'Calibrate fill valves, replace seals', everyDays: 90, due: now + 12 * day, last: null },
        { id: 7, equip: 'CAP', task: 'Check capping torque', everyDays: 45, due: now + 8 * day, last: null },
        { id: 8, equip: 'PALLETIZER', task: 'Gripper and axis lubrication', everyDays: 60, due: now + 30 * day, last: null }
      ];
    }
    maintDone(id) {
      const m = this.maint.find(x => x.id === id); if (!m) return;
      m.last = this.sim.clock(); m.due = m.last + m.everyDays * 86400000; m.flagged = false;
      const e = this.plant.eq[m.equip]; if (e && (m.task.match(/bearing|lubric/i))) e.wear = 0;
      P.bus.emit('audit', { action: 'MAINT_DONE', detail: m.equip + ': ' + m.task }); P.Store && P.Store.set('maint', this.maint);
    }
    maintTick() {
      if (!this.maint) this.initMaint();
    }
    /** Health rows with predictive warnings (ISO 10816-like vibration limits, current, starts). */
    health() {
      return P.EQUIP.map(q => {
        const s = this.plant.eq[q.id], rated = q.kw * 1000 / (1.732 * 400 * q.pf);
        const w = [];
        if (q.type !== 'heater') {
          if (s.vib >= 7.1) w.push({ lvl: 'critical', msg: 'Vibration above 7.1 mm/s - stop and inspect bearings' });
          else if (s.vib >= 4.5) w.push({ lvl: 'warn', msg: 'Vibration above 4.5 mm/s - schedule bearing inspection' });
        }
        if (q.id !== 'HEATER' && s.on && s.amps > rated * 1.15 && q.id !== 'CONV') w.push({ lvl: 'warn', msg: 'Motor current 15 % above rated' });
        if (q.id === 'CONV' && s.amps > 12) w.push({ lvl: 'critical', msg: 'Conveyor current high - possible jam' });
        if (s.starts > 1.1 * 1000 * (q.type === 'pump' ? 1 : 100)) w.push({ lvl: 'warn', msg: 'High number of starts' });
        const m = (this.maint || []).find(x => x.equip === q.id);
        if (m && m.due < this.sim.clock()) w.push({ lvl: 'warn', msg: 'Maintenance overdue: ' + m.task });
        return { eq: q, rt: s.rt / 3600, starts: s.starts, amps: s.amps, rated, vib: s.vib, on: s.on, warnings: w, status: w.some(x => x.lvl === 'critical') ? 'critical' : w.length ? 'warn' : 'ok' };
      });
    }
    degrade(id) { const e = this.plant.eq[id]; if (e) { e.wear += 3.2; P.bus.emit('audit', { action: 'SIMULATE_WEAR', detail: id }); } }
  }

  P.Production = Production; P.DOWN_REASONS = DOWN_REASONS; P.REJ_LABEL = REJ_LABEL; P.DEFAULT_RECIPES = DEFAULT_RECIPES;
})(typeof window !== 'undefined' ? window : globalThis);
