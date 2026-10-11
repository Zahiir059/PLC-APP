/* ==========================================================================
   screens-prod.js - Production group: orders + recipe manager, batches &
   traceability, quality (reject reasons, SPC), downtime (Pareto), bottleneck
   analysis, and printable / exportable reports.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT, U = P.UI, h = U.h, t = P.t, fmt = U.fmt, setK = U.setK, tile = U.tile, tabs = U.tabs;
  const V = n => P.sim.tags.get(n);

  /* ================================ PRODUCTION: ORDER + RECIPES ================================ */
  P.defScreen({
    id: 'prod', title: 'Production', group: 'Production', icon: '\u25a6',
    build(root) {
      const pr = P.sim.prod; this.sig = null;
      const rsel = h('select'), tgt = h('input', { type: 'number', min: 1, max: 5000, value: V('ORDER_TARGET'), style: { width: '110px' } });
      this.rsel = rsel; this.fill = () => { rsel.innerHTML = ''; pr.recipes.forEach(r => rsel.appendChild(h('option', { value: r.id }, r.name))); rsel.value = String(V('REC_ID')); }; this.fill();
      const start = () => {
        const r = pr.recipeById(parseInt(rsel.value)), n = parseInt(tgt.value) || 0; if (n < 1) return U.toast('Enter a target quantity', 'err');
        if (r.id !== V('REC_ID') && !pr.applyRecipe(r)) return U.toast('Recipe is locked while a batch is in progress. Finish or abort the batch first.', 'warn');
        pr.applyRecipe(r, true); pr.newOrder(n, P.session.user); P.Op.pulse('M_START', 'Start order'); U.toast('Order started: ' + r.name + ' x ' + n + ' cans', 'ok');
      };
      root.append(h('div', { class: 'grid g2' },
        h('div', { class: 'card' }, h('h3', null, t('Production order')), h('div', { class: 'form-row' }, h('label', null, t('Recipe')), rsel), h('div', { class: 'form-row' }, h('label', null, t('Target quantity') + ' (cans)'), tgt),
          h('div', { class: 'btnrow' }, h('button', { class: 'btn start', onclick: start }, '\u25b6 Start order'), h('button', { class: 'btn', onclick: () => { P.Op.pulse('M_NEW_ORDER', 'Reset order counters'); pr.newOrder(parseInt(tgt.value) || V('ORDER_TARGET'), P.session.user); } }, 'New order (reset counters)'), h('button', { class: 'btn stopb', onclick: () => P.Op.pulse('M_STOP', 'Stop') }, t('Stop'))),
          h('div', { class: 'hint' }, 'The plant stops automatically when the packed-can counter reaches the target (PLC rung "Order complete").'), h('div', { class: 'bar', id: 'ob', style: { margin: '10px 0 4px' } }, h('i')), h('div', { id: 'otxt', class: 'mono' })),
        h('div', { class: 'card' }, h('h3', null, 'Current order'), h('table', { class: 'tbl', id: 'ot' }))),
        h('div', { class: 'card', style: { marginTop: '12px' } }, h('h3', null, t('Recipes')), h('div', { class: 'toolbar' }, P.session.canEdit() ? h('button', { class: 'btn primary', onclick: () => this.edit(null) }, '+ New recipe') : h('small', null, 'Engineer or Admin can create and edit recipes')), (this.rt = h('div', { class: 'scroll', style: { maxHeight: 'none' } }))));
      this.tgt = tgt; this.renderRecipes();
    },
    edit(r) {
      const pr = P.sim.prod, isNew = !r, d = r ? Object.assign({}, r) : { id: pr.nextRecipeId(), name: 'New product', syrup: 18, temp: 85, fill: 330, cansCtn: 6, ctnPlt: 4, batchKg: 40, holdS: 10 };
      const f = [['name', 'Name', 'text'], ['syrup', 'Syrup ratio (kg per 100 kg)', 'number'], ['temp', 'Pasteurization temperature (\u00b0C)', 'number'], ['fill', 'Fill volume (ml)', 'number'], ['cansCtn', 'Cans per carton', 'number'], ['ctnPlt', 'Cartons per pallet', 'number'], ['batchKg', 'Batch size (kg)', 'number'], ['holdS', 'Hold time (s)', 'number']];
      const inputs = {}; const body = h('div', null, f.map(x => h('div', { class: 'fld' }, h('label', null, x[1]), (inputs[x[0]] = h('input', { type: x[2], value: d[x[0]], step: 'any' })))));
      U.modal({ title: isNew ? 'New recipe' : 'Edit recipe: ' + r.name, body, buttons: [{ label: t('Cancel') }, { label: t('Save'), primary: true, onclick: c => {
        const o = { id: d.id }; for (const x of f) { const v = inputs[x[0]].value; o[x[0]] = x[2] === 'number' ? parseFloat(v) : v.trim(); }
        if (!o.name) return U.toast('Name required', 'err');
        if (o.syrup <= 0 || o.syrup >= 60 || o.temp < 60 || o.temp > 94 || o.fill < 100 || o.fill > 1000 || o.cansCtn < 1 || o.ctnPlt < 1 || o.batchKg < 10 || o.batchKg > 90 || o.holdS < 1) return U.toast('Check ranges: syrup 1-59 %, temperature 60-94 \u00b0C, fill 100-1000 ml, batch 10-90 kg', 'err');
        if (isNew) pr.recipes.push(o); else Object.assign(r, o); pr.saveRecipes(); P.bus.emit('audit', { action: isNew ? 'RECIPE_CREATE' : 'RECIPE_EDIT', detail: o.name }); if (o.id === V('REC_ID')) pr.applyRecipe(pr.recipeById(o.id)); c(); this.sig = null; this.renderRecipes(); this.fill();
      } }] });
    },
    renderRecipes() {
      const pr = P.sim.prod, can = P.session.canEdit();
      this.rt.innerHTML = ''; this.rt.appendChild(h('table', { class: 'tbl' }, h('tr', null, ['Recipe', 'Syrup %', '\u00b0C', 'Fill ml', 'Cans/carton', 'Cartons/pallet', 'Batch kg', 'Hold s', ''].map(x => h('th', null, x))),
        pr.recipes.map(r => h('tr', null, h('td', null, h('b', null, r.name), r.id === V('REC_ID') ? h('span', { class: 'tag ok', style: { marginInlineStart: '6px' } }, 'selected') : ''), h('td', { class: 'num' }, r.syrup), h('td', { class: 'num' }, r.temp), h('td', { class: 'num' }, r.fill), h('td', { class: 'num' }, r.cansCtn), h('td', { class: 'num' }, r.ctnPlt), h('td', { class: 'num' }, r.batchKg), h('td', { class: 'num' }, r.holdS),
          h('td', null, h('button', { class: 'btn sm', onclick: () => { if (pr.applyRecipe(r)) { P.bus.emit('audit', { action: 'RECIPE_SELECT', detail: r.name }); this.sig = null; this.renderRecipes(); this.fill(); } else U.toast('Locked during a batch', 'warn'); } }, 'Select'), ' ',
            can ? [h('button', { class: 'btn sm', onclick: () => this.edit(r) }, t('Edit')), ' ', h('button', { class: 'btn sm', onclick: () => { const c = Object.assign({}, r, { id: pr.nextRecipeId(), name: r.name + ' (copy)' }); pr.recipes.push(c); pr.saveRecipes(); P.bus.emit('audit', { action: 'RECIPE_COPY', detail: r.name }); this.renderRecipes(); this.fill(); } }, t('Copy')), ' ',
              h('button', { class: 'btn sm bad', onclick: async () => { if (pr.recipes.length < 2) return U.toast('Keep at least one recipe', 'err'); if (r.id === V('REC_ID')) return U.toast('Cannot delete the selected recipe', 'err'); if (await U.confirmBox('Delete recipe "' + r.name + '"?')) { pr.recipes.splice(pr.recipes.indexOf(r), 1); pr.saveRecipes(); P.bus.emit('audit', { action: 'RECIPE_DELETE', detail: r.name }); this.renderRecipes(); this.fill(); } } }, t('Delete'))] : null)))));
    },
    update(root) {
      const pr = P.sim.prod, o = pr.orderProgress();
      root.querySelector('#ob i').style.width = o.pct + '%'; setK(root, 'otxt', o.done + ' / ' + o.target + ' cans (' + fmt(o.pct, 0) + ' %)' + (V('ORDER_DONE') ? ' - ORDER COMPLETE' : ''));
      const rows = [['Product', pr.currentRecipe().name], ['Sequence step', V('SEQ_STEP') + ' ' + P.stepName(V('SEQ_STEP'))], ['Batches started', V('BATCH_CNT.CV')], ['Cans packed (order)', V('CAN_PACKED.CV')], ['Cartons scanned', V('BARCODE_CNT.CV')], ['Pallets wrapped', V('PALLET_CNT.CV')], ['Recipe lock', pr.locked() ? 'LOCKED (batch in progress)' : 'open']];
      const ot = root.querySelector('#ot'), html = rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td></tr>`).join(''); if (ot._h !== html) { ot._h = html; ot.innerHTML = html; }
      const sig = pr.recipes.length + '|' + V('REC_ID'); if (sig !== this.sig) { this.sig = sig; this.renderRecipes(); }
    }
  });

  /* ================================ BATCHES & TRACEABILITY ================================ */
  P.defScreen({
    id: 'batches', title: 'Batches & Traceability', group: 'Production', icon: '\u29c9',
    build(root) {
      this.sel = null; this.sig = null;
      const q = h('input', { type: 'text', placeholder: 'Scan / enter a carton or pallet code (e.g. CTN-0001-0003)...', style: { minWidth: '320px' } });
      const out = h('div', { id: 'trace' });
      q.addEventListener('input', () => { this.query(q.value.trim(), out); });
      root.append(h('div', { class: 'card' }, h('h3', null, 'Batch records'), (this.bt = h('div', { class: 'scroll' }))), h('div', { class: 'grid g2', style: { marginTop: '12px' } },
        h('div', { class: 'card' }, h('h3', null, 'Genealogy of selected batch'), (this.gen = h('div'))),
        h('div', { class: 'card' }, h('h3', null, 'Barcode lookup (traceability)'), h('div', { class: 'toolbar' }, q), out, h('div', { class: 'hint' }, 'Each carton barcode is generated when the barcode scanner counter pulses and is linked to its batch, pallet, and ingredient lots.'))));
    },
    query(code, out) {
      const pr = P.sim.prod; out.innerHTML = ''; if (!code) return;
      const c = pr.cartons.find(x => x.code.toLowerCase() === code.toLowerCase()), p = pr.pallets.find(x => x.id.toLowerCase() === code.toLowerCase());
      if (c) { const b = pr.batches.find(x => x.id === c.batch); out.append(h('table', { class: 'tbl' }, [['Carton', c.code], ['Cans', c.cans], ['Scanned', U.fmtDT(c.t)], ['Batch', c.batch], ['Product', b ? b.product : '-'], ['Syrup lot', b ? b.lotSyrup : '-'], ['Pallet', c.pallet || 'not yet palletized'], ['Pasteurization max / avg', b ? fmt(b.tmax, 1) + ' / ' + fmt(b.avgT || (b.tn ? b.tsum / b.tn : 0), 1) + ' \u00b0C' : '-']].map(r => h('tr', null, h('td', null, r[0]), h('td', null, r[1]))))); }
      else if (p) out.append(h('table', { class: 'tbl' }, [['Pallet', p.id], ['Wrapped', U.fmtDT(p.t)], ['Cartons', p.cartons.join(', ')], ['Batches', p.batches.join(', ')]].map(r => h('tr', null, h('td', null, r[0]), h('td', null, r[1])))));
      else out.append(h('div', { class: 'hint' }, 'No matching carton or pallet'));
    },
    update() {
      const pr = P.sim.prod, sig = pr.batches.length + '|' + pr.cartons.length + '|' + pr.pallets.length + '|' + (pr.curBatch ? pr.curBatch.qty : '') + this.sel; if (sig === this.sig) return; this.sig = sig;
      this.bt.innerHTML = ''; this.bt.appendChild(h('table', { class: 'tbl' }, h('tr', null, ['Batch ID', t('Product'), t('Start time'), t('End time'), t('Quantity'), t('Rejected'), 'Cartons', 'Pallets', 'Max \u00b0C', ''].map(x => h('th', null, x))),
        pr.batches.length ? pr.batches.slice().reverse().map(b => h('tr', { class: 'clk', onclick: () => { this.sel = b.id; this.sig = null; } }, h('td', { class: 'mono' }, b.id), h('td', null, b.product), h('td', null, U.fmtDT(b.start)), h('td', null, b.end ? U.fmtDT(b.end) : 'in progress'), h('td', { class: 'num' }, b.qty), h('td', { class: 'num' }, b.rejects), h('td', { class: 'num' }, b.cartons.length), h('td', { class: 'num' }, b.pallets.length), h('td', { class: 'num' }, fmt(b.tmax, 1)), h('td', null, b.id === this.sel ? '\u25c0' : ''))) : h('tr', null, h('td', { colspan: 10, class: 'hint' }, 'No batches yet - start the plant (Plant Overview or Production).'))));
      const b = pr.batches.find(x => x.id === this.sel) || pr.batches[pr.batches.length - 1]; this.gen.innerHTML = '';
      if (b) this.gen.append(h('table', { class: 'tbl' }, [['Batch', b.id], ['Product / recipe', b.product + ' (' + b.recipe.syrup + ' % syrup, ' + b.recipe.temp + ' \u00b0C)'], ['Order', '#' + b.orderId], ['Syrup lot (simulated)', b.lotSyrup], ['Syrup used', fmt(b.syrupKg, 1) + ' kg'], ['Water used', fmt(b.waterKg, 1) + ' kg'], ['Energy', fmt(b.kwh, 2) + ' kWh'], ['Cartons', b.cartons.join(', ') || '-'], ['Pallets', b.pallets.join(', ') || '-']].map(r => h('tr', null, h('td', null, r[0]), h('td', { class: 'mono' }, r[1])))));
      else this.gen.append(h('div', { class: 'hint' }, 'Select a batch'));
    }
  });

  /* ================================ QUALITY ================================ */
  P.defScreen({
    id: 'quality', title: 'Quality', group: 'Production', icon: '\u2714',
    build(root) {
      this.cv = { rej: h('canvas', { class: 'chart' }), rate: h('canvas', { class: 'chart' }), spc: h('canvas', { class: 'chart' }) };
      root.append(h('div', { class: 'grid g4' }, tile(t('Reject rate'), 'q-rate', '% last 20'), tile('Total rejects', 'q-tot'), tile('Fill mean', 'q-mean', 'ml'), tile('Cpk (fill volume)', 'q-cpk')),
        h('div', { class: 'grid g2', style: { marginTop: '12px' } }, h('div', { class: 'card' }, h('h3', null, 'Reject reasons'), this.cv.rej), h('div', { class: 'card' }, h('h3', null, 'Reject rate over time'), this.cv.rate)),
        h('div', { class: 'card', style: { marginTop: '12px' } }, h('h3', null, 'SPC - fill volume (individual values, last 200 cans)'), this.cv.spc, h('div', { class: 'hint' }, 'Blue dashed = UCL/LCL (mean +/- 3 sigma). Red = specification limits (+/-3 % of target). Points outside the limits are red. Try a low filler bowl to see underfill rejects.')));
    },
    update(root) {
      const pl = P.sim.plant, r = pl.stats.rejects, s = P.sim.prod.spc();
      P.Charts.bars(this.cv.rej, { labels: Object.keys(r).map(k => P.REJ_LABEL[k]), values: Object.values(r), height: 200, colors: ['#e07b00', '#c8102e', '#7a1fa2', '#2f7fd1'], fmt: v => v });
      const rs = P.sim.prod.rejSeries; P.Charts.seqChart(this.cv.rate, { y: rs.map(x => x.rate), height: 200, lines: [{ v: 15, label: 'alarm', color: '#c8102e', limit: 'hi' }] });
      P.Charts.seqChart(this.cv.spc, { y: s.x, height: 230, lines: [{ v: s.target, label: 'target', color: '#1f8a4c', dash: false }, { v: s.ucl, label: 'UCL', color: '#2f7fd1', limit: 'hi' }, { v: s.lcl, label: 'LCL', color: '#2f7fd1', limit: 'lo' }, { v: s.usl, label: 'USL', color: '#c8102e', limit: 'hi' }, { v: s.lsl, label: 'LSL', color: '#c8102e', limit: 'lo' }] });
      setK(root, 'q-rate', fmt(pl.rejectRate(), 0)); setK(root, 'q-tot', String(pl.totalRejects())); setK(root, 'q-mean', s.x.length ? fmt(s.mean, 1) : '-'); setK(root, 'q-cpk', s.x.length > 5 ? fmt(s.cpk, 2) : '-');
    }
  });

  /* ================================ DOWNTIME ================================ */
  P.defScreen({
    id: 'downtime', title: 'Downtime', group: 'Production', icon: '\u23f1',
    build(root) {
      this.cv = h('canvas', { class: 'chart' }); this.sig = null;
      root.append(h('div', { class: 'grid g2' }, h('div', { class: 'card' }, h('h3', null, 'Downtime Pareto (minutes)'), this.cv, h('div', { class: 'hint' }, 'Operator selects a reason code per stop. Jam / no-material are suggested automatically from the PLC state.')),
        h('div', { class: 'card' }, h('h3', null, 'Stop events this shift'), (this.tb = h('div', { class: 'scroll' })))));
    },
    update() {
      const pr = P.sim.prod, par = pr.downtimePareto(); P.Charts.pareto(this.cv, { labels: par.map(x => x.reason), values: par.map(x => x.min), height: 230, fmt: v => v.toFixed(1) });
      const open = pr.openDown && pr.openDown.logged ? 1 : 0; const sig = pr.downtime.map(d => d.reason + Math.round(d.ms / 1000)).join() + open; if (sig === this.sig) return; this.sig = sig;
      this.tb.innerHTML = ''; this.tb.appendChild(h('table', { class: 'tbl' }, h('tr', null, ['Started', 'Duration', 'Reason', ''].map(x => h('th', null, x))),
        pr.downtime.length ? pr.downtime.slice().reverse().map(d => { const sel = h('select', { onchange: e => { pr.setDownReason(d, e.target.value); this.sig = null; } }, P.DOWN_REASONS.map(r => h('option', { value: r, selected: r === d.reason }, r))); return h('tr', null, h('td', null, U.fmtTime(d.start)), h('td', null, U.fmtDur(d.ms / 1000) + (d === pr.openDown ? ' (ongoing)' : '')), h('td', null, sel), h('td', null, d.auto ? h('span', { class: 'hint' }, 'suggested') : h('span', { class: 'tag ok' }, 'operator'))); }) : h('tr', null, h('td', { colspan: 4, class: 'hint' }, 'No stops yet. Start the plant, then stop it (or inject a jam) to log downtime.'))));
    }
  });

  /* ================================ BOTTLENECK ================================ */
  P.defScreen({
    id: 'bottleneck', title: 'Bottleneck', group: 'Production', icon: '\u2696',
    build(root) {
      this.cv = h('canvas', { class: 'chart' });
      root.append(h('div', { class: 'grid g4' }, tile('Bottleneck', 'b-bn'), tile('Line cycle time', 'b-ct', 's/can'), tile('Takt time (ideal ' + P.SIM.idealCansPerMin + '/min)', 'b-tk', 's'), tile('Line balance', 'b-lb', '%')),
        h('div', { class: 'card', style: { marginTop: '12px' } }, h('h3', null, 'Cycle time per machine (s) - line balance'), this.cv, h('div', { class: 'hint' }, 'Cycle time = average busy time per can. The slowest machine limits the line. Red line = takt time needed for the ideal rate. Conveyor index = time the belt moves per can.')));
    },
    update(root) {
      const c = P.sim.prod.cycleTimes(), rows = c.rows.filter(r => r.ct > 0);
      P.Charts.bars(this.cv, { labels: rows.map(r => r.id), values: rows.map(r => r.ct), height: 230, unit: 'seconds', fmt: v => v.toFixed(2), colors: rows.map(r => r.id === c.bottleneck ? '#e07b00' : '#1f5f8b'), lines: [{ v: c.takt, label: 'takt ' + c.takt.toFixed(1) + ' s', color: '#c8102e' }] });
      const mx = Math.max(...rows.map(r => r.ct), 0), avg = rows.length ? rows.reduce((a, r) => a + r.ct, 0) / rows.length : 0;
      setK(root, 'b-bn', rows.length ? c.bottleneck : '-'); setK(root, 'b-ct', c.cycle ? fmt(c.cycle, 2) : '-'); setK(root, 'b-tk', fmt(c.takt, 1)); setK(root, 'b-lb', mx ? fmt(avg / mx * 100, 0) : '-');
    }
  });

  /* ================================ REPORTS ================================ */
  const Reports = {
    list: ['Shift report', 'Alarm report', 'Production report', 'OEE report'],
    /** returns {title, blocks:[{h, cols[], rows[][]}]} */
    build(type) {
      const pr = P.sim.prod, pl = P.sim.plant, o = pr.oee(), now = P.sim.clock();
      const head = { h: 'Report header', cols: ['Item', 'Value'], rows: [['Plant', 'Smart Beverage Filling & Packaging Line'], ['Generated (sim clock)', U.fmtDT(now)], ['Operator', P.session.user + ' (' + P.session.role + ')'], ['Shift start', U.fmtDT(pr.shift.start)], ['Product', pr.currentRecipe().name]] };
      const kwh = pr.totalKWh();
      const oeeB = { h: 'OEE', cols: ['Metric', 'Value'], rows: [['Availability', fmt(o.avail * 100, 1) + ' %'], ['Performance', fmt(o.perf * 100, 1) + ' %'], ['Quality', fmt(o.qual * 100, 1) + ' %'], ['OEE', fmt(o.oee * 100, 1) + ' %'], ['Planned / run / down (min)', fmt(o.plannedMin, 1) + ' / ' + fmt(o.runMin, 1) + ' / ' + fmt(o.downMin, 1)]] };
      const alarmRows = pr.sim.alarms.history.slice(-100).reverse().map(r => [U.fmtDT(r.tActive), r.defId, r.pri, r.text, r.tAck ? U.fmtTime(r.tAck) : 'unack', r.ackBy]);
      const k = pr.sim.alarms.kpis();
      const batchRows = pr.batches.map(b => [b.id, b.product, U.fmtDT(b.start), b.end ? U.fmtDT(b.end) : 'running', b.qty, b.rejects, b.cartons.length, b.pallets.length, fmt(b.kwh, 2)]);
      if (type === 'Alarm report') return { title: type, blocks: [head, { h: 'Alarm KPIs', cols: ['KPI', 'Value'], rows: [['Total alarms', k.total], ['Alarms per hour', fmt(k.perHour, 1)], ['Average acknowledge time (s)', fmt(k.avgAckSec, 1)], ['Stale alarms', k.stale], ['Top 5', k.top5.map(x => x.id + ' x' + x.count).join(', ') || '-']] }, { h: 'Alarm log (latest 100)', cols: ['Time', 'ID', 'Priority', 'Description', 'Acked', 'By'], rows: alarmRows }] };
      if (type === 'Production report') return { title: type, blocks: [head, { h: 'Totals', cols: ['Item', 'Value'], rows: [['Good cans delivered', pl.stats.delivered], ['Rejected cans', pl.totalRejects()], ['Cartons packed', V('BARCODE_CNT.CV')], ['Pallets wrapped', V('PALLET_CNT.CV')], ['Syrup consumed (kg)', fmt(pl.totals.syrupKg - pr.shift.syrupBase, 1)], ['Water consumed (kg)', fmt(pl.totals.waterKg - pr.shift.waterBase, 1)]] }, { h: 'Batches', cols: ['Batch', 'Product', 'Start', 'End', 'Cans', 'Rejects', 'Cartons', 'Pallets', 'kWh'], rows: batchRows }, { h: 'Reject reasons', cols: ['Reason', 'Count'], rows: Object.keys(pl.stats.rejects).map(k2 => [P.REJ_LABEL[k2], pl.stats.rejects[k2]]) }] };
      if (type === 'OEE report') return { title: type, blocks: [head, oeeB, { h: 'Downtime by reason (min)', cols: ['Reason', 'Minutes'], rows: pr.downtimePareto().map(x => [x.reason, fmt(x.min, 2)]) }, { h: 'Cycle times', cols: ['Machine', 'Cycle time (s)'], rows: pr.cycleTimes().rows.map(r => [r.id, fmt(r.ct, 2)]) }] };
      return { title: 'Shift report', blocks: [head, { h: 'Production summary', cols: ['Item', 'Value'], rows: [['Good cans', o.good], ['Rejected', o.rej], ['Throughput (cans/min)', fmt(o.cansPerMin, 1)], ['Batches', pr.batches.length], ['Cartons / pallets', V('BARCODE_CNT.CV') + ' / ' + V('PALLET_CNT.CV')]] }, oeeB,
        { h: 'Downtime events', cols: ['Start', 'Minutes', 'Reason'], rows: pr.downtime.map(d => [U.fmtTime(d.start), fmt(d.ms / 60000, 2), d.reason]) },
        { h: 'Energy and consumption', cols: ['Item', 'Value'], rows: [['Energy (kWh)', fmt(kwh, 2)], ['Cost (PKR @ ' + pr.tariff + ')', fmt(kwh * pr.tariff, 0)], ['Peak demand (kW)', fmt(pr.peakKW, 1)], ['Power factor', fmt(pr.pf(), 2)], ['Syrup (kg)', fmt(pl.totals.syrupKg - pr.shift.syrupBase, 1)], ['Water (kg)', fmt(pl.totals.waterKg - pr.shift.waterBase, 1)]] },
        { h: 'Alarms', cols: ['Item', 'Value'], rows: [['Alarms this session', k.total], ['Per hour', fmt(k.perHour, 1)], ['Average acknowledge (s)', fmt(k.avgAckSec, 1)]] }] };
    },
    csv(rep) { const rows = [[rep.title]]; rep.blocks.forEach(b => { rows.push([]); rows.push([b.h]); rows.push(b.cols); b.rows.forEach(r => rows.push(r)); }); return U.csv(rows); }
  };
  P.Reports = Reports;

  P.defScreen({
    id: 'reports', title: 'Reports', group: 'Production', icon: '\u2637',
    build(root) {
      this.type = Reports.list[0];
      const seg = h('div', { class: 'seg' }, Reports.list.map((n, i) => h('button', { class: i === 0 ? 'on' : '', onclick: e => { seg.querySelectorAll('button').forEach(b => b.classList.remove('on')); e.target.classList.add('on'); this.type = n; this.render(); } }, n)));
      this.out = h('div', { id: 'rep' });
      root.append(h('div', { class: 'toolbar' }, seg, h('button', { class: 'btn primary', onclick: () => this.render() }, 'Refresh'), h('button', { class: 'btn', onclick: () => { this.render(); window.print(); } }, '\ud83d\udda8 Print / save as PDF'), h('button', { class: 'btn', onclick: () => { const r = Reports.build(this.type); U.download(r.title.replace(/\s+/g, '-').toLowerCase() + '.csv', Reports.csv(r), 'text/csv'); } }, t('Export CSV')), h('button', { class: 'btn', onclick: () => { const r = Reports.build(this.type); U.download(r.title.replace(/\s+/g, '-').toLowerCase() + '.json', JSON.stringify(r, null, 1), 'application/json'); } }, 'Export JSON')), this.out);
      this.render();
    },
    render() {
      const r = Reports.build(this.type); this.out.innerHTML = '';
      this.out.append(h('h2', null, r.title), r.blocks.map(b => h('div', { class: 'card', style: { marginBottom: '10px' } }, h('h3', null, b.h), h('table', { class: 'tbl' }, h('tr', null, b.cols.map(c => h('th', null, c))), b.rows.length ? b.rows.map(row => h('tr', null, row.map(c => h('td', null, String(c))))) : h('tr', null, h('td', { colspan: b.cols.length, class: 'hint' }, 'No data'))))));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
