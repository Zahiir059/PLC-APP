/* ==========================================================================
   screens-operate.js - Operate group: Plant Overview, P&ID, Tanks & Mixing,
   Heating, Filling & Conveyor, Inspection & Packaging, Operator Panel
   Graphics follow ISA-101: grey equipment, colour only for state/abnormal.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT, U = P.UI, h = U.h, t = P.t, fmt = U.fmt;
  const V = n => P.sim.tags.get(n);

  /* ------------------------------ SVG symbol library (ISA-style) ------------------------------ */
  const G = {
    tank(x, y, w, hh, tag, label, opts) {
      opts = opts || {};
      return `<g><rect class="vessel" x="${x}" y="${y}" width="${w}" height="${hh}" rx="8"/><rect class="liq" data-lvl="${tag}" data-h="${hh - 6}" data-y="${y + 3}" x="${x + 3}" y="${y + 3}" width="${w - 6}" height="0"/>` +
        `<text class="tagl" x="${x + w / 2}" y="${y - 6}" text-anchor="middle">${label}</text>` +
        (opts.unit ? `<text class="val" x="${x + w / 2}" y="${y + hh / 2 + 4}" text-anchor="middle" data-v="${tag}" data-d="${opts.d === undefined ? 0 : opts.d}"></text><text class="sm" x="${x + w / 2}" y="${y + hh / 2 + 17}" text-anchor="middle">${opts.unit}</text>` : '') + '</g>';
    },
    pump(x, y, fp, tag, label) {
      return `<g data-fp="${fp}" data-click="1"><circle class="eq" data-st="${tag}" cx="${x}" cy="${y}" r="15"/><polygon points="${x - 7},${y - 8} ${x - 7},${y + 8} ${x + 10},${y}" fill="#fff" opacity=".85" pointer-events="none"/><text class="sm" x="${x}" y="${y + 29}" text-anchor="middle">${label}</text></g>`;
    },
    valve(x, y, fp, tag, label) {
      return `<g data-fp="${fp}" data-click="1"><polygon class="valve" data-st="${tag}" points="${x - 11},${y - 8} ${x + 11},${y + 8} ${x + 11},${y - 8} ${x - 11},${y + 8}"/><text class="sm" x="${x}" y="${y + 22}" text-anchor="middle">${label}</text></g>`;
    },
    /** ISA instrument bubble. tag like LT-101; value from process tag */
    inst(x, y, name, tag, d, unit) {
      return `<g><circle class="bub" cx="${x}" cy="${y}" r="17"/><line x1="${x - 17}" y1="${y}" x2="${x + 17}" y2="${y}" stroke="var(--eq-dk)"/><text class="tagl" x="${x}" y="${y - 3}" text-anchor="middle" style="font-size:9.5px">${name.split('-')[0]}</text><text class="sm" x="${x}" y="${y + 11}" text-anchor="middle" style="font-size:9.5px">${name.split('-')[1]}</text>` +
        `<text class="val" x="${x}" y="${y + 32}" text-anchor="middle" data-v="${tag}" data-d="${d}"></text>${unit ? `<text class="sm" x="${x}" y="${y + 43}" text-anchor="middle">${unit}</text>` : ''}</g>`;
    },
    pipe(d, st) { return `<path class="pipe${st ? ' flow' : ''}" ${st ? `data-st="${st}" data-cls="anim"` : ''} d="${d}"/>`; },
    lamp(x, y, tag, cls, label) { return `<g><circle class="lamp ${cls || ''}" data-st="${tag}" cx="${x}" cy="${y}" r="7"/><text class="sm" x="${x + 12}" y="${y + 4}">${label}</text></g>`; }
  };
  P.G = G;

  /** operator button strip used on several screens */
  function opButtons() {
    const T = P.sim.tags;
    const auto = h('div', { class: 'seg' }, h('button', { id: 'bt-auto', onclick: () => { T.set('M_AUTO', true, 'hmi'); P.bus.emit('audit', { action: 'COMMAND', detail: 'Mode AUTO' }); } }, t('Auto')), h('button', { id: 'bt-man', onclick: () => { T.set('M_AUTO', false, 'hmi'); P.bus.emit('audit', { action: 'COMMAND', detail: 'Mode MANUAL' }); } }, t('Manual')));
    const el = h('div', { class: 'opbtns no-print' },
      h('button', { class: 'btn start', onclick: () => { if (!T.get('M_AUTO')) U.toast('Plant is in Manual: switch to Auto to run the sequence', 'warn'); P.Op.pulse('M_START', 'Start'); } }, '\u25b6 ' + t('Start')),
      h('button', { class: 'btn stopb', onclick: () => P.Op.pulse('M_STOP', 'Stop') }, '\u25a0 ' + t('Stop')),
      h('button', { class: 'btn estop', id: 'bt-estop', onclick: () => P.Op.estop() }, t('E-STOP')),
      h('button', { class: 'btn', onclick: () => P.Op.pulse('M_RESET', 'Reset') }, '\u21ba ' + t('Reset')),
      auto,
      h('button', { class: 'btn bad', title: 'Abort the current batch and drain the vessels', onclick: async () => { if (await U.confirmBox('Abort the current batch? Product in the vessels is drained.', 'Abort batch')) P.Op.abort(); } }, 'Abort batch'));
    el.update = () => {
      const T2 = P.sim.tags; el.querySelector('#bt-auto').classList.toggle('on', T2.get('M_AUTO')); el.querySelector('#bt-man').classList.toggle('on', !T2.get('M_AUTO'));
      const es = el.querySelector('#bt-estop'); es.textContent = P.sim.plant.estopPressed ? 'E-STOP ACTIVE - release' : t('E-STOP');
    };
    return el;
  }
  const stepName = n => ({ 0: 'IDLE', 10: 'PRE-CHECK', 20: 'DOSE SYRUP', 30: 'DOSE WATER', 40: 'MIX', 50: 'TRANSFER', 60: 'HEAT-UP', 70: 'HOLD', 80: 'PRODUCE', 90: 'BATCH COMPLETE' }[n] || String(n));
  P.stepName = stepName;
  const kpi = (label, id, unit) => h('div', { class: 'card kpi' }, h('div', { class: 'v', id }, '-'), h('div', { class: 'l' }, label + (unit ? ' (' + unit + ')' : '')));
  const setK = (root, id, txt) => { const e = root.querySelector('#' + id); if (e && e.textContent !== txt) e.textContent = txt; };

  /* --------------------------------- mini live trend helper (uses historian memory) --------------------------------- */
  P.histSource = keys => (t0, t1, n) => P.Hist.range(t0, t1, n).map(s => Object.assign({}, s));
  const recent = (root, id, series, span, title, height) => {
    const cv = h('canvas', { class: 'chart', id }); const ch = new P.Charts.TimeChart(cv, { height: height || 180, series, span, source: P.histSource(), now: () => P.sim.clock(), title });
    return { cv, ch };
  };

  /* ================================ PLANT OVERVIEW ================================ */
  const CX = m => 330 + m * 180;
  P.defScreen({
    id: 'overview', title: 'Plant Overview', group: 'Operate', icon: '\u25a3',
    build(root) {
      const D = P.DIM, svg = `<svg class="pg" viewBox="0 0 1300 440" role="img" aria-label="Animated plant overview">
      ${G.pipe('M75 170 V200 H200 V170')}${G.pipe('M165 170 V210 H200')}${G.pipe('M200 200 H260 V150', 'Q_P101,Q_P102')}${G.pipe('M300 215 V240 H420 V150', 'Q_P103')}${G.pipe('M450 215 V250 H560 V150', 'Q_P104')}
      ${G.tank(30, 50, 70, 120, 'AI_LT101', 'T-101 Syrup', { unit: '%' })}${G.tank(120, 50, 70, 120, 'AI_LT102', 'T-102 Water', { unit: '%' })}
      ${G.tank(240, 60, 80, 150, 'AI_WT103', 'T-103 Mixer', { unit: '' })}<text class="val" x="280" y="145" text-anchor="middle" data-v="AI_WT103">0</text><text class="sm" x="280" y="158" text-anchor="middle">kg</text>
      <rect class="eq" data-st="Q_AGIT" x="271" y="40" width="18" height="16" rx="3" data-fp="AGIT"/>
      ${G.tank(380, 60, 90, 150, 'AI_LT201', 'T-201 Pasteurizer')}<text class="val" x="425" y="135" text-anchor="middle" data-v="AI_TT201">0</text><text class="sm" x="425" y="148" text-anchor="middle">\u00b0C</text>
      <rect class="heat" data-st="Q_HEATER" x="392" y="196" width="66" height="8" rx="3"/>
      ${G.tank(520, 100, 70, 100, 'AI_LT301', 'T-301 Filler bowl', { unit: '%' })}
      ${G.valve(75, 205, 'XV101', 'Q_XV101', 'XV-101')}${G.valve(165, 205, 'XV102', 'Q_XV102', 'XV-102')}
      ${G.pump(220, 232, 'P101', 'Q_P101', 'P-101')}${G.pump(260, 250, 'P102', 'Q_P102', 'P-102')}${G.pump(345, 262, 'P103', 'Q_P103', 'P-103')}${G.pump(500, 262, 'P104', 'Q_P104', 'P-104')}
      <g id="stations">
        <rect class="eq" data-st="Q_FILL" x="${CX(D.FILL_X) - 22}" y="215" width="44" height="46" rx="4"/><text class="sm" x="${CX(D.FILL_X)}" y="212" text-anchor="middle">Filler</text>
        <rect class="eq" data-st="Q_CAP" x="${CX(D.CAP_X) - 22}" y="215" width="44" height="46" rx="4"/><text class="sm" x="${CX(D.CAP_X)}" y="212" text-anchor="middle">Capper</text>
        <rect class="eq" data-st="Q_REJ1" data-cls="fault" x="${CX(D.INSP_X) - 22}" y="215" width="44" height="46" rx="4"/><text class="sm" x="${CX(D.INSP_X)}" y="212" text-anchor="middle">Inspect</text>
        <rect class="eq" data-st="Q_LABEL" x="${CX(D.LBL_X) - 22}" y="215" width="44" height="46" rx="4"/><text class="sm" x="${CX(D.LBL_X)}" y="212" text-anchor="middle">Labeler</text>
        <rect class="eq" data-st="Q_REJ2" data-cls="fault" x="${CX(D.LCHK_X) - 22}" y="215" width="44" height="46" rx="4"/><text class="sm" x="${CX(D.LCHK_X)}" y="212" text-anchor="middle">Label chk</text>
        <rect class="eq" data-st="Q_CARTON" x="${CX(D.END_X) + 4}" y="270" width="60" height="62" rx="4"/><text class="sm" x="${CX(D.END_X) + 34}" y="266" text-anchor="middle">Carton</text>
        <rect class="eq" data-st="Q_PALLETIZER" x="1180" y="270" width="64" height="62" rx="4"/><text class="sm" x="1212" y="266" text-anchor="middle">Palletizer</text>
        <rect class="eq" data-st="Q_WRAP" x="1180" y="344" width="64" height="40" rx="4"/><text class="sm" x="1212" y="378" text-anchor="middle" style="fill:#fff">Wrap</text>
      </g>
      <rect class="belt" x="${CX(0) - 20}" y="326" width="${CX(D.END_X) - CX(0) + 44}" height="10" rx="4"/><rect data-st="Q_CONV" data-cls="on" class="eq" x="${CX(0) - 44}" y="318" width="22" height="26" rx="4" data-fp="CONV"/><text class="sm" x="${CX(0) - 33}" y="358" text-anchor="middle">M-401</text>
      <g id="cans"></g><g id="cartons"></g>
      <text class="tagl" x="30" y="400">Sequence step: <tspan data-v="SEQ_STEP" data-d="0"></tspan></text>
      ${G.lamp(900, 400, 'Q_LAMP_G', '', 'Running')}${G.lamp(990, 400, 'Q_LAMP_A', 'amb', 'Alarm')}${G.lamp(1070, 400, 'Q_LAMP_R', 'red', 'Trip')}
      <text class="tagl" x="1212" y="404" text-anchor="middle" data-v="PALLET_CNT.CV" data-d="0"></text><text class="sm" x="1212" y="418" text-anchor="middle">pallets</text></svg>`;
      this.ops = opButtons();
      root.append(h('div', { class: 'toolbar' }, this.ops), h('div', { html: svg }),
        h('div', { class: 'grid g4', style: { marginTop: '12px' } }, kpi(t('Cans filled'), 'k-fill'), kpi(t('Rejected'), 'k-rej'), kpi(t('Cartons'), 'k-ctn'), kpi('Step', 'k-step'),
          kpi('Rate', 'k-rate', 'cans/min'), kpi('Order', 'k-ord'), kpi('OEE', 'k-oee', '%'), kpi(t('Power'), 'k-kw', 'kW')));
      P.pidClick(root); this.root = root; this.cansG = root.querySelector('#cans'); this.ctnG = root.querySelector('#cartons'); this.pool = [];
    },
    update(root) {
      this.ops.update(); P.bind(root);
      const pl = P.sim.plant, D = P.DIM, g1 = this.cansG;
      while (this.pool.length < pl.cans.length) { const c = document.createElementNS('http://www.w3.org/2000/svg', 'g'); c.innerHTML = '<rect x="-6" y="-12" width="12" height="24" rx="3" class="can"/><rect x="-6" y="-12" width="12" height="4" class="cap" fill="#555"/>'; g1.appendChild(c); this.pool.push(c); }
      this.pool.forEach((el, i) => {
        const c = pl.cans[i]; if (!c) { el.style.display = 'none'; return; } el.style.display = '';
        el.setAttribute('transform', `translate(${CX(c.x)} 316)`); const body = el.firstChild, cap = el.lastChild;
        const f = Math.min(1, c.ml / c.target); body.style.fill = f > 0.05 ? `color-mix(in srgb, var(--liquid) ${Math.round(f * 100)}%, #c9d0d6)` : ''; cap.style.display = c.capped ? '' : 'none';
        body.style.stroke = c.labeled ? 'var(--accent)' : ''; body.style.strokeWidth = c.labeled ? 2.5 : '';
      });
      const o = P.sim.prod.oee(), ord = P.sim.prod.orderProgress();
      setK(root, 'k-fill', String(V('FILL_CNT.CV'))); setK(root, 'k-rej', String(pl.totalRejects())); setK(root, 'k-ctn', String(V('BARCODE_CNT.CV')));
      setK(root, 'k-step', stepName(V('SEQ_STEP'))); setK(root, 'k-rate', fmt(P.sim.prod.rate(), 0)); setK(root, 'k-ord', ord.done + ' / ' + ord.target); setK(root, 'k-oee', fmt(o.oee * 100, 0)); setK(root, 'k-kw', fmt(pl.powerKW, 0));
    }
  });

  /* ================================ P&ID ================================ */
  P.defScreen({
    id: 'pid', title: 'P&ID Process', group: 'Operate', icon: '\u2699',
    build(root) {
      const svg = `<svg class="pg" viewBox="0 0 1240 560" role="img" aria-label="P&ID of the beverage process">
      <text class="tagl" x="20" y="24" style="font-size:14px">Beverage batching and pasteurization - P&amp;ID (live)</text>
      <!-- supply tanks -->
      ${G.tank(60, 80, 90, 150, 'AI_LT101', 'T-101 Syrup tank')}${G.tank(250, 80, 90, 150, 'AI_LT102', 'T-102 Water tank')}
      ${G.inst(30, 120, 'LT-101', 'AI_LT101', 0, '%')}${G.inst(370, 120, 'LT-102', 'AI_LT102', 0, '%')}
      ${G.pipe('M105 20 V80')}${G.valve(105, 52, 'XV101', 'Q_XV101', 'XV-101')}<text class="sm" x="112" y="14">Syrup supply</text>
      ${G.pipe('M295 20 V80')}${G.valve(295, 52, 'XV102', 'Q_XV102', 'XV-102')}<text class="sm" x="302" y="14">Water supply</text>
      ${G.pipe('M105 230 V270 H180', 'Q_P101')}${G.pump(130, 270, 'P101', 'Q_P101', 'P-101')}${G.valve(210, 270, 'XV103', 'Q_XV103', 'XV-103')}
      ${G.pipe('M295 230 V320 H180 V300', 'Q_P102')}${G.pump(240, 320, 'P102', 'Q_P102', 'P-102')}${G.valve(180, 330, 'XV104', 'Q_XV104', 'XV-104')}
      ${G.pipe('M225 270 H460 V240', 'Q_P101')}
      <!-- mixing tank -->
      ${G.tank(420, 100, 110, 140, 'AI_WT103', 'T-103 Mixing tank')}<text class="val" x="475" y="175" text-anchor="middle" data-v="AI_WT103">0</text><text class="sm" x="475" y="189" text-anchor="middle">kg</text>
      ${G.inst(580, 150, 'WT-103', 'AI_WT103', 1, 'kg')}
      <rect class="eq" data-st="Q_AGIT" x="466" y="70" width="18" height="30" rx="3" data-fp="AGIT" data-click="1"/><line x1="475" y1="100" x2="475" y2="205" stroke="var(--eq-dk)" stroke-width="3"/><text class="sm" x="475" y="64" text-anchor="middle">M-103</text>
      ${G.pipe('M475 240 V300 H640', 'Q_P103')}${G.valve(520, 300, 'XV105', 'Q_XV105', 'XV-105')}${G.pump(600, 300, 'P103', 'Q_P103', 'P-103')}
      <!-- pasteurizer -->
      ${G.tank(660, 100, 120, 200, 'AI_LT201', 'T-201 Pasteurizer')}<text class="val" x="720" y="190" text-anchor="middle" data-v="AI_TT201">0</text><text class="sm" x="720" y="204" text-anchor="middle">\u00b0C</text>
      <rect class="heat" data-st="Q_HEATER" x="672" y="280" width="96" height="12" rx="4"/><text class="sm" x="720" y="318" text-anchor="middle">E-201 heater</text>
      ${G.inst(830, 130, 'TT-201', 'AI_TT201', 1, '\u00b0C')}${G.inst(830, 215, 'PT-201', 'AI_PT201', 2, 'bar')}${G.inst(830, 300, 'LT-201', 'AI_LT201', 0, '%')}
      <!-- TIC loop bubble -->
      <circle class="bub" cx="905" cy="130" r="20"/><text class="tagl" x="905" y="127" text-anchor="middle" style="font-size:9.5px">TIC</text><text class="sm" x="905" y="140" text-anchor="middle" style="font-size:9.5px">201</text>
      <line x1="847" y1="130" x2="885" y2="130" stroke="var(--eq-dk)" stroke-dasharray="4 3"/><path d="M905 150 V330 H772" fill="none" stroke="var(--eq-dk)" stroke-dasharray="4 3"/>
      <text class="val" x="905" y="168" text-anchor="middle" data-v="AO_HEATER" data-d="0"></text><text class="sm" x="905" y="180" text-anchor="middle">% out</text>
      <text class="sm" x="905" y="200" text-anchor="middle">SP</text><text class="val" x="905" y="214" text-anchor="middle" data-v="TT_SP" data-d="0"></text>
      <!-- to filler -->
      ${G.pipe('M720 300 V420 H960', 'Q_P104')}${G.pump(880, 420, 'P104', 'Q_P104', 'P-104')}
      ${G.tank(960, 360, 110, 120, 'AI_LT301', 'T-301 Filler bowl')}${G.inst(1120, 400, 'LT-301', 'AI_LT301', 0, '%')}
      <text class="sm" x="1010" y="508">to filling line \u2192</text>
      <!-- gas detector and E-stop -->
      <g><circle class="bub" data-fault="I_GAS_ALARM" cx="1180" cy="60" r="17"/><text class="tagl" x="1180" y="57" text-anchor="middle" style="font-size:9.5px">AT</text><text class="sm" x="1180" y="70" text-anchor="middle" style="font-size:9.5px">701</text><text class="val" x="1180" y="92" text-anchor="middle" data-v="AI_GAS_PPM" data-d="0"></text><text class="sm" x="1180" y="104" text-anchor="middle">ppm gas</text></g>
      ${G.lamp(1120, 160, 'Q_LAMP_R', 'red', 'Trip')}${G.lamp(1120, 185, 'Q_HORN', 'amb', 'Horn')}
      <text class="sm" x="20" y="540">Symbols: circle+triangle = pump, bow-tie = valve, bubble = instrument (ISA-5.1). Equipment is grey; green = running/open. Click any pump, valve or the heater for its faceplate.</text></svg>`;
      root.append(h('div', { class: 'toolbar' }, (this.ops = opButtons())), h('div', { html: svg }));
      root.querySelector('svg').insertAdjacentHTML('beforeend', '');
      // heater faceplate click
      root.querySelector('.heat').addEventListener('click', () => P.faceplate('HEATER')); root.querySelector('.heat').style.cursor = 'pointer';
      P.pidClick(root);
    },
    update(root) { this.ops.update(); P.bind(root); }
  });

  /* ================================ TANKS & MIXING ================================ */
  P.defScreen({
    id: 'tanks', title: 'Tanks & Mixing', group: 'Operate', icon: '\u2b13',
    build(root) {
      const svg = `<svg class="pg" viewBox="0 0 640 380">
        ${G.tank(40, 40, 100, 160, 'AI_LT101', 'T-101 Syrup', { unit: '%' })}${G.tank(190, 40, 100, 160, 'AI_LT102', 'T-102 Water', { unit: '%' })}
        ${G.valve(90, 20, 'XV101', 'Q_XV101', 'XV-101')}${G.valve(240, 20, 'XV102', 'Q_XV102', 'XV-102')}
        ${G.pipe('M90 200 V250 H370 V232', 'Q_P101')}${G.pipe('M240 200 V280 H370', 'Q_P102')}
        ${G.pump(90, 250, 'P101', 'Q_P101', 'P-101')}${G.valve(160, 250, 'XV103', 'Q_XV103', 'XV-103')}${G.pump(240, 280, 'P102', 'Q_P102', 'P-102')}${G.valve(300, 280, 'XV104', 'Q_XV104', 'XV-104')}
        ${G.tank(320, 70, 130, 160, 'AI_WT103', 'T-103 Mixing tank')}<text class="val" x="385" y="150" text-anchor="middle" data-v="AI_WT103">0</text><text class="sm" x="385" y="164" text-anchor="middle">kg</text>
        <rect class="eq" data-st="Q_AGIT" x="376" y="36" width="18" height="30" rx="3" data-fp="AGIT" data-click="1"/><text class="sm" x="385" y="30" text-anchor="middle">Agitator M-103</text>
        ${G.pipe('M450 200 H540', 'Q_P103')}${G.valve(480, 200, 'XV105', 'Q_XV105', 'XV-105')}${G.pump(520, 200, 'P103', 'Q_P103', 'P-103')}<text class="sm" x="590" y="204">to T-201</text></svg>`;
      const rsel = h('select', { id: 'recsel', onchange: e => { const r = P.sim.prod.recipeById(parseInt(e.target.value)); if (!P.sim.prod.applyRecipe(r)) { U.toast('Recipe is locked while a batch is in progress (steps 20-80)', 'warn'); this.fill(); } else P.bus.emit('audit', { action: 'RECIPE_SELECT', detail: r.name }); } });
      this.rsel = rsel; this.fill = () => { rsel.innerHTML = ''; P.sim.prod.recipes.forEach(r => rsel.appendChild(h('option', { value: r.id }, r.name))); rsel.value = String(V('REC_ID')); }; this.fill();
      root.append(h('div', { class: 'toolbar' }, (this.ops = opButtons())), h('div', { class: 'grid g2' }, h('div', { html: svg }),
        h('div', { class: 'card' }, h('h3', null, t('Recipe') + ' / Batch'), h('div', { class: 'form-row' }, h('label', null, t('Recipe')), rsel), h('table', { class: 'tbl', id: 'rt' }),
          h('div', { style: { margin: '8px 0' } }, h('div', { class: 'hint' }, 'Dosing progress (weight vs target)'), h('div', { class: 'bar', id: 'dbar' }, h('i'))),
          h('div', { class: 'hint' }, 'Manual mode: click a pump or valve to open its faceplate and start/stop it (interlocks still apply).'))));
      P.pidClick(root);
    },
    update(root) {
      this.ops.update(); P.bind(root); const rt = root.querySelector('#rt');
      const rows = [['Product', P.sim.prod.currentRecipe().name], ['Batch size', fmt(V('REC_BATCH_KG'), 0) + ' kg'], ['Syrup ratio', fmt(V('REC_SYRUP_PCT'), 1) + ' %  (target ' + fmt(V('SYRUP_TARGET_KG'), 1) + ' kg)'], ['Sequence step', V('SEQ_STEP') + ' ' + stepName(V('SEQ_STEP'))], ['Mixer weight', fmt(V('AI_WT103'), 1) + ' kg'], ['Syrup tank / water tank', fmt(V('AI_LT101'), 0) + ' % / ' + fmt(V('AI_LT102'), 0) + ' %'], ['Batch counter', String(V('BATCH_CNT.CV'))]];
      const html = rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td></tr>`).join(''); if (rt._h !== html) { rt._h = html; rt.innerHTML = html; }
      const st = V('SEQ_STEP'), tgt = st <= 20 ? V('SYRUP_TARGET_KG') : V('REC_BATCH_KG'); root.querySelector('#dbar i').style.width = Math.min(100, tgt ? 100 * V('AI_WT103') / tgt : 0) + '%';
      if (document.activeElement !== this.rsel && this.rsel.value !== String(V('REC_ID'))) this.rsel.value = String(V('REC_ID'));
    }
  });

  /* ================================ HEATING / PASTEURIZATION ================================ */
  P.defScreen({
    id: 'heating', title: 'Heating / Pasteurization', group: 'Operate', icon: '\u2668',
    build(root) {
      const svg = `<svg class="pg" viewBox="0 0 420 340">${G.tank(130, 50, 140, 220, 'AI_LT201', 'T-201 Pasteurizer')}<text class="val" x="200" y="140" text-anchor="middle" data-v="AI_TT201" style="font-size:20px">0</text><text class="sm" x="200" y="158" text-anchor="middle">\u00b0C</text>
        <rect class="heat" data-st="Q_HEATER" x="144" y="250" width="112" height="14" rx="5" data-fp="HEATER" data-click="1"/><text class="sm" x="200" y="290" text-anchor="middle">Heater E-201 (click for faceplate)</text>
        ${G.inst(330, 90, 'TT-201', 'AI_TT201', 1, '\u00b0C')}${G.inst(330, 180, 'PT-201', 'AI_PT201', 2, 'bar')}</svg>`;
      const mk = (id, l, u) => h('div', { class: 'card kpi' }, h('div', { class: 'v', id }, '-'), h('div', { class: 'l' }, l + (u ? ' (' + u + ')' : '')));
      const sp = h('input', { type: 'number', step: 0.5, style: { width: '90px' }, onchange: e => P.Op.set('TT_SP', parseFloat(e.target.value) || 0, 'TT_SP (pasteurization setpoint)') }); this.sp = sp;
      const tr = recent(root, 'c-heat', [{ key: 'tt', label: 'PV TT-201', color: '#c8102e' }, { key: 'sp', label: 'SP', color: '#1f5f8b', dash: true }, { key: 'heat', label: 'Heater %', color: '#e07b00', axis: 1, min: 0, max: 100 }], 180000, 'Temperature loop', 200);
      this.ch = tr.ch; this.sp.dataset.pv = 1;
      root.append(h('div', { class: 'toolbar' }, (this.ops = opButtons())), h('div', { class: 'grid g2' }, h('div', { html: svg }),
        h('div', { class: 'grid g2' }, mk('h-pv', t('Process value'), '\u00b0C'), h('div', { class: 'card' }, h('div', { class: 'l hint' }, t('Setpoint') + ' (\u00b0C)'), sp, h('div', { class: 'hint' }, 'Written to TT_SP (audited)')), mk('h-out', t('Output'), '%'), mk('h-pr', t('Pressure'), 'bar'), mk('h-st', t('Status'), ''), mk('h-hold', 'Hold timer', 's'))),
        h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'legend' }, [['PV TT-201', '#c8102e'], ['Setpoint', '#1f5f8b'], ['Heater output %', '#e07b00']].map(l => h('span', null, h('i', { style: { background: l[1] } }), l[0])), h('small', null, 'wheel = zoom, drag = pan, double-click = live')), tr.cv));
      P.pidClick(root); setTimeout(() => this.ch.draw(), 30);
    },
    update(root) {
      this.ops.update(); P.bind(root); setK(root, 'h-pv', fmt(V('AI_TT201'), 1)); setK(root, 'h-out', fmt(V('AO_HEATER'), 0)); setK(root, 'h-pr', fmt(V('AI_PT201'), 2));
      setK(root, 'h-st', V('Q_HEATER') ? 'HEATING' : 'OFF' + (V('TRIP') ? ' (TRIP)' : '')); setK(root, 'h-hold', fmt(V('T_HOLD.ACC') / 1000, 0) + ' / ' + fmt(V('HOLD_MS') / 1000, 0));
      if (document.activeElement !== this.sp) this.sp.value = V('TT_SP'); this.ch.draw();
    }
  });

  /* ================================ FILLING & CONVEYOR ================================ */
  P.defScreen({
    id: 'filling', title: 'Filling & Conveyor', group: 'Operate', icon: '\u2b24',
    build(root) {
      const D = P.DIM, X = m => 40 + m * 150;
      const svg = `<svg class="pg" viewBox="0 0 760 300"><rect class="belt" x="20" y="210" width="${X(D.END_X) - 4}" height="12" rx="4"/>
        ${G.tank(300, 20, 90, 70, 'AI_LT301', 'Filler bowl', { unit: '%' })}
        <rect class="eq" data-st="Q_FILL" x="${X(D.FILL_X) - 24}" y="120" width="48" height="60" rx="4"/><text class="sm" x="${X(D.FILL_X)}" y="116" text-anchor="middle">Filler FV-301</text>
        <rect class="eq" data-st="Q_CAP" x="${X(D.CAP_X) - 24}" y="120" width="48" height="60" rx="4"/><text class="sm" x="${X(D.CAP_X)}" y="116" text-anchor="middle">Capper</text>
        <rect class="eq" data-st="Q_CONV" x="0" y="200" width="18" height="32" rx="3" data-fp="CONV" data-click="1"/>
        <g id="cans"></g>
        <text class="sm" x="${X(D.FILL_X)}" y="250" text-anchor="middle">PE-301</text><circle class="lamp" data-st="DI_PE301" cx="${X(D.FILL_X)}" cy="262" r="6"/>
        <text class="sm" x="${X(D.CAP_X)}" y="250" text-anchor="middle">PE-302</text><circle class="lamp" data-st="DI_PE302" cx="${X(D.CAP_X)}" cy="262" r="6"/>
        <text class="sm" x="${X(D.END_X) - 40}" y="250" text-anchor="middle">to inspection \u2192</text></svg>`;
      const sl = h('input', { type: 'range', min: 10, max: 100, step: 5, oninput: e => P.Op.set('CONV_SPEED_SP', parseFloat(e.target.value), 'Conveyor speed setpoint'), 'aria-label': 'Conveyor speed setpoint' }); this.sl = sl;
      const D2 = P.DIM; this.D = D2;
      root.append(h('div', { class: 'toolbar' }, (this.ops = opButtons())), h('div', { html: svg }),
        h('div', { class: 'grid g4', style: { marginTop: '12px' } }, kpi(t('Cans filled'), 'f-cnt'), kpi('Capped', 'f-cap'), kpi('Fill progress', 'f-prog', '%'), kpi(t('Speed'), 'f-spd', '%'), kpi('Motor current', 'f-amp', 'A'), kpi('Fill time', 'f-ft', 'ms')),
        h('div', { class: 'card', style: { marginTop: '12px' } }, h('h3', null, 'Conveyor speed (VFD)'), h('div', { class: 'form-row' }, h('span', null, 'Setpoint: '), h('b', { id: 'f-sp' }), '%', h('span', { style: { flex: 1 } }, sl)), h('div', { class: 'bar' }, h('i', { id: 'f-bar' })),
          h('div', { class: 'hint' }, 'Stop-and-go: the conveyor halts while the filler, capper or labeler works on a can (see ladder section Conveyor).')));
      P.pidClick(root); this.cansG = root.querySelector('#cans'); this.pool = [];
    },
    update(root) {
      this.ops.update(); P.bind(root); const pl = P.sim.plant, X = m => 40 + m * 150, g1 = this.cansG;
      while (this.pool.length < pl.cans.length) { const c = document.createElementNS('http://www.w3.org/2000/svg', 'g'); c.innerHTML = '<rect x="-7" y="-15" width="14" height="30" rx="3" class="can"/><rect x="-7" y="-15" width="14" height="5" fill="#555"/>'; g1.appendChild(c); this.pool.push(c); }
      this.pool.forEach((el, i) => { const c = pl.cans[i]; if (!c || X(c.x) > 740) { el.style.display = 'none'; return; } el.style.display = ''; el.setAttribute('transform', `translate(${X(c.x)} 194)`); const f = Math.min(1, c.ml / c.target); el.firstChild.style.fill = f > .05 ? `color-mix(in srgb, var(--liquid) ${Math.round(f * 100)}%, #c9d0d6)` : ''; el.lastChild.style.display = c.capped ? '' : 'none'; });
      setK(root, 'f-cnt', String(V('FILL_CNT.CV'))); setK(root, 'f-cap', String(V('CAP_CNT.CV'))); setK(root, 'f-spd', fmt(V('AI_CONV_SPD'), 0)); setK(root, 'f-amp', fmt(V('AI_CONV_AMP'), 1)); setK(root, 'f-ft', String(V('FILL_TIME_MS')));
      setK(root, 'f-prog', fmt(V('T_FILL.PRE') ? 100 * V('T_FILL.ACC') / V('T_FILL.PRE') : 0, 0)); setK(root, 'f-sp', fmt(V('CONV_SPEED_SP'), 0)); root.querySelector('#f-bar').style.width = V('AI_CONV_SPD') + '%';
      if (document.activeElement !== this.sl) this.sl.value = V('CONV_SPEED_SP');
    }
  });

  /* ================================ INSPECTION & PACKAGING ================================ */
  P.defScreen({
    id: 'inspect', title: 'Inspection & Packaging', group: 'Operate', icon: '\u25a4',
    build(root) {
      const pl = P.sim.plant; this.cv = h('canvas', { class: 'chart', id: 'c-rej' });
      root.append(h('div', { class: 'toolbar' }, (this.ops = opButtons())),
        h('div', { class: 'grid g4' }, kpi('Inspected', 'i-ins'), kpi(t('Rejected'), 'i-rej'), kpi(t('Reject rate'), 'i-rate', '% last 20'), kpi('Good cans packed', 'i-pk'), kpi('Labelled', 'i-lbl'), kpi('Barcode scans', 'i-bc'), kpi(t('Cartons') + ' on pallet', 'i-cp'), kpi(t('Pallets'), 'i-plt')),
        h('div', { class: 'grid g2', style: { marginTop: '12px' } },
          h('div', { class: 'card' }, h('h3', null, 'Reject reasons'), this.cv, h('div', { class: 'hint' }, 'Inspection rejects: underfill, no cap, high temperature. Label check rejects: label missing.')),
          h('div', { class: 'card' }, h('h3', null, 'Packaging line'), h('table', { class: 'tbl', id: 'pk' }),
            h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => { pl.refill('caps'); P.bus.emit('audit', { action: 'COMMAND', detail: 'Cap magazine refilled' }); U.toast('Cap magazine refilled'); } }, 'Refill caps'), h('button', { class: 'btn', onclick: () => { pl.refill('labels'); P.bus.emit('audit', { action: 'COMMAND', detail: 'Label reel replaced' }); U.toast('Label reel replaced'); } }, 'Replace label reel'), h('button', { class: 'btn', onclick: () => { pl.refill('cans'); U.toast('Can magazine refilled'); } }, 'Refill cans')),
            h('div', { class: 'hint' }, 'Carton packer counts cans (recipe cans/carton); barcode scanner counts cartons; palletizer stacks cartons per pallet then wraps.'))));
    },
    update(root) {
      const pl = P.sim.plant, r = pl.stats.rejects, labels = [], vals = [];
      Object.keys(r).forEach(k => { labels.push(P.REJ_LABEL[k]); vals.push(r[k]); }); P.Charts.bars(this.cv, { labels, values: vals, height: 190, colors: ['#e07b00', '#c8102e', '#7a1fa2', '#2f7fd1'], fmt: v => v });
      setK(root, 'i-ins', String(V('INSP_CNT.CV'))); setK(root, 'i-rej', String(pl.totalRejects())); setK(root, 'i-rate', fmt(pl.rejectRate(), 0)); setK(root, 'i-pk', String(V('CAN_PACKED.CV'))); setK(root, 'i-lbl', String(V('LBL_CNT.CV'))); setK(root, 'i-bc', String(V('BARCODE_CNT.CV')));
      setK(root, 'i-cp', V('CTN_PALLET.CV') + ' / ' + V('REC_CTN_PLT')); setK(root, 'i-plt', String(V('PALLET_CNT.CV')));
      const pk = root.querySelector('#pk'), rows = [['Cans in carton', V('CTN_CANS.CV') + ' / ' + V('REC_CANS_CTN')], ['Cap magazine', pl.caps + ' caps'], ['Label reel', pl.labels + ' labels'], ['Carton packer', V('Q_CARTON') ? 'PACKING' : 'idle'], ['Palletizer', V('Q_PALLETIZER') ? 'PLACING' : 'idle'], ['Wrapper', V('Q_WRAP') ? 'WRAPPING' : 'idle'], ['Cartons in transit', String(pl.cartons.length)]];
      const html = rows.map(x => `<tr><td>${x[0]}</td><td class="num">${x[1]}</td></tr>`).join(''); if (pk._h !== html) { pk._h = html; pk.innerHTML = html; }
      this.ops.update();
    }
  });

  /* ================================ OPERATOR PANEL (mobile friendly) ================================ */
  P.defScreen({
    id: 'panel', title: 'Operator Panel', group: 'Operate', icon: '\u260e',
    build(root) {
      const wrap = h('div', { class: 'opanel' }, h('div', { class: 'card' }, h('h3', null, 'Operator panel'), (this.ops = opButtons())),
        h('div', { class: 'grid g2', style: { marginTop: '10px' } }, kpi('Step', 'p-step'), kpi(t('Temperature'), 'p-tt', '\u00b0C'), kpi(t('Cans filled'), 'p-cnt'), kpi('Order', 'p-ord'), kpi('Syrup T-101', 'p-l1', '%'), kpi('Water T-102', 'p-l2', '%'), kpi(t('Speed'), 'p-spd', '%'), kpi('Active alarms', 'p-al')),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', style: { flex: 1, minHeight: '48px' }, onclick: () => { P.sim.alarms.ackAll(P.session.user); } }, t('Acknowledge all')), h('button', { class: 'btn', style: { flex: 1, minHeight: '48px' }, onclick: () => P.App.go('alarms') }, t('Alarms'))));
      root.append(wrap);
    },
    update(root) {
      this.ops.update(); setK(root, 'p-step', stepName(V('SEQ_STEP'))); setK(root, 'p-tt', fmt(V('AI_TT201'), 1)); setK(root, 'p-cnt', String(V('FILL_CNT.CV'))); const o = P.sim.prod.orderProgress(); setK(root, 'p-ord', o.done + '/' + o.target);
      setK(root, 'p-l1', fmt(V('AI_LT101'), 0)); setK(root, 'p-l2', fmt(V('AI_LT102'), 0)); setK(root, 'p-spd', fmt(V('AI_CONV_SPD'), 0)); setK(root, 'p-al', String(P.sim.alarms.activeList().filter(a => !a.shelved).length));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
