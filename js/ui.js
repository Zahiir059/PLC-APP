/* ==========================================================================
   ui.js  -  small DOM helpers, modal dialogs, toasts and English/Urdu i18n
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};

  /* ------------------------------- i18n ------------------------------- */
  // English text is the key. Missing keys fall back to English.
  const UR = {
    'Plant Overview': 'پلانٹ کا جائزہ', 'P&ID Process': 'پراسیس P&ID', 'Tanks & Mixing': 'ٹینک اور مکسنگ', 'Heating / Pasteurization': 'ہیٹنگ / پاسچرائزیشن',
    'Filling & Conveyor': 'فلنگ اور کنویئر', 'Inspection & Packaging': 'معائنہ اور پیکیجنگ', 'Alarms': 'الارم', 'Trends': 'رجحانات', 'Energy & KPIs': 'توانائی اور KPI',
    'Equipment Health': 'مشینوں کی صحت', 'Maintenance': 'مینٹیننس', 'Production': 'پیداوار', 'Batches & Traceability': 'بیچ اور ٹریس ایبلٹی', 'Quality': 'معیار',
    'Downtime': 'ڈاؤن ٹائم', 'Bottleneck': 'رکاوٹ کا تجزیہ', 'I/O & PLC Logic': 'I/O اور PLC لاجک', 'PID Tuning': 'PID ٹیوننگ', 'Modbus Map': 'موڈبس میپ',
    'Cause & Effect': 'سبب اور اثر', 'Audit Trail': 'آڈٹ ٹریل', 'Documentation': 'دستاویزات', 'Reports': 'رپورٹس', 'Training': 'تربیت', 'Architecture': 'نظام کا ڈھانچہ',
    'Project Documentation': 'پروجیکٹ دستاویز', 'Operator Panel': 'آپریٹر پینل', 'Operate': 'آپریشن', 'Monitor': 'نگرانی', 'Engineering': 'انجینئرنگ', 'Learn': 'سیکھیں',
    'Start': 'اسٹارٹ', 'Stop': 'اسٹاپ', 'E-STOP': 'ایمرجنسی اسٹاپ', 'Reset': 'ری سیٹ', 'Auto': 'آٹو', 'Manual': 'مینول', 'Acknowledge all': 'سب تسلیم کریں',
    'Acknowledge': 'تسلیم', 'Login': 'لاگ ان', 'Logout': 'لاگ آؤٹ', 'User': 'صارف', 'Password': 'پاسورڈ', 'Role': 'کردار', 'Operator': 'آپریٹر', 'Engineer': 'انجینئر', 'Admin': 'ایڈمن',
    'Running': 'چل رہا ہے', 'Stopped': 'بند', 'Tripped': 'ٹرپ', 'Level': 'لیول', 'Temperature': 'درجہ حرارت', 'Pressure': 'دباؤ', 'Setpoint': 'سیٹ پوائنٹ',
    'Process value': 'پراسیس ویلیو', 'Output': 'آؤٹ پٹ', 'Mode': 'موڈ', 'Status': 'حالت', 'Runtime hours': 'چلنے کے گھنٹے', 'Cans filled': 'بھرے ہوئے کین',
    'Rejected': 'مسترد', 'Cartons': 'کارٹن', 'Pallets': 'پیلیٹ', 'Speed': 'رفتار', 'Recipe': 'ریسیپی', 'Recipes': 'ریسیپیز', 'Production order': 'پروڈکشن آرڈر',
    'Target quantity': 'ہدف مقدار', 'Save': 'محفوظ کریں', 'Cancel': 'منسوخ', 'Close': 'بند کریں', 'Delete': 'حذف', 'Copy': 'کاپی', 'New': 'نیا', 'Edit': 'ترمیم',
    'Availability': 'دستیابی', 'Performance': 'کارکردگی', 'Quality factor': 'معیار', 'OEE': 'OEE', 'Power': 'بجلی', 'Energy': 'توانائی', 'Cost': 'لاگت',
    'Tariff': 'ٹیرف', 'Active alarms': 'فعال الارم', 'Alarm history': 'الارم کی تاریخ', 'Priority': 'ترجیح', 'Critical': 'انتہائی اہم', 'High': 'زیادہ', 'Medium': 'درمیانہ',
    'Low': 'کم', 'Time': 'وقت', 'Description': 'تفصیل', 'Shelve': 'شیلو', 'Suppress': 'دبائیں', 'Export CSV': 'CSV ایکسپورٹ', 'Print': 'پرنٹ', 'Sound': 'آواز',
    'Language': 'زبان', 'Theme': 'تھیم', 'Dark': 'ڈارک', 'Light': 'لائٹ', 'Lock screen': 'اسکرین لاک', 'Unlock': 'ان لاک', 'Help': 'مدد', 'Shortcuts': 'شارٹ کٹس',
    'Scenarios': 'فالٹ منظرنامے', 'Tutorial': 'ٹیوٹوریل', 'Score': 'اسکور', 'Run': 'چلائیں', 'Pause': 'روکیں', 'Single scan': 'ایک اسکین', 'Apply': 'لاگو کریں',
    'Undo': 'واپس', 'Redo': 'دوبارہ', 'Tags': 'ٹیگز', 'Ladder': 'لیڈر', 'Search': 'تلاش', 'Filter': 'فلٹر', 'Value': 'ویلیو', 'Address': 'ایڈریس', 'Type': 'قسم',
    'Name': 'نام', 'Force': 'فورس', 'Release': 'ریلیز', 'Home': 'ہوم', 'Fault injection': 'فالٹ انجیکشن', 'Shift report': 'شفٹ رپورٹ', 'Batch': 'بیچ',
    'Product': 'پروڈکٹ', 'Quantity': 'مقدار', 'Start time': 'آغاز', 'End time': 'اختتام', 'Reason': 'وجہ', 'Syrup': 'شربت', 'Water': 'پانی', 'Mixing': 'مکسنگ',
    'Heating': 'ہیٹنگ', 'Filling': 'فلنگ', 'Capping': 'کیپنگ', 'Conveyor': 'کنویئر', 'Labeling': 'لیبلنگ', 'Palletizing': 'پیلیٹائزنگ', 'Safety': 'حفاظت',
    'Simulation speed': 'سمولیشن کی رفتار', 'Scan time': 'اسکین ٹائم', 'PLC mode': 'PLC موڈ', 'Signed in as': 'لاگ ان بطور', 'Welcome': 'خوش آمدید',
    'Take the tour': 'ٹور شروع کریں', 'Skip': 'چھوڑیں', 'Next': 'اگلا', 'Back': 'پیچھے', 'Done': 'مکمل', 'Mark as done': 'مکمل نشان زد کریں', 'Overdue': 'تاخیر',
    'Last 1 min': 'آخری 1 منٹ', 'Last 1 hour': 'آخری 1 گھنٹہ', 'Shift (8 h)': 'شفٹ (8 گھنٹے)', 'Reject rate': 'مسترد شرح', 'Consumption': 'کھپت'
  };
  const I18N = {
    lang: 'en',
    t(s) { return this.lang === 'ur' && UR[s] ? UR[s] : s; },
    set(l) { this.lang = l === 'ur' ? 'ur' : 'en'; document.documentElement.lang = this.lang; document.documentElement.dir = this.lang === 'ur' ? 'rtl' : 'ltr'; P.Store && P.Store.set('lang', this.lang); P.bus.emit('lang', this.lang); }
  };
  const t = s => I18N.t(s);

  /* Native Element.append() turns null / arrays into the text "null" / "[object ...]".
     Make it behave like the h() helper: skip null/false and flatten arrays. */
  if (typeof Element !== 'undefined' && !Element.prototype.__patched) {
    const nativeAppend = Element.prototype.append;
    const flat = a => a.reduce((o, x) => o.concat(Array.isArray(x) ? flat(x) : (x === null || x === undefined || x === false ? [] : [x])), []);
    Element.prototype.append = function () { return nativeAppend.apply(this, flat(Array.prototype.slice.call(arguments))); };
    Element.prototype.__patched = true;
  }

  /* ------------------------------- DOM helper ------------------------------- */
  /** h('div', {class:'x', onclick:fn, style:{color:'red'}, dataset:{a:1}}, 'text', childNode) */
  function h(tag, props) {
    const svgNS = ['svg', 'g', 'rect', 'circle', 'line', 'path', 'text', 'polygon', 'polyline', 'ellipse'];
    const el = svgNS.includes(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
      Object.keys(props).forEach(k => {
        const v = props[k]; if (v === undefined || v === null || v === false) return;
        if (k === 'class') el.setAttribute('class', v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.keys(v).forEach(d => { el.dataset[d] = v[d]; });
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected') { if (v) el[k] = true; }
        else el.setAttribute(k, v === true ? '' : v);
      });
      for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    } else for (let i = 1; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(x => add(el, x));
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, d) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(d === undefined ? 1 : d) : (v === true ? '1' : v === false ? '0' : String(v));
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const fmtTime = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  const fmtDT = ms => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + fmtTime(ms); };
  const fmtDur = sec => { sec = Math.round(sec); const m = Math.floor(sec / 60); return m ? m + 'm ' + pad(sec % 60) + 's' : sec + 's'; };

  /* ------------------------------- toast / modal ------------------------------- */
  function toast(msg, kind) {
    let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts' }); document.body.appendChild(box); }
    const el = h('div', { class: 'toast ' + (kind || 'info') }, msg); box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, kind === 'err' ? 6000 : 3200);
  }
  /** modal({title, body:Node|string, buttons:[{label, primary, onclick(close)}], wide}) */
  function modal(o) {
    const back = h('div', { class: 'modal-back' });
    const close = () => { back.remove(); if (o.onclose) o.onclose(); };
    const box = h('div', { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || '' },
      h('div', { class: 'modal-h' }, h('b', null, o.title || ''), h('button', { class: 'x', title: t('Close'), onclick: close }, '\u00d7')),
      h('div', { class: 'modal-b' }, typeof o.body === 'string' ? h('div', { html: o.body }) : o.body),
      (o.buttons && o.buttons.length) ? h('div', { class: 'modal-f' }, o.buttons.map(b => h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => b.onclick ? b.onclick(close) : close() }, b.label))) : null);
    back.appendChild(box); back.addEventListener('mousedown', e => { if (e.target === back && !o.sticky) close(); });
    document.body.appendChild(back);
    const f = $('input,select,button.primary', box); if (f && !o.nofocus) f.focus();
    return { close, el: box };
  }
  function confirmBox(msg, okLabel) {
    return new Promise(res => { modal({ title: 'Confirm', body: msg, sticky: true, buttons: [{ label: t('Cancel'), onclick: c => { c(); res(false); } }, { label: okLabel || 'OK', primary: true, onclick: c => { c(); res(true); } }] }); });
  }
  function promptBox(title, label, def) {
    return new Promise(res => {
      const inp = h('input', { type: 'text', value: def || '', style: { width: '100%' } });
      modal({ title, body: h('div', null, h('label', null, label), inp), sticky: true, buttons: [{ label: t('Cancel'), onclick: c => { c(); res(null); } }, { label: 'OK', primary: true, onclick: c => { c(); res(inp.value); } }] });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = $('.modal-f .primary'); b && b.click(); } });
    });
  }
  function download(name, text, mime) {
    const blob = text instanceof Blob ? text : new Blob([text], { type: mime || 'text/plain' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function pickFile(accept) {
    return new Promise(res => {
      const inp = h('input', { type: 'file', accept: accept || '' });
      inp.onchange = () => { const f = inp.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res({ name: f.name, text: r.result }); r.readAsText(f); };
      inp.click();
    });
  }
  const csv = rows => rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');

  P.I18N = I18N; P.t = t;
  P.UI = { h, $, $$, esc, fmt, pad, fmtTime, fmtDT, fmtDur, toast, modal, confirmBox, promptBox, download, pickFile, csv, t };
})(typeof window !== 'undefined' ? window : globalThis);
