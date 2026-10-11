/* ==========================================================================
   screens-learn.js - Learn group: fault scenarios + fault injection panel,
   guided tutorial with score, guided tour overlay, architecture page,
   project documentation (design report + downloadable PDF summary)
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT, U = P.UI, h = U.h, t = P.t, fmt = U.fmt;
  const V = n => P.sim.tags.get(n);
  const alarmOn = id => { const s = P.sim.alarms.inst[id]; return !!s && s.state !== 'normal' && s.state !== 'rtn_unack'; };
  const allOff = () => P.EQUIP.every(e => !V(e.tag));

  /* ============================== scenarios ============================== */
  const FAULTS = [['ttFail', 'Sensor failure (TT-201 broken wire)'], ['ltFail', 'Sensor failure (LT-101)'], ['pumpTrip', 'Motor overload (P-101)'], ['convOverload', 'Motor overload (conveyor)'], ['emptySyrup', 'Empty syrup tank'], ['jam', 'Conveyor jam'], ['overheat', 'Heater stuck ON (overheating)'], ['gasLeak', 'Gas leak'], ['powerLoss', 'Power loss'], ['noCaps', 'Cap magazine empty'], ['noLabels', 'Label reel empty'], ['noCans', 'Empty-can magazine empty']];
  const SCEN = [
    { id: 'sensor', name: 'Sensor failure', fault: 'ttFail', desc: 'Temperature transmitter TT-201 loses its 4-20 mA signal and reads -30 \u00b0C.',
      expect: 'The Safety section sees an analog value below -5 % (SENSOR_FAIL), latches TRIP and removes SAFE_OK. Heater contactor, pumps, conveyor and stations drop out. Critical alarm SENS-FAIL is first-out; horn sounds. Reset only works after the sensor is healthy.',
      checks: [['SENSOR_FAIL bit set', () => V('SENSOR_FAIL')], ['Plant TRIP latched', () => V('TRIP')], ['Heater contactor open', () => !V('Q_HEATER')], ['Alarm SENS-FAIL active', () => alarmOn('SENS-FAIL')]] },
    { id: 'pump', name: 'Pump trip (overload)', fault: 'pumpTrip', desc: 'Syrup pump P-101 overload relay trips.',
      expect: 'Local interlock only: Q_P101 is blocked by the overload contact, no plant trip. If the batch is dosing syrup the weight stops rising and the 40 s dosing-timeout alarm follows. Alarm OL-P101 (High).',
      checks: [['Overload input I_OL_P101 on', () => V('I_OL_P101')], ['P-101 not running', () => !V('Q_P101')], ['No plant trip (local interlock)', () => !V('TRIP')], ['Alarm OL-P101 active', () => alarmOn('OL-P101')]] },
    { id: 'power', name: 'Power loss', fault: 'powerLoss', desc: 'The MCC supply fails. Motors and heater lose power; the PLC and sensors stay alive (UPS).',
      expect: 'I_MCC_OK drops: TRIP latches, every output is de-energised, Critical alarm PWR-LOSS. When power returns the operator must press Reset, then Start to resume - the sequence step is retained.',
      checks: [['I_MCC_OK false', () => !V('I_MCC_OK')], ['TRIP latched', () => V('TRIP')], ['All machine outputs off', allOff], ['Alarm PWR-LOSS active', () => alarmOn('PWR-LOSS')]] },
    { id: 'jam', name: 'Conveyor jam', fault: 'jam', desc: 'Cans jam at the conveyor; jam switch JS-401 operates and motor current rises.',
      expect: 'LINE_FAULT stops the conveyor and blocks filler, capper and labeler requests. No plant trip - upstream process continues. Alarm JAM-401 (High). Clear the jam, then Reset and the line resumes. Downtime is logged with reason "Jam".',
      checks: [['Jam switch on', () => V('I_JAM')], ['Conveyor stopped', () => !V('Q_CONV')], ['No plant trip', () => !V('TRIP')], ['Alarm JAM-401 active', () => alarmOn('JAM-401')]] },
    { id: 'heat', name: 'Overheating', fault: 'overheat', desc: 'The heater power controller sticks at 100 % (SCR short circuit) - the PID cannot control the temperature.',
      expect: 'Temperature climbs. High alarm TAH-201 at 91 \u00b0C, then at 95 \u00b0C the Safety logic latches TRIP and opens the heater contactor (hardware-style backup). Critical alarm TAHH-201 is first-out. Start the plant first (heating happens in steps 60-80).',
      checks: [['TT-201 above 91 \u00b0C or tripped', () => V('AI_TT201') > 91 || V('TRIP')], ['Alarm TAH-201 / TAHH-201 raised', () => alarmOn('TAH-201') || alarmOn('TAHH-201') || P.sim.alarms.history.some(r => r.defId === 'TAH-201')], ['TRIP latched at 95 \u00b0C', () => V('TRIP')], ['Heater contactor open', () => !V('Q_HEATER')]] },
    { id: 'gas', name: 'Gas leak', fault: 'gasLeak', desc: 'A refrigerant/CO2 leak: detector AT-701 concentration rises quickly.',
      expect: 'At 50 ppm: High alarm GAS-H. At 100 ppm the detector contact closes: TRIP, all outputs off, Critical alarm GAS-HH, horn sounds. The area must be ventilated and the leak fixed before Reset is accepted.',
      checks: [['Gas above 50 ppm', () => V('AI_GAS_PPM') > 50], ['Detector contact (100 ppm)', () => V('I_GAS_ALARM')], ['TRIP latched', () => V('TRIP')], ['Horn / alarm GAS-HH', () => alarmOn('GAS-HH')]] },
    { id: 'syrup', name: 'Empty syrup tank', fault: 'emptySyrup', desc: 'The syrup supply fails and tank T-101 runs empty.',
      expect: 'Pre-check holds the batch at step 10 if the tank is below 20 %. If it empties during dosing, LSLL_101 inhibits P-101 (dry-run protection), the dosing timer expires after 40 s and raises DOSE-TMO. Alarms LAL-101 and LALL-101. Local interlock - no trip.',
      checks: [['Syrup tank below 5 %', () => V('LSLL_101')], ['P-101 inhibited', () => !V('Q_P101')], ['Alarm LALL-101 active', () => alarmOn('LALL-101')], ['No plant trip', () => !V('TRIP')]] }
  ];
  P.SCENARIOS = SCEN;

  function clearAll() { P.sim.plant.clearFaults(); P.sim.plant.setEstop(false); P.sim.tags.set('M_RESET', true, 'hmi'); P.bus.emit('audit', { action: 'FAULTS_CLEARED', detail: 'all faults cleared + reset' }); }

  P.defScreen({
    id: 'training', title: 'Training', group: 'Learn', icon: '\ud83c\udf93',
    build(root) {
      this.active = P.Store.get('scn', null); this.items = [];
      P.UI.tabs(root, [t('Scenarios'), 'Fault injection', t('Tutorial')], (i, body) => { this.i = i; this.body = body; this.items = []; if (i === 0) this.scenarios(body); else if (i === 1) this.inject(body); else this.tutorial(body); });
    },
    scenarios(body) {
      if (!P.FEATURES.scenarios) return body.append('Disabled');
      body.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: () => { clearAll(); this.active = null; U.toast('Faults cleared, E-stop released, reset pulsed', 'ok'); } }, 'Clear all faults and Reset'), h('small', null, 'Click Trigger, then watch the Alarms, Plant Overview and I/O screens. The checklist shows whether the PLC responded as expected.')),
        h('div', { class: 'scn' }, SCEN.map(s => {
          const list = h('ul', { class: 'chk' }, s.checks.map(c => { const li = h('li', null, c[0]); this.items.push({ li, fn: c[1], scn: s.id }); return li; }));
          return h('div', { class: 'card' }, h('h4', null, s.name), h('div', null, s.desc), h('p', { class: 'hint' }, h('b', null, 'Expected PLC response: '), s.expect),
            h('div', { class: 'btnrow' }, h('button', { class: 'btn bad solid', onclick: () => { if (!V('PLANT_RUN') && !V('TRIP')) { P.sim.tags.set('M_AUTO', true, 'hmi'); P.Op.pulse('M_START', 'Start (scenario)'); } P.sim.plant.setFault(s.fault, true); this.active = s.id; P.bus.emit('audit', { action: 'SCENARIO', detail: s.name }); P.bus.emit('scenario', s.id); U.toast('Scenario triggered: ' + s.name, 'warn'); } }, 'Trigger'), h('button', { class: 'btn', onclick: () => { P.sim.plant.setFault(s.fault, false); P.sim.tags.set('M_RESET', true, 'hmi'); U.toast('Fault removed. Press Reset if the plant tripped.'); } }, 'Remove fault')), list);
        })));
    },
    inject(body) {
      const rows = FAULTS.map(f => { const cb = h('input', { type: 'checkbox', onchange: e => { P.sim.plant.setFault(f[0], e.target.checked); P.bus.emit('audit', { action: 'FAULT_INJECT', detail: f[1] + ' ' + (e.target.checked ? 'ON' : 'OFF') }); } }); this.items.push({ cb, key: f[0] }); return h('label', { style: { display: 'flex', gap: '8px', padding: '4px 0', alignItems: 'center' } }, cb, f[1]); });
      body.append(h('div', { class: 'card' }, h('h3', null, 'Fault injection switchboard'), h('div', { class: 'hint' }, 'Toggle process faults to see alarms, interlocks and trips. Several faults can be active at once.'), rows, h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => clearAll() }, 'Clear all faults and Reset'), h('button', { class: 'btn estop', onclick: () => P.Op.estop() }, 'E-STOP'))));
    },
    update() {
      this.items.forEach(it => {
        if (it.cb) { const on = P.sim.plant.faults[it.key]; if (it.cb.checked !== on && document.activeElement !== it.cb) it.cb.checked = on; return; }
        let ok = false; try { ok = !!it.fn(); } catch (e) { ok = false; }
        const shown = this.active === it.scn; it.li.classList.toggle('done', shown && ok); it.li.style.opacity = shown ? 1 : .55;
      });
      if (this.i === 2) Tutorial.tick(this);
    },
    tutorial(body) { Tutorial.render(this, body); }
  });

  /* ============================== tutorial / exercises ============================== */
  const EX = [
    { id: 'start', name: 'Start the plant', brief: 'Run a complete batch from Start to the first packed can.', hint: 'Use Auto mode, then press Start (or Space). Turn simulation speed up to 5x to save time.',
      items: [['Select Auto mode', () => V('M_AUTO')], ['Press Start (PLANT_RUN latched)', () => V('PLANT_RUN') || V('SEQ_STEP') > 0], ['Syrup and water dosed (reach step 40)', () => V('SEQ_STEP') >= 40], ['Pasteurizer at temperature (reach step 70)', () => V('SEQ_STEP') >= 70], ['Production running (step 80)', () => V('SEQ_STEP') >= 80], ['First can packed', () => V('CAN_PACKED.CV') >= 1]] },
    { id: 'tune', name: 'Tune the temperature loop', brief: 'Use the PID Tuning screen to get a fast response with overshoot below 3 \u00b0C.', hint: 'Open Engineering > PID Tuning (Engineer role). Try the auto-tune demo or lower Kp / raise Kd, then simulate the step response.',
      items: [['Open the PID Tuning panel', () => Tutorial.flags.pidscreen], ['Run a step-response preview', () => Tutorial.flags.preview], ['Overshoot in preview below 3 \u00b0C', () => Tutorial.flags.preview && Tutorial.flags.overshoot < 3], ['Change at least one gain on the plant', () => V('KP_TEMP') !== 8 || V('KI_TEMP') !== 0.25 || V('KD_TEMP') !== 30]] },
    { id: 'find', name: 'Find why the line stopped', brief: 'A hidden fault will stop part of the line. Use alarms, the I/O screen and the Cause & Effect matrix to find the cause.', hint: 'Look at the alarm banner and the first-out alarm. Which outputs are off? Compare with the Cause & Effect matrix.', quiz: true,
      items: [['Open the Alarms screen', () => Tutorial.flags.alarmscreen], ['Acknowledge the alarm', () => Tutorial.flags.acked], ['Identify the correct root cause', () => Tutorial.flags.solved]] },
    { id: 'order', name: 'Run a small order', brief: 'Select the Orange recipe, run an order of 12 cans and let the plant stop by itself.', hint: 'Production > select Orange > target 12 > Start order. The PLC stops at the target.',
      items: [['Select the Orange recipe', () => V('REC_ID') === 2], ['Set order target to 12', () => V('ORDER_TARGET') === 12], ['Order completes automatically', () => V('ORDER_DONE')]] },
    { id: 'edit', name: 'Edit the ladder (online)', brief: 'As Engineer, add a new rung with a contact and a coil and apply it to the running PLC.', hint: 'I/O & PLC Logic > Ladder. + Add rung, drag a NO contact and a coil, assign tags, Compile / Apply.',
      items: [['Open the ladder editor', () => Tutorial.flags.ladder], ['Compile / Apply succeeded', () => Tutorial.flags.applied]] }
  ];
  const Tutorial = {
    flags: {}, state: P.Store.get('tutorial', { done: {}, hints: {}, solved: {} }),
    save() { P.Store.set('tutorial', this.state); },
    init() {
      P.bus.on('screen', id => { if (id === 'pidtune') this.flags.pidscreen = true; if (id === 'alarms') this.flags.alarmscreen = true; if (id === 'logic') this.flags.ladder = true; });
      P.bus.on('tune:preview', e => { this.flags.preview = true; this.flags.overshoot = e.overshoot; });
      P.bus.on('audit', e => { if (e.action === 'LADDER_APPLY') this.flags.applied = true; if (e.action === 'ALARM_ACK') this.flags.acked = true; });
    },
    score() { let s = 0; EX.forEach(ex => ex.items.forEach((it, k) => { if (this.state.done[ex.id + k]) s += 10; })); EX.forEach(ex => { s -= (this.state.hints[ex.id] || 0) * 3; }); return Math.max(0, s); },
    max() { return EX.reduce((a, ex) => a + ex.items.length * 10, 0); },
    render(scr, body) {
      this.scr = scr; this.lis = []; this.scoreEl = h('b', { class: 'mono' }); this.bar = h('div', { class: 'bar ok' }, h('i'));
      body.append(h('div', { class: 'card' }, h('h3', null, 'Guided exercises'), h('div', { class: 'form-row' }, h('span', null, t('Score') + ': '), this.scoreEl, h('span', { style: { flex: 1 } }, this.bar), h('button', { class: 'btn sm bad', onclick: () => { this.state = { done: {}, hints: {}, solved: {} }; this.flags = {}; this.save(); scr.body.innerHTML = ''; this.render(scr, scr.body); } }, 'Reset progress')), h('div', { class: 'hint' }, 'Each checklist item is worth 10 points; a hint costs 3. Items tick automatically when the plant state matches.')));
      EX.forEach(ex => {
        const ul = h('ul', { class: 'chk' }, ex.items.map((it, k) => { const li = h('li', null, it[0]); this.lis.push({ li, ex, k, fn: it[1] }); return li; }));
        const card = h('div', { class: 'card', style: { marginTop: '10px' } }, h('h4', { style: { fontSize: '15px' } }, ex.name), h('div', null, ex.brief), ul);
        const hint = h('div', { class: 'hint', style: { display: 'none' } }, 'Hint: ' + ex.hint);
        const btns = h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', onclick: () => { hint.style.display = 'block'; this.state.hints[ex.id] = Math.max(this.state.hints[ex.id] || 0, 1); this.save(); } }, 'Show hint (-3)'));
        if (ex.quiz) {
          const sel = h('select', null, h('option', { value: '' }, '- choose root cause -'), [['jam', 'Conveyor jam'], ['pumpTrip', 'Syrup pump overload'], ['emptySyrup', 'Empty syrup tank'], ['ttFail', 'Temperature sensor failure'], ['powerLoss', 'Power loss']].map(o => h('option', { value: o[0] }, o[1])));
          const res = h('span', { class: 'hint' });
          btns.append(h('button', { class: 'btn primary sm', onclick: () => { const pool = ['jam', 'pumpTrip', 'emptySyrup', 'ttFail', 'powerLoss']; this.hidden = pool[Math.floor(Math.random() * pool.length)]; P.sim.plant.clearFaults(); if (!V('PLANT_RUN')) { P.sim.tags.set('M_AUTO', true, 'hmi'); P.Op.pulse('M_START', 'Start (exercise)'); } P.sim.plant.setFault(this.hidden, true); this.flags.acked = false; this.flags.solved = false; res.textContent = 'A fault has been injected. Investigate, then choose the root cause.'; P.bus.emit('audit', { action: 'EXERCISE_FAULT', detail: 'hidden' }); } }, 'Start exercise (inject hidden fault)'), sel, h('button', { class: 'btn sm', onclick: () => { if (!this.hidden) return U.toast('Start the exercise first', 'warn'); if (sel.value === this.hidden) { this.flags.solved = true; res.textContent = '\u2714 Correct!'; U.toast('Correct root cause', 'ok'); P.sim.plant.clearFaults(); P.sim.tags.set('M_RESET', true, 'hmi'); } else res.textContent = '\u2718 Not that one - check which outputs dropped out and which alarm came first.'; } }, 'Submit'), res);
        }
        card.append(btns, hint); body.append(card);
      });
    },
    tick(scr) {
      if (!this.lis) return;
      this.lis.forEach(x => {
        const key = x.ex.id + x.k; let ok = false; try { ok = !!x.fn(); } catch (e) { /* ignore */ }
        if (ok && !this.state.done[key]) { this.state.done[key] = true; this.save(); P.UI.toast('\u2714 ' + x.ex.items[x.k][0], 'ok'); }
        x.li.classList.toggle('done', !!this.state.done[key]);
      });
      const s = this.score(), m = this.max(); if (this.scoreEl) { this.scoreEl.textContent = s + ' / ' + m; this.bar.firstChild.style.width = (100 * s / m) + '%'; }
    }
  };
  P.Tutorial = Tutorial; if (P.FEATURES.tutorial) Tutorial.init();

  /* ============================== guided tour ============================== */
  const STEPS = [
    ['#nav-overview', 'Plant Overview', 'The animated line: tanks, pasteurizer, filler, conveyor, labeler, packing and palletizing. Start, Stop, E-STOP and Auto/Manual live here. Click any pump or valve for its faceplate.'],
    ['#nav-pid', 'P&ID', 'ISA-style process diagram with instrument tags (LT-101, TT-201, PT-201...). Equipment is grey; green means running or open.'],
    ['#nav-alarms', 'Alarms', 'ISA-18.2 alarm management: priorities, acknowledge, shelving, first-out, flood detection and alarm KPIs.'],
    ['#nav-trends', 'Trends / historian', 'Live trend charts, 1 min / 1 h / shift ranges with zoom and pan. History is stored in your browser.'],
    ['#nav-prod', 'Production', 'Recipes, production orders (the plant stops at the target) and batch records with traceability.'],
    ['#nav-logic', 'I/O & PLC Logic', 'The heart of the project: edit the ladder program live, view it as FBD, SFC and Structured Text, watch and force tags, cross-reference and version history.'],
    ['#nav-training', 'Training', 'One-click fault scenarios, a fault injection switchboard and a guided tutorial with a score.'],
    ['#spd', 'Simulation speed', 'Run the plant at 0.5x to 10x, pause, or step one PLC scan at a time.'],
    ['#b-theme', 'Theme and language', 'Switch between light and dark themes. The language button toggles English / Urdu. Shortcuts: Space = start/stop, E = e-stop, A = acknowledge all, ? = help.']
  ];
  const Tour = {
    start() {
      let i = 0; const el = n => document.querySelector(n);
      const shade = h('div', { class: 'tour-shade' }), hole = h('div', { class: 'tour-hole' }), tip = h('div', { class: 'tour-tip' });
      document.body.append(shade, hole, tip);
      const end = () => { shade.remove(); hole.remove(); tip.remove(); P.Store.set('tourDone', true); const a = document.querySelector('.app'); if (a) a.classList.remove('navopen'); };
      const show = () => {
        const s = STEPS[i]; const nav = document.querySelector('.app'); if (nav && /^#nav-/.test(s[0])) nav.classList.add('navopen'); const target = el(s[0]);
        if (!target) { i++; return i < STEPS.length ? show() : end(); }
        const r = target.getBoundingClientRect(); Object.assign(hole.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' });
        tip.innerHTML = ''; tip.append(h('div', { class: 'hint' }, (i + 1) + ' / ' + STEPS.length), h('h3', null, s[1]), h('p', null, s[2]), h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: end }, t('Skip')), i ? h('button', { class: 'btn', onclick: () => { i--; show(); } }, t('Back')) : null, h('button', { class: 'btn primary', onclick: () => { i++; if (i >= STEPS.length) { end(); document.querySelector('.app') && document.querySelector('.app').classList.remove('navopen'); } else show(); } }, i === STEPS.length - 1 ? t('Done') : t('Next'))));
        const tw = 330, th = tip.offsetHeight || 160; let x = r.right + 14, y = Math.max(8, Math.min(window.innerHeight - th - 8, r.top)); if (x + tw > window.innerWidth) { x = Math.max(8, r.left - tw - 14); if (x < 8 || x + tw > window.innerWidth) { x = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left)); y = Math.min(window.innerHeight - th - 8, r.bottom + 14); } }
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      };
      show();
    }
  };
  P.Tour = Tour;

  /* ============================== architecture ============================== */
  P.defScreen({
    id: 'arch', title: 'Architecture', group: 'Learn', icon: '\u2b21',
    build(root) {
      const box = (x, y, w, hh, title, lines, cls) => `<g><rect class="ab ${cls || ''}" x="${x}" y="${y}" width="${w}" height="${hh}" rx="8"/><text class="at" x="${x + w / 2}" y="${y + 22}" text-anchor="middle">${title}</text>${lines.map((l, i) => `<text class="as" x="${x + w / 2}" y="${y + 42 + i * 15}" text-anchor="middle">${l}</text>`).join('')}</g>`;
      const svg = `<svg viewBox="0 0 1100 470" class="pg arch"><style>.arch .ab{fill:var(--panel);stroke:var(--eq-dk);stroke-width:2}.arch .ab.plc{fill:color-mix(in srgb,var(--accent) 18%,var(--card));stroke:var(--accent)}.arch .ab.hmi{fill:color-mix(in srgb,var(--ok) 16%,var(--card));stroke:var(--ok)}.arch .at{font-weight:700;font-size:14px}.arch .as{font-size:11.5px;fill:var(--mute)}.arch .lnk{stroke:var(--eq-dk);stroke-width:3;fill:none}.arch .pkt{fill:var(--accent)}.arch .pkt2{fill:var(--warn)}</style>
        ${box(20, 60, 230, 170, 'Field devices', ['Sensors: LT, TT, PT, WT, PE, gas', 'Actuators: pumps, valves, heater', 'Motors, VFD, reject pushers', 'Process model (JS physics)'], '')}
        ${box(20, 260, 230, 150, 'Fault injection', ['Sensor failure, overload', 'Jam, empty tank, gas, power', 'Scenario menu / tutorial'], '')}
        ${box(410, 40, 280, 250, 'PLC (JavaScript engine)', ['Scan cycle: read inputs \u2192 logic \u2192 write outputs', 'Ladder (11 sections, 111 rungs)', 'TON / TOF / TP, CTU / CTD, PID, math', 'State machine SEQ_STEP, interlocks', 'Tag database + force table', 'Online edit: Compile / Apply'], 'plc')}
        ${box(410, 320, 280, 110, 'Data services', ['Alarm manager (ISA-18.2)', 'Historian (IndexedDB), Audit trail', 'Production / OEE / maintenance'], '')}
        ${box(830, 60, 250, 190, 'HMI / SCADA (browser)', ['ISA-101 screens, faceplates', 'Alarms, trends, reports', 'Ladder / FBD / SFC / ST viewers', 'Roles: Operator, Engineer, Admin', 'EN / Urdu, light / dark, PWA'], 'hmi')}
        ${box(830, 290, 250, 140, 'Users', ['Operator: view + operate', 'Engineer: edit logic, tags, PID', 'Admin: audit / history clear'], '')}
        <path class="lnk" d="M250 120 H410"/><path class="lnk" d="M250 150 H410" stroke-dasharray="6 5"/><text class="as" x="330" y="112" text-anchor="middle">I/O: inputs \u2192 PLC</text><text class="as" x="330" y="172" text-anchor="middle">PLC outputs \u2192 field</text>
        <path class="lnk" d="M690 150 H830"/><text class="as" x="760" y="140" text-anchor="middle">Modbus TCP (simulated)</text><text class="as" x="760" y="172" text-anchor="middle">FC 01-06 / port 502</text>
        <path class="lnk" d="M550 290 V320"/><path class="lnk" d="M955 250 V290"/>
        <circle class="pkt" r="6"><animateMotion dur="2.2s" repeatCount="indefinite" path="M250 120 H410"/></circle><circle class="pkt2" r="6"><animateMotion dur="2.2s" repeatCount="indefinite" path="M410 150 H250"/></circle>
        <circle class="pkt" r="6"><animateMotion dur="1.6s" repeatCount="indefinite" path="M690 150 H830"/></circle><circle class="pkt2" r="6"><animateMotion dur="1.6s" begin=".8s" repeatCount="indefinite" path="M830 150 H690"/></circle>
        <text class="as" x="550" y="456" text-anchor="middle">Everything runs client-side: no server, no build step. Data stays in your browser (localStorage / IndexedDB).</text></svg>`;
      root.append(h('div', { class: 'card' }, h('h3', null, 'System architecture'), h('div', { html: svg })), h('div', { class: 'grid g3', style: { marginTop: '12px' } },
        h('div', { class: 'card' }, h('h4', null, 'Scan cycle'), h('div', { class: 'mono', id: 'ar-scan' }), h('div', { class: 'hint' }, '1. Read inputs (process model \u2192 input tags)  2. Execute every rung in order  3. Write outputs (tags \u2192 actuators)  then physics integrates one scan time.')),
        h('div', { class: 'card' }, h('h4', null, 'Simulated Modbus link'), h('div', { class: 'mono', id: 'ar-mb' }), h('div', { class: 'hint' }, 'See Engineering > Modbus Map for the register map and frame builder.')),
        h('div', { class: 'card' }, h('h4', null, 'Program'), h('div', { class: 'mono', id: 'ar-pr' }))));
    },
    update(root) { const s = P.sim, st = P.Program.stats(s.plc.program); U.setK(root, 'ar-scan', `scan time ${s.plc.scanMs} ms \u00b7 ${s.plc.scanCount} scans \u00b7 last scan ${s.plc.lastScanMs.toFixed(2)} ms`); U.setK(root, 'ar-mb', `polls: ${Math.floor(s.simMs / 1000)} \u00b7 tags mapped: ${P.Eng.modbusMap(s.tags).map.coils.length + P.Eng.modbusMap(s.tags).map.di.length + P.Eng.modbusMap(s.tags).map.ir.length + P.Eng.modbusMap(s.tags).map.hr.length}`); U.setK(root, 'ar-pr', `${st.sections} sections \u00b7 ${st.rungs} rungs \u00b7 ${st.elements} elements \u00b7 ${s.tags.list.length} tags`); }
  });

  /* ============================== project documentation ============================== */
  const REPORT = () => {
    const s = P.sim, st = P.Program.stats(s.plc.program), T = s.tags, io = { di: 0, ai: 0, do_: 0, ao: 0 };
    T.list.forEach(x => { if (/^%IX/.test(x.addr)) io.di++; else if (/^%IW/.test(x.addr)) io.ai++; else if (/^%QX/.test(x.addr)) io.do_++; else if (/^%QW/.test(x.addr)) io.ao++; });
    return [
      ['Smart Beverage Filling & Packaging Plant - Web-based PLC + HMI/SCADA Simulator', 'Design report and project summary', 'Author: Zaheer Abbas, Electrical Engineer (FAST-NUCES) - PLC, SCADA/HMI, industrial automation'],
      ['1. Purpose', 'This portfolio project demonstrates industrial automation engineering in a browser: a PLC scan-cycle engine with an editable ladder editor, a physical process model of a beverage plant, and an ISA-101 style HMI/SCADA with ISA-18.2 alarm management. It is a static website (HTML, CSS, vanilla JavaScript) and needs no backend or build step.'],
      ['2. Process', 'Syrup and water tanks -> batch mixing with weighing -> heating / pasteurization (PID) -> filling -> capping -> conveyor -> inspection and reject -> labeling -> carton packing -> palletizing and wrapping. Support functions: tank level control, gas detection, barcode counting, energy monitoring.'],
      ['3. PLC program', `The default program has ${st.sections} sections, ${st.rungs} rungs and ${st.elements} elements, executed as read inputs -> logic -> write outputs every ${s.plc.scanMs} ms of simulated time. Main sequence (state machine on SEQ_STEP): idle, pre-check, dose syrup, dose water, mix, transfer, heat-up, hold, produce, batch complete. Function blocks: contacts, coils, set/reset, TON/TOF/TP, CTU/CTD, comparators, math, PID. Programs can be edited online with a compile check (undefined tags, duplicate coils, type mismatches) and saved/loaded as JSON.`],
      ['4. I/O and tags', `${T.list.filter(x => !x.aux).length} tags: ${io.di} digital inputs, ${io.ai} analog inputs, ${io.do_} digital outputs, ${io.ao} analog outputs, plus memory bits, integers and reals for commands, recipes and calculations. Tags are fully editable with CSV import/export and a force table.`],
      ['5. Control philosophy', 'AUTO runs the sequence; MANUAL allows individual equipment commands from faceplates. Safety trips (E-stop, power loss, gas high-high, over-temperature, over-pressure, sensor failure) latch TRIP and de-energise all outputs; local interlocks (tank empty, overload, jam) only inhibit the affected equipment. The filling line runs stop-and-go: the conveyor holds while a station works.'],
      ['6. Alarm philosophy (ISA-18.2)', `${s.alarms.defs.length} alarms with four priorities (Critical, High, Medium, Low), on-delay and deadband, acknowledge states, shelving, suppression by design, first-out detection and flood detection (> 10 alarms / 10 min). KPIs: alarms per hour, top 5, average acknowledge time, stale alarms.`],
      ['7. HMI / SCADA', 'Overview, P&ID, tank and mixing, heating, filling and conveyor, inspection and packaging, alarms, trends, energy and KPIs, equipment health, maintenance, production and traceability, quality (SPC), downtime Pareto, bottleneck analysis, reports, I/O and PLC logic, PID tuning, Modbus map, cause and effect, audit trail, documentation, training. Roles: Operator, Engineer, Admin. Light/dark theme, English/Urdu, mobile operator panel, screen lock and auto-logout.'],
      ['8. Verification', 'tests.html runs automated checks of the PLC engine (timers, counters, latches, PID, interlocks, forces, compiler) and of the plant (start sequence, dosing, counters, e-stop, gas, over-temperature, sensor failure, power loss, alarm state machine, production layer).'],
      ['9. Limitations', 'This is a simulator: the physics are simplified, timing is simulated time, Modbus is simulated in the browser and the demo logins are not real security. Data stays in the browser.']
    ];
  };
  P.defScreen({
    id: 'projdoc', title: 'Project Documentation', group: 'Learn', icon: '\ud83d\udcc4',
    build(root) {
      const R = REPORT();
      const pdf = () => { const lines = []; R.forEach((s, i) => { if (i === 0) { s.forEach(l => lines.push(l)); lines.push(''); } else { lines.push(s[0].toUpperCase()); for (let k = 1; k < s.length; k++) lines.push(s[k]); lines.push(''); } }); U.download('beverage-plant-design-summary.pdf', P.Eng.makePDF('Smart Beverage Plant - design summary', lines), 'application/pdf'); };
      root.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: pdf }, '\u2b07 Download PDF summary'), h('button', { class: 'btn', onclick: () => window.print() }, '\ud83d\udda8 Print design report'), h('a', { class: 'btn', style: { textDecoration: 'none' }, href: '../tests.html', target: '_blank' }, 'Open self-test page')),
        h('div', { class: 'card' }, h('h2', null, R[0][0]), h('p', null, R[0][1]), h('p', { class: 'hint' }, R[0][2]), R.slice(1).map(s => h('div', null, h('h3', null, s[0]), h('p', null, s[1])))));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
