/* ==========================================================================
   tags.js  -  Tag database
   --------------------------------------------------------------------------
   A tag = { name, type:'BOOL'|'INT'|'REAL', addr, desc, unit, init, v,
             forced, fv, aux }
   * v      current value  (BOOL -> true/false, INT -> integer, REAL -> number)
   * forced when true the tag is frozen at 'fv' (logic writes are ignored)
   * aux    true for tags generated for timer/counter instances (T1.Q, C1.CV)
   Both the ladder engine and the HMI read/write through this one object.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};

  /** Convert any JS value to the storage format of a tag type. */
  function coerce(type, val) {
    if (type === 'BOOL') {
      if (typeof val === 'string') return !(val === '' || val === '0' || val.toLowerCase() === 'false');
      return !!val;
    }
    let n = Number(val);
    if (!isFinite(n)) n = 0;
    if (type === 'INT') { n = Math.trunc(n); if (n > 2147483647) n = 2147483647; if (n < -2147483648) n = -2147483648; }
    return n;
  }

  class TagDB {
    constructor() { this.map = new Map(); this.list = []; this.version = 0; }

    /** Replace the whole database with an array of tag definitions. */
    load(defs) {
      this.map.clear(); this.list.length = 0;
      (defs || []).forEach(d => this.add(d, true));
      this.version++;
    }

    /** Add (or replace) one tag. Returns the tag object. */
    add(d, silent) {
      const type = ['BOOL', 'INT', 'REAL'].includes(d.type) ? d.type : 'BOOL';
      const init = d.init === undefined || d.init === null ? (type === 'BOOL' ? false : 0) : coerce(type, d.init);
      const t = {
        name: String(d.name).trim(), type, addr: d.addr || '', desc: d.desc || '', unit: d.unit || '',
        init, v: d.v !== undefined ? coerce(type, d.v) : init, forced: !!d.forced,
        fv: d.fv !== undefined ? coerce(type, d.fv) : init, aux: !!d.aux
      };
      if (this.map.has(t.name)) {
        const old = this.map.get(t.name);
        Object.assign(old, t);
        if (!silent) this.version++;
        return old;
      }
      this.map.set(t.name, t); this.list.push(t);
      if (!silent) this.version++;
      return t;
    }

    remove(name) {
      const t = this.map.get(name); if (!t) return false;
      this.map.delete(name); this.list.splice(this.list.indexOf(t), 1); this.version++; return true;
    }

    rename(oldName, newName) {
      const t = this.map.get(oldName);
      if (!t || this.map.has(newName)) return false;
      this.map.delete(oldName); t.name = newName; this.map.set(newName, t); this.version++; return true;
    }

    has(name) { return this.map.has(name); }
    tag(name) { return this.map.get(name); }

    /** Read a value (0/false when the tag does not exist). */
    get(name) { const t = this.map.get(name); return t ? t.v : 0; }
    /** Numeric read helper (BOOL -> 1/0). */
    num(name) { const t = this.map.get(name); return t ? (t.v === true ? 1 : t.v === false ? 0 : t.v) : 0; }

    /**
     * Write a value respecting forces.  `force=true` bypasses the force check
     * (used by the process model for inputs when not forced; forced inputs
     * simply keep fv).  Returns true when the value changed.
     */
    set(name, val, source) {
      const t = this.map.get(name); if (!t) return false;
      if (t.forced) return false;
      const nv = coerce(t.type, val);
      if (nv === t.v) return false;
      const old = t.v; t.v = nv;
      if (source && source !== 'plc' && source !== 'process') P.bus.emit('tagchange', { name, old, value: nv, source });
      return true;
    }

    /** Force a tag to a value (or release the force when val === null). */
    force(name, val, source) {
      const t = this.map.get(name); if (!t) return;
      if (val === null || val === undefined) {
        t.forced = false;
        P.bus.emit('force', { name, forced: false, source });
      } else {
        t.forced = true; t.fv = coerce(t.type, val); t.v = t.fv;
        P.bus.emit('force', { name, forced: true, value: t.fv, source });
      }
    }

    forcedTags() { return this.list.filter(t => t.forced); }

    /** Reset every tag to its initial value and release forces. */
    resetValues() { this.list.forEach(t => { t.v = t.init; t.forced = false; t.fv = t.init; }); }

    /** Ensure tags exist for timer / counter instances used in a program. */
    ensureAux(inst, kind) {
      const mk = (suffix, type, desc) => {
        const n = inst + '.' + suffix;
        if (!this.map.has(n)) this.add({ name: n, type, addr: '%T:' + n, desc, aux: true }, true);
      };
      if (kind === 'timer') { mk('Q', 'BOOL', 'Timer done/output'); mk('ACC', 'INT', 'Timer accumulated (ms)'); mk('PRE', 'INT', 'Timer preset (ms)'); }
      if (kind === 'counter') { mk('Q', 'BOOL', 'Counter done'); mk('CV', 'INT', 'Counter value'); }
    }

    /** Definitions to persist (aux tags are regenerated from the program). */
    toJSON() {
      return this.list.filter(t => !t.aux).map(t => ({ name: t.name, type: t.type, addr: t.addr, desc: t.desc, unit: t.unit, init: t.init }));
    }

    /* ---------------------------- CSV ---------------------------- */
    toCSV() {
      const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
      const rows = [['name', 'type', 'address', 'description', 'unit', 'initial', 'value', 'forced'].join(',')];
      this.list.filter(t => !t.aux).forEach(t => rows.push([q(t.name), t.type, q(t.addr), q(t.desc), q(t.unit), t.init === true ? 1 : t.init === false ? 0 : t.init, t.v === true ? 1 : t.v === false ? 0 : t.v, t.forced ? 1 : 0].join(',')));
      return rows.join('\r\n');
    }

    /** Import CSV text. Returns {added, updated, errors[]}. */
    fromCSV(text) {
      const rows = parseCSV(text); const res = { added: 0, updated: 0, errors: [] };
      if (!rows.length) { res.errors.push('Empty file'); return res; }
      const head = rows[0].map(h => h.trim().toLowerCase());
      const ix = n => head.indexOf(n);
      const iName = ix('name'), iType = ix('type'), iAddr = Math.max(ix('address'), ix('addr')), iDesc = Math.max(ix('description'), ix('desc')), iUnit = ix('unit'), iInit = Math.max(ix('initial'), ix('init'));
      if (iName < 0 || iType < 0) { res.errors.push('CSV needs at least "name" and "type" columns'); return res; }
      for (let r = 1; r < rows.length; r++) {
        const c = rows[r]; if (!c.length || !c[iName]) continue;
        const name = c[iName].trim(), type = (c[iType] || '').trim().toUpperCase();
        if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) { res.errors.push(`Row ${r + 1}: invalid tag name "${name}"`); continue; }
        if (!['BOOL', 'INT', 'REAL'].includes(type)) { res.errors.push(`Row ${r + 1}: invalid type "${type}"`); continue; }
        const existed = this.map.has(name);
        this.add({ name, type, addr: iAddr >= 0 ? c[iAddr] : '', desc: iDesc >= 0 ? c[iDesc] : '', unit: iUnit >= 0 ? c[iUnit] : '', init: iInit >= 0 && c[iInit] !== '' ? c[iInit] : undefined });
        existed ? res.updated++ : res.added++;
      }
      return res;
    }
  }

  /** Minimal RFC-4180 CSV parser (quotes, commas, CRLF). */
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', inq = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inq) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += ch;
      } else if (ch === '"') inq = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  P.TagDB = TagDB; P.coerce = coerce; P.parseCSV = parseCSV;
})(typeof window !== 'undefined' ? window : globalThis);
