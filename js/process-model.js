/* ==========================================================================
   process-model.js  -  the "field": physics of the beverage plant
   --------------------------------------------------------------------------
   The PLC never touches this object directly.  The only coupling is through
   the tag database:
       readInputs(dt)   - called at the START of every scan: sensors -> input tags
       writeOutputs(dt) - called at the END of every scan: output tags -> actuators,
                          then the physics are integrated by dt (simulated ms)

   Models: tank levels, dosing by weight, pasteurizer heating (first-order
   thermal model with losses), steam pressure, filler bowl, conveyor with VFD
   ramp, individual cans (position, volume, cap, label, temperature), reject
   pushers, carton / pallet flow, gas concentration, power and energy, and
   injectable faults.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};

  /* ---- geometry of the conveyor (metres) ---- */
  const DIM = { PITCH: 0.3, FILL_X: 0.9, CAP_X: 1.5, INSP_X: 2.1, LBL_X: 3.0, LCHK_X: 3.6, END_X: 4.2, WIN: 0.08, VMAX: 0.6 };
  /* ---- tank sizes (kg) ---- */
  const CAP = { syrup: 100, water: 300, mix: 100, past: 100, bowl: 12 };

  /** Equipment register: id, driving output tag, name, rated kW, power factor */
  const EQUIP = [
    { id: 'P101', tag: 'Q_P101', name: 'Syrup pump P-101', kw: 1.5, pf: 0.84, type: 'pump', area: 'Mixing' },
    { id: 'P102', tag: 'Q_P102', name: 'Water pump P-102', kw: 2.2, pf: 0.85, type: 'pump', area: 'Mixing' },
    { id: 'P103', tag: 'Q_P103', name: 'Transfer pump P-103', kw: 3.0, pf: 0.86, type: 'pump', area: 'Mixing' },
    { id: 'P104', tag: 'Q_P104', name: 'Filler feed pump P-104', kw: 1.1, pf: 0.83, type: 'pump', area: 'Filling' },
    { id: 'AGIT', tag: 'Q_AGIT', name: 'Agitator M-103', kw: 4.0, pf: 0.87, type: 'motor', area: 'Mixing' },
    { id: 'HEATER', tag: 'Q_HEATER', name: 'Pasteurizer heater E-201', kw: 150, pf: 1.0, type: 'heater', area: 'Heating' },
    { id: 'CONV', tag: 'Q_CONV', name: 'Conveyor M-401', kw: 2.2, pf: 0.82, type: 'motor', area: 'Conveyor' },
    { id: 'FILL', tag: 'Q_FILL', name: 'Filler FV-301', kw: 0.9, pf: 0.9, type: 'machine', area: 'Filling' },
    { id: 'CAP', tag: 'Q_CAP', name: 'Capper CP-302', kw: 0.8, pf: 0.85, type: 'machine', area: 'Filling' },
    { id: 'LABEL', tag: 'Q_LABEL', name: 'Labeler LB-501', kw: 0.6, pf: 0.85, type: 'machine', area: 'Packaging' },
    { id: 'CARTON', tag: 'Q_CARTON', name: 'Carton packer CK-601', kw: 2.5, pf: 0.84, type: 'machine', area: 'Packaging' },
    { id: 'PALLETIZER', tag: 'Q_PALLETIZER', name: 'Palletizer PZ-701', kw: 5.5, pf: 0.8, type: 'machine', area: 'Palletizing' },
    { id: 'WRAP', tag: 'Q_WRAP', name: 'Wrapper WR-702', kw: 1.2, pf: 0.85, type: 'machine', area: 'Palletizing' }
  ];
  const UTIL_KW = 4.5;                                 // compressor, lighting, controls - always on

  /** deterministic PRNG so tests are repeatable */
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  class Plant {
    constructor(tags, seed) {
      this.tags = tags; this.seed = seed || 1234;
      this.onEvent = null;
      this.reset();
    }

    reset() {
      this.rng = mulberry32(this.seed);
      this.t = 0;                                       // simulated ms
      this.faults = { ttFail: false, ltFail: false, pumpTrip: false, convOverload: false, jam: false, emptySyrup: false, powerLoss: false, overheat: false, gasLeak: false, noCaps: false, noLabels: false, noCans: false };
      this.estopPressed = false;
      this.m = { syrup: 60, water: 195, mix: 0, past: 0, bowl: 0 };       // kg in each vessel
      this.T2 = 25; this.T3 = 25; this.amb = 25;
      this.v = 0; this.gas = 0;
      this.cans = []; this.cartons = []; this.nextCanId = 1;
      this.caps = 300; this.labels = 300; this.canMag = 5000;
      this.prev = {}; this.pulses = {};
      this.stats = { delivered: 0, filled: 0, rejects: { underfill: 0, nocap: 0, hitemp: 0, nolabel: 0 }, outcomes: [], fillSamples: [], busy: { FILL: 0, CAP: 0, LABEL: 0, CONV: 0, INSP: 0 }, cnt: { FILL: 0, CAP: 0, LABEL: 0, CONV: 0, INSP: 0 }, cartons: 0, pallets: 0 };
      this.totals = { syrupKg: 0, waterKg: 0, productKg: 0 };
      this.eq = {}; this.energy = { UTIL: 0 };
      // seed realistic running hours so the maintenance page is meaningful
      const seedH = { P101: 1840, P102: 2210, P103: 960, P104: 1530, AGIT: 3100, HEATER: 2750, CONV: 5200, FILL: 4100, CAP: 3900, LABEL: 3300, CARTON: 2800, PALLETIZER: 1900, WRAP: 1200 };
      EQUIP.forEach(e => { this.eq[e.id] = { on: false, rt: (seedH[e.id] || 500) * 3600, starts: Math.round((seedH[e.id] || 500) / 6), kw: 0, amps: 0, vib: 1.1, wear: 0 }; this.energy[e.id] = 0; });
      this.powerKW = 0; this.kvar = 0; this.peakKW = 0;
      this.convIndexBusy = 0;
      this.lastDefectCounter = 0;
    }

    /* ------------------------------ fault injection ------------------------------ */
    setFault(name, on) {
      if (!(name in this.faults)) return;
      const was = this.faults[name]; this.faults[name] = !!on;
      if (name === 'emptySyrup' && on && !was) this.m.syrup = Math.min(this.m.syrup, 3);
      if (name === 'noCaps' && on) this.caps = 0;
      if (name === 'noLabels' && on) this.labels = 0;
      this.emit({ type: 'fault', name, on: !!on });
    }
    clearFaults() { Object.keys(this.faults).forEach(k => { if (this.faults[k]) this.setFault(k, false); }); }
    setEstop(on) { this.estopPressed = !!on; this.emit({ type: 'estop', on: !!on }); }
    refill(what) { if (what === 'caps') { this.caps = 300; this.faults.noCaps = false; } if (what === 'labels') { this.labels = 300; this.faults.noLabels = false; } if (what === 'cans') { this.canMag = 5000; this.faults.noCans = false; } }
    dump() { this.m.mix = 0; this.m.past = 0; this.m.bowl = 0; }       // abort batch: product to drain
    emit(e) { if (this.onEvent) this.onEvent(e); }
    pwr() { return !this.faults.powerLoss && !this.estopPressed; }
    rand() { return this.rng(); }
    noise(a) { return (this.rng() - 0.5) * 2 * a; }

    /* ------------------------------ PLC inputs ------------------------------ */
    readInputs() {
      const T = this.tags, f = this.faults, W = DIM.WIN;
      const set = (n, v) => T.set(n, v);
      const near = x => this.cans.some(c => Math.abs(c.x - x) <= W);
      set('I_ESTOP_OK', !this.estopPressed);
      set('I_MCC_OK', !f.powerLoss);
      set('I_GAS_ALARM', this.gas >= 100);
      set('I_OL_P101', f.pumpTrip);
      set('I_OL_P102', false);
      set('I_OL_CONV', f.convOverload);
      set('I_JAM', f.jam);
      set('I_CAP_LOW', this.caps < 50);
      set('I_LBL_LOW', this.labels < 50);
      set('DI_PE301', near(DIM.FILL_X));
      set('DI_PE302', near(DIM.CAP_X));
      set('DI_PE401', near(DIM.INSP_X));
      set('DI_INSP_FAIL', this.cans.some(c => Math.abs(c.x - DIM.INSP_X) <= W && this.defect(c)));
      set('DI_PE501', near(DIM.LBL_X));
      set('DI_PE502', near(DIM.LCHK_X));
      set('DI_LBL_FAIL', this.cans.some(c => Math.abs(c.x - DIM.LCHK_X) <= W && !c.labeled));
      ['DI_PE601', 'DI_BARCODE', 'DI_PE701'].forEach(n => set(n, (this.pulses[n] || 0) > 0));
      // analog (engineering units) with small measurement noise and sensor-failure modes
      set('AI_LT101', f.ltFail ? -30 : this.pct(this.m.syrup, CAP.syrup) + this.noise(0.03));
      set('AI_LT102', this.pct(this.m.water, CAP.water) + this.noise(0.03));
      set('AI_WT103', Math.max(0, this.m.mix + this.noise(0.01)));
      set('AI_LT201', this.pct(this.m.past, CAP.past) + this.noise(0.03));
      set('AI_TT201', f.ttFail ? -30 : this.T2 + this.noise(0.05));
      set('AI_PT201', this.pressure());
      set('AI_LT301', this.pct(this.m.bowl, CAP.bowl) + this.noise(0.03));
      set('AI_TT301', this.T3 + this.noise(0.05));
      set('AI_GAS_PPM', Math.max(0, this.gas + this.noise(0.3)));
      set('AI_CONV_SPD', this.v / DIM.VMAX * 100);
      set('AI_CONV_AMP', this.eq.CONV.amps);
      set('AI_KW', this.powerKW);
    }
    pct(m, cap) { return Math.max(0, Math.min(100, m / cap * 100)); }
    pressure() { if (this.m.past < 2) return 1.0; const d = Math.max(0, this.T2 - 25); return 1 + 0.012 * d + 0.00018 * d * d; }
    defect(c) { return c.ml < c.target * 0.97 ? 'underfill' : (!c.capped ? 'nocap' : (c.temp > this.tags.get('TEMP_REJ_HI') ? 'hitemp' : null)); }

    /* ------------------------------ PLC outputs -> physics ------------------------------ */
    writeOutputs(dtMs) {
      let rem = dtMs;
      while (rem > 0) { const h = Math.min(rem, 50); this.step(h); rem -= h; }
    }

    step(hMs) {
      const T = this.tags, f = this.faults, h = hMs / 1000;
      const out = n => !!T.get(n), on = this.pwr();
      this.t += hMs;

      /* ---- supply tanks and dosing ---- */
      const p101 = on && out('Q_P101') && !f.pumpTrip, xv103 = on && out('Q_XV103');
      const p102 = on && out('Q_P102'), xv104 = on && out('Q_XV104');
      if (on && out('Q_XV101') && !f.emptySyrup) this.m.syrup = Math.min(CAP.syrup, this.m.syrup + 3.0 * h);
      if (on && out('Q_XV102')) this.m.water = Math.min(CAP.water, this.m.water + 6.0 * h);
      if (p101 && xv103 && this.m.syrup > 0) { const d = Math.min(this.m.syrup, 2.0 * h); this.m.syrup -= d; this.m.mix += d; this.totals.syrupKg += d; }
      if (p102 && xv104 && this.m.water > 0) { const d = Math.min(this.m.water, 4.0 * h); this.m.water -= d; this.m.mix += d; this.totals.waterKg += d; }

      /* ---- transfer mixing tank -> pasteurizer ---- */
      if (on && out('Q_P103') && out('Q_XV105') && this.m.mix > 0 && this.m.past < CAP.past) {
        const d = Math.min(this.m.mix, 5.0 * h, CAP.past - this.m.past);
        this.T2 = (this.T2 * this.m.past + this.amb * d) / (this.m.past + d);   // cold product mixes in
        this.m.mix -= d; this.m.past += d;
      }

      /* ---- pasteurizer heat balance ---- */
      let heatKW = 0;
      if (on && out('Q_HEATER') && this.m.past > 1) heatKW = f.overheat ? 150 : 150 * Math.max(0, Math.min(100, T.get('AO_HEATER'))) / 100;
      const mc = Math.max(this.m.past, 12) * 4.18;                // kJ/K
      const lossKW = 0.15 * (this.T2 - this.amb);
      this.T2 += (heatKW - lossKW) * h / mc;
      if (this.m.past <= 1) this.T2 += (this.amb - this.T2) * h / 60;

      /* ---- filler bowl ---- */
      if (on && out('Q_P104') && this.m.past > 0 && this.m.bowl < CAP.bowl) {
        const d = Math.min(this.m.past, 2.0 * h, CAP.bowl - this.m.bowl);
        this.T3 = (this.T3 * this.m.bowl + this.T2 * d) / (this.m.bowl + d);
        this.m.past -= d; this.m.bowl += d;
      }
      this.T3 += (this.amb - this.T3) * h / 600;

      /* ---- gas ---- */
      this.gas += ((f.gasLeak ? 220 : 0) - this.gas) * Math.min(1, h / 4);
      if (this.gas < 0.01) this.gas = 0;

      /* ---- conveyor motor, VFD ramp ---- */
      const run = on && out('Q_CONV') && !f.convOverload && !f.jam;
      const vt = run ? Math.max(0, Math.min(100, T.get('AO_CONV_SPD'))) / 100 * DIM.VMAX : 0;
      const acc = vt > this.v ? 2.0 : 4.0;
      this.v += Math.sign(vt - this.v) * Math.min(Math.abs(vt - this.v), acc * h);
      if (f.jam) this.v = 0;

      /* ---- can spawning (infeed gate) ---- */
      if (on && out('Q_FEEDER') && !f.noCans && this.canMag > 0) {
        const last = this.cans.length ? this.cans.reduce((a, c) => c.x < a.x ? c : a, this.cans[0]) : null;
        if (!last || last.x >= DIM.PITCH) {
          const rec = T.get('REC_FILL_ML');
          // exact pitch keeps every can in phase with every station window (see README: conveyor geometry)
          this.cans.push({ id: this.nextCanId++, x: last ? last.x - DIM.PITCH : 0, ml: 0, target: rec, capped: false, labeled: false, temp: this.amb, k: 1 + this.noise(0.012), sampled: false, reason: null });
          this.canMag--; if (this.canMag === 400) this.emit({ type: 'info', msg: 'Empty-can magazine low' });
        }
      }

      /* ---- move cans ---- */
      const dx = this.v * h;
      if (dx > 0) { this.cans.sort((a, b) => b.x - a.x); this.cans.forEach(c => { c.x += dx; }); this.convIndexBusy += hMs; }

      /* ---- filler ---- */
      const W = DIM.WIN, canAt = x => this.cans.find(c => Math.abs(c.x - x) <= W);
      if (on && out('Q_FILL')) {
        const c = canAt(DIM.FILL_X);
        if (c && this.m.bowl > 0.001) {
          const lvl = this.pct(this.m.bowl, CAP.bowl), factor = Math.min(1, lvl / 6);
          const ml = 250 * factor * c.k * h;                       // 250 ml/s nominal
          c.ml += ml; this.m.bowl = Math.max(0, this.m.bowl - ml / 1000); c.temp = this.T3; this.totals.productKg += ml / 1000;
        }
        this.stats.busy.FILL += hMs;
      }
      // can leaves the filler window: sample the fill volume (SPC) once
      this.cans.forEach(c => { if (!c.sampled && c.x > DIM.FILL_X + W && c.ml > 0) { c.sampled = true; this.stats.filled++; this.stats.cnt.FILL++; this.stats.fillSamples.push(c.ml); if (this.stats.fillSamples.length > 200) this.stats.fillSamples.shift(); } });

      /* ---- capper, labeler, reject pushers (act on rising edge of the output) ---- */
      const edge = (name, val) => { const r = val && !this.prev[name]; this.prev[name] = val; return r; };
      if (on && out('Q_CAP')) this.stats.busy.CAP += hMs;
      if (edge('Q_CAP', on && out('Q_CAP'))) {
        const c = canAt(DIM.CAP_X);
        if (c) { c.capped = this.caps > 0 && this.rand() > 0.012; if (this.caps > 0) this.caps--; this.stats.cnt.CAP++; }
      }
      if (on && out('Q_LABEL')) this.stats.busy.LABEL += hMs;
      if (edge('Q_LABEL', on && out('Q_LABEL'))) {
        const c = canAt(DIM.LBL_X);
        if (c) { c.labeled = this.labels > 0 && this.rand() > 0.015; if (this.labels > 0) this.labels--; this.stats.cnt.LABEL++; }
      }
      if (edge('Q_REJ1', on && out('Q_REJ1'))) {
        const c = canAt(DIM.INSP_X);
        if (c) { this.reject(c, this.defect(c) || 'underfill'); }
      }
      if (edge('Q_REJ2', on && out('Q_REJ2'))) {
        const c = canAt(DIM.LCHK_X);
        if (c) { this.reject(c, 'nolabel'); }
      }
      // inspection cycle bookkeeping (cans reaching the inspection window)
      this.cans.forEach(c => { if (!c.insp && c.x >= DIM.INSP_X - W) { c.insp = true; this.stats.cnt.INSP++; } });

      /* ---- end of conveyor: delivered to carton packer ---- */
      for (let i = this.cans.length - 1; i >= 0; i--) {
        const c = this.cans[i];
        if (c.x >= DIM.END_X) {
          this.cans.splice(i, 1); this.stats.delivered++; this.stats.outcomes.push(0); if (this.stats.outcomes.length > 20) this.stats.outcomes.shift();
          this.pulses.DI_PE601 = 250; this.emit({ type: 'can', good: true });
        }
      }

      /* ---- carton packer -> barcode -> palletizer ---- */
      if (edge('Q_CARTON', on && out('Q_CARTON'))) { this.cartons.push({ t: 0, scanned: false, arrived: false }); this.stats.cartons++; this.emit({ type: 'carton' }); }
      this.cartons.forEach(c => {
        c.t += hMs;
        if (!c.scanned && c.t >= 1800) { c.scanned = true; this.pulses.DI_BARCODE = 300; this.emit({ type: 'barcode' }); }
        if (!c.arrived && c.t >= 3500) { c.arrived = true; this.pulses.DI_PE701 = 300; }
      });
      this.cartons = this.cartons.filter(c => !c.arrived || c.t < 4200);
      const wrapNow = on && out('Q_WRAP');
      if (this.prevWrap && !wrapNow) { this.stats.pallets++; this.emit({ type: 'pallet' }); }   // wrap cycle finished
      this.prevWrap = wrapNow;
      Object.keys(this.pulses).forEach(k => { if (this.pulses[k] > 0) this.pulses[k] -= hMs; });

      /* ---- equipment bookkeeping: runtime, starts, current, vibration, power ---- */
      let kwTot = UTIL_KW, kvarTot = UTIL_KW * 0.33;
      EQUIP.forEach(e => {
        const q = on && out(e.tag) && !(e.id === 'P101' && f.pumpTrip) && !(e.id === 'CONV' && (f.convOverload || f.jam));
        const s = this.eq[e.id];
        if (q && !s.on) s.starts++;
        s.on = q;
        let kw = 0;
        if (q) {
          if (e.id === 'HEATER') kw = heatKW;
          else if (e.id === 'CONV') kw = 0.4 + 1.8 * (this.v / DIM.VMAX);
          else kw = e.kw;
          s.rt += h;
        }
        s.kw = kw;
        const amps = kw * 1000 / (1.732 * 400 * e.pf);
        s.amps = e.id === 'CONV' ? (q ? 2.5 + 7 * this.v / DIM.VMAX + (f.jam ? 18 : 0) : 0) : amps;
        const hrs = s.rt / 3600;
        s.vib = q ? 1.0 + s.wear + hrs * 0.00035 + (e.type === 'pump' || e.type === 'motor' ? 0.25 : 0.1) + Math.abs(this.noise(0.12)) : s.vib * 0.9 + 0.1;
        this.energy[e.id] += kw * h / 3600;
        kwTot += kw; kvarTot += kw * Math.tan(Math.acos(e.pf));
      });
      this.energy.UTIL += UTIL_KW * h / 3600;
      this.powerKW = kwTot; this.kvar = kvarTot; if (kwTot > this.peakKW) this.peakKW = kwTot;
      this.stats.busy.CONV = this.convIndexBusy;
    }

    reject(c, reason) {
      const i = this.cans.indexOf(c); if (i >= 0) this.cans.splice(i, 1);
      this.stats.rejects[reason] = (this.stats.rejects[reason] || 0) + 1;
      this.stats.outcomes.push(1); if (this.stats.outcomes.length > 20) this.stats.outcomes.shift();
      this.emit({ type: 'reject', reason });
    }
    rejectRate() { const o = this.stats.outcomes; return o.length ? 100 * o.reduce((a, b) => a + b, 0) / o.length : 0; }
    totalRejects() { const r = this.stats.rejects; return r.underfill + r.nocap + r.hitemp + r.nolabel; }
  }

  P.Plant = Plant; P.DIM = DIM; P.CAPS = CAP; P.EQUIP = EQUIP; P.UTIL_KW = UTIL_KW;
})(typeof window !== 'undefined' ? window : globalThis);
