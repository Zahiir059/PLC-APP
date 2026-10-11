/* selftest-plant.js - integration tests: the real default program running against the process model */
(function (g) {
  'use strict';
  const P = g.PLANT, H = P.testHelpers, T = (n, f) => P.registerTest('Plant', n, f);
  const mkSim = () => {
    const s = new P.Sim(); const D = g.PLANT_DEFAULTS; s.speed = 1;
    s.init(D.tags, D.program);
    s.alarms = new P.AlarmManager(s.tags); s.every(100, ms => s.alarms.evaluate(ms, s.clock()));
    return s;
  };
  const start = s => { s.runSeconds(1); s.pulse('M_START'); };
  const outsOff = s => P.EQUIP.every(e => !s.get(e.tag));
  const scanTo = (s, step) => { for (let i = 0; i < 40000 && s.get('SEQ_STEP') !== step; i++) s.scanOnce(); };
  const until = (s, fn, max) => { for (let i = 0; i < max; i++) { if (fn()) return i; s.runSeconds(1); } return -1; };

  T('Start sequence walks 10->20->...->80 in order', () => {
    const s = mkSim(); start(s); const seen = [];
    for (let i = 0; i < 400; i++) { s.runSeconds(1); const st = s.get('SEQ_STEP'); if (seen[seen.length - 1] !== st) seen.push(st); if (st === 80) break; }
    H.eq(seen.join(), '10,20,30,40,50,60,70,80');
  });
  T('Dosing weighs syrup then water to recipe', () => {
    const s = mkSim(); start(s); scanTo(s, 30);
    H.near(s.get('AI_WT103'), s.get('SYRUP_TARGET_KG'), 0.5, 'syrup weight');
    scanTo(s, 40); H.near(s.get('AI_WT103'), s.get('REC_BATCH_KG'), 0.5, 'total weight');
  });
  T('Temperature PID reaches setpoint with limited overshoot', () => {
    const s = mkSim(); start(s); let peak = 0;
    until(s, () => { peak = Math.max(peak, s.get('AI_TT201')); return s.get('SEQ_STEP') === 70; }, 300);
    H.ok(s.get('SEQ_STEP') === 70, 'reached hold'); s.runSeconds(15);
    H.ok(peak < 91, 'peak ' + peak.toFixed(1)); H.near(s.get('AI_TT201'), 85, 4, 'near setpoint');
  });
  T('Production order stops the plant at target and counters agree', () => {
    const s = mkSim(); s.tags.set('ORDER_TARGET', 12); start(s);
    const n = until(s, () => s.get('ORDER_DONE'), 600); H.ok(n >= 0, 'order completed'); s.runSeconds(2);
    H.eq(s.get('PLANT_RUN'), false); H.ok(s.get('CAN_PACKED.CV') >= 12);
    H.eq(s.get('BARCODE_CNT.CV') + (s.get('CTN_CANS.CV') > 0 ? 0 : 0) >= 1, true, 'carton barcode scanned');
    H.ok(s.get('FILL_CNT.CV') >= s.get('CAN_PACKED.CV'), 'filled >= packed');
  });
  T('Cartons and pallets: 6 cans/carton, 4 cartons/pallet', () => {
    const s = mkSim(); s.tags.set('ORDER_TARGET', 60); start(s); until(s, () => s.get('ORDER_DONE'), 700); s.runSeconds(15);
    H.eq(s.get('CAN_PACKED.CV'), 60); H.eq(s.get('BARCODE_CNT.CV'), 10); H.eq(s.get('PALLET_CNT.CV'), 2);
  });
  T('E-stop de-energises every machine and trips; reset needs release', () => {
    const s = mkSim(); start(s); s.runSeconds(25); H.ok(!outsOff(s), 'something running');
    s.plant.setEstop(true); s.runSeconds(1); H.ok(outsOff(s), 'all off'); H.eq(s.get('TRIP'), true);
    s.pulse('M_RESET'); s.runSeconds(1); H.eq(s.get('TRIP'), true, 'cannot reset while pressed');
    s.plant.setEstop(false); s.pulse('M_RESET'); s.runSeconds(1); H.eq(s.get('TRIP'), false);
  });
  T('Gas leak trips the plant and raises the critical alarm', () => {
    const s = mkSim(); start(s); s.runSeconds(20); s.plant.setFault('gasLeak', true); s.runSeconds(12);
    H.eq(s.get('TRIP'), true); H.ok(outsOff(s)); H.ok(s.alarms.activeList().some(a => a.def.id === 'GAS-HH'));
    H.ok(s.get('ALM_CRIT_UNACK') && s.get('Q_HORN'), 'horn sounds');
  });
  T('Over-temperature (stuck heater) trips at 95 degC and opens the heater contactor', () => {
    const s = mkSim(); start(s); s.plant.setFault('overheat', true);
    const n = until(s, () => s.get('TRIP'), 300); H.ok(n >= 0, 'tripped'); s.runSeconds(1);
    H.eq(s.get('Q_HEATER'), false); H.ok(s.get('AI_TT201') < 97, 'temperature stopped rising');
    H.ok(s.alarms.activeList().some(a => a.def.id === 'TAHH-201'));
  });
  T('Sensor failure (TT-201) trips the plant', () => {
    const s = mkSim(); start(s); s.runSeconds(10); s.plant.setFault('ttFail', true); s.runSeconds(1);
    H.eq(s.get('SENSOR_FAIL'), true); H.eq(s.get('TRIP'), true);
  });
  T('Power loss trips and de-energises', () => {
    const s = mkSim(); start(s); s.runSeconds(10); s.plant.setFault('powerLoss', true); s.runSeconds(1);
    H.eq(s.get('TRIP'), true); H.ok(outsOff(s));
  });
  T('Empty syrup tank: P-101 inhibited, dosing times out, alarms raised (local interlock, no trip)', () => {
    const s = mkSim(); start(s); scanTo(s, 20); s.plant.setFault('emptySyrup', true); s.runSeconds(50);
    H.eq(s.get('Q_P101'), false); H.eq(s.get('SEQ_STEP'), 20); H.eq(s.get('DOSE_FAULT'), true); H.eq(s.get('TRIP'), false);
    const ids = s.alarms.activeList().map(a => a.def.id); H.ok(ids.includes('LALL-101') && ids.includes('DOSE-TMO'), ids.join());
  });
  T('Pump overload trips only that pump', () => {
    const s = mkSim(); s.plant.setFault('pumpTrip', true); start(s); s.runSeconds(6);
    H.eq(s.get('Q_P101'), false); H.eq(s.get('TRIP'), false);
    H.ok(s.alarms.activeList().some(a => a.def.id === 'OL-P101'));
  });
  T('Conveyor jam stops the conveyor only; reset after clearing resumes', () => {
    const s = mkSim(); start(s); until(s, () => s.get('SEQ_STEP') === 80, 300); s.runSeconds(15);
    H.ok(s.get('Q_CONV') || s.get('CONV_HOLD'), 'line active'); s.plant.setFault('jam', true); s.runSeconds(2);
    H.eq(s.get('Q_CONV'), false); H.eq(s.get('TRIP'), false); H.ok(s.alarms.activeList().some(a => a.def.id === 'JAM-401'));
    s.plant.setFault('jam', false); s.runSeconds(15); H.ok(s.get('CAN_PACKED.CV') > 0);
  });
  T('Manual mode: operator command runs a pump, interlocks still apply', () => {
    const s = mkSim(); s.tags.set('M_AUTO', false); s.runSeconds(1); s.tags.set('CMD_P102', true); s.runSeconds(1);
    H.eq(s.get('Q_P102'), true); s.tags.set('M_START', true); s.runSeconds(1); H.eq(s.get('PLANT_RUN'), false, 'no auto start in manual');
    s.plant.setEstop(true); s.runSeconds(1); H.eq(s.get('Q_P102'), false);
  });
  T('Alarm state machine: unack -> ack -> normal, return-to-normal unack', () => {
    const s = mkSim(); s.runSeconds(1); s.plant.setFault('jam', true); s.runSeconds(1);
    s.alarms.ack('JAM-401', 'test'); H.eq(s.alarms.inst['JAM-401'].state, 'active_ack');
    s.plant.setFault('jam', false); s.runSeconds(1); H.eq(s.alarms.inst['JAM-401'].state, 'normal');
    s.plant.setFault('convOverload', true); s.runSeconds(1); s.plant.setFault('convOverload', false); s.runSeconds(1);
    H.eq(s.alarms.inst['OL-CONV'].state, 'rtn_unack'); s.alarms.ack('OL-CONV'); H.eq(s.alarms.inst['OL-CONV'].state, 'normal');
  });
  T('Alarm shelving silences and then restores; first-out flags the initiating trip', () => {
    const s = mkSim(); s.runSeconds(1); s.alarms.shelve('JAM-401', 1, 'test'); s.plant.setFault('jam', true); s.runSeconds(2);
    H.ok(s.alarms.activeList().every(a => a.def.id !== 'JAM-401' || a.shelved), 'shelved');
    s.plant.setFault('jam', false); s.plant.setFault('gasLeak', true); s.runSeconds(10);
    H.eq(s.alarms.firstOut, 'GAS-HH');
  });
  T('Production layer: batch record, genealogy, OEE, downtime reason', () => {
    const s = mkSim(); s.prod = new P.Production(s); s.tags.set('ORDER_TARGET', 24); start(s); until(s, () => s.get('ORDER_DONE'), 600); s.runSeconds(20);
    const pr = s.prod; H.ok(pr.batches.length === 1, 'one batch'); H.eq(pr.batches[0].id, 'B-0001'); H.ok(pr.batches[0].qty >= 24, 'batch qty ' + pr.batches[0].qty);
    H.ok(pr.cartons.length >= 4 && pr.cartons[0].batch === 'B-0001', 'cartons traced to batch'); H.ok(pr.pallets.length >= 1, 'pallet built');
    const o = pr.oee(); H.ok(o.avail > 0 && o.avail <= 1 && o.qual > 0.8 && o.perf > 0, 'oee ' + JSON.stringify(o));
    s.pulse('M_NEW_ORDER'); s.tags.set('ORDER_TARGET', 60); s.pulse('M_START'); s.runSeconds(30); s.plant.setFault('jam', true); s.runSeconds(10);
    H.ok(pr.downtime.length >= 1 && pr.downtime[pr.downtime.length - 1].reason === 'Jam', 'downtime auto reason');
    const r = pr.recipes[1]; pr.applyRecipe(r, true); H.eq(s.get('REC_SYRUP_PCT'), 22);
  });
  T('Compiled default program has no errors', () => {
    const s = mkSim(); H.eq(s.plc.compile(s.plc.program).errors.length, 0);
  });
})(typeof window !== 'undefined' ? window : globalThis);
