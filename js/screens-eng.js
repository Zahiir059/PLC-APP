/* ==========================================================================
   screens-eng.js - Engineering group
     I/O & PLC Logic : Ladder | FBD | SFC | ST | Tags | Watch & Force |
                       Cross-reference + Search/Replace | Versions | Listing
     PID Tuning (sliders, live chart, step-response preview, auto-tune demo)
     Modbus Map + frame simulator, Cause & Effect, Audit Trail, Documentation
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT, U = P.UI, h = U.h, t = P.t, fmt = U.fmt, setK = U.setK, tile = U.tile, tabs = U.tabs;
  const V = n => P.sim.tags.get(n);
  const val = tg => tg.v === true ? '1' : tg.v === false ? '0' : (Number.isInteger(tg.v) ? String(tg.v) : (+tg.v).toFixed(3));

  /* ============================================================ I/O & PLC LOGIC ============================================================ */
  const TABS = ['Ladder', 'FBD', 'SFC', 'Structured Text', 'Tags', 'Watch & Force', 'Cross-ref / Replace', 'Versions', 'Listing'];
  P.defScreen({
    id: 'logic', title: 'I/O & PLC Logic', group: 'Engineering', icon: '\u2630',
    build(root) {
      const sim = P.sim;
      if (!P._le) {
        P._leRoot = h('div');
        P._le = new P.LadderEditor(P._leRoot, { sim, canEdit: () => P.session.canEdit(), saveProgram: p => P.Prog.saveProgram(p), onChange: () => {} });
      }
      this.ed = P._le; this.ed.render(); this.tab = 0; this.xrefTag = this.xrefTag || ''; this.watch = P.Store.get('watch', ['AI_TT201', 'AO_HEATER', 'SEQ_STEP', 'Q_CONV', 'CAN_PACKED.CV']);
      this.body = null;
      this.tb = tabs(root, TABS.map(x => x), (i, body) => { this.tab = i; this.body = body; this.cells = []; this.rows = null; this.sig = null; this.build_tab(i, body); }, this.tab);
      this.off = P.bus.on && null;
      this.xr = name => { this.xrefTag = name; this.tb.sel(6); };
      if (!P._xrefHooked) { P._xrefHooked = true; P.bus.on('xref:show', n => { const s = P.Screens.logic; if (s && s.xr) s.xr(n); }); }
    },
    destroy() { /* keep the editor (and any unapplied draft) alive between visits */ },
    update(root) {
      const i = this.tab, ed = this.ed, plc = P.sim.plc;
      if (i === 0) ed.update();
      else if (i === 1 || i === 2) {
        if (i === 1 && this.fbdSec !== ed.section.id + P.sim.plc.program.sections.length) { this.build_tab(1, this.body); }
        const fi = plc.flowIn, fo = plc.flowOut;
        this.body.querySelectorAll('[data-f]').forEach(e => { const [k, id] = e.dataset.f.split(':'); const on = (k === 'i' ? fi[id] : fo[id]) === true; if (e._on !== on) { e._on = on; e.classList.toggle('on', on); } });
        if (i === 2) { const st = V('SEQ_STEP'); this.body.querySelectorAll('.sfc-s').forEach(e => e.classList.toggle('active', +e.dataset.n === st)); }
      } else if (i === 4) this.updTags();
      else if (i === 5) this.updWatch();
    },
    build_tab(i, body) {
      const ed = this.ed; body.innerHTML = '';
      if (i === 0) { body.appendChild(P._leRoot); ed.render(); return; }
      const secSel = fn => h('select', { onchange: e => { ed.secIdx = parseInt(e.target.value); fn(); } }, ed.draft.sections.map((s, k) => h('option', { value: k, selected: k === ed.secIdx }, s.name)));
      if (i === 1) {
        if (!P.FEATURES.fbdSfc) return body.append('FBD view disabled in config.js');
        const sec = ed.draft.sections[Math.min(ed.secIdx, ed.draft.sections.length - 1)]; this.fbdSec = sec.id + P.sim.plc.program.sections.length;
        body.append(h('div', { class: 'toolbar' }, h('label', null, 'Section: '), secSel(() => this.build_tab(1, body)), h('small', null, 'Function Block Diagram generated from the ladder draft; wires turn green with live power flow.')), h('div', { class: 'sv', html: P.Eng.fbdSection(sec) }));
      } else if (i === 2) {
        if (!P.FEATURES.fbdSfc) return body.append('SFC view disabled in config.js');
        const sfc = ed.draft.sfc || P.sim.plc.program.sfc;
        body.append(h('div', { class: 'toolbar' }, h('small', null, 'Main plant sequence as an SFC / GRAFCET chart. The active step (tag SEQ_STEP) is highlighted live.'), h('span', { class: 'tag ok', id: 'sfc-now' }, 'Step ' + V('SEQ_STEP'))), h('div', { class: 'sv', html: sfc ? P.Eng.sfcSvg(sfc) : '<p>No SFC definition in this program.</p>' }));
      } else if (i === 3) {
        const mk = () => { const idx = body.querySelector('select').value; const txt = P.toST(ed.draft, idx === 'all' ? null : ed.draft.sections[idx].id); pre.innerHTML = U.esc(txt).replace(/\(\*(.*?)\*\)/g, '<span class="c">(*$1*)</span>'); };
        const sel = h('select', { onchange: mk }, h('option', { value: 'all' }, 'All sections'), ed.draft.sections.map((s, k) => h('option', { value: k }, s.name))); const pre = h('pre', { class: 'st' });
        body.append(h('div', { class: 'toolbar' }, h('label', null, 'Show: '), sel, h('button', { class: 'btn', onclick: () => U.download('plant-program.st', P.toST(ed.draft), 'text/plain') }, 'Download .st'), h('small', null, 'IEC 61131-3 Structured Text generated from the ladder draft (read-only).')), pre); mk();
      } else if (i === 4) this.tagTab(body);
      else if (i === 5) this.watchTab(body);
      else if (i === 6) this.xrefTab(body);
      else if (i === 7) this.versionsTab(body);
      else if (i === 8) this.listingTab(body);
    },

    /* ---------------------------------------------------------- tag table */
    tagTab(body) {
      const T = P.sim.tags, can = P.session.canEdit(); this.cells = [];
      const q = h('input', { type: 'text', placeholder: 'Search name / description / address...', style: { minWidth: '260px' }, oninput: () => render() });
      const ty = h('select', { onchange: () => render() }, ['All types', 'BOOL', 'INT', 'REAL'].map(x => h('option', null, x)));
      const ar = h('select', { onchange: () => render() }, [['all', 'All areas'], ['%I', 'Inputs %I'], ['%Q', 'Outputs %Q'], ['%M', 'Memory %M'], ['aux', 'Timer/counter']].map(x => h('option', { value: x[0] }, x[1])));
      const tb = h('tbody'); const info = h('small');
      const save = () => P.bus.emit('tagsedited');
      const render = () => {
        const s = q.value.toLowerCase(); tb.innerHTML = ''; this.cells = []; let n = 0;
        T.list.forEach(tg => {
          if (ty.value !== 'All types' && tg.type !== ty.value) return;
          if (ar.value === 'aux' ? !tg.aux : (ar.value !== 'all' && !(tg.addr || '').startsWith(ar.value))) return;
          if (s && !(tg.name + ' ' + tg.desc + ' ' + tg.addr).toLowerCase().includes(s)) return;
          if (++n > 300) return;
          const ed = tg.aux || !can;
          const vcell = h('input', { value: val(tg), style: { width: '80px' }, onchange: e => { if (tg.type === 'BOOL') T.set(tg.name, e.target.value === '1' || /^t/i.test(e.target.value), 'tagtable'); else T.set(tg.name, parseFloat(e.target.value) || 0, 'tagtable'); } });
          const fcell = h('input', { type: 'checkbox', disabled: !can, checked: tg.forced, title: 'Force this tag', onchange: e => { if (e.target.checked) T.force(tg.name, tg.v, 'tagtable'); else T.force(tg.name, null, 'tagtable'); this.sig = null; } });
          const row = h('tr', { class: tg.forced ? 'forced-row' : '' },
            h('td', null, h('input', { value: tg.name, disabled: ed, class: 'mono', onchange: e => this.renameTag(tg, e.target.value.trim()) })),
            h('td', null, h('select', { disabled: ed, onchange: e => { tg.type = e.target.value; tg.v = P.coerce(tg.type, tg.v); tg.init = P.coerce(tg.type, tg.init); save(); } }, ['BOOL', 'INT', 'REAL'].map(x => h('option', { selected: x === tg.type }, x)))),
            h('td', null, h('input', { value: tg.addr, disabled: ed, class: 'mono', onchange: e => { tg.addr = e.target.value.trim(); save(); } })),
            h('td', null, h('input', { value: tg.desc, disabled: ed, onchange: e => { tg.desc = e.target.value; save(); P.bus.emit('audit', { action: 'TAG_EDIT', detail: tg.name + ' description' }); } })), h('td', null, tg.unit),
            h('td', null, vcell), h('td', { style: { textAlign: 'center' } }, fcell),
            h('td', null, can && !tg.aux ? h('button', { class: 'btn sm bad', title: 'Delete tag', onclick: async () => { const uses = P.Program.xref(P.sim.plc.program, tg.name).length; if (await U.confirmBox(`Delete tag ${tg.name}?` + (uses ? ` It is used in ${uses} ladder element(s).` : ''))) { T.remove(tg.name); P.bus.emit('audit', { action: 'TAG_DELETE', detail: tg.name }); save(); render(); } } }, '\u2716') : ''));
          this.cells.push({ tg, vcell, fcell, row }); tb.appendChild(row);
        });
        info.textContent = n + ' tag(s) shown' + (n > 300 ? ' (first 300 - refine the search)' : '') + ' of ' + T.list.length;
      };
      body.append(h('div', { class: 'toolbar' }, q, ty, ar, can ? h('button', { class: 'btn primary', onclick: () => this.addTag(render) }, '+ Tag') : null,
        h('button', { class: 'btn', onclick: () => U.download('tags.csv', T.toCSV(), 'text/csv') }, 'Export CSV'), can ? h('button', { class: 'btn', onclick: async () => { const f = await U.pickFile('.csv'); if (!f) return; const r = T.fromCSV(f.text); save(); P.bus.emit('audit', { action: 'TAG_IMPORT', detail: f.name + ' +' + r.added + ' ~' + r.updated }); U.toast(`Imported: ${r.added} added, ${r.updated} updated` + (r.errors.length ? ', ' + r.errors.length + ' error(s): ' + r.errors[0] : ''), r.errors.length ? 'warn' : 'ok'); render(); } }, 'Import CSV') : null, info),
        !can ? h('div', { class: 'hint' }, 'View only. Engineer or Admin can edit tags. Values and forces apply live.') : null,
        h('div', { class: 'scroll', style: { maxHeight: '66vh' } }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Name', 'Type', 'Address', 'Description', 'Unit', 'Value', 'Force', ''].map(x => h('th', null, x)))), tb)));
      render();
    },
    updTags() {
      const act = document.activeElement;
      (this.cells || []).forEach(c => { if (c.vcell !== act) { const v = val(c.tg); if (c.vcell.value !== v) c.vcell.value = v; } if (c.fcell.checked !== c.tg.forced) { c.fcell.checked = c.tg.forced; c.row.classList.toggle('forced-row', c.tg.forced); } });
    },
    addTag(after) {
      const n = h('input', { placeholder: 'TAG_NAME' }), ty = h('select', null, ['BOOL', 'INT', 'REAL'].map(x => h('option', null, x))), ad = h('input', { placeholder: '%MX20.0' }), de = h('input', { placeholder: 'Description' });
      U.modal({ title: 'New tag', body: h('div', null, [['Name', n], ['Type', ty], ['Address', ad], ['Description', de]].map(r => h('div', { class: 'fld' }, h('label', null, r[0]), r[1]))), buttons: [{ label: t('Cancel') }, { label: t('Save'), primary: true, onclick: c => {
        const name = n.value.trim(); if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return U.toast('Invalid name (letters, digits, underscore)', 'err'); if (P.sim.tags.has(name)) return U.toast('Tag already exists', 'err');
        P.sim.tags.add({ name, type: ty.value, addr: ad.value.trim(), desc: de.value }); P.bus.emit('audit', { action: 'TAG_CREATE', detail: name }); P.bus.emit('tagsedited'); c(); after();
      } }] });
    },
    renameTag(tg, nn) {
      const old = tg.name; if (!nn || nn === old) return;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nn) || P.sim.tags.has(nn)) { U.toast('Invalid or duplicate tag name', 'err'); return; }
      const ed = this.ed; P.sim.tags.rename(old, nn); let n = P.Program.replaceTag(P.sim.plc.program, old, nn); n += P.Program.replaceTag(ed.draft, old, nn);
      P.Prog.saveProgram(P.sim.plc.program); P.bus.emit('tagsedited'); P.bus.emit('audit', { action: 'TAG_RENAME', detail: `${old} -> ${nn} (${n} ladder refs)` }); U.toast(`Renamed ${old} -> ${nn} (${n} ladder references updated). HMI/alarm configs still use the old name.`, 'warn');
    },

    /* ---------------------------------------------------------- watch & force */
    watchTab(body) {
      const T = P.sim.tags, can = P.session.canEdit(); this.wrows = {};
      const inp = h('input', { list: 'le-tags', placeholder: 'Add tag to watch...', style: { minWidth: '220px' } });
      const add = () => { const n = inp.value.trim(); if (!T.has(n)) return U.toast('Unknown tag', 'err'); if (!this.watch.includes(n)) this.watch.push(n); P.Store.set('watch', this.watch); inp.value = ''; this.build_tab(5, body); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
      const wtb = h('tbody'), ftb = h('tbody');
      this.watch.forEach(n => { const tg = T.tag(n); if (!tg) return; const v = h('td', { class: 'num' }); this.wrows[n] = v; wtb.appendChild(h('tr', null, h('td', { class: 'mono' }, n), h('td', null, tg.desc), v, h('td', null, can ? h('button', { class: 'btn sm', onclick: async () => { if (tg.type === 'BOOL') T.force(n, !tg.v, 'watch'); else { const x = await U.promptBox('Force ' + n, 'Value', val(tg)); if (x !== null) T.force(n, parseFloat(x) || 0, 'watch'); } } }, 'Force') : null, ' ', h('button', { class: 'btn sm', onclick: () => { this.watch = this.watch.filter(x => x !== n); P.Store.set('watch', this.watch); this.build_tab(5, body); } }, '\u2716')))); });
      this.ftb = ftb;
      body.append(h('div', { class: 'grid g2' }, h('div', { class: 'card' }, h('h3', null, 'Data watch table'), h('datalist', { id: 'le-tags' }, T.list.map(x => h('option', { value: x.name }))), h('div', { class: 'toolbar' }, inp, h('button', { class: 'btn', onclick: add }, 'Add')), h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Tag', 'Description', 'Value', ''].map(x => h('th', null, x)))), wtb)),
        h('div', { class: 'card' }, h('h3', null, 'Force table (all forced I/O)'), h('div', { class: 'hint' }, 'Forced items are shown in red and keep their value regardless of the program. Remove forces before leaving the plant in service.'), h('div', { class: 'btnrow' }, can ? h('button', { class: 'btn bad', onclick: () => { T.forcedTags().forEach(x => T.force(x.name, null, 'watch')); this.sig = null; } }, 'Release all forces') : null), h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Tag', 'Address', 'Forced value', ''].map(x => h('th', null, x)))), ftb))));
      this.sig = null;
    },
    updWatch() {
      const T = P.sim.tags; Object.keys(this.wrows || {}).forEach(n => { const tg = T.tag(n); if (!tg) return; const v = val(tg) + (tg.forced ? '  FORCED' : ''); const c = this.wrows[n]; if (c.textContent !== v) { c.textContent = v; c.style.color = tg.forced ? 'var(--bad)' : ''; } });
      const f = T.forcedTags(), sig = f.map(x => x.name + x.fv).join(); if (sig !== this.sig) { this.sig = sig; this.ftb.innerHTML = ''; f.forEach(x => this.ftb.appendChild(h('tr', { class: 'forced-row' }, h('td', { class: 'mono' }, x.name), h('td', null, x.addr), h('td', { class: 'num' }, val({ v: x.fv })), h('td', null, P.session.canEdit() ? h('button', { class: 'btn sm', onclick: () => { T.force(x.name, null, 'watch'); this.sig = null; } }, 'Release') : null)))); if (!f.length) this.ftb.appendChild(h('tr', null, h('td', { colspan: 4, class: 'hint' }, 'No forced I/O'))); }
    },

    /* ---------------------------------------------------------- cross-reference + search/replace */
    xrefTab(body) {
      const ed = this.ed, T = P.sim.tags;
      const inp = h('input', { list: 'le-tags2', value: this.xrefTag, placeholder: 'Tag name (e.g. Q_CONV)', style: { minWidth: '240px' } }), out = h('div');
      const rep = h('input', { list: 'le-tags2', placeholder: 'Replace with tag', style: { minWidth: '200px' } });
      const run = () => {
        const name = inp.value.trim(); this.xrefTag = name; out.innerHTML = ''; if (!name) return;
        const tg = T.tag(name); const uses = P.Program.xref(ed.draft, name);
        const hmi = [...((P.App.usage && P.App.usage[name]) || [])];
        const al = P.sim.alarms.defs.filter(d => d.tag === name).map(d => d.id + ' (' + d.pri + ')');
        const roles = { read: 'reads', write: 'writes', inst: 'instance' };
        out.append(h('div', { class: 'card' }, h('h3', null, name + (tg ? ' - ' + tg.desc : ' (undefined)')), tg ? h('div', { class: 'hint' }, tg.type + ' ' + tg.addr + ' = ' + val(tg)) : null,
          h('h4', null, 'Ladder (' + uses.length + ' use(s)) - click to open the rung'), h('table', { class: 'tbl' }, h('tr', null, ['Section', 'Rung', 'Element', 'Use', ''].map(x => h('th', null, x))), uses.length ? uses.map(u => h('tr', { class: 'clk', onclick: () => { this.tb.sel(0); ed.jump(u.rung.id, u.el.id); } }, h('td', null, u.section.name), h('td', null, u.rungIndex + 1), h('td', null, u.el.t.toUpperCase() + (u.via ? ' via ' + u.via : '')), h('td', null, roles[u.role]), h('td', null, '\u203a'))) : h('tr', null, h('td', { colspan: 5, class: 'hint' }, 'Not used in the program'))),
          h('h4', null, 'HMI screens'), h('div', null, hmi.length ? hmi.map(s => h('span', { class: 'tag', style: { marginInlineEnd: '4px' } }, s)) : h('span', { class: 'hint' }, 'none')), h('h4', null, 'Alarms'), h('div', null, al.length ? al.join(', ') : h('span', { class: 'hint' }, 'none'))));
      };
      inp.addEventListener('change', run); inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
      const doRep = async () => {
        if (!P.session.canEdit()) return U.toast('Engineer or Admin required', 'err'); const a = inp.value.trim(), b = rep.value.trim(); if (!a || !b) return U.toast('Enter both tags', 'err');
        if (!T.has(b)) return U.toast('Replacement tag is not defined - create it first (Tags tab)', 'err');
        const n = P.Program.xref(ed.draft, a).length; if (!n) return U.toast('Nothing to replace', 'warn');
        if (await U.confirmBox(`Replace ${a} with ${b} in ${n} ladder element(s)? The change is made in the draft; press Compile / Apply to run it.`, 'Replace')) {
          const p = P.Program.clone(ed.draft); P.Program.replaceTag(p, a, b); ed.setDraft(p, true); P.bus.emit('audit', { action: 'TAG_REPLACE', detail: `${a} -> ${b} (${n})` }); U.toast(n + ' replaced in draft. Open Ladder and Apply.', 'ok'); run();
        }
      };
      body.append(h('datalist', { id: 'le-tags2' }, T.list.map(x => h('option', { value: x.name }))), h('div', { class: 'toolbar' }, h('b', null, 'Cross-reference:'), inp, h('button', { class: 'btn primary', onclick: run }, 'Find'), h('span', { class: 'sep' }), h('b', null, 'Replace across program:'), rep, h('button', { class: 'btn bad', onclick: doRep }, 'Replace in all rungs')), out);
      run();
    },

    /* ---------------------------------------------------------- versions */
    versionsTab(body) {
      if (!P.FEATURES.versionHistory) return body.append('Disabled');
      const ed = this.ed, can = P.session.canEdit(), list = P.Versions.list(); let a = null, b = null;
      const nm = h('input', { placeholder: 'Snapshot name, e.g. "Before heater change"', style: { minWidth: '280px' } }), out = h('div');
      const cmp = () => { if (!a || !b || a === b) return U.toast('Tick two different versions to compare', 'warn'); const va = P.Versions.get(a), vb = P.Versions.get(b); const d = P.Versions.diff(va, vb); out.innerHTML = ''; out.append(h('div', { class: 'card' }, h('h3', null, `Compare "${va.name}" -> "${vb.name}"`), h('h4', null, 'Rungs: ' + d.rungs.length + ' difference(s)'), h('table', { class: 'tbl' }, d.rungs.map(r => h('tr', null, h('td', null, h('span', { class: 'tag ' + (r.kind === 'added' ? 'ok' : r.kind === 'removed' ? 'crit' : 'warn') }, r.kind)), h('td', null, r.sec + ' #' + r.idx), h('td', { class: 'mono' }, r.text + (r.was ? '   (was: ' + r.was + ')' : ''))))), d.rungs.length ? null : h('div', { class: 'hint' }, 'Program logic identical'), h('h4', null, 'Tags: ' + d.tags.length + ' difference(s)'), d.tags.length ? h('div', null, d.tags.map(x => h('div', null, h('span', { class: 'tag ' + (x.kind === 'added' ? 'ok' : x.kind === 'removed' ? 'crit' : 'warn') }, x.kind), ' ', x.name))) : h('div', { class: 'hint' }, 'Tag definitions identical'))); };
      body.append(h('div', { class: 'toolbar' }, nm, can ? h('button', { class: 'btn primary', onclick: () => { P.Versions.save(nm.value.trim() || 'Snapshot ' + new Date().toLocaleTimeString(), ed.draft, P.sim.tags.toJSON()); U.toast('Snapshot saved', 'ok'); this.build_tab(7, body); } }, 'Save snapshot of draft + tags') : null, h('button', { class: 'btn', onclick: () => { const cur = { program: ed.draft, tags: P.sim.tags.toJSON(), name: 'Current draft' }; if (!a) return U.toast('Tick one version to compare with the current draft', 'warn'); const va = P.Versions.get(a); const d = P.Versions.diff(va, cur); out.innerHTML = ''; out.append(h('div', { class: 'card' }, h('h3', null, `Compare "${va.name}" -> current draft`), d.rungs.length ? h('table', { class: 'tbl' }, d.rungs.map(r => h('tr', null, h('td', null, r.kind), h('td', null, r.sec + ' #' + r.idx), h('td', { class: 'mono' }, r.text)))) : h('div', { class: 'hint' }, 'No logic differences'), h('div', null, 'Tag differences: ' + d.tags.length))); } }, 'Compare first tick with current'), h('button', { class: 'btn', onclick: cmp }, 'Compare two ticked')),
        h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Compare', 'Name', 'Saved', 'User', 'Rungs', ''].map(x => h('th', null, x)))), h('tbody', null, list.length ? list.slice().reverse().map(v => h('tr', null, h('td', null, h('input', { type: 'checkbox', onchange: e => { if (e.target.checked) { if (!a) a = v.id; else b = v.id; } else { if (a === v.id) a = b, b = null; else b = null; } } })), h('td', null, v.name), h('td', null, new Date(v.ts).toLocaleString()), h('td', null, v.user), h('td', { class: 'num' }, P.Program.stats(v.program).rungs),
          h('td', null, can ? h('button', { class: 'btn sm', onclick: async () => { if (await U.confirmBox('Restore "' + v.name + '"? The program becomes the draft and is applied to the PLC; tags from the snapshot are loaded.', 'Restore')) { P.sim.tags.load(JSON.parse(JSON.stringify(v.tags))); P.sim.tags.list.length; ed.setDraft(v.program, true); P.bus.emit('tagsedited'); ed.apply(); P.bus.emit('audit', { action: 'VERSION_RESTORE', detail: v.name }); this.build_tab(7, body); } } }, 'Restore') : null, ' ', can ? h('button', { class: 'btn sm bad', onclick: () => { P.Versions.remove(v.id); this.build_tab(7, body); } }, '\u2716') : null))) : h('tr', null, h('td', { colspan: 6, class: 'hint' }, 'No snapshots yet')))), out);
    },

    /* ---------------------------------------------------------- listing */
    listingTab(body) {
      const ed = this.ed, st = P.Program.stats(ed.draft); const rows = [];
      ed.draft.sections.forEach(s => s.rungs.forEach((r, i) => { if (r.comment || r.bookmark) rows.push([s.name, i + 1, r.comment || '', r.bookmark ? '\u2605' : '']); }));
      body.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: () => { const w = window.open('', '_blank'); if (!w) return U.toast('Allow pop-ups to print the listing', 'warn'); w.document.write(P.Eng.listingHTML(ed.draft, P.sim.tags)); w.document.close(); } }, '\ud83d\udda8 Printable program listing'), h('span', null, `${st.sections} sections, ${st.rungs} rungs, ${st.elements} elements`)),
        h('div', { class: 'grid g2' }, h('div', { class: 'card' }, h('h3', null, 'Section descriptions'), h('table', { class: 'tbl' }, ed.draft.sections.map(s => h('tr', null, h('td', null, h('b', null, s.name)), h('td', null, s.desc || ''), h('td', { class: 'num' }, s.rungs.length))))),
          h('div', { class: 'card' }, h('h3', null, 'Rung comments and bookmarks'), h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, rows.map(r => h('tr', { class: 'clk', onclick: () => { const sec = ed.draft.sections.find(s => s.name === r[0]); this.tb.sel(0); ed.jump(sec.rungs[r[1] - 1].id); } }, h('td', null, r[0] + ' #' + r[1]), h('td', null, r[2]), h('td', null, r[3]))))))));
    }
  });

  /* ============================================================ PID TUNING ============================================================ */
  /** Run the real PLC PID block against a first-order thermal model (offline preview / auto-tune) */
  function simLoop(kp, ki, kd, opt) {
    opt = opt || {}; const tags = new P.TagDB();
    tags.load([{ name: 'PV', type: 'REAL', init: opt.t0 || 25 }, { name: 'SP', type: 'REAL', init: opt.sp || 85 }, { name: 'OUT', type: 'REAL' }, { name: 'KP', type: 'REAL', init: kp }, { name: 'KI', type: 'REAL', init: ki }, { name: 'KD', type: 'REAL', init: kd }]);
    const plc = new P.PLC(tags); plc.scanMs = 100; plc.load({ sections: [{ name: 'x', rungs: [{ cond: { t: 'ser', items: [] }, outs: [{ t: 'pid', tag: 'P1', pv: 'PV', sp: 'SP', out: 'OUT', kp: 'KP', ki: 'KI', kd: 'KD' }] }] }] }); plc.run();
    const m = opt.mass || 40, pv = [], sp = [], out = []; let T = opt.t0 || 25;
    for (let k = 0; k < (opt.n || 2400); k++) {
      tags.set('PV', T); plc.scan(100); const u = tags.get('OUT');
      T += (150 * u / 100 - 0.15 * (T - 25)) * 0.1 / (Math.max(m, 12) * 4.18);
      if (k % 5 === 0) { pv.push(T); sp.push(tags.get('SP')); out.push(u); }
    }
    return { pv, sp, out };
  }
  function relayTune() {
    const d = 40, bias = 45, sp = 80, hys = 0.4; let T = 70, u = bias + d, dir = 1; const cross = [], peaks = []; let hi = -1e9, lo = 1e9;
    for (let k = 0; k < 20000 && cross.length < 9; k++) {
      T += (150 * u / 100 - 0.15 * (T - 25)) * 0.1 / (40 * 4.18);
      if (T > hi) hi = T; if (T < lo) lo = T;
      if (dir === 1 && T > sp + hys) { dir = -1; u = bias - d; cross.push(k * 0.1); peaks.push(hi); hi = -1e9; } else if (dir === -1 && T < sp - hys) { dir = 1; u = bias + d; cross.push(k * 0.1); peaks.push(lo); lo = 1e9; }
    }
    if (cross.length < 7) return null;
    const pu = (cross[cross.length - 1] - cross[cross.length - 5]) / 2, amp = (peaks[peaks.length - 2] - peaks[peaks.length - 1]) / 2, a = Math.abs(amp), ku = 4 * d / (Math.PI * Math.max(a, 0.05));
    const kp = 0.6 * ku * 0.5, ti = pu / 2, td = pu / 8;       // classic ZN PID, halved for less overshoot
    return { ku, pu, kp, ki: kp / ti, kd: kp * td };
  }
  P.defScreen({
    id: 'pidtune', title: 'PID Tuning', group: 'Engineering', icon: '\u223f',
    build(root) {
      const can = P.session.canEdit(); this.can = can; this.sl = {};
      const mk = (name, tag, min, max, step) => { const out = h('b', { class: 'mono' }), r = h('input', { type: 'range', min, max, step, disabled: !can, oninput: e => { P.Op.set(tag, parseFloat(e.target.value), tag + ' (PID tuning)'); out.textContent = e.target.value; } }); this.sl[tag] = { r, out }; return h('div', { class: 'fld' }, h('label', null, name + ': ', out), r); };
      this.cvL = h('canvas', { class: 'chart' }); this.cvS = h('canvas', { class: 'chart' }); this.res = h('div', { class: 'hint' });
      const ch = new P.Charts.TimeChart(this.cvL, { height: 220, span: 180000, source: (a, b, n) => P.Hist.range(a, b, n), now: () => P.sim.clock(), series: [{ key: 'tt', label: 'PV', color: '#c8102e' }, { key: 'sp', label: 'SP', color: '#1f5f8b', dash: true }, { key: 'heat', label: 'Output %', color: '#e07b00', axis: 1, min: 0, max: 100 }], title: 'Live loop response (TT-201)' }); this.ch = ch;
      root.append(!can ? h('div', { class: 'hint' }, 'View only: Engineer or Admin role is needed to change PID parameters.') : null,
        h('div', { class: 'grid g2' }, h('div', { class: 'card' }, h('h3', null, 'Temperature loop TIC-201'), mk('Kp (% per \u00b0C)', 'KP_TEMP', 0, 40, 0.1), mk('Ki (% per \u00b0C\u00b7s)', 'KI_TEMP', 0, 2, 0.01), mk('Kd (%\u00b7s per \u00b0C)', 'KD_TEMP', 0, 150, 1),
          h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', onclick: () => this.preview() }, 'Simulate step response (25 \u2192 85 \u00b0C)'), h('button', { class: 'btn', disabled: !can, onclick: () => this.autotune() }, 'Auto-tune demo (relay method)'), h('button', { class: 'btn', disabled: !can, onclick: () => { P.Op.set('KP_TEMP', 8, 'KP'); P.Op.set('KI_TEMP', 0.25, 'KI'); P.Op.set('KD_TEMP', 30, 'KD'); this.sync(true); } }, 'Defaults')), this.res,
          h('div', { class: 'hint' }, 'Changes apply to the running plant immediately (audited). The step-response preview runs the real PLC PID block against a model of the pasteurizer offline, so you can try gains without disturbing production.')),
          h('div', { class: 'card' }, h('div', { class: 'legend' }, [['PV', '#c8102e'], ['Setpoint', '#1f5f8b'], ['Output %', '#e07b00']].map(l => h('span', null, h('i', { style: { background: l[1] } }), l[0]))), this.cvL)),
        h('div', { class: 'card', style: { marginTop: '12px' } }, h('h3', null, 'Step-response preview (offline model)'), this.cvS));
      this.sync(true); setTimeout(() => { ch.draw(); this.preview(true); }, 40);
    },
    sync(force) { Object.keys(this.sl).forEach(k => { const s = this.sl[k]; if (force || document.activeElement !== s.r) { s.r.value = V(k); s.out.textContent = (+V(k)).toFixed(2); } }); },
    preview(quiet) {
      const r = simLoop(V('KP_TEMP'), V('KI_TEMP'), V('KD_TEMP')); this.last = r;
      P.Charts.lineArr(this.cvS, { height: 230, dt: 0.5, series: [{ label: 'PV', color: '#c8102e', y: r.pv }, { label: 'SP', color: '#1f5f8b', dash: true, y: r.sp }, { label: 'Output %', color: '#e07b00', y: r.out.map(x => 25 + x * 0.6) }] });
      const peak = Math.max(...r.pv), ov = Math.max(0, peak - 85); let ts = r.pv.length; for (let i = r.pv.length - 1; i >= 0; i--) { if (Math.abs(r.pv[i] - 85) > 1) { ts = i + 1; break; } }
      const rise = r.pv.findIndex(x => x >= 76.5); if (!quiet || true) this.res.textContent = `Preview: overshoot ${ov.toFixed(1)} \u00b0C, rise time (90 %) ${rise < 0 ? 'n/a' : (rise * 0.5).toFixed(0) + ' s'}, settling (\u00b11 \u00b0C) ${ts >= r.pv.length ? 'not settled in 120 s' : (ts * 0.5).toFixed(0) + ' s'}. (Output curve scaled for display.)`;
      P.bus.emit('tune:preview', { overshoot: ov });
    },
    autotune() {
      const r = relayTune(); if (!r) return U.toast('Relay test did not oscillate - try again', 'err');
      P.Op.set('KP_TEMP', +r.kp.toFixed(2), 'KP (auto-tune)'); P.Op.set('KI_TEMP', +r.ki.toFixed(3), 'KI (auto-tune)'); P.Op.set('KD_TEMP', +r.kd.toFixed(1), 'KD (auto-tune)'); this.sync(true); this.preview();
      this.res.textContent = `Auto-tune: ultimate gain Ku = ${r.ku.toFixed(1)}, ultimate period Pu = ${r.pu.toFixed(1)} s \u2192 Kp ${r.kp.toFixed(2)}, Ki ${r.ki.toFixed(3)}, Kd ${r.kd.toFixed(1)} (Ziegler-Nichols PID, applied). ` + this.res.textContent; P.bus.emit('tune:auto', r);
    },
    update() { this.ch.draw(); this.sync(false); }
  });

  /* ============================================================ MODBUS ============================================================ */
  P.defScreen({
    id: 'modbus', title: 'Modbus Map', group: 'Engineering', icon: '\u21c4',
    build(root) {
      if (!P.FEATURES.modbus) return root.append('Disabled');
      this.mm = P.Eng.modbusMap(P.sim.tags); this.cells = [];
      const names = [['coils', 'Coils (0x) FC01/05', 1], ['di', 'Discrete inputs (1x) FC02', 10001], ['ir', 'Input registers (3x) FC04', 30001], ['hr', 'Holding registers (4x) FC03/06', 40001]];
      this.tb = tabs(root, names.map(n => n[1]).concat('Frame simulator'), (i, body) => {
        this.i = i; this.cells = []; body.innerHTML = '';
        if (i < 4) {
          const area = names[i][0], base = names[i][2], list = this.mm.map[area], isReg = area === 'ir' || area === 'hr';
          body.append(h('p', { class: 'hint' }, 'Simulated Modbus TCP server (unit id 1). Addresses are 5-digit Modicon style. ' + (isReg ? 'Registers are 16-bit signed; REAL values are scaled x10.' : 'Bit values.')),
            h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Modbus addr', 'Offset', 'Tag', 'PLC address', 'Type', 'Description', 'Raw value'].map(x => h('th', null, x)))), h('tbody', null, list.map((tg, k) => { const c = h('td', { class: 'num' }); this.cells.push({ tg, c }); return h('tr', null, h('td', { class: 'mono' }, base + k), h('td', null, k), h('td', { class: 'mono' }, tg.name), h('td', { class: 'mono' }, tg.addr), h('td', null, tg.type), h('td', null, tg.desc), c); })))));
        } else this.frameTab(body);
      }, this.i || 0);
    },
    frameTab(body) {
      const fc = h('select', null, [[1, '01 Read Coils'], [2, '02 Read Discrete Inputs'], [3, '03 Read Holding Registers'], [4, '04 Read Input Registers']].map(x => h('option', { value: x[0] }, x[1]))); fc.value = '4';
      const st = h('input', { type: 'number', value: 0, min: 0, style: { width: '80px' } }), qt = h('input', { type: 'number', value: 6, min: 1, max: 40, style: { width: '70px' } }); const out = h('div'); const pk = h('div', { class: 'mb-pkt', style: { height: '26px', position: 'relative', overflow: 'hidden', background: 'var(--panel)', borderRadius: '4px', margin: '8px 0' } });
      const run = () => {
        const r = P.Eng.modbusFrame(this.mm, parseInt(fc.value), parseInt(st.value) || 0, parseInt(qt.value) || 1); out.innerHTML = '';
        out.append(h('div', { class: 'card' }, h('h4', null, 'Request (HMI/SCADA \u2192 PLC), MBAP + PDU'), h('pre', { class: 'st' }, r.req), h('h4', null, 'Response (PLC \u2192 HMI/SCADA)'), h('pre', { class: 'st' }, r.resp), h('table', { class: 'tbl' }, r.rows.map((tg, k) => h('tr', null, h('td', { class: 'mono' }, (parseInt(st.value) || 0) + k), h('td', { class: 'mono' }, tg ? tg.name : '-'), h('td', { class: 'num' }, tg ? this.mm.raw(tg) : 0))))));
        pk.innerHTML = '<span style="position:absolute;left:0;top:3px;padding:0 8px;background:var(--accent);color:var(--accent-ink);border-radius:3px;animation:pk 1.2s linear">REQ \u2192</span>';
      };
      body.append(h('style', null, '@keyframes pk{from{left:0}to{left:calc(100% - 70px)}}'), h('div', { class: 'toolbar' }, h('label', null, 'Function '), fc, h('label', null, 'Start offset '), st, h('label', null, 'Quantity '), qt, h('button', { class: 'btn primary', onclick: run }, 'Send request')), pk, out, h('p', { class: 'hint' }, 'This builds the exact bytes a Modbus TCP master would send and the PLC would answer, using the live tag values. There is no real network in a static website - the link is simulated in the browser.')); run();
    },
    update() { (this.cells || []).forEach(x => { const v = String(this.mm.raw(x.tg)); if (x.c.textContent !== v) x.c.textContent = v; }); }
  });

  /* ============================================================ CAUSE & EFFECT ============================================================ */
  P.defScreen({
    id: 'ce', title: 'Cause & Effect', group: 'Engineering', icon: '\u2573',
    build(root) {
      const CE = P.CAUSE_EFFECT; this.rows = [];
      root.append(h('p', { class: 'hint' }, 'Which fault trips which equipment. "X" = the equipment is de-energised or inhibited by that cause. A row lights up red while its alarm is active. This matrix mirrors the Safety and actuator rungs of the ladder program.'),
        h('div', { class: 'scroll', style: { maxHeight: 'none' } }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, [h('th', null, 'Cause'), h('th', null, 'Alarm')].concat(CE.effects.map(e => h('th', { style: { textAlign: 'center' } }, e[1]))).concat(h('th', null, 'Scope')))),
          h('tbody', null, CE.causes.map(c => { const tr = h('tr', null, h('td', null, c.name), h('td', { class: 'mono' }, c.alarm || '(heater rung)'), CE.effects.map(e => h('td', { style: { textAlign: 'center', fontWeight: 700 } }, c.marks.includes(e[0]) ? 'X' : '')), h('td', null, c.global ? 'Plant trip (latched)' : 'Local interlock')); this.rows.push({ c, tr }); return tr; })))));
    },
    update() { const am = P.sim.alarms; this.rows.forEach(r => { const on = r.c.alarm ? (am.inst[r.c.alarm] && am.inst[r.c.alarm].state !== 'normal' && am.inst[r.c.alarm].state !== 'rtn_unack') : (V('Q_HEATER') === false && V('AI_LT201') < 3 && V('SEQ_STEP') >= 60); r.tr.style.background = on ? 'color-mix(in srgb, var(--bad) 22%, transparent)' : ''; }); }
  });

  /* ============================================================ AUDIT TRAIL ============================================================ */
  P.defScreen({
    id: 'audit', title: 'Audit Trail', group: 'Engineering', icon: '\ud83d\udcdc',
    build(root) {
      const q = h('input', { type: 'text', placeholder: 'Filter by user, action or detail...', style: { minWidth: '280px' }, oninput: () => { this.q = q.value.toLowerCase(); this.sig = null; } });
      this.tb = h('div', { class: 'scroll', style: { maxHeight: '70vh' } }); this.sig = null; this.q = '';
      root.append(h('div', { class: 'toolbar' }, q, h('button', { class: 'btn', onclick: () => U.download('audit-trail.csv', P.Audit.toCSV(), 'text/csv') }, t('Export CSV')), P.session.isAdmin() ? h('button', { class: 'btn bad', onclick: async () => { if (await U.confirmBox('Clear the audit trail? (Admin only; this action itself is logged.)')) { P.Audit.clear(); P.Audit.log('AUDIT_CLEARED', ''); this.sig = null; } } }, 'Clear (Admin)') : h('small', null, 'Only Admin can clear the log')), this.tb);
    },
    update() {
      const L = P.Audit.list; const sig = L.length + '|' + this.q; if (sig === this.sig) return; this.sig = sig;
      const rows = L.slice().reverse().filter(e => !this.q || (e.user + e.action + e.detail).toLowerCase().includes(this.q)).slice(0, 400);
      this.tb.innerHTML = ''; this.tb.appendChild(h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Timestamp', 'User', 'Role', 'Action', 'Detail'].map(x => h('th', null, x)))), h('tbody', null, rows.map(e => h('tr', null, h('td', { class: 'mono' }, U.fmtDT(e.ts)), h('td', null, e.user), h('td', null, e.role), h('td', { class: 'mono' }, e.action), h('td', null, e.detail))))));
    }
  });

  /* ============================================================ DOCUMENTATION ============================================================ */
  P.defScreen({
    id: 'docs', title: 'Documentation', group: 'Engineering', icon: '\ud83d\udcd8',
    build(root) {
      const D = P.Eng.docs, T = P.sim.tags;
      const tbl = (cols, rows, name) => h('div', null, h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: () => U.download(name + '.csv', U.csv([cols].concat(rows)), 'text/csv') }, t('Export CSV')), h('button', { class: 'btn', onclick: () => window.print() }, t('Print')), h('small', null, rows.length + ' rows (auto-generated from the live tag database)')), h('div', { class: 'scroll', style: { maxHeight: '68vh' } }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, cols.map(c => h('th', null, c)))), h('tbody', null, rows.map(r => h('tr', null, r.map(c => h('td', null, String(c)))))))));
      tabs(root, ['I/O list', 'Tag list', 'Equipment list', 'Sequence of operations'], (i, b) => {
        if (i === 0) b.append(tbl(['Address', 'Tag', 'Type', 'Description', 'Unit'], D.ioList(T), 'io-list'));
        else if (i === 1) b.append(tbl(['Tag', 'Type', 'Address', 'Description', 'Unit', 'Value'], D.tagList(T), 'tag-list'));
        else if (i === 2) b.append(tbl(['Tag', 'Description', 'Area / class', 'Rating / unit', 'PLC tag'], D.equipment(), 'equipment-list'));
        else b.append(h('div', { class: 'card' }, h('h3', null, 'Sequence of operations'), D.sequence.map((s, k) => h('p', null, h('b', null, (k + 1) + '. '), s))));
      });
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
