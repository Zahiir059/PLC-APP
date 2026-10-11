/* ==========================================================================
   screens-monitor.js - Monitor group: Alarms (ISA-18.2), Trends + historian,
   Energy & KPIs (OEE), Equipment Health, Maintenance schedule
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT, U = P.UI, h = U.h, t = P.t, fmt = U.fmt;
  const V = n => P.sim.tags.get(n);
  const setK = (root, id, txt) => { const e = root.querySelector('#' + id); if (e && e.textContent !== txt) e.textContent = txt; };
  const tile = (label, id, unit) => h('div', { class: 'card kpi' }, h('div', { class: 'v', id }, '-'), h('div', { class: 'l' }, label + (unit ? ' (' + unit + ')' : '')));
  const tabs = (root, names, onSel, start) => {
    const bar = h('div', { class: 'tabs no-print' }), body = h('div'); let cur = start || 0;
    const sel = i => { cur = i; bar.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === i)); body.innerHTML = ''; onSel(i, body); };
    names.forEach((n, i) => bar.appendChild(h('button', { onclick: () => sel(i) }, n))); root.append(bar, body); sel(cur); return { sel, body };
  };
  P.UI.tabs = tabs; P.UI.setK = setK; P.UI.tile = tile;

  /* ================================ ALARMS ================================ */
  P.defScreen({
    id: 'alarms', title: 'Alarms', group: 'Monitor', icon: '\u26a0',
    build(root) {
      this.view = 0; this.root = root;
      this.t = tabs(root, [t('Active alarms'), t('Alarm history'), 'Alarm KPIs', 'Configuration / shelving'], (i, body) => { this.view = i; this.body = body; this.rendered = null; this.render(); });
    },
    update() { this.render(); },
    render() {
      const am = P.sim.alarms, body = this.body; if (!body) return;
      const sig = this.view + '|' + am.history.length + '|' + am.activeList().map(a => a.def.id + a.state + a.shelved).join() + '|' + (this.view === 2 ? Math.floor(Date.now() / 2000) : '') + (this.view === 3 ? am.defs.map(d => d.suppressed + '' + (d.shelvedUntil > am.now)).join('') : '');
      if (sig === this.rendered) return; this.rendered = sig;
      body.innerHTML = '';
      if (this.view === 0) {
        const L = am.activeList();
        body.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: () => { am.ackAll(P.session.user); this.rendered = null; } }, t('Acknowledge all')), am.firstOut ? h('span', null, 'First-out: ', h('span', { class: 'tag fo' }, am.firstOut)) : null, am.flood ? h('span', { class: 'flood' }, 'ALARM FLOOD: ' + am.activations.length + ' alarms in 10 min') : null),
          h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('tr', null, ['', t('Priority'), 'ID', t('Description'), t('Time'), t('Status'), 'Response', ''].map(x => h('th', null, x))),
            L.length ? L.map(a => h('tr', { class: a.state === 'active_unack' ? 'unack' : '' }, h('td', null, a.def.id === am.firstOut ? h('span', { class: 'tag fo', title: 'First-out alarm' }, 'FO') : ''), h('td', null, h('span', { class: 'tag ' + a.def.pri }, a.def.pri)), h('td', { class: 'mono' }, a.def.id), h('td', null, a.def.text, a.shelved ? h('i', null, ' (shelved)') : ''), h('td', null, a.rec ? U.fmtTime(a.rec.tActive) : ''),
              h('td', null, { active_unack: 'ACTIVE - UNACK', active_ack: 'Active - acked', rtn_unack: 'Returned - UNACK' }[a.state]), h('td', { class: 'hint' }, a.def.resp),
              h('td', null, (a.state === 'active_unack' || a.state === 'rtn_unack') ? h('button', { class: 'btn sm', onclick: () => { am.ack(a.def.id, P.session.user); this.rendered = null; } }, t('Acknowledge')) : null))) : h('tr', null, h('td', { colspan: 8, class: 'hint' }, 'No active alarms')))));
      } else if (this.view === 1) {
        const hist = am.history.slice().reverse().slice(0, 200);
        body.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: () => U.download('alarm-history.csv', U.csv([['Activated', 'Acknowledged', 'Returned', 'ID', 'Priority', 'Area', 'Description', 'Value', 'Ack by']].concat(am.history.map(r => [U.fmtDT(r.tActive), r.tAck ? U.fmtDT(r.tAck) : '', r.tRtn ? U.fmtDT(r.tRtn) : '', r.defId, r.pri, r.area, r.text, r.value, r.ackBy]))), 'text/csv') }, t('Export CSV')), h('button', { class: 'btn', onclick: () => window.print() }, t('Print')), P.session.isAdmin() ? h('button', { class: 'btn bad', onclick: async () => { if (await U.confirmBox('Clear alarm history?')) { am.history = []; this.rendered = null; } } }, 'Clear history (Admin)') : null),
          h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('tr', null, ['Activated', 'Ack', 'RTN', 'ID', t('Priority'), t('Description'), t('Value'), 'By'].map(x => h('th', null, x))),
            hist.map(r => h('tr', null, h('td', null, U.fmtDT(r.tActive)), h('td', null, r.tAck ? U.fmtTime(r.tAck) : '-'), h('td', null, r.tRtn ? U.fmtTime(r.tRtn) : '-'), h('td', { class: 'mono' }, r.defId, r.firstOut ? ' FO' : ''), h('td', null, h('span', { class: 'tag ' + r.pri }, r.pri)), h('td', null, r.text), h('td', { class: 'num' }, r.value), h('td', null, r.ackBy))))));
      } else if (this.view === 2) {
        const k = am.kpis();
        body.append(h('div', { class: 'grid g4' }, tile('Alarms per hour', 'ak1'), tile('Alarms last 10 min', 'ak2'), tile('Avg acknowledge time', 'ak3', 's'), tile('Stale alarms (>30 min)', 'ak4')),
          h('div', { class: 'card', style: { marginTop: '12px' } }, h('h3', null, 'Top 5 most frequent alarms'), h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'ID'), h('th', null, t('Description')), h('th', null, 'Count')), k.top5.length ? k.top5.map(x => h('tr', null, h('td', { class: 'mono' }, x.id), h('td', null, x.text), h('td', { class: 'num' }, x.count))) : h('tr', null, h('td', { colspan: 3, class: 'hint' }, 'No alarms yet')))),
          h('p', { class: 'hint' }, 'ISA-18.2 guidance: < 6 alarms/hour is manageable; > 10 alarms in 10 minutes is an alarm flood. Times use the simulated clock.'));
        setK(body, 'ak1', fmt(k.perHour, 1)); setK(body, 'ak2', String(k.last10min) + (k.flood ? ' FLOOD' : '')); setK(body, 'ak3', fmt(k.avgAckSec, 1)); setK(body, 'ak4', String(k.stale));
      } else {
        body.append(h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('tr', null, ['ID', t('Priority'), t('Description'), 'Tag', 'Limit', 'Delay', 'State', 'Shelve / suppress'].map(x => h('th', null, x))),
          am.defs.map(d => { const sh = d.shelvedUntil > am.now; return h('tr', null, h('td', { class: 'mono' }, d.id), h('td', null, h('span', { class: 'tag ' + d.pri }, d.pri)), h('td', null, d.text), h('td', { class: 'mono' }, d.tag), h('td', null, d.cond + (d.limit !== undefined ? ' ' + d.limit : '')), h('td', null, d.delay + ' s'),
            h('td', null, d.suppressed ? 'Suppressed: ' + d.suppressReason : sh ? 'Shelved ' + Math.ceil((d.shelvedUntil - am.now) / 60000) + ' min: ' + d.shelveReason : (d.enable ? 'Conditional (' + d.enable + ')' : 'In service')),
            h('td', null, sh ? h('button', { class: 'btn sm', onclick: () => { am.unshelve(d.id); this.rendered = null; } }, 'Unshelve') : h('button', { class: 'btn sm', onclick: async () => { const r = await U.promptBox('Shelve ' + d.id, 'Reason (shelved for 10 simulated minutes)', 'Nuisance alarm'); if (r !== null) { am.shelve(d.id, 10, r); this.rendered = null; } } }, t('Shelve')), ' ',
              P.session.canEdit() ? h('button', { class: 'btn sm', onclick: async () => { if (d.suppressed) am.suppress(d.id, false); else { const r = await U.promptBox('Suppress ' + d.id + ' (out of service)', 'Reason / MOC reference', 'Equipment out of service'); if (r === null) return; am.suppress(d.id, true, r); } this.rendered = null; } }, d.suppressed ? 'Return to service' : t('Suppress')) : null)); }))),
          h('p', { class: 'hint' }, 'Shelving temporarily silences an alarm (logged with reason). Suppression by design needs Engineer/Admin and is audited.'));
      }
    }
  });

  /* ================================ TRENDS + HISTORIAN ================================ */
  P.defScreen({
    id: 'trends', title: 'Trends', group: 'Monitor', icon: '\u2248',
    build(root) {
      this.charts = []; const mk = (title, series, height) => { const cv = h('canvas', { class: 'chart' }); const ch = new P.Charts.TimeChart(cv, { height: height || 190, series, span: 120000, source: (t0, t1, n) => P.Hist.range(t0, t1, n), now: () => P.sim.clock(), title }); this.charts.push(ch); return h('div', { class: 'card' }, h('div', { class: 'legend' }, series.map(s => h('span', null, h('i', { style: { background: s.color } }), s.label))), cv); };
      const range = h('div', { class: 'seg' }, [['1 min', 60000], ['1 hour', 3600000], ['Shift (8 h)', 28800000]].map((r, i) => h('button', { class: i === 0 ? 'on' : '', onclick: e => { range.querySelectorAll('button').forEach(b => b.classList.remove('on')); e.target.classList.add('on'); this.charts.forEach(c => c.setSpan(r[1])); } }, r[0])));
      root.append(h('div', { class: 'toolbar' }, h('b', null, 'Historian range:'), range, h('button', { class: 'btn', onclick: () => this.charts.forEach(c => { c.live = true; c.draw(); }) }, 'Live'), h('button', { class: 'btn', onclick: () => this.csv() }, t('Export CSV')), P.session.isAdmin() ? h('button', { class: 'btn bad', onclick: async () => { if (await U.confirmBox('Clear all historian data (memory + IndexedDB)?')) P.Hist.clear(); } }, 'Clear historian') : null, h('small', null, 'Mouse wheel = zoom, drag = pan, double-click = back to live. Data is stored in your browser (IndexedDB).')),
        h('div', { class: 'grid g2' },
          mk('Temperature - TT-201 / setpoint / heater', [{ key: 'tt', label: 'TT-201 \u00b0C', color: '#c8102e' }, { key: 'sp', label: 'Setpoint', color: '#1f5f8b', dash: true }, { key: 'heat', label: 'Heater %', color: '#e07b00', axis: 1, min: 0, max: 100 }]),
          mk('Tank levels', [{ key: 'l101', label: 'LT-101 syrup %', color: '#7a1fa2' }, { key: 'l102', label: 'LT-102 water %', color: '#1f5f8b' }, { key: 'l201', label: 'LT-201 pasteurizer %', color: '#c8102e' }, { key: 'l301', label: 'LT-301 bowl %', color: '#1f8a4c' }]),
          mk('Production rate (cans/min) and conveyor speed', [{ key: 'r', label: 'Cans/min', color: '#1f8a4c' }, { key: 'spd', label: 'Conveyor %', color: '#7d8892', axis: 1, min: 0, max: 100 }]),
          mk('Pressure, weight and power', [{ key: 'pt', label: 'PT-201 bar', color: '#e07b00' }, { key: 'wt', label: 'WT-103 kg', color: '#1f5f8b' }, { key: 'kw', label: 'Power kW', color: '#7a1fa2', axis: 1 }])));
      setTimeout(() => this.charts.forEach(c => c.draw()), 30);
    },
    csv() { const H = P.Hist.ch, rows = [['time', 'cans_per_min'].concat(H.map(c => c[2] + ' [' + c[3] + ']'))]; P.Hist.mem.forEach(s => rows.push([U.fmtDT(s.t), s.r].concat(H.map(c => s[c[0]])))); U.download('historian.csv', U.csv(rows), 'text/csv'); },
    update() { this.charts.forEach(c => c.draw()); }
  });

  /* ================================ ENERGY & KPIs ================================ */
  P.defScreen({
    id: 'energy', title: 'Energy & KPIs', group: 'Monitor', icon: '\u26a1',
    build(root) {
      this.root = root; this.cv = {}; this.tab = 0;
      tabs(root, ['KPIs / OEE', t('Energy')], (i, body) => {
        this.tab = i; this.body = body; this.cv = {};
        if (i === 0) {
          this.cv.oee = h('canvas', { class: 'chart' });
          body.append(h('div', { class: 'grid g4' }, tile('OEE', 'o-oee', '%'), tile(t('Availability'), 'o-av', '%'), tile(t('Performance'), 'o-pf', '%'), tile(t('Quality factor'), 'o-q', '%'), tile('Production count (good cans)', 'o-good'), tile(t('Downtime'), 'o-down', 'min'), tile('Run time', 'o-run', 'min'), tile(t('Power'), 'o-kw', 'kW')),
            h('div', { class: 'grid g2', style: { marginTop: '12px' } }, h('div', { class: 'card' }, h('h3', null, 'OEE factors'), this.cv.oee), h('div', { class: 'card' }, h('h3', null, 'Shift'), h('table', { class: 'tbl', id: 'sh' }), h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: async () => { if (await U.confirmBox('Start a new shift? Current shift KPIs are archived and counters restart.')) { P.sim.prod.newShift(); P.bus.emit('audit', { action: 'NEW_SHIFT', detail: '' }); } } }, 'Start new shift')), h('div', { class: 'hint' }, 'Availability = run time / planned time; Performance = produced / (production time x ideal ' + P.SIM.idealCansPerMin + ' cans/min); Quality = good / (good + rejected).'))));
        } else {
          this.cv.mach = h('canvas', { class: 'chart' });
          const tar = h('input', { type: 'number', step: 1, min: 0, style: { width: '90px' }, value: P.sim.prod.tariff, onchange: e => P.sim.prod.setTariff(parseFloat(e.target.value) || 0) });
          body.append(h('div', { class: 'toolbar' }, h('label', null, t('Tariff') + ' (PKR/kWh) '), tar, h('small', null, 'editable, saved in your browser')),
            h('div', { class: 'grid g4' }, tile(t('Power'), 'e-kw', 'kW'), tile('Peak demand (15 min avg)', 'e-pk', 'kW'), tile('Power factor', 'e-pf'), tile('Energy this session', 'e-kwh', 'kWh'), tile('Energy cost', 'e-cost', 'PKR'), tile('Cost per batch (last)', 'e-cb', 'PKR'), tile('Syrup consumed (shift)', 'e-sy', 'kg'), tile('Water consumed (shift)', 'e-wa', 'kg')),
            h('div', { class: 'grid g2', style: { marginTop: '12px' } }, h('div', { class: 'card' }, h('h3', null, 'kWh per machine'), this.cv.mach), h('div', { class: 'card' }, h('h3', null, 'Machines'), h('table', { class: 'tbl', id: 'mt' }))),
            h('div', { class: 'card', style: { marginTop: '12px' } }, h('h3', null, 'Batch energy cost'), h('table', { class: 'tbl', id: 'bt' })));
        }
      });
    },
    update(root) {
      const pr = P.sim.prod, pl = P.sim.plant;
      if (this.tab === 0) {
        const o = pr.oee(), pc = x => fmt(x * 100, 0);
        setK(root, 'o-oee', pc(o.oee)); setK(root, 'o-av', pc(o.avail)); setK(root, 'o-pf', pc(o.perf)); setK(root, 'o-q', pc(o.qual)); setK(root, 'o-good', String(o.good)); setK(root, 'o-down', fmt(o.downMin, 1)); setK(root, 'o-run', fmt(o.runMin, 1)); setK(root, 'o-kw', fmt(pl.powerKW, 0));
        P.Charts.bars(this.cv.oee, { labels: ['Availability', 'Performance', 'Quality', 'OEE'], values: [o.avail * 100, o.perf * 100, o.qual * 100, o.oee * 100], max: 100, height: 200, colors: ['#1f5f8b', '#1f8a4c', '#7a1fa2', '#e07b00'], fmt: v => v.toFixed(0) + '%', lines: [{ v: 85, label: 'world-class OEE 85 %', color: '#c8102e' }] });
        const rows = [['Planned time', fmt(o.plannedMin, 1) + ' min'], ['Run time', fmt(o.runMin, 1) + ' min'], ['Production time', fmt(o.prodMin, 1) + ' min'], ['Downtime', fmt(o.downMin, 1) + ' min'], ['Cans produced', o.produced], ['Good cans', o.good], ['Rejected', o.rej], ['Throughput', fmt(o.cansPerMin, 1) + ' cans/min']];
        const sh = root.querySelector('#sh'), html = rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td></tr>`).join(''); if (sh._h !== html) { sh._h = html; sh.innerHTML = html; }
      } else {
        const kwh = pr.totalKWh(), bs = pr.batches.filter(b => b.end), last = bs[bs.length - 1];
        setK(root, 'e-kw', fmt(pl.powerKW, 1)); setK(root, 'e-pk', fmt(pr.peakKW, 1)); setK(root, 'e-pf', fmt(pr.pf(), 2)); setK(root, 'e-kwh', fmt(kwh, 2)); setK(root, 'e-cost', fmt(kwh * pr.tariff, 0)); setK(root, 'e-cb', last ? fmt(last.kwh * pr.tariff, 0) : '-');
        setK(root, 'e-sy', fmt(pl.totals.syrupKg - pr.shift.syrupBase, 1)); setK(root, 'e-wa', fmt(pl.totals.waterKg - pr.shift.waterBase, 1));
        const rows = pr.energyByMachine(); P.Charts.bars(this.cv.mach, { labels: rows.map(r => r.id), values: rows.map(r => r.kwh), height: 220, unit: 'kWh', fmt: v => v.toFixed(2) });
        const mt = root.querySelector('#mt'), html = '<tr><th>Machine</th><th>kW now</th><th>kWh</th><th>PKR</th></tr>' + rows.map(r => `<tr><td>${r.name}</td><td class="num">${fmt(r.kw, 1)}</td><td class="num">${fmt(r.kwh, 2)}</td><td class="num">${fmt(r.kwh * pr.tariff, 0)}</td></tr>`).join('');
        if (mt._h !== html) { mt._h = html; mt.innerHTML = html; }
        const bt = root.querySelector('#bt'), bh = '<tr><th>Batch</th><th>Product</th><th>Cans</th><th>kWh</th><th>Cost PKR</th><th>PKR / can</th></tr>' + pr.batches.map(b => `<tr><td>${b.id}</td><td>${b.product}</td><td class="num">${b.qty}</td><td class="num">${fmt(b.kwh, 2)}</td><td class="num">${fmt(b.kwh * pr.tariff, 0)}</td><td class="num">${b.qty ? fmt(b.kwh * pr.tariff / b.qty, 2) : '-'}</td></tr>`).join('');
        if (bt._h !== bh) { bt._h = bh; bt.innerHTML = bh; }
      }
    }
  });

  /* ================================ EQUIPMENT HEALTH ================================ */
  P.defScreen({
    id: 'health', title: 'Equipment Health', group: 'Monitor', icon: '\u2695',
    build(root) {
      root.append(h('div', { class: 'toolbar' }, h('small', null, 'Vibration limits (ISO 10816 style): warning 4.5 mm/s, critical 7.1 mm/s. Use "Simulate wear" to age a machine and watch the predictive warning appear (run the plant so the machine is on).')), (this.tb = h('div', { class: 'scroll', style: { maxHeight: 'none' } })));
    },
    update() {
      const rows = P.sim.prod.health(); const sig = rows.map(r => r.status + Math.round(r.vib * 4) + r.on + Math.round(r.rt) + Math.round(r.amps)).join(); if (sig === this.sig) return; this.sig = sig;
      this.tb.innerHTML = ''; this.tb.appendChild(h('table', { class: 'tbl' }, h('tr', null, ['Equipment', t('Status'), t('Runtime hours'), 'Starts', 'Current (A)', 'Vibration (mm/s)', 'Predictive maintenance', ''].map(x => h('th', null, x))),
        rows.map(r => h('tr', null, h('td', null, r.eq.name), h('td', null, h('span', { class: 'tag ' + (r.status === 'ok' ? 'ok' : r.status === 'warn' ? 'warn' : 'crit') }, r.status === 'ok' ? 'OK' : r.status === 'warn' ? 'WARNING' : 'CRITICAL'), ' ', h('span', { class: 'led ' + (r.on ? 'on' : '') })), h('td', { class: 'num' }, fmt(r.rt, 1)), h('td', { class: 'num' }, r.starts), h('td', { class: 'num' }, r.eq.type === 'heater' ? fmt(r.amps, 0) : fmt(r.amps, 1)), h('td', { class: 'num' }, r.eq.type === 'heater' ? '-' : fmt(r.vib, 2)), h('td', null, r.warnings.length ? r.warnings.map(w => h('div', null, '\u26a0 ' + w.msg)) : h('span', { class: 'hint' }, 'Within limits')),
          h('td', null, r.eq.type !== 'heater' ? h('button', { class: 'btn sm', title: 'Demo: simulate bearing wear', onclick: () => { P.sim.prod.degrade(r.eq.id); this.sig = null; } }, 'Simulate wear') : null)))));
    }
  });

  /* ================================ MAINTENANCE ================================ */
  P.defScreen({
    id: 'maint', title: 'Maintenance', group: 'Monitor', icon: '\ud83d\udee0',
    build(root) { this.sig = null; root.append(h('p', { class: 'hint' }, 'Preventive maintenance schedule. Due dates use the simulated clock; marking a task done reschedules it and resets bearing wear for lubrication tasks.'), (this.tb = h('div', { class: 'scroll', style: { maxHeight: 'none' } }))); },
    update() {
      const pr = P.sim.prod; if (!pr.maint) return; const now = P.sim.clock(); const sig = pr.maint.map(m => m.due + '|' + (m.last || 0)).join() + Math.floor(now / 3600000); if (sig === this.sig) return; this.sig = sig;
      this.tb.innerHTML = ''; this.tb.appendChild(h('table', { class: 'tbl' }, h('tr', null, ['Equipment', 'Task', 'Interval', 'Last done', 'Due', t('Status'), ''].map(x => h('th', null, x))),
        pr.maint.slice().sort((a, b) => a.due - b.due).map(m => { const days = (m.due - now) / 86400000, od = days < 0; return h('tr', null, h('td', null, (P.EQUIP.find(e => e.id === m.equip) || {}).name || m.equip), h('td', null, m.task), h('td', null, m.everyDays + ' d'), h('td', null, m.last ? U.fmtDT(m.last).slice(0, 10) : '-'), h('td', null, U.fmtDT(m.due).slice(0, 10)),
          h('td', null, h('span', { class: 'tag ' + (od ? 'crit' : days < 7 ? 'warn' : 'ok') }, od ? t('Overdue') + ' ' + Math.ceil(-days) + ' d' : 'in ' + Math.ceil(days) + ' d')), h('td', null, h('button', { class: 'btn sm', onclick: () => { pr.maintDone(m.id); this.sig = null; U.toast('Marked done: ' + m.task, 'ok'); } }, t('Mark as done')))); })));
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
