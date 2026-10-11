/* ==========================================================================
   app.js - HMI shell: login (roles), navigation + breadcrumbs, alarm banner,
   clock, theme / language, screen lock + auto-logout, keyboard shortcuts,
   alarm sound, faceplates.  Screens register themselves with P.defScreen().
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};
  const U = P.UI, h = U.h, t = P.t, $ = U.$;
  const SCREENS = {}, ORDER = [];
  /** P.defScreen({id, title, group, icon, build(root, ctx), update(), destroy()}) */
  P.defScreen = d => { SCREENS[d.id] = d; ORDER.push(d.id); };
  P.Screens = SCREENS;
  const GROUPS = ['Operate', 'Monitor', 'Production', 'Engineering', 'Learn'];

  const App = {
    cur: null, curId: null, soundOn: true, lastNew: 0, lastBeep: 0, lastAct: Date.now(), locked: false,

    /* --------------------------------------------------------------- login */
    showLogin() {
      document.body.classList.add('loggedout');
      const old = $('#app'); if (old) old.remove();
      const u = h('input', { type: 'text', value: '', autocomplete: 'username', placeholder: 'operator / engineer / admin' });
      const pw = h('input', { type: 'password', value: '', autocomplete: 'current-password', placeholder: 'same as user name' });
      const err = h('div', { class: 'hint err' });
      const go = (user, pass) => {
        const acc = P.users[(user || '').toLowerCase()];
        if (!acc || acc.pass !== pass) { err.textContent = 'Wrong user name or password. Demo accounts: operator, engineer, admin (password = user name).'; return; }
        P.session.user = user.toLowerCase(); P.session.role = acc.role; P.Audit.log('LOGIN', acc.role); wrap.remove(); this.start();
      };
      const wrap = h('div', { class: 'login-wrap' }, h('div', { class: 'login' },
        h('h2', null, 'Smart Beverage Plant'), h('div', { class: 'hint' }, 'Filling & packaging line - PLC + HMI/SCADA simulator'),
        h('div', { class: 'fld' }, h('label', null, t('User')), u), h('div', { class: 'fld' }, h('label', null, t('Password')), pw), err,
        h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', onclick: () => go(u.value, pw.value) }, t('Login'))),
        h('div', { class: 'hint' }, 'Quick demo sign-in:'),
        h('div', { class: 'quick' }, ['operator', 'engineer', 'admin'].map(n => h('button', { class: 'btn', onclick: () => go(n, n) }, t(P.users[n].role)))),
        h('p', { class: 'hint' }, 'Operator: view and operate. Engineer / Admin: also edit ladder logic, tags and tuning. Admin can clear the audit trail.')));
      pw.addEventListener('keydown', e => { if (e.key === 'Enter') go(u.value, pw.value); });
      document.body.appendChild(wrap); setTimeout(() => u.focus(), 50);
    },

    /* --------------------------------------------------------------- shell */
    start() {
      document.body.classList.remove('loggedout');
      const mob = g.matchMedia && g.matchMedia('(max-width: 900px)').matches;
      this.navEl = h('nav', { class: 'nav', 'aria-label': 'Screens' });
      this.main = h('main', { class: 'main', id: 'main' });
      this.crumb = h('div', { class: 'crumbs' });
      this.clock = h('div', { class: 'clock' });
      this.banner = h('div', { class: 'banner normal', role: 'status', 'aria-live': 'polite' });
      this.statusEl = h('div', { class: 'status' });
      const hdr = h('header', { class: 'hdr' },
        h('button', { class: 'btn menu-btn', onclick: () => this.el.classList.toggle('navopen'), 'aria-label': 'Menu' }, '\u2630'),
        h('div', { class: 'brand' }, 'Smart Beverage Plant', h('small', null, 'PLC + HMI/SCADA simulator')), this.crumb, this.clock,
        P.FEATURES.urdu ? h('button', { class: 'btn', id: 'b-lang', title: t('Language'), onclick: () => { P.I18N.set(P.I18N.lang === 'en' ? 'ur' : 'en'); } }, P.I18N.lang === 'en' ? '\u0627\u0631\u062f\u0648' : 'EN') : null,
        h('button', { class: 'btn', id: 'b-theme', title: t('Theme'), onclick: () => this.toggleTheme() }, '\u25d0'),
        P.FEATURES.sound ? h('button', { class: 'btn', id: 'b-snd', title: t('Sound'), onclick: () => this.toggleSound() }, '\ud83d\udd0a') : null,
        P.FEATURES.screenLock ? h('button', { class: 'btn', title: t('Lock screen'), onclick: () => this.lock() }, '\ud83d\udd12') : null,
        h('button', { class: 'btn', title: t('Help'), onclick: () => this.help() }, '?'),
        h('button', { class: 'btn', id: 'b-user', title: 'Sign out', onclick: () => this.logout() }, P.session.user + ' (' + t(P.session.role) + ') \u23fb'));
      this.el = h('div', { class: 'app', id: 'app' }, hdr, this.banner, this.navEl, this.main, this.statusEl);
      document.body.appendChild(this.el);
      this.buildNav(); this.buildStatus();
      this.soundOn = P.Store.get('sound', true); this.updateSoundBtn();
      // events
      if (!this.wired) { this.wired = true; this.wire(); }
      P.Hist && 0;
      const first = mob ? 'panel' : (P.Store.get('screen', 'overview'));
      this.go(SCREENS[first] ? first : 'overview');
      this.collectUsage();
      if (P.Tour && P.FEATURES.tour && !P.Store.get('tourDone', false)) setTimeout(() => P.Tour.start(), 600);
    },

    buildNav() {
      const N = this.navEl; N.innerHTML = '';
      GROUPS.forEach(gr => {
        N.appendChild(h('h5', null, t(gr)));
        ORDER.filter(id => SCREENS[id].group === gr && !SCREENS[id].hidden).forEach(id => {
          const d = SCREENS[id];
          N.appendChild(h('button', { id: 'nav-' + id, class: id === this.curId ? 'on' : '', onclick: () => { this.go(id); this.el.classList.remove('navopen'); } }, h('span', null, d.icon || '\u25aa'), h('span', null, t(d.title)), id === 'alarms' ? h('span', { class: 'bd', id: 'nav-alm', style: { display: 'none' } }, '0') : null));
        });
      });
    },

    go(id) {
      const d = SCREENS[id]; if (!d) return;
      if (this.cur && this.cur.destroy) { try { this.cur.destroy(); } catch (e) { console.error(e); } }
      this.main.innerHTML = ''; this.main.scrollTop = 0;
      const root = h('div', { class: 'screen', id: 'scr-' + id }); this.main.appendChild(root);
      this.cur = d; this.curId = id; P.Store.set('screen', id);
      try { d.build(root, this); } catch (e) { console.error('screen build failed', id, e); root.appendChild(h('div', { class: 'card' }, 'Screen error: ' + e.message)); }
      this.crumb.innerHTML = ''; this.crumb.append(t('Home'), ' \u203a ', t(d.group), ' \u203a ', h('b', null, t(d.title)));
      this.navEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.id === 'nav-' + id));
      P.bus.emit('screen', id); this.frame(true);
    },

    /** Which HMI screens use which tag (for the cross-reference tool): build every screen once, off-screen. */
    collectUsage() {
      this.usage = {};
      const tagNames = new Set(P.sim.tags.list.map(x => x.name));
      ORDER.forEach(id => {
        const d = SCREENS[id]; let src = (d.build.toString() + (d.update ? d.update.toString() : '') + (d.src || ''));
        try { const tmp = h('div'); const saved = this.cur; d.build(tmp, this); src += tmp.innerHTML; if (d.destroy) d.destroy(); this.cur = saved; } catch (e) { /* ignore */ }
        (src.match(/[A-Za-z_][A-Za-z0-9_.]*/g) || []).forEach(tok => { const base = tok; if (tagNames.has(base)) { (this.usage[base] = this.usage[base] || new Set()).add(d.title); } });
      });
      this.cur && this.cur.build && 0;
      // restore the live screen (collectUsage ran its build into a detached node; rebuild current for event wiring)
      if (this.curId) { const keep = this.curId; this.go(keep); }
    },

    /* --------------------------------------------------------------- status bar */
    buildStatus() {
      const sim = P.sim, S = this.statusEl; S.innerHTML = '';
      this.dotEl = h('span', { class: 'dot' }); this.modeEl = h('span'); this.scanEl = h('span'); this.plantEl = h('b');
      const spd = h('select', { id: 'spd', title: t('Simulation speed'), onchange: e => { sim.speed = parseFloat(e.target.value); P.Audit.log('SIM_SPEED', sim.speed + 'x'); } }, P.SIM.speeds.map(s => h('option', { value: s }, s + 'x')));
      spd.value = String(sim.speed); this.spdSel = spd;
      this.pauseB = h('button', { class: 'btn sm', onclick: () => { sim.paused = !sim.paused; } }, '\u23f8');
      const stepB = h('button', { class: 'btn sm', title: t('Single scan'), onclick: () => { sim.paused = true; sim.step(); this.frame(true); } }, '\u23ed');
      S.append(h('span', null, this.dotEl, h('b', null, 'PLC '), this.modeEl), this.scanEl, h('span', null, t('Simulation speed') + ' ', spd, ' ', this.pauseB, ' ', stepB), h('span', { style: { marginInlineStart: 'auto' } }, this.plantEl), h('span', null, 'v' + P.VERSION));
    },

    /* --------------------------------------------------------------- per-frame update */
    frame(force) {
      if (!this.el || !this.el.isConnected) return;
      const sim = P.sim, T = sim.tags, am = sim.alarms;
      // clock
      this.clock.innerHTML = ''; const c = sim.clock(); this.clock.append(U.fmtTime(c), h('small', null, U.fmtDT(c).slice(0, 10) + ' \u00b7 ' + (sim.paused ? 'PAUSED' : sim.speed + 'x')));
      // status bar
      const run = sim.plc.mode === 'run';
      this.dotEl.className = 'dot ' + (run ? (sim.paused ? 'paused' : 'run') : 'stop'); this.modeEl.textContent = run ? (sim.paused ? 'RUN (paused)' : 'RUN') : 'STOP';
      this.scanEl.textContent = `scan ${sim.plc.scanMs} ms \u00b7 cpu ${sim.plc.lastScanMs.toFixed(2)} ms \u00b7 #${sim.plc.scanCount}`;
      this.pauseB.textContent = sim.paused ? '\u25b6' : '\u23f8'; if (this.spdSel.value !== String(sim.speed)) this.spdSel.value = String(sim.speed);
      const st = T.get('TRIP') ? t('Tripped') : T.get('PLANT_RUN') ? t('Running') + ' \u00b7 step ' + T.get('SEQ_STEP') : t('Stopped'); this.plantEl.textContent = t('Plant') + ': ' + st + (T.get('M_AUTO') ? ' \u00b7 ' + t('Auto') : ' \u00b7 ' + t('Manual'));
      // banner
      const top = am.banner(), cn = am.counts(), unackAny = T.get('ALM_UNACK');
      this.banner.className = 'banner ' + (top ? top.def.pri : 'normal') + (top && top.state === 'active_unack' ? ' blink unack' : '');
      this.banner.innerHTML = '';
      if (top) {
        this.banner.append(h('span', { class: 'pill', style: { background: 'rgba(0,0,0,.25)' } }, top.def.pri), h('b', null, top.def.id), ' ', top.def.text, top.rec ? h('small', { style: { color: 'inherit', opacity: .8 } }, ' ' + U.fmtTime(top.rec.tActive)) : null,
          top.state === 'active_unack' || unackAny ? h('button', { class: 'btn sm', onclick: () => { am.ackAll(P.session.user); this.frame(true); } }, t('Acknowledge all')) : null);
      } else this.banner.append('\u2713 ' + t('No active alarms'));
      if (am.flood) this.banner.append(h('span', { class: 'flood' }, 'ALARM FLOOD'));
      this.banner.append(h('span', { class: 'cnt' }, ['Critical', 'High', 'Medium', 'Low'].map(p => h('span', { style: cn[p] ? { background: P.PRI_COLOR[p], color: '#fff' } : {} }, p[0] + ' ' + cn[p]))));
      const nb = $('#nav-alm'); if (nb) { const n = am.activeList().filter(x => !x.shelved).length; nb.style.display = n ? '' : 'none'; nb.textContent = n; }
      // sound
      if (am.newCount !== this.lastNew) { this.lastNew = am.newCount; if (this.soundOn) this.beep(top ? top.def.pri : 'Low'); }
      else if (this.soundOn && T.get('ALM_CRIT_UNACK') && Date.now() - this.lastBeep > 4000) this.beep('Critical');
      // screen
      if (this.cur && this.cur.update && !this.locked) { try { this.cur.update(this.main, force); } catch (e) { if (!this._errd) { console.error('screen update error', this.curId, e); this._errd = true; } } }
      // inactivity
      if (P.FEATURES.autoLogout || P.FEATURES.screenLock) {
        const idle = (Date.now() - this.lastAct) / 1000;
        if (P.FEATURES.screenLock && !this.locked && idle > P.SIM.lockAfterSec) this.lock();
        if (P.FEATURES.autoLogout && idle > P.SIM.logoutAfterSec) this.logout(true);
      }
    },

    /* --------------------------------------------------------------- misc controls */
    toggleTheme() { const d = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = d; P.Store.set('theme', d); P.bus.emit('theme', d); },
    toggleSound() { this.soundOn = !this.soundOn; P.Store.set('sound', this.soundOn); this.updateSoundBtn(); },
    updateSoundBtn() { const b = $('#b-snd'); if (b) b.textContent = this.soundOn ? '\ud83d\udd0a' : '\ud83d\udd07'; },
    beep(pri) {
      try {
        this.lastBeep = Date.now(); this.ac = this.ac || new (g.AudioContext || g.webkitAudioContext)(); const ac = this.ac; if (ac.state === 'suspended') ac.resume();
        const n = pri === 'Critical' ? 3 : pri === 'High' ? 2 : 1, f = pri === 'Critical' ? 980 : pri === 'High' ? 740 : 520;
        for (let i = 0; i < n; i++) { const o = ac.createOscillator(), gn = ac.createGain(); o.frequency.value = f; o.type = 'square'; gn.gain.value = 0.04; o.connect(gn); gn.connect(ac.destination); const t0 = ac.currentTime + i * 0.22; o.start(t0); o.stop(t0 + 0.14); }
      } catch (e) { /* audio not available */ }
    },
    lock() {
      if (this.locked || !P.session.user) return; this.locked = true;
      const pw = h('input', { type: 'password', placeholder: t('Password'), style: { width: '100%', marginBottom: '8px' } }), er = h('div', { class: 'hint err' });
      const ov = h('div', { class: 'lock' }, h('div', { class: 'box' }, h('h3', null, '\ud83d\udd12 ' + t('Lock screen')), h('div', { class: 'hint' }, P.session.user + ' - the plant keeps running'), pw, er,
        h('button', { class: 'btn primary', onclick: () => { if (pw.value === P.users[P.session.user].pass) { ov.remove(); this.locked = false; this.lastAct = Date.now(); P.Audit.log('UNLOCK', ''); } else er.textContent = 'Wrong password'; } }, t('Unlock')),
        h('button', { class: 'btn', style: { marginInlineStart: '6px' }, onclick: () => { ov.remove(); this.locked = false; this.logout(); } }, t('Logout'))));
      pw.addEventListener('keydown', e => { if (e.key === 'Enter') ov.querySelector('.primary').click(); });
      document.body.appendChild(ov); P.Audit.log('SCREEN_LOCK', ''); setTimeout(() => pw.focus(), 50);
    },
    logout(auto) {
      P.Audit.log(auto ? 'AUTO_LOGOUT' : 'LOGOUT', ''); P.Audit.flush(); document.querySelectorAll('.lock,.modal-back').forEach(e => e.remove());
      this.locked = false; if (this.cur && this.cur.destroy) this.cur.destroy(); this.cur = null; this.curId = null; P.session.user = ''; P.session.role = ''; this.showLogin();
      if (auto) U.toast('Signed out after inactivity', 'warn');
    },
    help() {
      const rows = [['Space', 'Start / Stop the plant'], ['E', 'Emergency stop (press again to release)'], ['A', 'Acknowledge all alarms'], ['P', 'Pause / resume the simulation'], ['N', 'Execute one PLC scan'], ['L', 'Lock the screen'], ['?', 'This help'], ['Del / Ctrl+Z / Ctrl+Y', 'Ladder editor: delete / undo / redo']];
      U.modal({ title: t('Shortcuts'), body: h('div', null, h('table', { class: 'tbl' }, rows.map(r => h('tr', null, h('td', null, h('span', { class: 'kbd' }, r[0])), h('td', null, r[1])))), h('p', { class: 'hint' }, 'Demo accounts: operator / engineer / admin (password = user name). Idle lock after ' + P.SIM.lockAfterSec / 60 + ' min, auto-logout after ' + P.SIM.logoutAfterSec / 60 + ' min.')), buttons: [{ label: t('Take the tour'), onclick: c => { c(); P.Tour && P.Tour.start(); } }, { label: t('Close'), primary: true }] });
    },
    wire() {
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { this.lastAct = Date.now(); }, { passive: true }));
      P.bus.on('frame', () => this.frame());
      P.bus.on('lang', () => { if (!this.el) return; const keep = this.curId; this.el.remove(); this.start(); this.go(keep); });
      document.addEventListener('keydown', e => {
        if (!P.session.user || this.locked || e.ctrlKey || e.metaKey || e.altKey) return;
        if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable) return;
        const T = P.sim.tags;
        if (e.code === 'Space') { e.preventDefault(); if (T.get('PLANT_RUN')) P.Op.pulse('M_STOP', 'Stop (Space)'); else P.Op.pulse('M_START', 'Start (Space)'); U.toast(T.get('PLANT_RUN') ? 'Stop command' : 'Start command'); }
        else if (e.key === 'e' || e.key === 'E') { const on = P.Op.estop(); U.toast(on ? 'E-STOP pressed' : 'E-STOP released', on ? 'err' : 'ok'); }
        else if (e.key === 'a' || e.key === 'A') { const n = P.sim.alarms.ackAll(P.session.user); U.toast(n + ' alarm(s) acknowledged'); }
        else if (e.key === 'p' || e.key === 'P') P.sim.paused = !P.sim.paused;
        else if (e.key === 'n' || e.key === 'N') { P.sim.paused = true; P.sim.step(); }
        else if (e.key === 'l' || e.key === 'L') this.lock();
        else if (e.key === '?') this.help();
      });
      P.bus.on('xref', name => { this.go('logic'); setTimeout(() => P.bus.emit('xref:show', name), 60); });
    }
  };
  P.App = App;

  /* ---------------------------------------------------------------- faceplates */
  /** Equipment faceplate: mode, setpoint, output, status, runtime, start/stop */
  const FP = {
    P101: { name: 'P-101 Syrup pump', out: 'Q_P101', cmd: 'CMD_P101', eq: 'P101', inter: [['I_OL_P101', 'Overload tripped', 1], ['LSLL_101', 'Syrup tank empty', 1], ['SAFE_OK', 'Safety OK', 0]] },
    P102: { name: 'P-102 Water pump', out: 'Q_P102', cmd: 'CMD_P102', eq: 'P102', inter: [['I_OL_P102', 'Overload tripped', 1], ['LSLL_102', 'Water tank empty', 1], ['SAFE_OK', 'Safety OK', 0]] },
    P103: { name: 'P-103 Transfer pump', out: 'Q_P103', cmd: 'CMD_P103', eq: 'P103', inter: [['SAFE_OK', 'Safety OK', 0]] },
    P104: { name: 'P-104 Filler feed pump', out: 'Q_P104', cmd: 'CMD_P104', eq: 'P104', inter: [['SAFE_OK', 'Safety OK', 0]] },
    AGIT: { name: 'M-103 Agitator', out: 'Q_AGIT', cmd: 'CMD_AGIT', eq: 'AGIT', inter: [['SAFE_OK', 'Safety OK', 0]] },
    CONV: { name: 'M-401 Conveyor motor', out: 'Q_CONV', cmd: 'CMD_CONV', eq: 'CONV', inter: [['LINE_FAULT', 'Overload / jam', 1], ['SAFE_OK', 'Safety OK', 0]], sp: { tag: 'CONV_SPEED_SP', label: 'Speed setpoint', unit: '%', min: 10, max: 100, step: 5 }, pv: ['AI_CONV_SPD', 'Speed', '%'] },
    XV101: { name: 'XV-101 Syrup inlet valve', out: 'Q_XV101', cmd: 'CMD_XV101', valve: true, inter: [['SAFE_OK', 'Safety OK', 0]] },
    XV102: { name: 'XV-102 Water inlet valve', out: 'Q_XV102', cmd: 'CMD_XV102', valve: true, inter: [['SAFE_OK', 'Safety OK', 0]] },
    XV103: { name: 'XV-103 Syrup dosing valve', out: 'Q_XV103', cmd: 'CMD_XV103', valve: true, inter: [['SAFE_OK', 'Safety OK', 0]] },
    XV104: { name: 'XV-104 Water dosing valve', out: 'Q_XV104', cmd: 'CMD_XV104', valve: true, inter: [['SAFE_OK', 'Safety OK', 0]] },
    XV105: { name: 'XV-105 Mixer discharge valve', out: 'Q_XV105', cmd: 'CMD_XV105', valve: true, inter: [['SAFE_OK', 'Safety OK', 0]] },
    HEATER: { name: 'E-201 Heater / TIC-201 loop', out: 'Q_HEATER', cmd: 'CMD_HEATER', eq: 'HEATER', pid: true, inter: [['TRIP', 'Safety trip', 1], ['SAFE_OK', 'Safety OK', 0]] }
  };
  P.faceplate = function (id) {
    const d = FP[id]; if (!d) return; const T = P.sim.tags, plant = P.sim.plant;
    const live = [];
    const val = (cls, fn) => { const s = h('span', { class: cls }); live.push(() => { s.textContent = fn(); }); return s; };
    const body = h('div', { class: 'fp' });
    const auto = () => T.get('M_AUTO');
    body.append(
      h('div', null, h('div', { class: 'lbl' }, t('Status')), val('big', () => T.get(d.out) ? (d.valve ? 'OPEN' : t('Running')) : (d.valve ? 'CLOSED' : t('Stopped')))),
      h('div', null, h('div', { class: 'lbl' }, t('Mode')), h('div', { class: 'seg' }, h('button', { class: auto() ? 'on' : '', onclick: () => { T.set('M_AUTO', true, 'hmi'); P.bus.emit('audit', { action: 'COMMAND', detail: 'Mode AUTO (faceplate ' + id + ')' }); } }, t('Auto')), h('button', { class: !auto() ? 'on' : '', onclick: () => { T.set('M_AUTO', false, 'hmi'); P.bus.emit('audit', { action: 'COMMAND', detail: 'Mode MANUAL (faceplate ' + id + ')' }); } }, t('Manual'))), h('div', { class: 'hint' }, 'Plant-wide selector')));
    if (d.pid) {
      body.append(
        h('div', null, h('div', { class: 'lbl' }, t('Setpoint') + ' (\u00b0C)'), h('input', { type: 'number', step: 1, value: T.get('TT_SP'), disabled: !1, onchange: e => P.Op.set('TT_SP', parseFloat(e.target.value) || 0, 'TT_SP') })),
        h('div', null, h('div', { class: 'lbl' }, t('Process value')), val('big', () => U.fmt(T.get('AI_TT201'), 1) + ' \u00b0C')),
        h('div', null, h('div', { class: 'lbl' }, 'Loop mode'), h('div', { class: 'seg' }, h('button', { onclick: () => { T.set('PID_AUTO', true, 'hmi'); } }, t('Auto')), h('button', { onclick: () => { T.set('PID_AUTO', false, 'hmi'); } }, t('Manual')))),
        h('div', null, h('div', { class: 'lbl' }, t('Output') + ' (%)'), val('big', () => U.fmt(T.get('AO_HEATER'), 0) + ' %')),
        h('div', { class: 'full' }, h('div', { class: 'lbl' }, 'Manual output (when loop is Manual)'), h('input', { type: 'range', min: 0, max: 100, value: T.get('PID_MAN_OUT'), oninput: e => T.set('PID_MAN_OUT', parseFloat(e.target.value), 'setpoint') })),
        h('div', { class: 'full' }, h('a', { href: '#', onclick: e => { e.preventDefault(); document.querySelector('.modal-back').remove(); P.App.go('pidtune'); } }, 'Open PID tuning panel \u203a')));
    } else if (d.sp) {
      body.append(h('div', null, h('div', { class: 'lbl' }, t(d.sp.label) + ' (' + d.sp.unit + ')'), h('input', { type: 'range', min: d.sp.min, max: d.sp.max, step: d.sp.step, value: T.get(d.sp.tag), oninput: e => { P.Op.set(d.sp.tag, parseFloat(e.target.value), d.sp.tag); } })),
        h('div', null, h('div', { class: 'lbl' }, d.pv[1]), val('big', () => U.fmt(T.get(d.pv[0]), 0) + ' ' + d.pv[2])));
    } else body.append(h('div', null, h('div', { class: 'lbl' }, t('Setpoint')), h('div', null, 'On / off device - no setpoint')), h('div', null, h('div', { class: 'lbl' }, t('Output')), val('big', () => T.get(d.out) ? '100 %' : '0 %')));
    if (d.eq) {
      const e = plant.eq[d.eq];
      body.append(h('div', null, h('div', { class: 'lbl' }, t('Runtime hours')), val('big', () => U.fmt(e.rt / 3600, 1) + ' h')), h('div', null, h('div', { class: 'lbl' }, 'Starts / current'), val('mono', () => e.starts + ' starts \u00b7 ' + U.fmt(e.amps, 1) + ' A \u00b7 vib ' + U.fmt(e.vib, 1) + ' mm/s')));
    }
    body.append(h('div', { class: 'full' }, h('div', { class: 'lbl' }, 'Interlocks'), val('mono', () => d.inter.map(i => (T.get(i[0]) ? (i[2] ? '\u26d4 ' : '\u2714 ') : (i[2] ? '\u2714 ' : '\u26d4 ')) + i[1]).join('   '))));
    const manual = () => !T.get('M_AUTO');
    body.append(h('div', { class: 'full btnrow' },
      h('button', { class: 'btn start', onclick: () => { if (!manual()) return U.toast('Switch to Manual to command equipment', 'warn'); T.set(d.cmd, true, 'hmi'); P.bus.emit('audit', { action: 'COMMAND', detail: d.name + ' START (manual)' }); } }, d.valve ? 'Open' : t('Start')),
      h('button', { class: 'btn stopb', onclick: () => { T.set(d.cmd, false, 'hmi'); P.bus.emit('audit', { action: 'COMMAND', detail: d.name + ' STOP (manual)' }); } }, d.valve ? 'Close' : t('Stop'))));
    const m = U.modal({ title: d.name, body, nofocus: true, onclose: () => clearInterval(iv) });
    const iv = setInterval(() => { if (!m.el.isConnected) return clearInterval(iv); live.forEach(f => f()); }, 200); live.forEach(f => f());
  };
  P.FACEPLATES = FP;

  /* ---------------------------------------------------------------- tag-bound SVG helpers (used by many screens) */
  /** Update all [data-v], [data-lvl], [data-st] nodes inside root. */
  P.bind = function (root) {
    const T = P.sim.tags;
    root.querySelectorAll('[data-v]').forEach(e => { const tg = T.tag(e.dataset.v); if (!tg) return; const v = tg.v; const txt = typeof v === 'number' ? v.toFixed(e.dataset.d === undefined ? 1 : +e.dataset.d) : (v ? (e.dataset.on || '1') : (e.dataset.off || '0')); if (e.textContent !== txt) e.textContent = txt; });
    root.querySelectorAll('[data-lvl]').forEach(e => { const v = Math.max(0, Math.min(100, T.get(e.dataset.lvl))), H = +e.dataset.h, y0 = +e.dataset.y; e.setAttribute('height', (H * v / 100).toFixed(1)); e.setAttribute('y', (y0 + H - H * v / 100).toFixed(1)); });
    root.querySelectorAll('[data-st]').forEach(e => {
      const parts = e.dataset.st.split(','); const on = parts.some(p => p[0] === '!' ? !T.get(p.slice(1)) : !!T.get(p));
      const cls = e.dataset.cls || 'on'; if (e._on !== on) { e._on = on; e.classList.toggle(cls, on); }
    });
    root.querySelectorAll('[data-fault]').forEach(e => { const on = e.dataset.fault.split(',').some(p => !!T.get(p)); e.classList.toggle('fault', on); });
  };
  P.pidClick = function (root) { root.querySelectorAll('[data-fp]').forEach(e => e.addEventListener('click', () => P.faceplate(e.dataset.fp))); };
})(typeof window !== 'undefined' ? window : globalThis);
