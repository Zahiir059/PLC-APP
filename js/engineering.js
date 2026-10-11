/* ==========================================================================
   engineering.js - engineering tools used by the "I/O & PLC Logic" screen
     FBD view (auto-generated from the ladder tree, live wires)
     SFC / GRAFCET view of the main sequence (active step highlighted live)
     Modbus TCP register map + request/response frame builder
     Auto-generated documentation (I/O list, tag list, equipment, sequence)
     Printable program listing, tiny PDF writer for the design-report summary
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ============================== FBD ============================== */
  const BW = 150, BH = 26, GW = 44, GAP = 8;
  function fbdLay(n) {
    if (n.t === 'ser' || n.t === 'par') {
      if (n.items.length === 1 && n.t === 'ser') return fbdLay(n.items[0]);
      if (!n.items.length) return { n, kind: 'const', w: 70, h: BH, wy: BH / 2 };
      const kids = n.items.map(fbdLay); let y = 0; kids.forEach(k => { k.dy = y; y += k.h + GAP; });
      const cw = Math.max(...kids.map(k => k.w)), h = y - GAP, wyTop = kids[0].dy + kids[0].wy, wyBot = kids[kids.length - 1].dy + kids[kids.length - 1].wy;
      return { n, kind: 'gate', op: n.t === 'ser' ? 'AND' : 'OR', kids, cw, w: cw + 26 + GW, h: Math.max(h, 30), wy: (wyTop + wyBot) / 2, top: wyTop - 8, bot: wyBot + 8 };
    }
    return { n, kind: 'leaf', w: BW, h: BH, wy: BH / 2 };
  }
  function fbdDraw(L, x, y, S) {
    const on = id => `data-f="o:${id}"`;
    if (L.kind === 'leaf') {
      const n = L.n; let txt = n.tag || '?';
      if (n.t === 'nc') txt = 'NOT ' + txt; else if (n.t === 'pos') txt = '\u2191 ' + txt; else if (n.t === 'neg') txt = '\u2193 ' + txt;
      if (n.t === 'cmp') txt = `${n.a} ${n.op} ${n.b}`;
      S.push(`<rect class="fb ${n.t === 'cmp' ? 'cm' : ''}" x="${x}" y="${y}" width="${BW}" height="${BH}" rx="3"/><text x="${x + 6}" y="${y + 17}" class="fbt">${esc(txt.length > 22 ? txt.slice(0, 21) + '\u2026' : txt)}</text><line class="w" ${on(n.id)} x1="${x + BW}" y1="${y + BH / 2}" x2="${x + BW + 14}" y2="${y + BH / 2}"/>`);
      return;
    }
    if (L.kind === 'const') { S.push(`<text x="${x}" y="${y + 17}" class="fbt">TRUE</text><line class="w on" x1="${x + 40}" y1="${y + 13}" x2="${x + L.w}" y2="${y + 13}"/>`); return; }
    const gx = x + L.cw + 26;
    L.kids.forEach(k => { fbdDraw(k, x, y + k.dy, S); const wy = y + k.dy + k.wy; S.push(`<line class="w" ${on(k.n.id)} x1="${x + k.w - (k.kind === 'gate' ? 0 : 0)}" y1="${wy}" x2="${gx}" y2="${wy}"/>`); });
    S.push(`<rect class="gt" x="${gx}" y="${y + L.top}" width="${GW - 14}" height="${L.bot - L.top}" rx="3"/><text x="${gx + (GW - 14) / 2}" y="${y + (L.top + L.bot) / 2 + 4}" text-anchor="middle" class="fbt b">${L.op}</text>`);
    S.push(`<line class="w" ${on(L.n.id)} x1="${gx + GW - 14}" y1="${y + L.wy}" x2="${x + L.w}" y2="${y + L.wy}"/>`);
  }
  /** SVG for all rungs of a section as function-block diagrams */
  function fbdSection(sec) {
    const S = []; let Y = 10, maxW = 600;
    sec.rungs.forEach((r, i) => {
      const L = fbdLay(r.cond), outs = r.outs; const ox = 20 + L.w + 20;
      S.push(`<text class="fbh" x="10" y="${Y + 12}">Rung ${i + 1}${r.comment ? ' - ' + esc(r.comment.length > 90 ? r.comment.slice(0, 89) + '\u2026' : r.comment) : ''}</text>`); Y += 20;
      const top = Y; fbdDraw(L, 10, top, S);
      const wyAbs = top + L.wy; let oy = top; let oh = 0;
      outs.forEach((o, k) => {
        const bh = o.t === 'pid' ? 100 : ['ton', 'tof', 'tp', 'ctu', 'ctd'].includes(o.t) ? 70 : o.t === 'math' ? 52 : 34, bw = 190;
        const title = { coil: 'ASSIGN', ncoil: 'ASSIGN NOT', set: 'SET', reset: 'RESET', ton: 'TON', tof: 'TOF', tp: 'TP', ctu: 'CTU', ctd: 'CTD', math: o.op === 'mov' ? 'MOVE' : 'MATH ' + o.op, pid: 'PID' }[o.t] || o.t;
        let body = '';
        if (['coil', 'ncoil', 'set', 'reset'].includes(o.t)) body = `<text x="${ox + 8}" y="${oy + 26}" class="fbt">\u2192 ${esc(o.tag)}</text>`;
        else if (['ton', 'tof', 'tp'].includes(o.t)) body = `<text x="${ox + 8}" y="${oy + 30}" class="fbt">${esc(o.tag)}  PT=${esc(o.presetTag || o.preset)}${o.presetTag ? '' : 'ms'}</text><text x="${ox + 8}" y="${oy + 48}" class="fbt">Q \u2192 ${esc(o.tag)}.Q   ET \u2192 .ACC</text>`;
        else if (['ctu', 'ctd'].includes(o.t)) body = `<text x="${ox + 8}" y="${oy + 30}" class="fbt">${esc(o.tag)}  PV=${esc(o.presetTag || o.preset)}</text><text x="${ox + 8}" y="${oy + 48}" class="fbt">${o.t === 'ctu' ? 'R' : 'LD'}=${esc(o.reset || '-')}  CV \u2192 .CV</text>`;
        else if (o.t === 'math') body = `<text x="${ox + 8}" y="${oy + 30}" class="fbt">${esc(o.a)}${['abs', 'sqrt', 'mov'].includes(o.op) ? '' : ' ' + esc(o.op) + ' ' + esc(o.b)} \u2192 ${esc(o.dest)}</text>`;
        else body = `<text x="${ox + 8}" y="${oy + 30}" class="fbt">PV=${esc(o.pv)} SP=${esc(o.sp)}</text><text x="${ox + 8}" y="${oy + 48}" class="fbt">KP=${esc(o.kp)} KI=${esc(o.ki)} KD=${esc(o.kd)}</text><text x="${ox + 8}" y="${oy + 66}" class="fbt">OUT \u2192 ${esc(o.out)}</text>`;
        S.push(`<line class="w" data-f="o:${r.cond.id}" x1="${10 + L.w}" y1="${wyAbs}" x2="${ox}" y2="${oy + 16}"/><rect class="fb out" data-f="i:${o.id}" x="${ox}" y="${oy}" width="${bw}" height="${bh}" rx="3"/><text x="${ox + 8}" y="${oy + 14}" class="fbt b">${title}</text>${body}`);
        oy += bh + 8; oh += bh + 8; maxW = Math.max(maxW, ox + bw + 20);
      });
      Y = top + Math.max(L.h, oh) + 24;
    });
    return `<svg class="fbd" width="${maxW}" height="${Y + 10}" viewBox="0 0 ${maxW} ${Y + 10}">${S.join('')}</svg>`;
  }

  /* ============================== SFC / GRAFCET ============================== */
  function sfcSvg(sfc) {
    const S = [], X = 160, SW = 210, SH = 34, TG = 40; let y = 20;
    sfc.steps.forEach((s, i) => {
      S.push(`<g class="sfc-s" data-n="${s.n}"><rect class="st" x="${X}" y="${y}" width="${SW}" height="${SH}" rx="2"/>${s.n === 0 ? `<rect class="st2" x="${X - 4}" y="${y - 4}" width="${SW + 8}" height="${SH + 8}" rx="3"/>` : ''}<rect class="num" x="${X - 44}" y="${y}" width="44" height="${SH}"/><text class="sn" x="${X - 22}" y="${y + 22}" text-anchor="middle">${s.n}</text><text class="sl2" x="${X + SW / 2}" y="${y + 22}" text-anchor="middle">${esc(s.name)}</text>` +
        `<line class="ln" x1="${X + SW}" y1="${y + SH / 2}" x2="${X + SW + 20}" y2="${y + SH / 2}"/><rect class="act" x="${X + SW + 20}" y="${y + 3}" width="330" height="${SH - 6}"/><text class="at" x="${X + SW + 28}" y="${y + 21}">${esc(s.act)}</text></g>`);
      const tr = sfc.trans.find(t => t.from === s.n && t.to === (sfc.steps[i + 1] || {}).n);
      if (tr) { S.push(`<line class="ln" x1="${X + SW / 2}" y1="${y + SH}" x2="${X + SW / 2}" y2="${y + SH + TG}"/><line class="tb" x1="${X + SW / 2 - 12}" y1="${y + SH + TG / 2}" x2="${X + SW / 2 + 12}" y2="${y + SH + TG / 2}"/><text class="tt" x="${X + SW / 2 + 20}" y="${y + SH + TG / 2 + 4}">${esc(tr.cond)}</text>`); }
      y += SH + TG;
    });
    // loop back 90 -> 10
    const last = y - TG - SH / 2, tgt = 20 + (SH + TG) + SH / 2;
    S.push(`<path class="ln" d="M ${X} ${last} H ${X - 70} V ${tgt} H ${X - 6}" fill="none"/><polygon class="ar" points="${X - 6},${tgt - 5} ${X},${tgt} ${X - 6},${tgt + 5}"/><text class="tt" transform="rotate(-90 ${X - 76} ${(last + tgt) / 2})" x="${X - 76}" y="${(last + tgt) / 2}" text-anchor="middle">90 \u2192 10: order not complete</text>`);
    S.push(`<text class="tt" x="20" y="${y + 20}">${esc(sfc.note)}</text>`);
    return `<svg class="sfc" width="760" height="${y + 40}" viewBox="0 0 760 ${y + 40}"><text class="sh" x="20" y="14">${esc(sfc.title)}</text>${S.join('')}</svg>`;
  }

  /* ============================== Modbus ============================== */
  /** Build the register map: coils (outputs + command bits), discrete inputs, input regs, holding regs */
  function modbusMap(tags) {
    const map = { coils: [], di: [], ir: [], hr: [] };
    tags.list.forEach(t => {
      if (t.aux) return;
      if (t.type === 'BOOL' && /^%QX/.test(t.addr)) map.coils.push(t);
      else if (t.type === 'BOOL' && /^%MX/.test(t.addr) && /^(M_|CMD_|PID_AUTO)/.test(t.name)) map.coils.push(t);
      else if (t.type === 'BOOL' && /^%IX/.test(t.addr)) map.di.push(t);
      else if (/^%IW/.test(t.addr)) map.ir.push(t);
      else if (/^%(QW|MW|MD)/.test(t.addr) && /^(AO_|REC_|SEQ_|ORDER_|TT_|PT_|KP_|KI_|KD_|PID_MAN|CONV_SPEED|LT_|SYRUP|FILL_TIME|HOLD_MS|REJ_RATE)/.test(t.name)) map.hr.push(t);
    });
    const scale = t => t.type === 'REAL' ? 10 : 1;
    const raw = t => { let v = t.v === true ? 1 : t.v === false ? 0 : t.v; v = Math.round(v * scale(t)); return Math.max(-32768, Math.min(32767, v)); };
    return { map, scale, raw, addr: { coils: 1, di: 10001, ir: 30001, hr: 40001 } };
  }
  const hex = (n, w) => (n >>> 0).toString(16).toUpperCase().padStart(w || 2, '0');
  let txn = 1;
  /** Build request/response ADUs for FC 1-4. */
  function modbusFrame(mm, fc, start, qty) {
    const area = { 1: 'coils', 2: 'di', 3: 'hr', 4: 'ir' }[fc], list = mm.map[area] || [];
    const t = txn++ & 0xffff; qty = Math.max(1, Math.min(qty, 40));
    const req = [hex(t >> 8), hex(t & 255), '00', '00', '00', '06', '01', hex(fc), hex(start >> 8), hex(start & 255), hex(qty >> 8), hex(qty & 255)];
    let data = [];
    if (fc <= 2) { const nb = Math.ceil(qty / 8); const bytes = new Array(nb).fill(0); for (let i = 0; i < qty; i++) { const tg = list[start + i]; if (tg && tg.v) bytes[i >> 3] |= 1 << (i & 7); } data = [hex(nb)].concat(bytes.map(b => hex(b))); }
    else { data = [hex(qty * 2)]; for (let i = 0; i < qty; i++) { const tg = list[start + i], v = tg ? mm.raw(tg) & 0xffff : 0; data.push(hex(v >> 8), hex(v & 255)); } }
    const len = 3 + data.length - 0; const resp = [hex(t >> 8), hex(t & 255), '00', '00', hex((len) >> 8), hex(len & 255), '01', hex(fc)].concat(data);
    return { req: req.join(' '), resp: resp.join(' '), rows: Array.from({ length: qty }, (_, i) => list[start + i] || null) };
  }

  /* ============================== documentation generators ============================== */
  const EQUIP_EXTRA = [['XV-101', 'Syrup tank inlet valve', 'Q_XV101', 'T-101'], ['XV-102', 'Water tank inlet valve', 'Q_XV102', 'T-102'], ['XV-103', 'Syrup dosing valve', 'Q_XV103', 'T-103'], ['XV-104', 'Water dosing valve', 'Q_XV104', 'T-103'], ['XV-105', 'Mixer discharge valve', 'Q_XV105', 'T-103']];
  const INSTR = [['LT-101', 'Syrup tank level', 'AI_LT101', '%'], ['LT-102', 'Water tank level', 'AI_LT102', '%'], ['WT-103', 'Mixing tank load cell', 'AI_WT103', 'kg'], ['LT-201', 'Pasteurizer level', 'AI_LT201', '%'], ['TT-201', 'Pasteurizer temperature', 'AI_TT201', 'degC'], ['PT-201', 'Pasteurizer pressure', 'AI_PT201', 'bar'], ['LT-301', 'Filler bowl level', 'AI_LT301', '%'], ['TT-301', 'Filler bowl temperature', 'AI_TT301', 'degC'], ['AT-701', 'Gas detector', 'AI_GAS_PPM', 'ppm'], ['SI-401', 'Conveyor speed', 'AI_CONV_SPD', '%'], ['II-401', 'Conveyor motor current', 'AI_CONV_AMP', 'A']];
  const SEQ_TEXT = [
    'The plant is operated from the HMI. In AUTO the operator presses START; the PLC latches PLANT_RUN (only when the safety permissive SAFE_OK is healthy and no production order is complete).',
    'Step 10 PRE-CHECK: syrup and water tanks must be above 20 %, the mixing tank empty and the pasteurizer below 50 %. The recipe temperature is loaded into the loop setpoint.',
    'Step 20 DOSE SYRUP: pump P-101 and valve XV-103 run until the load cell WT-103 shows the syrup weight (batch kg x syrup %). A 40 s timeout raises "Dosing timeout".',
    'Step 30 DOSE WATER: pump P-102 and valve XV-104 run until the total batch weight is reached; the agitator M-103 starts.',
    'Step 40 MIX: agitator runs for the mixing time (6 s). Step 50 TRANSFER: P-103 and XV-105 move the batch into the pasteurizer T-201 until the mixing tank is empty.',
    'Step 60 HEAT-UP: heater contactor K-201 closes and the PID loop TIC-201 drives the heater power to the setpoint (PV = TT-201). When the temperature is within 3 degC of the setpoint for 3 s the sequence continues.',
    'Step 70 HOLD: the temperature must stay at or above setpoint - 3 degC for the recipe hold time; if it drops the hold timer restarts (guaranteed pasteurization).',
    'Step 80 PRODUCE: P-104 feeds the filler bowl (55 % start / 90 % stop). The conveyor runs stop-and-go: when a can reaches the filler (PE-301), capper (PE-302) or labeler (PE-501) the belt holds until each station finishes. Camera inspection rejects underfill, uncapped or too-hot cans at RP-401; label verification rejects unlabelled cans at RP-502.',
    'Good cans are counted at PE-601. The carton packer forms a carton after the recipe cans-per-carton; the barcode scanner counts cartons; the palletizer stacks cartons and the wrapper wraps a full pallet.',
    'Step 90 BATCH COMPLETE: when the pasteurizer and filler bowl are empty the batch closes and the sequence returns to step 10 until the production order target is reached, then the plant stops automatically.',
    'Safety: E-stop, power loss, gas high-high, over-temperature (95 degC), over-pressure (3.0 bar) or an analog sensor failure latch TRIP and de-energise all outputs. TRIP is cleared with RESET only after every cause has gone. Local interlocks (empty tank, overload, jam) stop only the affected equipment.'
  ];
  const docs = {
    ioList(tags) { return tags.list.filter(t => /^%(I|Q)/.test(t.addr)).map(t => [t.addr, t.name, t.type, t.desc, t.unit]); },
    tagList(tags) { return tags.list.filter(t => !t.aux).map(t => [t.name, t.type, t.addr, t.desc, t.unit, t.v === true ? 1 : t.v === false ? 0 : t.v]); },
    equipment() { return P.EQUIP.map(e => [e.id, e.name, e.area, e.kw + ' kW', e.tag]).concat(EQUIP_EXTRA.map(e => [e[0], e[1], 'Valves', '-', e[2]])).concat(INSTR.map(i => [i[0], i[1], 'Instrument', i[3], i[2]])); },
    sequence: SEQ_TEXT
  };

  /* ============================== printable listing ============================== */
  function listingHTML(prog, tags) {
    const parts = [`<h1>PLC program listing</h1><p>${esc(prog.name || 'Smart Beverage Plant')} - generated ${new Date().toLocaleString()} - ${P.Program.stats(prog).rungs} rungs</p>`];
    prog.sections.forEach(s => {
      parts.push(`<h2>${esc(s.name)}</h2><p><i>${esc(s.desc || '')}</i></p><pre>${esc(P.toST({ sections: [s] }))}</pre>`);
    });
    return `<!doctype html><html><head><meta charset="utf-8"><title>Program listing</title><style>body{font-family:sans-serif;margin:20px}pre{font-family:Consolas,monospace;font-size:11px;border:1px solid #bbb;padding:8px;white-space:pre-wrap}h2{border-bottom:2px solid #333;margin-top:22px}@media print{h2{break-after:avoid}}</style></head><body>${parts.join('')}<script>setTimeout(function(){window.print()},300)<\/script></body></html>`;
  }

  /* ============================== tiny PDF writer (text only) ============================== */
  function makePDF(title, lines) {
    const W = 595, H = 842, M = 50, LH = 13, PER = Math.floor((H - 2 * M) / LH), MAXC = 92;
    const wrapped = [];
    lines.forEach(l => {
      l = String(l).replace(/[^\x20-\x7e]/g, c => ({ '\u2192': '->', '\u00b0': 'deg', '\u2013': '-', '\u2014': '-' }[c] || '?'));
      if (l.length <= MAXC) { wrapped.push(l); return; }
      const ind = (l.match(/^\s*/) || [''])[0]; let cur = ind;
      l.trim().split(/\s+/).forEach(w => { if ((cur + ' ' + w).length > MAXC) { wrapped.push(cur); cur = ind + '  ' + w; } else cur += (cur.trim() ? ' ' : '') + w; });
      wrapped.push(cur);
    });
    const pages = []; for (let i = 0; i < wrapped.length; i += PER) pages.push(wrapped.slice(i, i + PER));
    const objs = []; const add = s => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>'); add(''); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const kids = [];
    pages.forEach((pg, pi) => {
      const body = pg.map(l => '(' + l.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ') Tj T*').join('\n');
      const stream = `BT /F1 9.5 Tf ${M} ${H - M} Td ${LH} TL\n${body}\nET\nBT /F1 8 Tf ${M} 28 Td (${title.replace(/[()\\]/g, '')} - page ${pi + 1} of ${pages.length}) Tj ET`;
      const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const p = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${c} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
      kids.push(p + ' 0 R');
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n'; const off = [];
    objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xr = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`;
    return new Blob([out], { type: 'application/pdf' });
  }

  P.Eng = { fbdSection, sfcSvg, modbusMap, modbusFrame, docs, listingHTML, makePDF };
})(typeof window !== 'undefined' ? window : globalThis);
