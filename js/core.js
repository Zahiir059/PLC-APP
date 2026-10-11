/* ==========================================================================
   core.js - boots the simulator: tags + program (from localStorage or defaults),
   alarm manager, production layer, historian, and the real-time ticker.
   Shared by simulator/index.html and ladder/index.html.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};

  P.boot = function () {
    const sim = new P.Sim();
    let tagDefs = P.Prog.loadTags(), program = P.Prog.loadProgram();
    // make sure every default tag exists (older saved projects)
    const have = new Set(tagDefs.map(t => t.name));
    g.PLANT_DEFAULTS.tags.forEach(t => { if (!have.has(t.name)) tagDefs.push(t); });
    sim.init(tagDefs, program);
    const sp = P.Store.get('speed', 2); sim.speed = P.SIM.speeds.includes(sp) ? sp : 2;
    const sc = P.Store.get('scanMs', P.SIM.scanMs); sim.plc.scanMs = sc;
    sim.alarms = new P.AlarmManager(sim.tags);
    sim.alarms.importState(P.Store.get('alarms', null));
    sim.every(100, ms => sim.alarms.evaluate(ms, sim.clock()));
    sim.prod = new P.Production(sim);
    P.sim = sim; P.Hist.open();
    P.bus.on('tagsedited', () => P.Prog.saveTags(sim.tags.toJSON()));
    setInterval(() => { P.Store.set('alarms', sim.alarms.exportState()); P.Store.set('speed', sim.speed); P.Store.set('scanMs', sim.plc.scanMs); }, 8000);
    let last = performance.now();
    setInterval(() => { const n = performance.now(); sim.tick(n - last); last = n; P.bus.emit('frame'); }, P.SIM.tickMs);
    return sim;
  };

  /** Operator command helper: audit + role-aware momentary / toggle writes */
  P.Op = {
    pulse(tag, label) { P.sim.tags.set(tag, true, 'hmi'); P.bus.emit('audit', { action: 'COMMAND', detail: label || tag }); },
    toggle(tag, label) { const v = !P.sim.tags.get(tag); P.sim.tags.set(tag, v, 'hmi'); P.bus.emit('audit', { action: 'COMMAND', detail: (label || tag) + ' = ' + (v ? 1 : 0) }); return v; },
    set(tag, v, label) { const t = P.sim.tags.tag(tag); const old = t.v; P.sim.tags.set(tag, v, 'setpoint'); if (old !== t.v) P.bus.emit('audit', { action: 'SETPOINT_CHANGE', detail: `${label || tag}: ${old} -> ${t.v}` }); },
    estop() { const on = !P.sim.plant.estopPressed; P.sim.plant.setEstop(on); P.bus.emit('audit', { action: 'COMMAND', detail: on ? 'E-STOP pressed' : 'E-STOP released' }); return on; },
    abort() { P.sim.tags.set('M_ABORT', true, 'hmi'); P.sim.plant.dump(); P.bus.emit('audit', { action: 'COMMAND', detail: 'Abort batch' }); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
