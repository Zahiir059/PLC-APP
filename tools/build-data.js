/* ==========================================================================
   tools/build-data.js  -  generates data/default-tags.json, data/default-program.json
   and data/default-data.js (same content as a script, so the site also works from file://)

   Run:  node tools/build-data.js
   (You do NOT need to run this to deploy - the generated files are already in /data.
    It is included so you can see how the default program was authored.)
   ========================================================================== */
const fs = require('fs'), path = require('path');
const out = p => path.join(__dirname, '..', 'data', p);

/* ------------------------------------------------------------------ TAGS */
const tags = [];
const ctr = { ix: [0, 0], qx: [0, 0], iw: 0, qw: 0, mx: [0, 0], mw: 0, md: 0 };
const bitAddr = (k, pre) => { const c = ctr[k]; const a = `%${pre}${c[0]}.${c[1]}`; c[1]++; if (c[1] > 7) { c[1] = 0; c[0]++; } return a; };
const add = (name, type, addr, desc, init, unit) => tags.push({ name, type, addr, desc, init: init === undefined ? (type === 'BOOL' ? false : 0) : init, unit: unit || '' });
const DI = (n, d, init) => add(n, 'BOOL', bitAddr('ix', 'IX'), d, init);
const AI = (n, d, u, init) => add(n, 'REAL', `%IW${ctr.iw++}`, d, init || 0, u);
const DO = (n, d) => add(n, 'BOOL', bitAddr('qx', 'QX'), d);
const AO = (n, d, u) => add(n, 'REAL', `%QW${ctr.qw++}`, d, 0, u);
const MB = (n, d, init) => add(n, 'BOOL', bitAddr('mx', 'MX'), d, init);
const MI = (n, d, init, u) => add(n, 'INT', `%MW${ctr.mw++}`, d, init, u);
const MR = (n, d, init, u) => add(n, 'REAL', `%MD${ctr.md++}`, d, init, u);

// ---- field inputs (digital)
DI('I_ESTOP_OK', 'Emergency stop circuit healthy (NC chain, 1 = OK)', true);
DI('I_MCC_OK', 'Motor control centre supply healthy (1 = OK)', true);
DI('I_GAS_ALARM', 'Gas detector GD-701 high-high contact');
DI('I_OL_P101', 'P-101 syrup pump overload relay tripped');
DI('I_OL_P102', 'P-102 water pump overload relay tripped');
DI('I_OL_CONV', 'M-401 conveyor motor overload tripped');
DI('I_JAM', 'Conveyor jam switch JS-401');
DI('I_CAP_LOW', 'Cap magazine low level LS-302');
DI('I_LBL_LOW', 'Label reel low LS-501');
DI('DI_PE301', 'PE-301 can present at filler');
DI('DI_PE302', 'PE-302 can present at capper');
DI('DI_PE401', 'PE-401 can present at inspection station');
DI('DI_INSP_FAIL', 'Inspection camera result = FAIL (underfill / no cap / high temp)');
DI('DI_PE501', 'PE-501 can present at labeler');
DI('DI_PE502', 'PE-502 can present at label verification');
DI('DI_LBL_FAIL', 'Label verification result = FAIL (label missing)');
DI('DI_PE601', 'PE-601 can delivered to carton packer');
DI('DI_BARCODE', 'BCR-601 carton barcode scanned (pulse)');
DI('DI_PE701', 'PE-701 carton arrived at palletizer');
// ---- field inputs (analog, engineering units)
AI('AI_LT101', 'LT-101 syrup tank level', '%', 60);
AI('AI_LT102', 'LT-102 water tank level', '%', 65);
AI('AI_WT103', 'WT-103 mixing tank weight (load cell)', 'kg');
AI('AI_LT201', 'LT-201 pasteurizer tank level', '%');
AI('AI_TT201', 'TT-201 pasteurizer temperature', 'degC', 25);
AI('AI_PT201', 'PT-201 pasteurizer pressure', 'bar', 1);
AI('AI_LT301', 'LT-301 filler bowl level', '%');
AI('AI_TT301', 'TT-301 filler bowl product temperature', 'degC', 25);
AI('AI_GAS_PPM', 'AT-701 gas concentration', 'ppm');
AI('AI_CONV_SPD', 'SI-401 conveyor speed feedback', '%');
AI('AI_CONV_AMP', 'II-401 conveyor motor current', 'A');
AI('AI_KW', 'JI-001 total plant power', 'kW');
// ---- field outputs
['P101:Syrup pump P-101', 'P102:Water pump P-102', 'P103:Transfer pump P-103 (mixer to pasteurizer)', 'P104:Filler feed pump P-104',
  'XV101:Syrup tank inlet valve XV-101', 'XV102:Water tank inlet valve XV-102', 'XV103:Syrup dosing valve XV-103', 'XV104:Water dosing valve XV-104',
  'XV105:Mixer discharge valve XV-105', 'AGIT:Mixer agitator M-103', 'HEATER:Heater / steam contactor K-201', 'FILL:Filling valve FV-301',
  'CAP:Capper press CP-302', 'CONV:Conveyor motor M-401 run', 'FEEDER:Empty-can infeed gate', 'REJ1:Reject pusher RP-401 (inspection)',
  'REJ2:Reject pusher RP-502 (label check)', 'LABEL:Labeler LB-501', 'CARTON:Carton packer CK-601', 'PALLETIZER:Palletizer robot PZ-701',
  'WRAP:Pallet wrapper WR-702', 'HORN:Alarm horn', 'LAMP_G:Beacon green (running)', 'LAMP_R:Beacon red (tripped)', 'LAMP_A:Beacon amber (alarm)']
  .forEach(s => { const [k, d] = s.split(':'); DO('Q_' + k, d); });
AO('AO_HEATER', 'Heater power command (PID output)', '%');
AO('AO_CONV_SPD', 'Conveyor VFD speed reference', '%');
// ---- HMI commands (momentary ones are cleared by the Housekeeping section)
MB('M_START', 'HMI Start pushbutton (momentary)');
MB('M_STOP', 'HMI Stop pushbutton (momentary)');
MB('M_RESET', 'HMI Reset / trip reset (momentary)');
MB('M_ABORT', 'HMI Abort batch (momentary)');
MB('M_NEW_ORDER', 'HMI New production order - resets order counters (momentary)');
MB('M_AUTO', 'Auto(1)/Manual(0) mode selector', true);
MB('PID_AUTO', 'Temperature loop Auto(1)/Manual(0)', true);
['P101', 'P102', 'P103', 'P104', 'XV101', 'XV102', 'XV103', 'XV104', 'XV105', 'AGIT', 'HEATER', 'CONV'].forEach(n => MB('CMD_' + n, 'Manual command for ' + n));
// ---- internal bits
[['PLANT_RUN', 'Plant running (latched by Start)'], ['AUTO_OK', 'Auto run permissive'], ['SAFE_OK', 'Safety permissive (no trip, E-stop OK, power OK)'],
  ['TRIP', 'Safety trip latch'], ['CAUSE_ACTIVE', 'A trip cause is present'], ['SENSOR_FAIL', 'Analog sensor out of range'], ['LINE_FAULT', 'Conveyor overload or jam'],
  ['ORDER_DONE', 'Production order target reached'], ['PROD_EN', 'Production (filling line) enabled - SEQ step 80'], ['LV1_REFILL', 'Syrup tank refill active'],
  ['LV2_REFILL', 'Water tank refill active'], ['LSLL_101', 'Syrup tank empty (<5 %)'], ['LSLL_102', 'Water tank empty (<5 %)'], ['LSLL_301', 'Filler bowl empty (<3 %)'],
  ['DOSE_FAULT', 'Dosing timeout'], ['FEED_REQ', 'Filler bowl requests product'], ['FILL_REQ', 'Filler station active'], ['CAP_REQ', 'Capper station active'],
  ['LBL_REQ', 'Labeler station active'], ['FILL_DONE', 'Can at filler already filled'], ['CAP_DONE', 'Can at capper already capped'], ['LBL_DONE', 'Can at labeler already labelled'],
  ['CONV_HOLD', 'Conveyor held while a station works'], ['CTN_RST', 'Reset can-per-carton counter'], ['PLT_RST', 'Reset carton-per-pallet counter'],
  ['ALM_ANY', 'Any alarm active (from alarm server)'], ['ALM_UNACK', 'Unacknowledged alarm present (from alarm server)'], ['ALM_CRIT_UNACK', 'Unacknowledged critical alarm (from alarm server)']]
  .forEach(([n, d]) => MB(n, d));
// ---- integers
MI('SEQ_STEP', 'Main sequence step (0 idle ... 90 batch complete)');
MI('ORDER_TARGET', 'Production order target (cans)', 60, 'cans');
MI('REC_ID', 'Selected recipe number', 1);
MI('REC_CANS_CTN', 'Recipe: cans per carton', 6);
MI('REC_CTN_PLT', 'Recipe: cartons per pallet', 4);
MI('REC_FILL_ML', 'Recipe: fill volume', 330, 'ml');
MI('REC_HOLD_S', 'Recipe: pasteurization hold time', 10, 's');
MI('FILL_TIME_MS', 'Calculated fill time', 1320, 'ms');
MI('HOLD_MS', 'Calculated hold time', 10000, 'ms');
// ---- reals
MR('REC_BATCH_KG', 'Recipe: batch size', 40, 'kg');
MR('REC_SYRUP_PCT', 'Recipe: syrup ratio (kg per 100 kg)', 18, '%');
MR('REC_TEMP_SP', 'Recipe: pasteurization temperature', 85, 'degC');
MR('SYRUP_TARGET_KG', 'Syrup dosing target weight', 7.2, 'kg');
MR('TMP_SYR', 'Scratch value for syrup calculation');
MR('TT_SP', 'Temperature loop setpoint', 85, 'degC');
MR('TT_HOLD_MIN', 'Minimum temperature for a valid hold', 82, 'degC');
MR('TT_HH', 'Over-temperature trip limit', 95, 'degC');
MR('PT_HH', 'Over-pressure trip limit', 3.0, 'bar');
MR('KP_TEMP', 'Temperature PID Kp', 8, '%/degC');
MR('KI_TEMP', 'Temperature PID Ki', 0.25, '%/(degC.s)');
MR('KD_TEMP', 'Temperature PID Kd', 30, '%.s/degC');
MR('PID_MAN_OUT', 'Temperature loop manual output', 0, '%');
MR('CONV_SPEED_SP', 'Conveyor speed setpoint', 60, '%');
MR('LT_LOW_SP', 'Tank refill start level', 30, '%');
MR('LT_HIGH_SP', 'Tank refill stop level', 90, '%');
MR('FILL_MS_PER_ML', 'Fill time per ml (valve flow 250 ml/s)', 4, 'ms/ml');
MR('TEMP_REJ_HI', 'Inspection: reject cans filled hotter than', 92, 'degC');
MR('REJ_RATE', 'Reject rate over last 20 cans (HMI calculated)', 0, '%');

/* ------------------------------------------------------------- LADDER DSL */
const no = t => ({ t: 'no', tag: t }), nc = t => ({ t: 'nc', tag: t }), pos = t => ({ t: 'pos', tag: t }), neg = t => ({ t: 'neg', tag: t });
const cmp = (op, a, b) => ({ t: 'cmp', op, a, b });
const S = (...i) => ({ t: 'ser', items: i }), O = (...i) => ({ t: 'par', items: i });
const coil = t => ({ t: 'coil', tag: t }), set = t => ({ t: 'set', tag: t }), rst = t => ({ t: 'reset', tag: t });
const ton = (t, p) => typeof p === 'string' ? ({ t: 'ton', tag: t, preset: 0, presetTag: p }) : ({ t: 'ton', tag: t, preset: p });
const tp = (t, p) => ({ t: 'tp', tag: t, preset: p });
const ctu = (t, p, reset) => typeof p === 'string' ? ({ t: 'ctu', tag: t, preset: 0, presetTag: p, reset: reset || '' }) : ({ t: 'ctu', tag: t, preset: p, reset: reset || '' });
const math = (op, a, b, dest) => ({ t: 'math', op, a, b, dest });
const mov = (a, dest) => ({ t: 'math', op: 'mov', a, b: 0, dest });
const R = (comment, cond, ...outs) => ({ comment, cond: S(...(cond ? (Array.isArray(cond) ? cond : [cond]) : [])), outs });
const step = n => cmp('==', 'SEQ_STEP', n);
// auto branch OR manual branch of an actuator rung
const autoOrManual = (autoItems, cmd) => O(S(...autoItems), S(nc('M_AUTO'), no(cmd)));

const sections = [];
const sec = (name, desc, rungs) => sections.push({ name, desc, rungs });

/* ---------------------------------------------------------------- SAFETY */
sec('Safety', 'Trip logic, permissives, beacons and horn. Runs first in every scan.', [
  R('Analog sensor fail (4-20 mA broken wire reads below -5 %): TT-201, LT-101, LT-102, LT-201', O(cmp('<', 'AI_TT201', -5), cmp('<', 'AI_LT101', -5), cmp('<', 'AI_LT102', -5), cmp('<', 'AI_LT201', -5)), coil('SENSOR_FAIL')),
  R('Trip causes: E-stop, power loss, gas HH, over-temperature, over-pressure, sensor failure', O(nc('I_ESTOP_OK'), nc('I_MCC_OK'), no('I_GAS_ALARM'), cmp('>=', 'AI_TT201', 'TT_HH'), cmp('>=', 'AI_PT201', 'PT_HH'), no('SENSOR_FAIL')), coil('CAUSE_ACTIVE')),
  R('Trip latch - sets on any cause', no('CAUSE_ACTIVE'), set('TRIP')),
  R('Trip reset - only when every cause has cleared (reset-last priority)', [no('M_RESET'), nc('CAUSE_ACTIVE')], rst('TRIP')),
  R('Safety permissive for all outputs', [nc('TRIP'), no('I_ESTOP_OK'), no('I_MCC_OK')], coil('SAFE_OK')),
  R('Conveyor line fault: motor overload or jam', O(no('I_OL_CONV'), no('I_JAM')), coil('LINE_FAULT')),
  R('Alarm horn follows unacknowledged critical alarm', no('ALM_CRIT_UNACK'), coil('Q_HORN')),
  R('Beacon green = plant running and healthy', [no('PLANT_RUN'), no('SAFE_OK')], coil('Q_LAMP_G')),
  R('Beacon red = safety trip', O(no('TRIP'), nc('I_ESTOP_OK')), coil('Q_LAMP_R')),
  R('Beacon amber = any alarm active', no('ALM_ANY'), coil('Q_LAMP_A'))
]);

/* -------------------------------------------------------------- SEQUENCE */
sec('Sequence', 'Plant start/stop, Auto/Manual, and the main batch state machine (SEQ_STEP). Step transitions are written highest step first so only one step is taken per scan.', [
  R('Derived values: syrup target = batch kg x syrup % / 100', [], math('*', 'REC_BATCH_KG', 'REC_SYRUP_PCT', 'TMP_SYR')),
  R('', [], math('/', 'TMP_SYR', 100, 'SYRUP_TARGET_KG')),
  R('Derived: pasteurization hold time in ms', [], math('*', 'REC_HOLD_S', 1000, 'HOLD_MS')),
  R('Derived: fill time in ms = ml x 4 ms/ml', [], math('*', 'REC_FILL_ML', 'FILL_MS_PER_ML', 'FILL_TIME_MS')),
  R('Derived: minimum temperature for a valid pasteurization hold = SP - 3', [], math('-', 'TT_SP', 3, 'TT_HOLD_MIN')),
  R('Order complete when packed cans reach the order target', [cmp('>', 'ORDER_TARGET', 0), cmp('>=', 'CAN_PACKED.CV', 'ORDER_TARGET')], coil('ORDER_DONE')),
  R('Plant run latch: SET by Start (Auto, healthy, order not done)', [no('M_START'), no('SAFE_OK'), no('M_AUTO'), nc('ORDER_DONE')], set('PLANT_RUN')),
  R('Plant run latch: RESET by Stop, trip, Manual mode or order done', O(no('M_STOP'), nc('SAFE_OK'), nc('M_AUTO'), no('ORDER_DONE')), rst('PLANT_RUN')),
  R('Auto permissive', [no('M_AUTO'), no('PLANT_RUN'), no('SAFE_OK')], coil('AUTO_OK')),
  // --- transitions, highest first
  R('Step 90 batch complete: wait 2 s', [step(90), no('AUTO_OK')], ton('T_BATCH_END', 2000)),
  R('90 -> 10  start next batch (order still open)', [step(90), no('T_BATCH_END.Q'), nc('ORDER_DONE')], mov(10, 'SEQ_STEP')),
  R('Step 80 production: product exhausted (pasteurizer and filler bowl empty) for 3 s', [step(80), no('AUTO_OK'), cmp('<', 'AI_LT201', 2), cmp('<', 'AI_LT301', 10)], ton('T_EMPTY', 3000)),
  R('80 -> 90  batch finished', [step(80), no('T_EMPTY.Q')], mov(90, 'SEQ_STEP')),
  R('Step 70 hold: temperature must stay >= SP-3 for the whole hold time (timer restarts otherwise)', [step(70), no('AUTO_OK'), cmp('>=', 'AI_TT201', 'TT_HOLD_MIN')], ton('T_HOLD', 'HOLD_MS')),
  R('70 -> 80  pasteurization complete, start production', [step(70), no('T_HOLD.Q')], mov(80, 'SEQ_STEP')),
  R('Step 60 heat-up: at temperature for 3 s', [step(60), no('AUTO_OK'), cmp('>=', 'AI_TT201', 'TT_HOLD_MIN')], ton('T_AT_TEMP', 3000)),
  R('60 -> 70  start hold timer', [step(60), no('T_AT_TEMP.Q')], mov(70, 'SEQ_STEP')),
  R('Step 50 transfer: mixing tank empty for 1.5 s', [step(50), no('AUTO_OK'), cmp('<', 'AI_WT103', 0.5)], ton('T_TRANSFER_END', 1500)),
  R('50 -> 60  begin heating', [step(50), no('T_TRANSFER_END.Q')], mov(60, 'SEQ_STEP')),
  R('Step 40 mixing time 6 s', [step(40), no('AUTO_OK')], ton('T_MIX', 6000)),
  R('40 -> 50  transfer to pasteurizer', [step(40), no('T_MIX.Q')], mov(50, 'SEQ_STEP')),
  R('30 -> 40  water dosed, total weight reached', [step(30), no('AUTO_OK'), cmp('>=', 'AI_WT103', 'REC_BATCH_KG')], mov(40, 'SEQ_STEP')),
  R('20 -> 30  syrup dosed (weighing)', [step(20), no('AUTO_OK'), cmp('>=', 'AI_WT103', 'SYRUP_TARGET_KG')], mov(30, 'SEQ_STEP')),
  R('Step 10 pre-check: tanks have material, mixer empty, room in pasteurizer', [step(10), no('AUTO_OK'), cmp('>', 'AI_LT101', 20), cmp('>', 'AI_LT102', 20), cmp('<', 'AI_WT103', 1), cmp('<', 'AI_LT201', 50)], ton('T_PRECHECK', 1500)),
  R('Step 10: load recipe temperature into the loop setpoint', step(10), mov('REC_TEMP_SP', 'TT_SP')),
  R('10 -> 20  start syrup dosing', [step(10), no('T_PRECHECK.Q')], mov(20, 'SEQ_STEP')),
  R('0 -> 10  first batch', [step(0), no('AUTO_OK')], mov(10, 'SEQ_STEP')),
  R('Production enabled while in step 80', [no('AUTO_OK'), step(80)], coil('PROD_EN')),
  R('Batch counter (counts every entry into step 20)', step(20), ctu('BATCH_CNT', 9999, '')),
  R('Abort batch: back to step 0 (process drains product)', no('M_ABORT'), mov(0, 'SEQ_STEP'))
]);

/* ----------------------------------------------------------------- TANKS */
sec('Tanks', 'Syrup (T-101) and water (T-102) tank level control with hysteresis, inlet valves and empty detection.', [
  R('Syrup tank refill latch: start below LT_LOW_SP', [cmp('<', 'AI_LT101', 'LT_LOW_SP'), no('SAFE_OK')], set('LV1_REFILL')),
  R('Syrup tank refill latch: stop above LT_HIGH_SP or on trip', O(cmp('>=', 'AI_LT101', 'LT_HIGH_SP'), nc('SAFE_OK')), rst('LV1_REFILL')),
  R('Syrup inlet valve XV-101 (auto level control or manual)', [O(no('LV1_REFILL'), S(nc('M_AUTO'), no('CMD_XV101'))), no('SAFE_OK'), cmp('<', 'AI_LT101', 99)], coil('Q_XV101')),
  R('Water tank refill latch: start', [cmp('<', 'AI_LT102', 'LT_LOW_SP'), no('SAFE_OK')], set('LV2_REFILL')),
  R('Water tank refill latch: stop', O(cmp('>=', 'AI_LT102', 'LT_HIGH_SP'), nc('SAFE_OK')), rst('LV2_REFILL')),
  R('Water inlet valve XV-102', [O(no('LV2_REFILL'), S(nc('M_AUTO'), no('CMD_XV102'))), no('SAFE_OK'), cmp('<', 'AI_LT102', 99)], coil('Q_XV102')),
  R('Syrup tank empty (LL) - dry-run protection for P-101', cmp('<', 'AI_LT101', 5), coil('LSLL_101')),
  R('Water tank empty (LL) - dry-run protection for P-102', cmp('<', 'AI_LT102', 5), coil('LSLL_102')),
  R('Filler bowl empty (LL) - inhibits filling valve', cmp('<', 'AI_LT301', 3), coil('LSLL_301'))
]);

/* ---------------------------------------------------------------- MIXING */
sec('Mixing', 'Batch dosing by weight: syrup (step 20), water (step 30), agitator, mixing time (step 40) and transfer to the pasteurizer (step 50).', [
  R('Syrup pump P-101: step 20 until syrup weight reached; interlocks: overload, tank empty', [autoOrManual([no('AUTO_OK'), step(20), cmp('<', 'AI_WT103', 'SYRUP_TARGET_KG')], 'CMD_P101'), no('SAFE_OK'), nc('I_OL_P101'), nc('LSLL_101'), cmp('<', 'AI_WT103', 95)], coil('Q_P101')),
  R('Syrup dosing valve XV-103 (opens with pump)', [autoOrManual([no('AUTO_OK'), step(20), cmp('<', 'AI_WT103', 'SYRUP_TARGET_KG')], 'CMD_XV103'), no('SAFE_OK'), cmp('<', 'AI_WT103', 95)], coil('Q_XV103')),
  R('Water pump P-102: step 30 until batch weight reached', [autoOrManual([no('AUTO_OK'), step(30), cmp('<', 'AI_WT103', 'REC_BATCH_KG')], 'CMD_P102'), no('SAFE_OK'), nc('I_OL_P102'), nc('LSLL_102'), cmp('<', 'AI_WT103', 95)], coil('Q_P102')),
  R('Water dosing valve XV-104', [autoOrManual([no('AUTO_OK'), step(30), cmp('<', 'AI_WT103', 'REC_BATCH_KG')], 'CMD_XV104'), no('SAFE_OK'), cmp('<', 'AI_WT103', 95)], coil('Q_XV104')),
  R('Agitator M-103: steps 30-50, only when there is liquid in the tank', [autoOrManual([no('AUTO_OK'), cmp('>=', 'SEQ_STEP', 30), cmp('<=', 'SEQ_STEP', 50)], 'CMD_AGIT'), no('SAFE_OK'), cmp('>', 'AI_WT103', 2)], coil('Q_AGIT')),
  R('Transfer pump P-103: step 50, pasteurizer not full', [autoOrManual([no('AUTO_OK'), step(50), cmp('<', 'AI_LT201', 95)], 'CMD_P103'), no('SAFE_OK'), cmp('>', 'AI_WT103', 0.2), cmp('<', 'AI_LT201', 98)], coil('Q_P103')),
  R('Mixer discharge valve XV-105', [autoOrManual([no('AUTO_OK'), step(50), cmp('<', 'AI_LT201', 95)], 'CMD_XV105'), no('SAFE_OK')], coil('Q_XV105')),
  R('Dosing timeout - syrup (40 s)', [step(20), no('AUTO_OK')], ton('T_DOSE_SYR', 40000)),
  R('Dosing timeout - water (40 s)', [step(30), no('AUTO_OK')], ton('T_DOSE_WTR', 40000)),
  R('Dosing fault bit for the alarm server', O(no('T_DOSE_SYR.Q'), no('T_DOSE_WTR.Q')), coil('DOSE_FAULT'))
]);

/* --------------------------------------------------------------- HEATING */
sec('Heating', 'Pasteurizer heater contactor and the temperature PID loop (steps 60-80). Loop can be put in manual from the HMI.', [
  R('Heater contactor K-201: needs liquid over the element and temperature below the HH limit', [autoOrManual([no('AUTO_OK'), cmp('>=', 'SEQ_STEP', 60), cmp('<=', 'SEQ_STEP', 80)], 'CMD_HEATER'), no('SAFE_OK'), cmp('>', 'AI_LT201', 3), cmp('<', 'AI_TT201', 'TT_HH')], coil('Q_HEATER')),
  R('Temperature PID: PV=TT-201, output = heater power %', no('Q_HEATER'), { t: 'pid', tag: 'PID_TEMP', pv: 'AI_TT201', sp: 'TT_SP', out: 'AO_HEATER', kp: 'KP_TEMP', ki: 'KI_TEMP', kd: 'KD_TEMP', auto: 'PID_AUTO', man: 'PID_MAN_OUT', min: 0, max: 100 })
]);

/* --------------------------------------------------------------- FILLING */
sec('Filling', 'Filler bowl feed pump, filling and capping stations. Each station: sensor -> request -> timer -> done latch (reset when the can leaves).', [
  R('Filler bowl feed request: start below 55 %', cmp('<', 'AI_LT301', 55), set('FEED_REQ')),
  R('Filler bowl feed request: stop above 90 %', cmp('>=', 'AI_LT301', 90), rst('FEED_REQ')),
  R('Filler feed pump P-104', [autoOrManual([no('AUTO_OK'), step(80), no('FEED_REQ')], 'CMD_P104'), no('SAFE_OK'), cmp('>', 'AI_LT201', 1.5), cmp('<', 'AI_LT301', 95)], coil('Q_P104')),
  R('Filler station request: can present, not yet filled', [no('DI_PE301'), nc('FILL_DONE'), no('PROD_EN'), nc('LINE_FAULT')], coil('FILL_REQ')),
  R('Fill timer (duration from recipe volume)', [no('FILL_REQ'), nc('LSLL_301')], ton('T_FILL', 'FILL_TIME_MS')),
  R('Filling valve FV-301', [no('FILL_REQ'), nc('T_FILL.Q'), nc('LSLL_301'), no('SAFE_OK')], coil('Q_FILL')),
  R('Can filled -> latch done (releases the conveyor)', no('T_FILL.Q'), set('FILL_DONE')),
  R('Filled latch resets when the can has left the station', nc('DI_PE301'), rst('FILL_DONE')),
  R('Capper station request', [no('DI_PE302'), nc('CAP_DONE'), no('PROD_EN'), nc('LINE_FAULT')], coil('CAP_REQ')),
  R('Capping timer 0.8 s', no('CAP_REQ'), ton('T_CAP', 800)),
  R('Capper press CP-302', [no('CAP_REQ'), nc('T_CAP.Q'), no('SAFE_OK')], coil('Q_CAP')),
  R('Can capped -> latch done', no('T_CAP.Q'), set('CAP_DONE')),
  R('Capped latch resets when the can has left', nc('DI_PE302'), rst('CAP_DONE')),
  R('Counter: cans filled (this order)', no('FILL_DONE'), ctu('FILL_CNT', 32000, 'M_NEW_ORDER')),
  R('Counter: cans capped (this order)', no('CAP_DONE'), ctu('CAP_CNT', 32000, 'M_NEW_ORDER'))
]);

/* -------------------------------------------------------------- CONVEYOR */
sec('Conveyor', 'Conveyor motor M-401 with VFD speed control, stop-and-go while any station is working, empty-can infeed.', [
  R('Conveyor hold while filler, capper or labeler is busy', O(no('FILL_REQ'), no('CAP_REQ'), no('LBL_REQ')), coil('CONV_HOLD')),
  R('Conveyor motor run: auto in step 80 (not held), or manual command', [autoOrManual([no('PROD_EN'), nc('CONV_HOLD')], 'CMD_CONV'), no('SAFE_OK'), nc('LINE_FAULT')], coil('Q_CONV')),
  R('Empty-can infeed gate opens while the conveyor runs', no('Q_CONV'), coil('Q_FEEDER')),
  R('VFD speed reference = speed setpoint x run bit', [], math('*', 'CONV_SPEED_SP', 'Q_CONV', 'AO_CONV_SPD'))
]);

/* ------------------------------------------------------------ INSPECTION */
sec('Inspection', 'Camera inspection (fill level, cap present, product temperature) and reject pusher RP-401.', [
  R('Reject pusher pulse (0.6 s) on a FAIL result edge', pos('DI_INSP_FAIL'), tp('T_REJ1', 600)),
  R('Reject pusher RP-401', no('T_REJ1.Q'), coil('Q_REJ1')),
  R('Counter: cans inspected', no('DI_PE401'), ctu('INSP_CNT', 32000, 'M_NEW_ORDER')),
  R('Counter: rejects at inspection', no('Q_REJ1'), ctu('REJ1_CNT', 32000, 'M_NEW_ORDER'))
]);

/* ------------------------------------------------------------- PACKAGING */
sec('Packaging', 'Labeler, label verification + reject, carton packing with can counting, and barcode scan counter.', [
  R('Labeler station request', [no('DI_PE501'), nc('LBL_DONE'), no('PROD_EN'), nc('LINE_FAULT')], coil('LBL_REQ')),
  R('Labeling timer 0.6 s', no('LBL_REQ'), ton('T_LBL', 600)),
  R('Labeler LB-501', [no('LBL_REQ'), nc('T_LBL.Q'), no('SAFE_OK')], coil('Q_LABEL')),
  R('Can labelled -> latch done', no('T_LBL.Q'), set('LBL_DONE')),
  R('Labelled latch resets when the can has left', nc('DI_PE501'), rst('LBL_DONE')),
  R('Counter: cans labelled', no('LBL_DONE'), ctu('LBL_CNT', 32000, 'M_NEW_ORDER')),
  R('Label verification FAIL -> reject pusher RP-502 pulse', pos('DI_LBL_FAIL'), tp('T_REJ2', 600)),
  R('Reject pusher RP-502', no('T_REJ2.Q'), coil('Q_REJ2')),
  R('Counter: rejects at label check', no('Q_REJ2'), ctu('REJ2_CNT', 32000, 'M_NEW_ORDER')),
  R('Counter: good cans delivered to the packer (order progress)', no('DI_PE601'), ctu('CAN_PACKED', 32000, 'M_NEW_ORDER')),
  R('Cans-per-carton counter (preset from recipe); reset by CTN_RST', no('DI_PE601'), ctu('CTN_CANS', 'REC_CANS_CTN', 'CTN_RST')),
  R('Carton full -> reset the can counter one scan later (or new order)', O(no('CTN_CANS.Q'), no('M_NEW_ORDER')), coil('CTN_RST')),
  R('Carton full -> packer pulse 1.5 s', pos('CTN_CANS.Q'), tp('T_CARTON', 1500)),
  R('Carton packer CK-601', [no('T_CARTON.Q'), no('SAFE_OK')], coil('Q_CARTON')),
  R('Barcode scan counter (cartons scanned)', no('DI_BARCODE'), ctu('BARCODE_CNT', 32000, 'M_NEW_ORDER'))
]);

/* ------------------------------------------------------------ PALLETIZING */
sec('Palletizing', 'Palletizer robot, cartons-per-pallet counting and stretch wrapping.', [
  R('Palletizer pulse per carton arrival', pos('DI_PE701'), tp('T_PLT', 1000)),
  R('Palletizer robot PZ-701', [no('T_PLT.Q'), no('SAFE_OK')], coil('Q_PALLETIZER')),
  R('Cartons-on-pallet counter (preset from recipe)', no('DI_PE701'), ctu('CTN_PALLET', 'REC_CTN_PLT', 'PLT_RST')),
  R('Pallet full -> wrap cycle 4 s', pos('CTN_PALLET.Q'), tp('T_WRAP', 4000)),
  R('Pallet wrapper WR-702', [no('T_WRAP.Q'), no('SAFE_OK')], coil('Q_WRAP')),
  R('Wrap finished (falling edge) -> pallet counter and reset carton count', neg('T_WRAP.Q'), ctu('PALLET_CNT', 9999, 'M_NEW_ORDER')),
  R('Reset cartons-on-pallet at wrap end or new order', O(neg('T_WRAP.Q'), no('M_NEW_ORDER')), coil('PLT_RST'))
]);

/* ----------------------------------------------------------- HOUSEKEEPING */
sec('Housekeeping', 'Clears momentary HMI command bits at the END of the scan so every rung has seen them exactly once.', [
  R('Clear Start', no('M_START'), rst('M_START')), R('Clear Stop', no('M_STOP'), rst('M_STOP')),
  R('Clear Reset', no('M_RESET'), rst('M_RESET')), R('Clear Abort', no('M_ABORT'), rst('M_ABORT')),
  R('Clear New order', no('M_NEW_ORDER'), rst('M_NEW_ORDER'))
]);

/* ------------------------------------------------------------------ SFC */
const sfc = {
  title: 'Main plant sequence (GRAFCET)',
  tag: 'SEQ_STEP',
  steps: [
    { n: 0, name: 'IDLE', act: 'All batch equipment off' },
    { n: 10, name: 'PRE-CHECK', act: 'Check tank levels; load recipe setpoint' },
    { n: 20, name: 'DOSE SYRUP', act: 'P-101 + XV-103 until syrup weight' },
    { n: 30, name: 'DOSE WATER', act: 'P-102 + XV-104 + agitator until batch weight' },
    { n: 40, name: 'MIX', act: 'Agitator for mixing time' },
    { n: 50, name: 'TRANSFER', act: 'P-103 + XV-105 to pasteurizer' },
    { n: 60, name: 'HEAT-UP', act: 'Heater + PID to setpoint' },
    { n: 70, name: 'HOLD', act: 'Hold temperature for the recipe time' },
    { n: 80, name: 'PRODUCE', act: 'Feed filler, run line' },
    { n: 90, name: 'BATCH COMPLETE', act: 'Close batch record' }
  ],
  trans: [
    { from: 0, to: 10, cond: 'AUTO_OK' },
    { from: 10, to: 20, cond: 'Levels OK for 1.5 s' },
    { from: 20, to: 30, cond: 'WT-103 >= syrup target' },
    { from: 30, to: 40, cond: 'WT-103 >= batch kg' },
    { from: 40, to: 50, cond: 'Mix timer done' },
    { from: 50, to: 60, cond: 'WT-103 < 0.5 kg' },
    { from: 60, to: 70, cond: 'TT-201 >= SP-3 for 3 s' },
    { from: 70, to: 80, cond: 'Hold timer done' },
    { from: 80, to: 90, cond: 'Tanks empty for 3 s' },
    { from: 90, to: 10, cond: 'Order not complete' }
  ],
  note: 'Abort (M_ABORT) returns to step 0 from any step. Trip / Stop freezes the step; Start resumes.'
};

const program = { name: 'Smart Beverage Plant - default program', version: 1, sections, sfc };

// ---- sanity: tag names unique
const seen = new Set(); tags.forEach(t => { if (seen.has(t.name)) throw new Error('duplicate tag ' + t.name); seen.add(t.name); });

fs.writeFileSync(out('default-tags.json'), JSON.stringify(tags, null, 1));
fs.writeFileSync(out('default-program.json'), JSON.stringify(program, null, 1));
fs.writeFileSync(out('default-data.js'), '/* generated by tools/build-data.js - do not edit by hand */\nwindow.PLANT_DEFAULTS = ' + JSON.stringify({ tags, program }) + ';\n');
console.log(`tags: ${tags.length}, sections: ${sections.length}, rungs: ${sections.reduce((a, s) => a + s.rungs.length, 0)}`);
