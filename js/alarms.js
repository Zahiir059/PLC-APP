/* ==========================================================================
   alarms.js  -  ISA-18.2 style alarm management
   --------------------------------------------------------------------------
   * Alarm definitions: tag, condition (hi/lo/on/off), limit, deadband, on-delay,
     priority (Critical/High/Medium/Low), area, expected operator response.
   * State machine per alarm:
         NORMAL -> ACTIVE-UNACK -> ACTIVE-ACK -> NORMAL
                       |                            ^
                       +--> RTN-UNACK (cleared before ack) --ack--+
   * Shelving (timed, with reason), suppression by design (out-of-service),
     first-out detection for trips, alarm flood detection (>10 alarms / 10 min),
     KPIs (rate/hour, top-5, average acknowledge time, stale alarms).
   * The manager writes ALM_ANY / ALM_UNACK / ALM_CRIT_UNACK back into the tag
     DB so the PLC can drive the horn and beacon.
   All times are SIMULATED milliseconds (sim.simMs) for logic and sim clock for
   display, so everything behaves correctly at 0.5x ... 10x speed.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};

  const PRI = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  const PRI_COLOR = { Critical: '#c8102e', High: '#e8590c', Medium: '#d4a300', Low: '#2f7fd1' };

  /** Default alarm database */
  const DEFS = [
    // Tanks
    { id: 'LAL-101', tag: 'AI_LT101', cond: 'lo', limit: 20, dead: 2, delay: 2, pri: 'Medium', area: 'Tanks', text: 'Syrup tank T-101 level low', resp: 'Check syrup supply; XV-101 should be refilling.' },
    { id: 'LALL-101', tag: 'AI_LT101', cond: 'lo', limit: 5, dead: 2, delay: 1, pri: 'High', area: 'Tanks', text: 'Syrup tank T-101 level LOW-LOW (pump P-101 inhibited)', resp: 'Restore syrup supply. Dosing will time out.' },
    { id: 'LAH-101', tag: 'AI_LT101', cond: 'hi', limit: 97, dead: 3, delay: 1, pri: 'Low', area: 'Tanks', text: 'Syrup tank T-101 level high', resp: 'Verify XV-101 closes at 90 %.' },
    { id: 'LAL-102', tag: 'AI_LT102', cond: 'lo', limit: 20, dead: 2, delay: 2, pri: 'Medium', area: 'Tanks', text: 'Water tank T-102 level low', resp: 'Check water supply; XV-102 should be refilling.' },
    { id: 'LALL-102', tag: 'AI_LT102', cond: 'lo', limit: 5, dead: 2, delay: 1, pri: 'High', area: 'Tanks', text: 'Water tank T-102 level LOW-LOW (pump P-102 inhibited)', resp: 'Restore water supply.' },
    { id: 'LAH-102', tag: 'AI_LT102', cond: 'hi', limit: 97, dead: 3, delay: 1, pri: 'Low', area: 'Tanks', text: 'Water tank T-102 level high', resp: 'Verify XV-102 closes at 90 %.' },
    // Mixing
    { id: 'WAH-103', tag: 'AI_WT103', cond: 'hi', limit: 90, dead: 5, delay: 1, pri: 'Medium', area: 'Mixing', text: 'Mixing tank weight high', resp: 'Check dosing valves are closed.' },
    { id: 'DOSE-TMO', tag: 'DOSE_FAULT', cond: 'on', pri: 'High', area: 'Mixing', text: 'Dosing timeout - batch stalled', resp: 'Check supply tank level, pump overload, valves. Abort batch if needed.' },
    { id: 'OL-P101', tag: 'I_OL_P101', cond: 'on', pri: 'High', area: 'Mixing', text: 'P-101 syrup pump overload tripped', resp: 'Inspect pump and motor, reset the overload relay.' },
    { id: 'OL-P102', tag: 'I_OL_P102', cond: 'on', pri: 'High', area: 'Mixing', text: 'P-102 water pump overload tripped', resp: 'Inspect pump and motor, reset the overload relay.' },
    // Heating
    { id: 'TAH-201', tag: 'AI_TT201', cond: 'hi', limit: 91, dead: 1, delay: 1, pri: 'High', area: 'Heating', text: 'Pasteurizer temperature high', resp: 'Check heater output and PID loop. Trip at 95 degC.' },
    { id: 'TAHH-201', tag: 'AI_TT201', cond: 'hi', limit: 95, dead: 1, delay: 0, pri: 'Critical', area: 'Heating', trip: true, text: 'Pasteurizer temperature HIGH-HIGH - plant trip', resp: 'Heater contactor opened by safety logic. Find cause, then reset trip.' },
    { id: 'PAH-201', tag: 'AI_PT201', cond: 'hi', limit: 2.6, dead: 0.1, delay: 1, pri: 'High', area: 'Heating', text: 'Pasteurizer pressure high', resp: 'Reduce heater output; check relief valve.' },
    { id: 'PAHH-201', tag: 'AI_PT201', cond: 'hi', limit: 3.0, dead: 0.1, delay: 0, pri: 'Critical', area: 'Heating', trip: true, text: 'Pasteurizer pressure HIGH-HIGH - plant trip', resp: 'Plant tripped. Inspect relief valve before reset.' },
    { id: 'SENS-FAIL', tag: 'SENSOR_FAIL', cond: 'on', pri: 'Critical', area: 'Heating', trip: true, text: 'Analog sensor failure (4-20 mA out of range) - plant trip', resp: 'Check transmitter wiring (TT-201 / LT-101 / LT-102 / LT-201).' },
    // Filling
    { id: 'LAL-301', tag: 'AI_LT301', enable: 'PROD_EN', cond: 'lo', limit: 10, dead: 3, delay: 3, pri: 'Medium', area: 'Filling', text: 'Filler bowl level low (underfill risk)', resp: 'Check P-104 and pasteurizer level.' },
    { id: 'LALL-301', tag: 'AI_LT301', enable: 'PROD_EN', cond: 'lo', limit: 3, dead: 2, delay: 2, pri: 'High', area: 'Filling', text: 'Filler bowl empty - filling inhibited', resp: 'Product not reaching the filler.' },
    { id: 'CAP-LOW', tag: 'I_CAP_LOW', cond: 'on', pri: 'Low', area: 'Filling', text: 'Cap magazine low', resp: 'Refill caps (Inspection & Packaging screen).' },
    { id: 'REJ-HI', tag: 'REJ_RATE', cond: 'hi', limit: 15, dead: 3, delay: 5, pri: 'Medium', area: 'Inspection', text: 'Reject rate high (>15 % of last 20 cans)', resp: 'See Quality screen for reject reasons.' },
    { id: 'LBL-LOW', tag: 'I_LBL_LOW', cond: 'on', pri: 'Low', area: 'Packaging', text: 'Label reel low', resp: 'Refill labels (Inspection & Packaging screen).' },
    // Conveyor
    { id: 'OL-CONV', tag: 'I_OL_CONV', cond: 'on', pri: 'High', area: 'Conveyor', text: 'Conveyor motor M-401 overload', resp: 'Inspect belt for obstruction, reset overload.' },
    { id: 'JAM-401', tag: 'I_JAM', cond: 'on', pri: 'High', area: 'Conveyor', text: 'Conveyor jam detected', resp: 'Clear the jam, then press Reset.' },
    // Safety
    { id: 'ESTOP', tag: 'I_ESTOP_OK', cond: 'off', pri: 'Critical', area: 'Safety', trip: true, text: 'EMERGENCY STOP pressed', resp: 'Make area safe, release E-stop, press Reset.' },
    { id: 'PWR-LOSS', tag: 'I_MCC_OK', cond: 'off', pri: 'Critical', area: 'Safety', trip: true, text: 'Power loss / MCC supply failure', resp: 'Check incoming supply and MCC breaker.' },
    { id: 'GAS-H', tag: 'AI_GAS_PPM', cond: 'hi', limit: 50, dead: 5, delay: 0, pri: 'High', area: 'Safety', text: 'Gas concentration high (>50 ppm)', resp: 'Ventilate; locate the leak.' },
    { id: 'GAS-HH', tag: 'I_GAS_ALARM', cond: 'on', pri: 'Critical', area: 'Safety', trip: true, text: 'GAS HIGH-HIGH (>100 ppm) - plant trip', resp: 'Evacuate area. Plant tripped by safety logic.' },
    { id: 'TRIP', tag: 'TRIP', cond: 'on', pri: 'High', area: 'Safety', text: 'Safety trip latched - Reset required', resp: 'Clear all causes, then press Reset.' },
    { id: 'ORD-DONE', tag: 'ORDER_DONE', cond: 'on', pri: 'Low', area: 'Production', text: 'Production order target reached - plant stopped', resp: 'Start a new order to continue.' }
  ];

  /** Cause & effect matrix: which cause trips which equipment (matches the Safety / actuator rungs) */
  const ALL = ['P101', 'P102', 'P103', 'P104', 'XV', 'AGIT', 'HEATER', 'FILL', 'CAP', 'LABEL', 'CONV', 'PACK', 'HORN'];
  const CE = {
    effects: [
      ['P101', 'P-101'], ['P102', 'P-102'], ['P103', 'P-103'], ['P104', 'P-104'], ['XV', 'Dosing valves'], ['AGIT', 'Agitator'], ['HEATER', 'Heater'],
      ['FILL', 'Filler'], ['CAP', 'Capper'], ['LABEL', 'Labeler'], ['CONV', 'Conveyor'], ['PACK', 'Carton/Pallet'], ['HORN', 'Horn']
    ],
    causes: [
      { name: 'E-stop pressed', alarm: 'ESTOP', global: true, marks: ALL.filter(x => x !== 'HORN') },
      { name: 'Power loss (MCC)', alarm: 'PWR-LOSS', global: true, marks: ALL.filter(x => x !== 'HORN') },
      { name: 'Gas HH > 100 ppm', alarm: 'GAS-HH', global: true, marks: ALL },
      { name: 'Over-temperature >= 95 degC', alarm: 'TAHH-201', global: true, marks: ALL.filter(x => x !== 'HORN') },
      { name: 'Over-pressure >= 3.0 bar', alarm: 'PAHH-201', global: true, marks: ALL.filter(x => x !== 'HORN') },
      { name: 'Analog sensor failure', alarm: 'SENS-FAIL', global: true, marks: ALL.filter(x => x !== 'HORN') },
      { name: 'Conveyor overload', alarm: 'OL-CONV', marks: ['FILL', 'CAP', 'LABEL', 'CONV'] },
      { name: 'Conveyor jam', alarm: 'JAM-401', marks: ['FILL', 'CAP', 'LABEL', 'CONV'] },
      { name: 'Syrup tank empty (LL)', alarm: 'LALL-101', marks: ['P101'] },
      { name: 'Water tank empty (LL)', alarm: 'LALL-102', marks: ['P102'] },
      { name: 'P-101 overload', alarm: 'OL-P101', marks: ['P101'] },
      { name: 'Filler bowl empty (LL)', alarm: 'LALL-301', marks: ['FILL'] },
      { name: 'Pasteurizer level < 3 % (dry-run)', alarm: null, marks: ['HEATER'] }
    ]
  };

  class AlarmManager {
    constructor(tags) {
      this.tags = tags;
      this.defs = DEFS.map(d => Object.assign({ delay: 0, dead: 0, shelvedUntil: 0, shelveReason: '', suppressed: false, suppressReason: '' }, d));
      this.inst = {};              // defId -> {state, since, pend, rec}
      this.history = [];           // newest last
      this.activations = [];       // sim ms of every activation (for rate / flood)
      this.firstOut = null; this.flood = false;
      this.now = 0; this.clock = 0;
      this.newCount = 0;           // incremented on every new activation (UI beeps on change)
      this.ackTimes = [];
    }

    def(id) { return this.defs.find(d => d.id === id); }

    value(d) { const t = this.tags.tag(d.tag); return t ? (t.v === true ? 1 : t.v === false ? 0 : t.v) : 0; }

    /** Evaluate every alarm. Called every 100 simulated ms. */
    evaluate(simMs, clockMs) {
      this.now = simMs; this.clock = clockMs;
      let any = false, unack = false, critUnack = false;
      for (const d of this.defs) {
        let s = this.inst[d.id]; if (!s) s = this.inst[d.id] = { state: 'normal', pend: 0, rec: null };
        const v = this.value(d);
        let cond;
        const was = s.state !== 'normal' && s.state !== 'rtn_unack';
        switch (d.cond) {
          case 'hi': cond = was ? v > d.limit - d.dead : v >= d.limit; break;
          case 'lo': cond = was ? v < d.limit + d.dead : v <= d.limit; break;
          case 'on': cond = v !== 0; break;
          case 'off': cond = v === 0; break;
          default: cond = false;
        }
        if (d.suppressed || (d.enable && !this.tags.get(d.enable))) cond = false;   // suppressed by design, or state-based (conditional) alarm
        // on-delay (debounce) for new activations
        if (cond && s.state === 'normal') {
          if (!s.pend) s.pend = simMs;
          if (simMs - s.pend < d.delay * 1000) cond = false;
        } else if (!cond) s.pend = 0;
        const shelved = d.shelvedUntil > simMs;
        if (d.shelvedUntil && !shelved) { d.shelvedUntil = 0; d.shelveReason = ''; P.bus.emit('alarm:unshelved', d); }

        // ---- state transitions ----
        if (cond && (s.state === 'normal' || s.state === 'rtn_unack') && !(shelved && s.state === 'normal')) {
          if (s.state === 'normal') this.activate(d, s, v);
          else { s.state = 'active_unack'; if (s.rec) { s.rec.tRtn = null; } }      // re-alarm before ack
        } else if (!cond) {
          if (s.state === 'active_ack') { s.state = 'normal'; this.close(s, 'rtn'); }
          else if (s.state === 'active_unack') { s.state = 'rtn_unack'; if (s.rec) s.rec.tRtn = clockMs; }
        }
        if (shelved && s.state === 'active_unack') s.state = 'active_ack';       // shelved alarms are silenced
        if (s.state !== 'normal' && !shelved) {
          any = any || s.state === 'active_unack' || s.state === 'active_ack';
          if (s.state === 'active_unack' || s.state === 'rtn_unack') { unack = true; if (d.pri === 'Critical' && s.state === 'active_unack') critUnack = true; }
        }
      }
      // flood detection: > 10 activations in the last 10 simulated minutes
      const cut = simMs - 600000;
      while (this.activations.length && this.activations[0] < cut) this.activations.shift();
      const wasFlood = this.flood; this.flood = this.activations.length > 10;
      if (this.flood && !wasFlood) P.bus.emit('alarm:flood', this.activations.length);
      // first-out bookkeeping
      if (this.firstOut && !this.tags.get('TRIP') && !this.activeTrips().length) this.firstOut = null;

      this.tags.set('ALM_ANY', any, 'alarm'); this.tags.set('ALM_UNACK', unack, 'alarm'); this.tags.set('ALM_CRIT_UNACK', critUnack, 'alarm');
    }

    activeTrips() { return this.defs.filter(d => d.trip && this.inst[d.id] && this.inst[d.id].state !== 'normal' && this.inst[d.id].state !== 'rtn_unack'); }

    activate(d, s, v) {
      s.state = 'active_unack'; s.pend = 0;
      const rec = { defId: d.id, text: d.text, pri: d.pri, area: d.area, tActive: this.clock, simActive: this.now, tAck: null, tRtn: null, ackBy: '', value: Math.round(v * 100) / 100, firstOut: false };
      if (d.trip && !this.firstOut) { this.firstOut = d.id; rec.firstOut = true; }
      s.rec = rec; this.history.push(rec); if (this.history.length > 800) this.history.shift();
      this.activations.push(this.now); this.newCount++;
      P.bus.emit('alarm:new', { def: d, rec });
    }
    close(s) { s.rec = null; }

    /** Acknowledge one alarm (by def id). */
    ack(id, user) {
      const s = this.inst[id]; if (!s) return false;
      if (s.state === 'active_unack') { s.state = 'active_ack'; this.recordAck(s, user); return true; }
      if (s.state === 'rtn_unack') { s.state = 'normal'; this.recordAck(s, user); this.close(s); return true; }
      return false;
    }
    recordAck(s, user) {
      if (s.rec) { s.rec.tAck = this.clock; s.rec.ackBy = user || ''; this.ackTimes.push((this.clock - s.rec.tActive) / 1000); if (this.ackTimes.length > 500) this.ackTimes.shift(); }
      P.bus.emit('audit', { action: 'ALARM_ACK', detail: s.rec ? s.rec.defId + ' ' + s.rec.text : '' });
    }
    ackAll(user) { let n = 0; this.defs.forEach(d => { if (this.ack(d.id, user)) n++; }); return n; }

    shelve(id, minutes, reason) {
      const d = this.def(id); if (!d) return; d.shelvedUntil = this.now + minutes * 60000; d.shelveReason = reason || '';
      P.bus.emit('audit', { action: 'ALARM_SHELVE', detail: `${id} for ${minutes} min - ${reason || 'no reason'}` });
    }
    unshelve(id) { const d = this.def(id); if (!d) return; d.shelvedUntil = 0; d.shelveReason = ''; P.bus.emit('audit', { action: 'ALARM_UNSHELVE', detail: id }); }
    suppress(id, on, reason) {
      const d = this.def(id); if (!d) return; d.suppressed = !!on; d.suppressReason = on ? (reason || '') : '';
      if (on && this.inst[id]) { this.inst[id].state = 'normal'; this.inst[id].rec = null; }
      P.bus.emit('audit', { action: on ? 'ALARM_SUPPRESS' : 'ALARM_UNSUPPRESS', detail: `${id} ${reason || ''}` });
    }

    /** Active list sorted: unacknowledged first, then priority, then time. */
    activeList() {
      const out = [];
      this.defs.forEach(d => {
        const s = this.inst[d.id]; if (!s || s.state === 'normal') return;
        out.push({ def: d, state: s.state, rec: s.rec, shelved: d.shelvedUntil > this.now });
      });
      out.sort((a, b) => ((b.state === 'active_unack') - (a.state === 'active_unack')) || (PRI[b.def.pri] - PRI[a.def.pri]) || ((b.rec ? b.rec.simActive : 0) - (a.rec ? a.rec.simActive : 0)));
      return out;
    }
    /** Highest priority unacknowledged (or any active) alarm for the banner. */
    banner() { const l = this.activeList().filter(x => !x.shelved); return l.length ? l[0] : null; }
    counts() { const c = { Critical: 0, High: 0, Medium: 0, Low: 0 }; this.activeList().forEach(a => { if (!a.shelved) c[a.def.pri]++; }); return c; }

    /** KPIs for the alarm dashboard */
    kpis() {
      const hr = Math.max(this.now / 3600000, 1 / 60);
      const freq = {}; this.history.forEach(r => { freq[r.defId] = (freq[r.defId] || 0) + 1; });
      const top5 = Object.keys(freq).map(k => ({ id: k, count: freq[k], text: (this.def(k) || {}).text || k })).sort((a, b) => b.count - a.count).slice(0, 5);
      const avgAck = this.ackTimes.length ? this.ackTimes.reduce((a, b) => a + b, 0) / this.ackTimes.length : 0;
      const stale = this.activeList().filter(a => a.rec && (this.now - a.rec.simActive) > 30 * 60000).length;
      const last10 = this.activations.length;
      return { perHour: this.history.length / hr, last10min: last10, flood: this.flood, top5, avgAckSec: avgAck, stale, total: this.history.length };
    }

    /* persistence helpers */
    exportState() { return { history: this.history.slice(-300), suppress: this.defs.filter(d => d.suppressed).map(d => ({ id: d.id, reason: d.suppressReason })) }; }
    importState(s) {
      if (!s) return;
      if (s.history) this.history = s.history;
      (s.suppress || []).forEach(x => { const d = this.def(x.id); if (d) { d.suppressed = true; d.suppressReason = x.reason; } });
    }
    reset() { this.inst = {}; this.history = []; this.activations = []; this.firstOut = null; this.flood = false; this.ackTimes = []; this.defs.forEach(d => { d.shelvedUntil = 0; }); }
  }

  P.AlarmManager = AlarmManager; P.ALARM_DEFS = DEFS; P.CAUSE_EFFECT = CE; P.PRI = PRI; P.PRI_COLOR = PRI_COLOR;
})(typeof window !== 'undefined' ? window : globalThis);
