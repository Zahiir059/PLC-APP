/* ==========================================================================
   selftest.js  -  automated checks for the PLC engine (and later the plant)
   --------------------------------------------------------------------------
   Used by tests.html (browser) and by `node tests/run-node.js` (CI style).
   Each test builds a tiny program, scans it with a fixed dt and asserts the
   result.  PLANT.runSelfTests() returns [{group,name,ok,msg}].
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};

  /* --- tiny helpers to build programs/engines --- */
  const no = tag => ({ t: 'no', tag }), nc = tag => ({ t: 'nc', tag });
  const ser = (...items) => ({ t: 'ser', items }), par = (...items) => ({ t: 'par', items });
  const rung = (cond, ...outs) => ({ cond: Array.isArray(cond) ? ser(...cond) : ser(cond), outs });
  const mk = (tagDefs, rungs) => {
    const tags = new P.TagDB();
    tags.load(tagDefs.map(d => typeof d === 'string' ? { name: d, type: 'BOOL' } : d));
    const plc = new P.PLC(tags);
    plc.scanMs = 10;
    plc.load({ sections: [{ name: 'T', rungs }] });
    plc.run();
    return { tags, plc };
  };
  const scans = (plc, n, dt) => { for (let i = 0; i < n; i++) plc.scan(dt || 10); };

  const T = [];                       // registry
  const test = (group, name, fn) => T.push({ group, name, fn });
  const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || 'expected') + ': ' + b + ' but got ' + a); };
  const near = (a, b, tol, msg) => { if (Math.abs(a - b) > tol) throw new Error((msg || 'expected') + ': ' + b + ' +/- ' + tol + ' but got ' + a); };
  const ok = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };

  /* ------------------------------ CONTACTS & COILS ------------------------------ */
  test('Contacts/coils', 'NO contact energises coil', () => {
    const { tags, plc } = mk(['A', 'Y'], [rung(no('A'), { t: 'coil', tag: 'Y' })]);
    scans(plc, 1); eq(tags.get('Y'), false);
    tags.set('A', true); scans(plc, 1); eq(tags.get('Y'), true);
  });
  test('Contacts/coils', 'NC contact inverts', () => {
    const { tags, plc } = mk(['A', 'Y'], [rung(nc('A'), { t: 'coil', tag: 'Y' })]);
    scans(plc, 1); eq(tags.get('Y'), true);
    tags.set('A', true); scans(plc, 1); eq(tags.get('Y'), false);
  });
  test('Contacts/coils', 'Series = AND, parallel = OR', () => {
    const { tags, plc } = mk(['A', 'B', 'C', 'Y', 'Z'], [
      rung([no('A'), no('B')], { t: 'coil', tag: 'Y' }),
      rung([par(no('A'), no('C'))], { t: 'coil', tag: 'Z' })]);
    tags.set('A', true); scans(plc, 1); eq(tags.get('Y'), false); eq(tags.get('Z'), true);
    tags.set('B', true); scans(plc, 1); eq(tags.get('Y'), true);
    tags.set('A', false); tags.set('C', true); scans(plc, 1); eq(tags.get('Y'), false); eq(tags.get('Z'), true);
  });
  test('Contacts/coils', 'Nested parallel branch with series legs', () => {
    const { tags, plc } = mk(['A', 'B', 'C', 'D', 'Y'], [
      rung([par(ser(no('A'), no('B')), ser(no('C'), nc('D')))], { t: 'coil', tag: 'Y' })]);
    scans(plc, 1); eq(tags.get('Y'), false);
    tags.set('C', true); scans(plc, 1); eq(tags.get('Y'), true);
    tags.set('D', true); scans(plc, 1); eq(tags.get('Y'), false);
    tags.set('A', true); tags.set('B', true); scans(plc, 1); eq(tags.get('Y'), true);
  });
  test('Contacts/coils', 'Rising / falling edge contacts give a single-scan pulse', () => {
    const { tags, plc } = mk(['A', 'P', 'N', 'CP', 'CN'], [
      rung({ t: 'pos', tag: 'A' }, { t: 'coil', tag: 'P' }), rung({ t: 'neg', tag: 'A' }, { t: 'coil', tag: 'N' })]);
    scans(plc, 2); tags.set('A', true);
    scans(plc, 1); eq(tags.get('P'), true, 'P on rising scan');
    scans(plc, 1); eq(tags.get('P'), false, 'P off next scan');
    tags.set('A', false); scans(plc, 1); eq(tags.get('N'), true); scans(plc, 1); eq(tags.get('N'), false);
  });

  /* ------------------------------ LATCHES ------------------------------ */
  test('Latches', 'Set/Reset latch holds, reset-last wins', () => {
    const { tags, plc } = mk(['S', 'R', 'Q'], [
      rung(no('S'), { t: 'set', tag: 'Q' }), rung(no('R'), { t: 'reset', tag: 'Q' })]);
    tags.set('S', true); scans(plc, 1); tags.set('S', false); scans(plc, 3); eq(tags.get('Q'), true, 'held');
    tags.set('S', true); tags.set('R', true); scans(plc, 1); eq(tags.get('Q'), false, 'reset dominates');
  });
  test('Latches', 'Seal-in (start/stop) circuit', () => {
    const { tags, plc } = mk(['START', 'STOP', 'RUN'], [
      rung([par(no('START'), no('RUN')), nc('STOP')], { t: 'coil', tag: 'RUN' })]);
    tags.set('START', true); scans(plc, 1); tags.set('START', false); scans(plc, 2); eq(tags.get('RUN'), true);
    tags.set('STOP', true); scans(plc, 1); tags.set('STOP', false); scans(plc, 2); eq(tags.get('RUN'), false);
  });

  /* ------------------------------ TIMERS ------------------------------ */
  test('Timers', 'TON delays output by preset and resets when input drops', () => {
    const { tags, plc } = mk(['IN'], [rung(no('IN'), { t: 'ton', tag: 'T1', preset: 100 })]);
    tags.set('IN', true); scans(plc, 9); eq(tags.get('T1.Q'), false);
    scans(plc, 1); eq(tags.get('T1.Q'), true); eq(tags.get('T1.ACC'), 100);
    tags.set('IN', false); scans(plc, 1); eq(tags.get('T1.Q'), false); eq(tags.get('T1.ACC'), 0);
  });
  test('Timers', 'TON preset from a tag', () => {
    const { tags, plc } = mk(['IN', { name: 'PT', type: 'INT', init: 50 }], [rung(no('IN'), { t: 'ton', tag: 'T1', presetTag: 'PT' })]);
    tags.set('IN', true); scans(plc, 5); eq(tags.get('T1.Q'), true);
  });
  test('Timers', 'TOF holds output after input falls', () => {
    const { tags, plc } = mk(['IN'], [rung(no('IN'), { t: 'tof', tag: 'T1', preset: 50 })]);
    tags.set('IN', true); scans(plc, 2); eq(tags.get('T1.Q'), true);
    tags.set('IN', false); scans(plc, 4); eq(tags.get('T1.Q'), true, 'still on');
    scans(plc, 2); eq(tags.get('T1.Q'), false, 'off after preset');
  });
  test('Timers', 'TP gives fixed-length pulse even if input is short', () => {
    const { tags, plc } = mk(['IN'], [rung(no('IN'), { t: 'tp', tag: 'T1', preset: 50 })]);
    tags.set('IN', true); scans(plc, 1); tags.set('IN', false);
    eq(tags.get('T1.Q'), true); scans(plc, 3); eq(tags.get('T1.Q'), true); scans(plc, 3); eq(tags.get('T1.Q'), false);
  });
  test('Timers', 'Timer done bit usable as a contact', () => {
    const { tags, plc } = mk(['IN', 'Y'], [rung(no('IN'), { t: 'ton', tag: 'T1', preset: 30 }), rung(no('T1.Q'), { t: 'coil', tag: 'Y' })]);
    tags.set('IN', true); scans(plc, 5); eq(tags.get('Y'), true);
  });

  /* ------------------------------ COUNTERS ------------------------------ */
  test('Counters', 'CTU counts rising edges only and sets Q at preset', () => {
    const { tags, plc } = mk(['IN', 'RST'], [rung(no('IN'), { t: 'ctu', tag: 'C1', preset: 3, reset: 'RST' })]);
    for (let i = 0; i < 3; i++) { tags.set('IN', true); scans(plc, 3); tags.set('IN', false); scans(plc, 1); }
    eq(tags.get('C1.CV'), 3); eq(tags.get('C1.Q'), true);
    tags.set('RST', true); scans(plc, 1); eq(tags.get('C1.CV'), 0); eq(tags.get('C1.Q'), false);
  });
  test('Counters', 'CTD counts down from loaded preset', () => {
    const { tags, plc } = mk(['IN', 'LD'], [rung(no('IN'), { t: 'ctd', tag: 'C1', preset: 2, reset: 'LD' })]);
    tags.set('LD', true); scans(plc, 1); tags.set('LD', false); eq(tags.get('C1.CV'), 2);
    for (let i = 0; i < 2; i++) { tags.set('IN', true); scans(plc, 1); tags.set('IN', false); scans(plc, 1); }
    eq(tags.get('C1.CV'), 0); eq(tags.get('C1.Q'), true);
  });

  /* ------------------------------ COMPARE & MATH ------------------------------ */
  test('Compare/math', 'Comparators (all six operators)', () => {
    const { tags, plc } = mk([{ name: 'X', type: 'INT', init: 5 }, 'G', 'GE', 'L', 'LE', 'E', 'NE'], [
      rung({ t: 'cmp', op: '>', a: 'X', b: 5 }, { t: 'coil', tag: 'G' }), rung({ t: 'cmp', op: '>=', a: 'X', b: 5 }, { t: 'coil', tag: 'GE' }),
      rung({ t: 'cmp', op: '<', a: 'X', b: 5 }, { t: 'coil', tag: 'L' }), rung({ t: 'cmp', op: '<=', a: 'X', b: 5 }, { t: 'coil', tag: 'LE' }),
      rung({ t: 'cmp', op: '==', a: 'X', b: 5 }, { t: 'coil', tag: 'E' }), rung({ t: 'cmp', op: '!=', a: 'X', b: 5 }, { t: 'coil', tag: 'NE' })]);
    scans(plc, 1);
    eq([tags.get('G'), tags.get('GE'), tags.get('L'), tags.get('LE'), tags.get('E'), tags.get('NE')].join(), 'false,true,false,true,true,false');
  });
  test('Compare/math', 'Math block: add, multiply, divide-by-zero guard, MOV', () => {
    const { tags, plc } = mk([{ name: 'A', type: 'REAL', init: 6 }, { name: 'B', type: 'REAL', init: 4 }, { name: 'S', type: 'REAL' }, { name: 'M', type: 'REAL' }, { name: 'D', type: 'REAL', init: 99 }, { name: 'V', type: 'INT' }], [
      rung([], { t: 'math', op: '+', a: 'A', b: 'B', dest: 'S' }), rung([], { t: 'math', op: '*', a: 'A', b: 'B', dest: 'M' }),
      rung([], { t: 'math', op: '/', a: 'A', b: 0, dest: 'D' }), rung([], { t: 'math', op: 'mov', a: 7, dest: 'V' })]);
    scans(plc, 1); eq(tags.get('S'), 10); eq(tags.get('M'), 24); eq(tags.get('D'), 0); eq(tags.get('V'), 7);
  });
  test('Compare/math', 'Math only executes while rung is true', () => {
    const { tags, plc } = mk(['EN', { name: 'V', type: 'INT' }], [rung(no('EN'), { t: 'math', op: 'mov', a: 5, dest: 'V' })]);
    scans(plc, 2); eq(tags.get('V'), 0); tags.set('EN', true); scans(plc, 1); eq(tags.get('V'), 5);
  });

  /* ------------------------------ PID ------------------------------ */
  const pidRig = (kp, ki, kd) => mk([
    { name: 'PV', type: 'REAL', init: 20 }, { name: 'SP', type: 'REAL', init: 60 }, { name: 'OUT', type: 'REAL' },
    { name: 'KP', type: 'REAL', init: kp }, { name: 'KI', type: 'REAL', init: ki }, { name: 'KD', type: 'REAL', init: kd },
    { name: 'AUTO', type: 'BOOL', init: true }, { name: 'MAN', type: 'REAL', init: 30 }, 'EN'],
  [rung(no('EN'), { t: 'pid', tag: 'PID1', pv: 'PV', sp: 'SP', out: 'OUT', kp: 'KP', ki: 'KI', kd: 'KD', auto: 'AUTO', man: 'MAN' })]);
  /** simple first-order plant: dPV/dt = (gain*out - (pv-20)) / tau */
  const stepPlant = (tags, dtS) => { const pv = tags.get('PV'), u = tags.get('OUT'); tags.set('PV', pv + dtS * ((0.8 * u - (pv - 20)) / 20)); };

  test('PID', 'Output clamps to 0..100 and is 0 while disabled', () => {
    const { tags, plc } = pidRig(50, 0, 0);
    scans(plc, 1, 100); eq(tags.get('OUT'), 0, 'disabled');
    tags.set('EN', true); scans(plc, 1, 100); eq(tags.get('OUT'), 100, 'clamped high');
    tags.set('SP', 0); tags.set('PV', 50); scans(plc, 1, 100); eq(tags.get('OUT'), 0, 'clamped low');
  });
  test('PID', 'Closed loop settles on the setpoint (PI)', () => {
    const { tags, plc } = pidRig(4, 0.5, 0); tags.set('EN', true);
    let peak = 0;
    for (let i = 0; i < 6000; i++) { plc.scan(100); stepPlant(tags, 0.1); peak = Math.max(peak, tags.get('PV')); }
    near(tags.get('PV'), 60, 0.5, 'final PV'); ok(peak < 70, 'overshoot below 10 degC, peak=' + peak.toFixed(1));
  });
  test('PID', 'Manual mode outputs MAN value; switching to auto is bumpless', () => {
    const { tags, plc } = pidRig(4, 0.5, 0); tags.set('EN', true); tags.set('AUTO', false);
    scans(plc, 3, 100); eq(tags.get('OUT'), 30);
    tags.set('PV', 55); scans(plc, 2, 100);                    // process moves while in manual
    tags.set('AUTO', true); scans(plc, 1, 100);
    near(tags.get('OUT'), 30, 6, 'output near previous manual value after switch');
  });
  test('PID', 'Anti-windup: integrator does not run away while saturated', () => {
    const { tags, plc } = pidRig(4, 1, 0); tags.set('EN', true);
    for (let i = 0; i < 300; i++) plc.scan(100);               // 30 s with PV stuck at 20 (saturated at 100)
    tags.set('PV', 60); scans(plc, 2, 100);                    // PV reaches SP
    ok(tags.get('OUT') <= 100 && tags.get('OUT') >= 0);
    tags.set('PV', 65); scans(plc, 5, 100);
    ok(tags.get('OUT') < 100, 'recovers promptly after saturation (out=' + tags.get('OUT').toFixed(1) + ')');
  });

  /* ------------------------------ INTERLOCKS / STATE MACHINE ------------------------------ */
  test('Interlocks', 'E-stop kills a motor even in manual command', () => {
    const { tags, plc } = mk(['CMD', 'ESTOP_OK', 'LOW', 'MOTOR'], [
      rung([no('CMD'), no('ESTOP_OK'), nc('LOW')], { t: 'coil', tag: 'MOTOR' })]);
    tags.set('ESTOP_OK', true); tags.set('CMD', true); scans(plc, 1); eq(tags.get('MOTOR'), true);
    tags.set('ESTOP_OK', false); scans(plc, 1); eq(tags.get('MOTOR'), false);
    tags.set('ESTOP_OK', true); tags.set('LOW', true); scans(plc, 1); eq(tags.get('MOTOR'), false, 'low-level interlock');
  });
  test('Interlocks', 'Trip latch needs reset and cause cleared', () => {
    const { tags, plc } = mk(['FAULT', 'RESET', 'CAUSE', 'TRIP'], [
      rung(no('FAULT'), { t: 'coil', tag: 'CAUSE' }), rung(no('CAUSE'), { t: 'set', tag: 'TRIP' }),
      rung([no('RESET'), nc('CAUSE')], { t: 'reset', tag: 'TRIP' })]);
    tags.set('FAULT', true); scans(plc, 2); eq(tags.get('TRIP'), true);
    tags.set('RESET', true); scans(plc, 2); eq(tags.get('TRIP'), true, 'cannot reset while cause present');
    tags.set('FAULT', false); scans(plc, 2); eq(tags.get('TRIP'), false);
  });
  test('Interlocks', 'State machine advances one step per scan (reverse-order rungs)', () => {
    const cmp = (s) => ({ t: 'cmp', op: '==', a: 'STEP', b: s });
    const { tags, plc } = mk([{ name: 'STEP', type: 'INT' }, 'GO'], [
      rung([cmp(20), no('GO')], { t: 'math', op: 'mov', a: 30, dest: 'STEP' }),
      rung([cmp(10), no('GO')], { t: 'math', op: 'mov', a: 20, dest: 'STEP' }),
      rung([cmp(0), no('GO')], { t: 'math', op: 'mov', a: 10, dest: 'STEP' })]);
    tags.set('GO', true); scans(plc, 1); eq(tags.get('STEP'), 10); scans(plc, 1); eq(tags.get('STEP'), 20); scans(plc, 1); eq(tags.get('STEP'), 30);
  });

  /* ------------------------------ FORCES / MODES ------------------------------ */
  test('Force & modes', 'Forced tag ignores logic writes and holds forced value', () => {
    const { tags, plc } = mk(['A', 'Y'], [rung(no('A'), { t: 'coil', tag: 'Y' })]);
    tags.force('Y', true); scans(plc, 2); eq(tags.get('Y'), true, 'forced ON with A=0');
    tags.force('Y', false); scans(plc, 2); eq(tags.get('Y'), false, 'forced OFF');
    tags.set('A', true); scans(plc, 2); eq(tags.get('Y'), false, 'still forced OFF with A=1');
    tags.force('Y', null); scans(plc, 1); eq(tags.get('Y'), true, 'released');
  });
  test('Force & modes', 'STOP mode de-energises outputs, RUN resumes', () => {
    const tags = new P.TagDB(); tags.load([{ name: 'A', type: 'BOOL' }, { name: 'Y', type: 'BOOL', addr: '%QX0.0' }]);
    const plc = new P.PLC(tags); plc.load({ sections: [{ name: 'T', rungs: [rung(no('A'), { t: 'coil', tag: 'Y' })] }] }); plc.run();
    tags.set('A', true); plc.scan(10); eq(tags.get('Y'), true); plc.stop(); eq(tags.get('Y'), false);
    plc.scan(10); eq(tags.get('Y'), false, 'no scan in STOP'); plc.run(); plc.scan(10); eq(tags.get('Y'), true);
  });
  test('Force & modes', 'Single scan executes exactly one cycle', () => {
    const { tags, plc } = mk(['IN'], [rung(no('IN'), { t: 'ctu', tag: 'C', preset: 10 })]);
    const before = plc.scanCount; plc.scan(10); eq(plc.scanCount, before + 1);
  });

  /* ------------------------------ COMPILER ------------------------------ */
  test('Compiler', 'Flags undefined tags, duplicate coils and type mismatches', () => {
    const tags = new P.TagDB(); tags.load([{ name: 'A', type: 'BOOL' }, { name: 'Y', type: 'BOOL' }, { name: 'N', type: 'INT' }, { name: 'IN1', type: 'BOOL', addr: '%IX0.0' }]);
    const plc = new P.PLC(tags);
    const p = { sections: [{ name: 'T', rungs: [
      rung(no('GHOST'), { t: 'coil', tag: 'Y' }),            // undefined tag
      rung(no('A'), { t: 'coil', tag: 'Y' }),                // duplicate coil
      rung(no('N'), { t: 'coil', tag: 'A' }),                // INT used as contact
      rung(no('A'), { t: 'coil', tag: 'IN1' }),              // write to input
      rung(no('A'), { t: 'ton', tag: 'T1', preset: 10 }), rung(no('A'), { t: 'ton', tag: 'T1', preset: 10 })] }] };
    const r = plc.compile(Program_normalize(p)); const m = r.errors.map(e => e.msg).join(' | ');
    ok(/Undefined tag "GHOST"/.test(m), 'undefined tag'); ok(/Duplicate coil/.test(m), 'duplicate coil');
    ok(/Type mismatch/.test(m), 'type mismatch'); ok(/input tag/.test(m), 'write to input'); ok(/Duplicate timer/.test(m), 'duplicate timer');
  });
  test('Compiler', 'A clean program compiles with no errors', () => {
    const tags = new P.TagDB(); tags.load([{ name: 'A', type: 'BOOL' }, { name: 'Y', type: 'BOOL' }]);
    const plc = new P.PLC(tags);
    eq(plc.compile(Program_normalize({ sections: [{ name: 'T', rungs: [rung(no('A'), { t: 'coil', tag: 'Y' })] }] })).errors.length, 0);
  });
  test('Compiler', 'Structured Text generator output', () => {
    const st = P.toST(Program_normalize({ sections: [{ name: 'Demo', rungs: [rung([par(no('A'), no('B')), nc('C')], { t: 'coil', tag: 'Y' })] }] }));
    ok(/Y := \(A OR B\) AND NOT C;/.test(st), st);
  });
  test('Tags', 'CSV export/import round-trip', () => {
    const a = new P.TagDB(); a.load([{ name: 'X1', type: 'REAL', addr: '%MD0', desc: 'a, "quoted" desc', init: 1.5 }, { name: 'B1', type: 'BOOL', addr: '%MX0.0', init: true }]);
    const b = new P.TagDB(); const res = b.fromCSV(a.toCSV());
    eq(res.errors.length, 0); eq(b.get('X1'), 1.5); eq(b.tag('X1').desc, 'a, "quoted" desc'); eq(b.get('B1'), true);
  });
  function Program_normalize(p) { return P.Program.normalize(p); }

  /** Run every registered test; extra suites (plant) push into P.__tests */
  P.registerTest = test;
  P.runSelfTests = function (filterGroup) {
    const res = [];
    T.concat(P.__tests || []).forEach(t => {
      if (filterGroup && t.group !== filterGroup) return;
      try { t.fn(); res.push({ group: t.group, name: t.name, ok: true }); }
      catch (e) { res.push({ group: t.group, name: t.name, ok: false, msg: e.message }); }
    });
    return res;
  };
  P.testHelpers = { mk, scans, eq, near, ok, no, nc, ser, par, rung };
})(typeof window !== 'undefined' ? window : globalThis);
