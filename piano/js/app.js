/* Клавиши — piano app. One file on purpose: no build step, one cache entry. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};
const COLORS = { staffLine: '#9aa1b6', paper: '#ede7d9', muted: '#a3a9bc', left: '#39c2b0', right: '#f2a541', wrong: '#ef6f6c', ok: '#7bd389', line: '#3a4361' };
const CHECKED = ['note-reading', 'chord', 'guided-practice'];

/* ---------------- storage ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: work without */ } }
};
const K = { url: 'pa.piano.bridgeUrl', queue: 'pa.piano.queue', progress: 'pa.piano.progress', read: 'pa.piano.read', bpm: 'pa.piano.bpm' };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------- notes ---------------- */
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
function parseNote(s) {
  const m = /^([A-G])(#|b)?(-?\d)?$/.exec(String(s).trim());
  if (!m) throw new Error(`нота «${s}» не читается`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const oct = m[3] == null ? null : +m[3];
  return { letter: m[1], acc: m[2] || '', oct, pc: (PC[m[1]] + acc + 12) % 12, midi: oct == null ? null : (oct + 1) * 12 + PC[m[1]] + acc, text: String(s).trim() };
}
const midiName = n => SHARP_NAMES[n % 12] + (Math.floor(n / 12) - 1);
const pcName = n => SHARP_NAMES[((n % 12) + 12) % 12];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------------- staff (VexFlow) ---------------- */
// events: array; string = one note, array = notes together. opts.colors: {midi: color}
function drawStaff(host, { clef = 'auto', events = [], labels = false, colors = {}, scale = 1.35, compact = false } = {}) {
  host.innerHTML = '';
  const VF = window.Vex && Vex.Flow;
  if (!VF) { host.append(h('p', { class: 'note-bad' }, 'Нотный стан не загрузился — обнови страницу.')); return; }
  const evs = events.map(e => (Array.isArray(e) ? e : [e]).map(parseNote));
  for (const g of evs) for (const n of g) if (n.oct == null) throw new Error(`нота «${n.text}» без октавы`);
  const all = evs.flat();
  // treble reaches down to A3 and bass up to E4 on ledger lines, like printed music; only wider spans get two staves
  if (clef === 'auto') clef = all.every(n => n.midi >= 57) ? 'treble' : all.every(n => n.midi <= 64) ? 'bass' : 'grand';
  const grand = clef === 'grand';
  const avail = Math.max(host.clientWidth || 640, 280);
  // compact: a short staff centred in the stage, so a lone note isn't lost at the left edge
  const width = compact ? Math.min(avail, (170 + evs.length * 70) * scale) : avail;
  const W = width / scale;
  const H = grand ? 250 : 150;
  const renderer = new VF.Renderer(host, VF.Renderer.Backends.SVG);
  renderer.resize(width, H * scale);
  if (compact) { const svg = host.querySelector('svg'); svg.style.width = width + 'px'; svg.style.maxWidth = '100%'; svg.style.margin = '0 auto'; }
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);
  ctx.setFillStyle(COLORS.paper); ctx.setStrokeStyle(COLORS.paper);
  const style = { fillStyle: COLORS.paper, strokeStyle: COLORS.paper };
  // staff lines thicker and a shade dimmer than the note heads, so the line under/through a head stays readable
  const lineW = compact ? 1.7 : 1.35;
  const staffStyle = { fillStyle: COLORS.staffLine, strokeStyle: COLORS.staffLine, lineWidth: lineW };
  const ledgerStyle = { fillStyle: COLORS.staffLine, strokeStyle: COLORS.staffLine, lineWidth: lineW };
  const x = 8, sw = W - 16;
  const makeNote = (group, staffClef) => {
    if (!group.length) return new VF.GhostNote({ duration: 'q' });
    const g = group.slice().sort((a, b) => a.midi - b.midi);
    // filled heads without stems: the usual look of reading drills; rhythm isn't shown, so no stems or hollow heads
    const note = new VF.StaveNote({ clef: staffClef, keys: g.map(n => `${n.letter.toLowerCase()}${n.acc}/${n.oct}`), duration: 'q', auto_stem: true, glyph_font_scale: 31 });
    note.setStyle(style); note.setLedgerLineStyle(ledgerStyle);
    note.setStemStyle({ strokeStyle: 'transparent', fillStyle: 'transparent' });
    g.forEach((n, i) => {
      if (n.acc) note.addModifier(new VF.Accidental(n.acc), i);
      const c = colors[n.midi];
      if (c) note.setKeyStyle(i, { fillStyle: c, strokeStyle: c });
    });
    if (labels) {
      const a = new VF.Annotation(g.map(n => n.text.replace(/-?\d$/, '')).join(' '));
      a.setFont('Golos Text', 11, 'normal');
      a.setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM);
      note.addModifier(a, 0);
    }
    return note;
  };
  const voice = notes => new VF.Voice({ num_beats: Math.max(notes.length, 1) * 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT).addTickables(notes);
  if (!grand) {
    const stave = new VF.Stave(x, 20, sw).addClef(clef).setContext(ctx);
    stave.setStyle(staffStyle); stave.draw();
    let notes = evs.map(g => makeNote(g, clef));
    if (!notes.length) return;
    if (compact) notes = [new VF.GhostNote({ duration: 'q' }), ...notes, new VF.GhostNote({ duration: 'q' })];
    const v = voice(notes);
    new VF.Formatter().joinVoices([v]).format([v], Math.max(sw - 70, 40));
    v.draw(ctx, stave);
  } else {
    const top = new VF.Stave(x + 14, 10, sw - 14).addClef('treble').setContext(ctx);
    const bot = new VF.Stave(x + 14, 120, sw - 14).addClef('bass').setContext(ctx);
    top.setStyle(staffStyle); bot.setStyle(staffStyle); top.draw(); bot.draw();
    const brace = new VF.StaveConnector(top, bot).setType(VF.StaveConnector.type.BRACE).setContext(ctx);
    brace.setStyle?.(style); brace.draw();
    new VF.StaveConnector(top, bot).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
    const tn = evs.map(g => makeNote(g.filter(n => n.midi >= 60), 'treble'));
    const bn = evs.map(g => makeNote(g.filter(n => n.midi < 60), 'bass'));
    if (!evs.length) return;
    const v1 = voice(tn), v2 = voice(bn);
    new VF.Formatter().joinVoices([v1]).joinVoices([v2]).format([v1, v2], sw - 90);
    v1.draw(ctx, top); v2.draw(ctx, bot);
  }
}

/* ---------------- keyboard (SVG) ---------------- */
function drawKeyboard(host, { from = 'C3', to = 'C5', highlight = {}, labels = false } = {}) {
  const a = parseNote(from).midi, b = parseNote(to).midi;
  const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
  const whites = []; for (let n = a; n <= b; n++) if (!isBlack(n)) whites.push(n);
  const ww = 40, wh = 150, bw = 24, bh = 94;
  const pos = {}; whites.forEach((n, i) => (pos[n] = i * ww));
  let svg = `<svg viewBox="0 0 ${whites.length * ww + 2} ${wh + 2}" role="img" aria-label="Клавиатура">`;
  for (const n of whites) {
    const c = highlight[n];
    svg += `<rect x="${pos[n] + 1}" y="1" width="${ww - 2}" height="${wh}" rx="5" fill="${c || '#ede7d9'}" />`;
    if (labels && c) svg += `<text x="${pos[n] + ww / 2}" y="${wh - 12}" text-anchor="middle" font-family="Golos Text" font-size="15" font-weight="600" fill="#161b29">${pcName(n)}</text>`;
    if (n === 60) svg += `<circle cx="${pos[n] + ww / 2}" cy="${wh - (labels && c ? 34 : 14)}" r="3" fill="${c ? '#161b29' : '#a3a9bc'}"/>`;
  }
  for (let n = a; n <= b; n++) {
    if (!isBlack(n)) continue;
    const left = pos[n - 1]; if (left == null) continue;
    const c = highlight[n];
    svg += `<rect x="${left + ww - bw / 2}" y="1" width="${bw}" height="${bh}" rx="4" fill="${c || '#1b2030'}" stroke="#0e121d" />`;
    if (labels && c) svg += `<text x="${left + ww}" y="${bh - 10}" text-anchor="middle" font-family="Golos Text" font-size="12" font-weight="600" fill="#161b29">${pcName(n)}</text>`;
  }
  host.innerHTML = svg + '</svg>';
}

/* ---------------- generative art from notation ---------------- */
function hash(s) { let x = 2166136261; for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; }
function motif(seed, { w = 150, h = 64, n = 5 } = {}) {
  let r = hash(seed);
  const rnd = () => ((r = Math.imul(r ^ (r >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  const gap = h / 8, top = gap * 1.5;
  let s = `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true">`;
  for (let i = 0; i < 5; i++) s += `<line x1="0" x2="${w}" y1="${top + i * gap}" y2="${top + i * gap}" stroke="#3a4361" stroke-width="1.2"/>`;
  let y = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    y = Math.max(0, Math.min(8, y + Math.round(rnd() * 4 - 2)));
    const cx = 18 + i * ((w - 30) / (n - 1)), cy = top + (8 - y) * gap / 2;
    const col = i === n - 1 ? COLORS.right : rnd() > .7 ? COLORS.left : COLORS.paper;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${gap * .62}" ry="${gap * .44}" transform="rotate(-20 ${cx} ${cy})" fill="${col}"/>`;
  }
  return s + '</svg>';
}
const ART = {
  'nav-theory': `<svg viewBox="0 0 40 28"><g stroke="#3a4361" stroke-width="1.3"><path d="M0 6h40M0 11h40M0 16h40M0 21h40"/></g><ellipse cx="14" cy="16" rx="4" ry="3" transform="rotate(-20 14 16)" fill="#ede7d9"/><ellipse cx="27" cy="8.5" rx="4" ry="3" transform="rotate(-20 27 8.5)" fill="#f2a541"/></svg>`,
  'nav-exercises': `<svg viewBox="0 0 40 28"><g fill="#ede7d9"><ellipse cx="7" cy="22" rx="3.6" ry="2.7" transform="rotate(-20 7 22)"/><ellipse cx="17" cy="16" rx="3.6" ry="2.7" transform="rotate(-20 17 16)"/><ellipse cx="27" cy="10" rx="3.6" ry="2.7" transform="rotate(-20 27 10)"/></g><ellipse cx="36" cy="4.5" rx="3.6" ry="2.7" transform="rotate(-20 36 4.5)" fill="#39c2b0"/></svg>`,
  'nav-songs': `<svg viewBox="0 0 40 28"><g fill="#f2a541"><ellipse cx="13" cy="6" rx="4" ry="3" transform="rotate(-20 13 6)"/><ellipse cx="13" cy="12" rx="4" ry="3" transform="rotate(-20 13 12)"/></g><ellipse cx="13" cy="18" rx="4" ry="3" transform="rotate(-20 13 18)" fill="#39c2b0"/><path d="M22 24h18" stroke="#a3a9bc" stroke-width="2" stroke-linecap="round"/><path d="M22 18h12" stroke="#3a4361" stroke-width="2" stroke-linecap="round"/></svg>`,
  'nav-settings': `<svg viewBox="0 0 40 28"><circle cx="20" cy="14" r="7" fill="none" stroke="#a3a9bc" stroke-width="2"/><circle cx="20" cy="14" r="2.5" fill="#a3a9bc"/></svg>`,
  hero: `<svg viewBox="0 0 200 120" aria-hidden="true"><g stroke="#3a4361" stroke-width="1.4"><path d="M0 30h200M0 45h200M0 60h200M0 75h200M0 90h200"/></g>
    <g fill="#ede7d9"><ellipse cx="40" cy="82" rx="9" ry="6.5" transform="rotate(-20 40 82)"/><ellipse cx="75" cy="67" rx="9" ry="6.5" transform="rotate(-20 75 67)"/></g>
    <g fill="#39c2b0"><ellipse cx="112" cy="97" rx="9" ry="6.5" transform="rotate(-20 112 97)"/></g>
    <g fill="#f2a541"><ellipse cx="150" cy="52" rx="9" ry="6.5" transform="rotate(-20 150 52)"/><ellipse cx="150" cy="37" rx="9" ry="6.5" transform="rotate(-20 150 37)"/><ellipse cx="150" cy="22" rx="9" ry="6.5" transform="rotate(-20 150 22)"/></g>
    <path d="M158 50V4" stroke="#f2a541" stroke-width="2.4"/></svg>`
};
function fillArt(root = document) { root.querySelectorAll('[data-art]').forEach(el => { el.innerHTML = ART[el.dataset.art] || ''; }); }

/* ---------------- MIDI ---------------- */
const midi = { held: new Set(), access: null, listener: null };
function setMidiPill() {
  const ins = midi.access ? [...midi.access.inputs.values()].filter(i => i.state === 'connected') : [];
  $('#midiPill').classList.toggle('live', ins.length > 0);
  $('#midiLabel').textContent = ins.length ? ins[0].name.replace(/\s*MIDI$/i, '') : 'MIDI нет';
  for (const i of ins) i.onmidimessage = onMidi;
}
async function initMidi(manual) {
  if (!navigator.requestMIDIAccess) { if (manual) toast('Этот браузер не умеет MIDI — открой сайт в Chrome'); return; }
  try {
    midi.access = await navigator.requestMIDIAccess({ sysex: false });
    midi.access.onstatechange = setMidiPill;
    setMidiPill();
    if (manual) toast(midi.access.inputs.size ? 'MIDI подключён' : 'Пианино не видно — подключи его в MIDI BLE Connect');
  } catch (e) { if (manual) toast('MIDI: доступ не дали'); }
}
function onMidi(ev) {
  const [st, n, vel] = ev.data, type = st & 0xf0;
  if (type === 0x90 && vel > 0) { midi.held.add(n); $('#lastNote').textContent = midiName(n); midi.listener?.({ on: true, note: n }); }
  else if (type === 0x80 || (type === 0x90 && vel === 0)) { midi.held.delete(n); midi.listener?.({ on: false, note: n }); }
}

/* ---------------- metronome ---------------- */
const metro = {
  bpm: store.get(K.bpm, 60), beats: 4, on: false, ctx: null, next: 0, beat: 0, timer: null,
  start() {
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    this.ctx.resume(); this.next = this.ctx.currentTime + 0.06; this.beat = 0; this.on = true;
    this.timer = setInterval(() => this.schedule(), 25); this.ui();
  },
  stop() { clearInterval(this.timer); this.on = false; this.ui(); },
  toggle() { this.on ? this.stop() : this.start(); },
  setBpm(v) { this.bpm = Math.max(30, Math.min(200, Math.round(v))); store.set(K.bpm, this.bpm); this.ui(); },
  schedule() {
    while (this.next < this.ctx.currentTime + 0.12) {
      const b = this.beat % this.beats, t = this.next;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = b === 0 ? 1560 : 1040;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + 0.06);
      setTimeout(() => this.flash(b), Math.max(0, (t - this.ctx.currentTime) * 1000));
      this.next += 60 / this.bpm; this.beat++;
    }
  },
  flash(b) {
    const dots = $('#beatDots').children;
    [...dots].forEach((d, i) => d.classList.toggle('on', i === b));
    $('#metroPill').classList.add('beat'); setTimeout(() => $('#metroPill').classList.remove('beat'), 90);
  },
  ui() {
    $('#bpmVal').textContent = this.bpm; $('#bpmRange').value = this.bpm;
    $('#metroLabel').textContent = this.on ? `${this.bpm} ▸` : this.bpm;
    $('#metroToggle').textContent = this.on ? 'Стоп' : 'Старт';
    const d = $('#beatDots'); if (d.children.length !== this.beats) d.innerHTML = Array.from({ length: this.beats }, (_, i) => `<i class="${i ? '' : 'first'}"></i>`).join('');
    document.querySelectorAll('[data-metro-bpm]').forEach(el => (el.textContent = this.bpm));
    document.querySelectorAll('[data-metro-toggle]').forEach(el => (el.textContent = this.on ? 'Стоп' : 'Метроном'));
  }
};

/* ---------------- bridge + queue ---------------- */
const bridge = {
  url: () => store.get(K.url, ''),
  async get(params, tries = 3) {
    if (!this.url()) throw new Error('не задан адрес моста — открой Настройки');
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(this.url() + '?' + new URLSearchParams(params));
        const d = JSON.parse(await res.text());
        if (!d.ok) throw new Error(d.error || 'мост ответил ошибкой');
        return d;
      } catch (e) { last = e; await new Promise(r => setTimeout(r, 600 * (i + 1))); }
    }
    throw last;
  },
  async post(r) {
    const res = await fetch(this.url(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(r) });
    return JSON.parse(await res.text());
  }
};
let flushing = false;
async function flush() {
  if (flushing || !bridge.url()) return;
  flushing = true;
  try {
    for (const r of store.get(K.queue, [])) {
      try {
        const d = await bridge.post(r);
        if (d.ok && d.saved && d.attemptId === r.attemptId) store.set(K.queue, store.get(K.queue, []).filter(x => x.attemptId !== r.attemptId));
        else break;
      } catch { break; }
    }
  } finally { flushing = false; }
}
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
function saveResult(lesson, block, r) {
  const res = { attemptId: uuid(), lessonId: lesson.id, blockId: block.id, finishedAt: new Date().toISOString(), client: 'klavishi/1', ...r };
  const q = store.get(K.queue, []); q.push(res); store.set(K.queue, q);
  const p = store.get(K.progress, {}); (p[lesson.id] ||= {})[block.id] = res.status; store.set(K.progress, p);
  flush();
}
window.addEventListener('online', flush);
setInterval(flush, 30000);

/* ---------------- lessons data ---------------- */
let catalog = null;
async function loadCatalog(force) {
  if (catalog && !force) return catalog;
  const [list, prog] = await Promise.all([bridge.get({ action: 'list' }), bridge.get({ action: 'progress' }).catch(() => null)]);
  if (prog && prog.latest) store.set(K.progress, mergeProgress(store.get(K.progress, {}), prog.latest));
  catalog = list;
  return list;
}
function mergeProgress(local, remote) {
  const out = JSON.parse(JSON.stringify(local));
  for (const [l, blocks] of Object.entries(remote)) for (const [b, v] of Object.entries(blocks)) (out[l] ||= {})[b] = v.status || v;
  return out;
}
function lessonState(meta) {
  const p = store.get(K.progress, {})[meta.id] || {};
  const done = Object.values(p).filter(s => s === 'passed').length;
  const read = store.get(K.read, []).includes(meta.id);
  if (meta.checked > 0 ? done >= meta.checked : read) return 'done';
  if (Object.keys(p).length || read) return 'going';
  return 'new';
}
const STATE_TEXT = { done: 'пройден', going: 'в процессе', new: 'новый' };

/* ---------------- block renderers ---------------- */
let active = null; // the block currently listening to MIDI
function activate(ctrl) { if (active && active !== ctrl) active.stop?.(); active = ctrl; midi.listener = ctrl ? e => ctrl.onMidi(e) : null; }

/* ---------------- text markup (see piano-content-spec) ---------------- */
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
function renderMarkup(text) {
  const root = h('div', { class: 'theory' });
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let i = 0;
  const take = test => { const out = []; while (i < lines.length && test(lines[i])) out.push(lines[i++]); return out; };
  while (i < lines.length) {
    const line = lines[i], t = line.trim();
    if (!t) { i++; continue; }
    if (/^\+\+\+\s+\S/.test(t)) {
      i++; const inner = take(l => l.trim() !== '+++'); i++;
      const d = h('details', { class: 'toggle' }, h('summary', { html: inline(t.replace(/^\+\+\+\s+/, '')) }));
      d.append(renderMarkup(inner.join('\n'))); root.append(d); continue;
    }
    if (/^##\s+/.test(t)) { root.append(h('h4', { class: 'md-h', html: inline(t.replace(/^##\s+/, '')) })); i++; continue; }
    if (/^>\s?/.test(t)) { const q = take(l => /^>\s?/.test(l.trim())).map(l => l.trim().replace(/^>\s?/, '')); root.append(h('div', { class: 'callout', html: inline(q.join(' ')) })); continue; }
    if (t.startsWith('|')) {
      const rows = take(l => l.trim().startsWith('|')).map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())).filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)));
      const [head, ...body] = rows;
      root.append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, head.map(c => h('th', { html: inline(c) })))), h('tbody', {}, body.map(r => h('tr', {}, r.map(c => h('td', { html: inline(c) }))))))));
      continue;
    }
    if (/^-\s+/.test(t)) { root.append(h('ul', {}, take(l => /^-\s+/.test(l.trim())).map(l => h('li', { html: inline(l.trim().replace(/^-\s+/, '')) })))); continue; }
    if (/^\d+\.\s+/.test(t)) { root.append(h('ol', {}, take(l => /^\d+\.\s+/.test(l.trim())).map(l => h('li', { html: inline(l.trim().replace(/^\d+\.\s+/, '')) })))); continue; }
    const para = take(l => l.trim() && !/^(\+\+\+|##\s|>|\||-\s|\d+\.\s)/.test(l.trim()));
    root.append(h('p', { html: inline(para.map(l => l.trim()).join(' ')) }));
  }
  return root;
}
const imageCache = {};
function loadImage(name) {
  return (imageCache[name] ||= bridge.get({ action: 'image', name }).then(d => `data:${d.mime};base64,${d.data}`));
}

const BLOCKS = {
  theory(b) { return renderMarkup(b.text); },
  image(b) {
    const fig = h('figure', { class: 'figure image-fig' }, h('p', { class: 'feedback' }, 'Загружаю картинку…'));
    loadImage(b.file).then(src => {
      fig.innerHTML = '';
      fig.append(h('img', { src, alt: b.caption || '' }));
      if (b.caption) fig.append(h('figcaption', { class: 'caption' }, b.caption));
      if (b.source) fig.append(h('div', { class: 'source' }, 'Источник: ' + b.source));
    }).catch(e => { fig.innerHTML = ''; fig.append(h('p', { class: 'note-bad' }, `Картинка ${b.file} не загрузилась: ${e.message}`)); });
    return fig;
  },
  staff(b) {
    const host = h('div', { class: 'staff-host' });
    const fig = h('div', { class: 'figure' }, host, b.caption ? h('div', { class: 'caption' }, b.caption) : null);
    requestAnimationFrame(() => drawStaff(host, { clef: b.clef || 'auto', events: b.notes || [], labels: !!b.labels }));
    return fig;
  },
  keyboard(b) {
    const host = h('div', { class: 'kb' });
    const hl = {}; for (const n of b.highlight || []) hl[parseNote(n).midi] = n && parseNote(n).midi < 60 ? COLORS.left : COLORS.right;
    drawKeyboard(host, { from: b.from, to: b.to, highlight: hl, labels: b.labels !== false });
    return h('div', { class: 'figure' }, host, b.caption ? h('div', { class: 'caption' }, b.caption) : null);
  },

  'note-reading'(b, lesson) {
    const pool = (b.pitches || []).map(parseNote);
    const rounds = b.rounds || pool.length, min = b.minAccuracy ?? 0.8;
    const stage = h('div', { class: 'stage' });
    const count = h('span', { class: 'count' });
    const view = h('div', { class: 'staff-host' });
    const fb = h('div', { class: 'feedback' }, 'Нажми «Начать», дальше руки на клавишах — всё листается само.');
    const start = h('button', { class: 'btn primary' }, 'Начать');
    stage.append(h('div', { class: 'top' }, h('span', { class: 'kind' }, b.mode === 'name-to-key' ? 'Название → клавиша' : 'Нота на стане → клавиша'), count), view, fb, h('div', { class: 'row center' }, start));
    let st = null;
    const show = (colors = {}) => {
      if (b.mode === 'name-to-key') { view.innerHTML = ''; view.append(h('div', { class: 'big-name' }, st.target.text.replace(/-?\d$/, '') + (st.target.oct ?? ''))); }
      else drawStaff(view, { clef: b.clef || 'auto', events: [st.target.text], colors, scale: 1.9, compact: true });
      count.textContent = `${st.i + 1} из ${rounds}`;
    };
    const next = () => {
      if (st.i >= rounds) return finish();
      if (!st.bag.length) { let bag = shuffle(pool); if (bag.length > 1 && st.target && bag[0].midi === st.target.midi) bag.push(bag.shift()); st.bag = bag; }
      st.target = st.bag.shift(); st.first = true; st.t0 = performance.now(); st.fixing = false;
      fb.className = 'feedback'; fb.textContent = '';
      show();
    };
    const finish = () => {
      const acc = st.correct / rounds;
      const status = acc >= min ? 'passed' : 'needs-practice';
      view.innerHTML = '';
      view.append(h('div', { class: 'summary' }, h('div', { class: 'score' }, `${st.correct} из ${rounds}`),
        h('div', {}, `в среднем ${(st.times.reduce((a, x) => a + x, 0) / st.times.length / 1000).toFixed(1)} с на ноту`),
        h('span', { class: 'state ' + (status === 'passed' ? 'done' : 'going') }, status === 'passed' ? 'зачёт' : 'ещё потренировать')));
      fb.textContent = ''; count.textContent = '';
      saveResult(lesson, b, { accuracy: Math.round(acc * 1000) / 1000, avgResponseMs: Math.round(st.times.reduce((a, x) => a + x, 0) / st.times.length), status, checkedBy: 'midi' });
      start.textContent = 'Ещё раз'; start.hidden = false; stage.classList.remove('active'); st = null; activate(null);
    };
    const ctrl = {
      onMidi(e) {
        if (!st || !e.on) return;
        const ok = e.note === st.target.midi;
        if (st.first) { st.times.push(performance.now() - st.t0); if (ok) st.correct++; st.first = false; }
        if (ok) {
          fb.className = 'feedback ok'; fb.textContent = st.fixing ? 'Вот так.' : 'Верно';
          st.i++; setTimeout(next, st.fixing ? 500 : 280); st.target = { ...st.target, midi: -1 };
        } else {
          st.fixing = true; fb.className = 'feedback bad';
          fb.textContent = `Это ${midiName(e.note)}. Нужна ${st.target.text} — нажми её.`;
          show({ [st.target.midi]: COLORS.right });
        }
      },
      stop() { if (st) { st = null; stage.classList.remove('active'); start.hidden = false; start.textContent = 'Начать'; fb.textContent = 'Остановлено.'; } }
    };
    start.onclick = () => {
      if (!pool.length) { fb.textContent = 'В упражнении нет нот.'; return; }
      st = { i: 0, correct: 0, times: [], bag: [], target: null };
      activate(ctrl); stage.classList.add('active'); start.hidden = true; next();
    };
    return stage;
  },

  chord(b, lesson) {
    const voicing = b.check === 'voicing';
    const steps = (b.steps || []).map(s => ({ name: s.name, notes: s.notes.map(parseNote) }));
    for (const s of steps) if (voicing && s.notes.some(n => n.oct == null)) throw new Error(`аккорд ${s.name}: для voicing нужны октавы`);
    const rounds = b.rounds || 1, min = b.minAccuracy ?? 0.8;
    const stage = h('div', { class: 'stage' });
    const count = h('span', { class: 'count' });
    const name = h('div', { class: 'big-name' });
    const view = h('div', { class: 'staff-host' });
    const fb = h('div', { class: 'feedback' }, voicing ? 'Играй ровно ту форму, что на стане.' : 'Любая форма и октава — главное, правильные ноты.');
    const start = h('button', { class: 'btn primary' }, 'Начать');
    stage.append(h('div', { class: 'top' }, h('span', { class: 'kind' }, voicing ? 'Аккорд в заданной форме' : 'Аккорд по названию'), count), name, view, fb, h('div', { class: 'row center' }, start));
    let st = null, timer = null;
    const order = () => { let seq = []; for (let r = 0; r < rounds; r++) seq = seq.concat(b.order === 'shuffle' ? shuffle(steps) : steps); return seq; };
    const show = () => {
      const s = st.seq[st.i];
      name.textContent = s.name; name.classList.toggle('long', s.name.length > 5); count.textContent = `${st.i + 1} из ${st.seq.length}`;
      if (voicing) drawStaff(view, { events: [s.notes.map(n => n.text)], scale: 1.8, compact: true }); else view.innerHTML = '';
      st.first = true; st.t0 = performance.now(); st.fixing = false;
    };
    const matches = (s, held) => {
      if (voicing) { const want = s.notes.map(n => n.midi).sort((a, c) => a - c); const got = [...held].sort((a, c) => a - c); return want.length === got.length && want.every((m, i) => m === got[i]); }
      const want = new Set(s.notes.map(n => n.pc)), got = new Set([...held].map(m => m % 12));
      return want.size === got.size && [...want].every(p => got.has(p));
    };
    const evaluate = () => {
      if (!st) return;
      const s = st.seq[st.i], held = new Set(midi.held);
      const ok = matches(s, held);
      if (st.first) { st.times.push(performance.now() - st.t0); if (ok) st.correct++; st.first = false; }
      if (ok) {
        fb.className = 'feedback ok'; fb.textContent = st.fixing ? 'Вот так.' : 'Верно';
        st.i++;
        if (st.i >= st.seq.length) return setTimeout(finish, 350);
        setTimeout(show, 250);
      } else {
        st.fixing = true; fb.className = 'feedback bad';
        const played = [...held].sort((a, c) => a - c).map(m => voicing ? midiName(m) : pcName(m)).join(' ');
        fb.textContent = `Сыграл ${played}. Нужно ${s.notes.map(n => n.text).join(' ')}${voicing ? '' : ' — в любой форме'}.`;
      }
    };
    const finish = () => {
      const acc = st.correct / st.seq.length, status = acc >= min ? 'passed' : 'needs-practice';
      name.textContent = `${st.correct} из ${st.seq.length}`; view.innerHTML = ''; count.textContent = '';
      fb.className = 'feedback'; fb.textContent = status === 'passed' ? 'Зачёт.' : 'Ещё потренировать — это нормально.';
      saveResult(lesson, b, { accuracy: Math.round(acc * 1000) / 1000, avgResponseMs: Math.round(st.times.reduce((a, x) => a + x, 0) / st.times.length), status, checkedBy: 'midi' });
      start.textContent = 'Ещё раз'; start.hidden = false; stage.classList.remove('active'); st = null; activate(null);
    };
    const ctrl = {
      onMidi(e) {
        if (!st || !e.on) return;
        const need = st.seq[st.i].notes.length;
        clearTimeout(timer);
        // engine rule: judge the chord once enough keys are down and nothing changed for 140 ms
        if (midi.held.size >= need) timer = setTimeout(evaluate, 140);
      },
      stop() { clearTimeout(timer); if (st) { st = null; stage.classList.remove('active'); start.hidden = false; start.textContent = 'Начать'; fb.textContent = 'Остановлено.'; } }
    };
    start.onclick = () => {
      if (!steps.length) { fb.textContent = 'В упражнении нет аккордов.'; return; }
      midi.held.clear(); // a lost note-off must not poison chord checks
      st = { i: 0, correct: 0, times: [], seq: order() };
      activate(ctrl); stage.classList.add('active'); start.hidden = true; show();
    };
    return stage;
  },

  'guided-practice'(b, lesson) {
    const stage = h('div', { class: 'stage' });
    const text = renderMarkup(b.text); text.classList.add('practice-text');
    stage.append(h('div', { class: 'top' }, h('span', { class: 'kind' }, 'Играешь сам'), h('span')), text);
    if (b.metronome) {
      const bpm = b.metronome.bpm || 60;
      stage.append(h('div', { class: 'metro-inline' }, `Темп ${bpm} BPM`,
        h('button', { class: 'btn', onclick: () => { metro.beats = b.metronome.beats || 4; metro.setBpm(bpm); metro.toggle(); } , 'data-metro-toggle': true }, metro.on ? 'Стоп' : 'Метроном')));
    }
    const fb = h('div', { class: 'feedback' });
    const rate = (status, label) => h('button', { class: 'btn' + (status === 'passed' ? ' primary' : ''), onclick: () => {
      if (status) saveResult(lesson, b, { accuracy: status === 'passed' ? 1 : 0, avgResponseMs: 0, status, checkedBy: 'self' });
      fb.textContent = status ? `Записал: ${label.toLowerCase()}.` : 'Пропущено, ничего не записал.';
    } }, label);
    stage.append(h('div', { class: 'row' }, rate('passed', 'Получилось'), rate('needs-practice', 'Ещё надо'), rate(null, 'Пропустить')), fb);
    return stage;
  }
};

/* ---------------- pages ---------------- */
const main = $('#main');
const page = (...kids) => { main.innerHTML = ''; const p = h('div', { class: 'page' }, ...kids); main.append(p); window.scrollTo(0, 0); return p; };
const hero = (title, text) => h('div', { class: 'hero' }, h('div', {}, h('h1', {}, title), h('p', {}, text)), h('div', { class: 'art', html: ART.hero }));

async function theoryPage() {
  const p = page(hero('Теория', 'Читаешь сверху вниз и сразу пробуешь на клавишах. Пройденные уроки можно открыть снова.'));
  const body = h('div', {}, h('p', { class: 'feedback' }, 'Загружаю уроки…'));
  p.append(body);
  let list;
  try { list = await loadCatalog(); }
  catch (e) { body.innerHTML = ''; body.append(h('div', { class: 'empty' }, h('strong', {}, 'Уроки не загрузились'), e.message)); return; }
  body.innerHTML = '';
  const lessons = list.lessons.filter(l => l.schemaVersion === 1);
  if (!lessons.length) { body.append(h('div', { class: 'empty' }, h('strong', {}, 'Уроков пока нет'), 'Попроси Палыча написать следующий урок — он появится здесь.')); }
  const next = lessons.find(l => lessonState(l) !== 'done');
  if (next) body.append(h('a', { class: 'continue', href: `#/lesson/${next.id}` },
    h('div', {}, h('div', { class: 'label' }, lessonState(next) === 'new' ? 'Следующий урок' : 'Продолжить'), h('div', { class: 'title' }, next.title), h('div', { class: 'label' }, next.goal || '')),
    h('div', { class: 'motif', html: motif(next.id) })));
  if (lessons.length) {
    body.append(h('h2', { class: 'section' }, 'Все уроки'));
    body.append(h('ul', { class: 'lesson-list' }, lessons.map(l => {
      const s = lessonState(l);
      return h('li', {}, h('a', { class: 'lesson-row', href: `#/lesson/${l.id}` },
        h('div', { class: 'motif', html: motif(l.id, { w: 96, h: 44, n: 4 }) }),
        h('div', {}, h('div', { class: 't' }, l.title), l.goal ? h('div', { class: 'g' }, l.goal) : null),
        h('span', { class: 'state ' + (s === 'done' ? 'done' : s === 'going' ? 'going' : '') }, STATE_TEXT[s])));
    })));
  }
  for (const e of list.errors || []) body.append(h('p', { class: 'note-bad' }, `Урок ${e.file} не читается: ${e.error}`));
  const old = list.lessons.filter(l => l.schemaVersion !== 1);
  for (const o of old) body.append(h('p', { class: 'note-bad' }, `Урок ${o.id} в старом формате (schemaVersion ${o.schemaVersion}) — пропущен.`));
}

async function lessonPage(id) {
  const p = page(h('p', { class: 'feedback' }, 'Открываю урок…'));
  let lesson;
  try { lesson = (await bridge.get({ action: 'lesson', id })).lesson; }
  catch (e) { p.innerHTML = ''; p.append(h('div', { class: 'empty' }, h('strong', {}, 'Урок не открылся'), e.message, h('p', {}, h('a', { href: '#/theory' }, 'К списку уроков')))); return; }
  p.innerHTML = '';
  p.append(h('div', { class: 'lesson-head' }, h('a', { class: 'back', href: '#/theory' }, '‹ Все уроки'), h('h1', {}, lesson.title), lesson.goal ? h('p', { class: 'goal' }, lesson.goal) : null));
  for (const b of lesson.blocks || []) {
    const wrap = h('section', { class: 'block', id: 'b-' + b.id });
    if (b.title) wrap.append(h('h3', {}, b.title));
    try {
      const make = BLOCKS[b.type];
      if (!make) throw new Error(`неизвестный тип блока «${b.type}»`);
      wrap.append(make(b, lesson));
    } catch (e) { wrap.append(h('p', { class: 'note-bad' }, `Блок ${b.id} не показан: ${e.message}`)); }
    p.append(wrap);
  }
  const list = catalog?.lessons?.filter(l => l.schemaVersion === 1) || [];
  const idx = list.findIndex(l => l.id === lesson.id), nextL = idx >= 0 ? list[idx + 1] : null;
  p.append(h('div', { class: 'lesson-end' },
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => { const r = store.get(K.read, []); if (!r.includes(lesson.id)) { r.push(lesson.id); store.set(K.read, r); } location.hash = nextL ? `#/lesson/${nextL.id}` : '#/theory'; } }, nextL ? 'Дочитал — к следующему уроку' : 'Дочитал — к списку'),
      h('a', { class: 'btn quiet', href: '#/theory', style: 'text-decoration:none;display:inline-flex;align-items:center' }, 'К списку'))));
  keepAwake();
}

function exercisesPage() {
  page(hero('Упражнения', 'Библиотека упражнений по темам и то, что сейчас в фокусе.'),
    h('div', { class: 'empty' }, h('strong', {}, 'Скоро здесь'), 'Арпеджио, синхронность рук, аккорды и смены, интервалы, гаммы и знаки. Каждое упражнение — зачем оно, как делать правильно, варианты и ступени темпа. Метроном уже есть сверху справа.'));
}
/* ---------------- songs: list + MIDI player ---------------- */
const b64ToBytes = b64 => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
const songTitle = n => n.replace(/\.(mid|midi|musicxml|xml)$/i, '');
const songId = n => 'song-' + (songTitle(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x');
const HAND_COLOR = { R: COLORS.right, L: COLORS.left, V: '#b9a6f2' };

async function songsPage() {
  const p = page(hero('Песни', 'Мелодия и аккомпанемент по нотам: приложение ждёт, пока сыграешь нужные клавиши, и ведёт дальше.'));
  const body = h('div', {}, h('p', { class: 'feedback' }, 'Загружаю песни…')); p.append(body);
  let list;
  try { list = (await bridge.get({ action: 'songs' })).songs; }
  catch (e) { body.innerHTML = ''; body.append(h('div', { class: 'empty' }, h('strong', {}, 'Песни не загрузились'), e.message.includes('unknown action') ? 'Мост ещё старой версии — обнови Code.gs в Apps Script.' : e.message)); return; }
  body.innerHTML = '';
  const prog = store.get(K.progress, {});
  if (!list.length) body.append(h('div', { class: 'empty' }, h('strong', {}, 'Песен пока нет'), 'Положи MIDI-файл в Google Drive → Music/Piano/songs — он появится здесь.'));
  else body.append(h('ul', { class: 'lesson-list' }, list.map(s => {
    const done = Object.values(prog[songId(s.name)] || {});
    const st = done.includes('passed') ? 'going' : done.length ? 'going' : '';
    return h('li', {}, h('a', { class: 'lesson-row', href: '#/song/' + encodeURIComponent(s.name) },
      h('div', { class: 'motif', html: motif(s.name, { w: 96, h: 44, n: 4 }) }),
      h('div', {}, h('div', { class: 't' }, songTitle(s.name)), h('div', { class: 'g' }, /\.mid/i.test(s.name) ? 'MIDI' : 'MusicXML — пока не поддерживается')),
      h('span', { class: 'state ' + st }, done.length ? `проходов: ${done.length}` : 'новая')));
  })));
  body.append(h('p', { class: 'feedback', style: 'text-align:left;margin-top:22px' }, 'Добавить песню: MIDI-файл в Google Drive → Music/Piano/songs. Разбор по аккордам переедет сюда следующим шагом.'));
}

function finishSong(base) {
  const { notes } = base;
  notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
  const starts = base.barStarts, nums = base.barNums;
  let i = 0;
  for (const n of notes) { while (i + 1 < starts.length && starts[i + 1] <= n.ticks) i++; n.bar = nums[i]; }
  const lo = Math.min(...notes.map(n => n.midi)), hi = Math.max(...notes.map(n => n.midi));
  const hands = [...new Set(notes.map(n => n.hand))];
  return { ...base, lo, hi, hands, firstBar: nums[0], bars: notes.length ? notes[notes.length - 1].bar : nums[0] };
}
function prepareMidi(m) {
  const tracks = m.tracks.filter(t => t.notes.length);
  const avg = t => t.notes.reduce((a, n) => a + n.midi, 0) / t.notes.length;
  const notes = [];
  if (tracks.length >= 2) {
    const sorted = tracks.slice().sort((a, b) => avg(b) - avg(a));
    const rAvg = avg(sorted[0]), lAvg = avg(sorted[sorted.length - 1]);
    for (const t of sorted) { const hand = Math.abs(avg(t) - rAvg) <= Math.abs(avg(t) - lAvg) ? 'R' : 'L'; for (const n of t.notes) notes.push({ midi: n.midi, ticks: n.ticks, dur: n.durationTicks, time: n.time, hand }); }
  } else for (const n of (tracks[0]?.notes || [])) notes.push({ midi: n.midi, ticks: n.ticks, dur: n.durationTicks, time: n.time, hand: n.midi >= 60 ? 'R' : 'L' });
  const ppq = m.header.ppq, ts = m.header.timeSignatures[0]?.timeSignature || [4, 4];
  const bar = ppq * 4 * ts[0] / ts[1], last = notes.reduce((a, n) => Math.max(a, n.ticks), 0);
  const barStarts = [], barNums = [];
  for (let k = 0; k * bar <= last + bar; k++) { barStarts.push(k * bar); barNums.push(k + 1); }
  const ks = m.header.keySignatures[0];
  const flats = !!ks && (/b/.test(ks.key) || (ks.scale === 'major' && ks.key === 'F') || (ks.scale === 'minor' && ['D', 'G', 'C', 'F'].includes(ks.key)));
  for (const n of notes) n.label = (flats ? FLAT_NAMES : SHARP_NAMES)[n.midi % 12];
  return finishSong({ notes, ppq, ts, barStarts, barNums, bpm: Math.round(m.header.tempos[0]?.bpm || 100),
    t2s: t => m.header.ticksToSeconds(t), s2t: x => m.header.secondsToTicks(x) });
}

// MusicXML (partwise, uncompressed). Piano staff 1 = right hand, staff 2 = left; other single-staff parts = melody ('V').
function prepareMusicXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('файл MusicXML не читается');
  const root = doc.querySelector('score-partwise');
  if (!root) throw new Error('поддерживается только обычный MusicXML (partwise), не .mxl');
  const PPQ = 480, STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const notes = [], tempos = [];
  let ts = null, barStarts = null, barNums = null;
  const kid = (el, name) => { for (const c of el.children) if (c.tagName === name) return c; return null; };
  const kids = (el, name) => [...el.children].filter(c => c.tagName === name);
  const txt = (el, name) => kid(el, name)?.textContent?.trim();
  for (const part of kids(root, 'part')) {
    let divisions = 1, cursor = 0, lastStart = 0, staves = 1;
    const myStarts = [], myNums = [], open = {}, partNotes = [];
    let seq = 0;
    for (const meas of kids(part, 'measure')) {
      const implicit = meas.getAttribute('implicit') === 'yes';
      myStarts.push(cursor); myNums.push(implicit && seq === 0 ? 0 : (seq === 0 ? 1 : myNums[myNums.length - 1] + 1));
      seq++;
      for (const el of meas.children) {
        const tag = el.tagName;
        if (tag === 'attributes') {
          if (kid(el, 'divisions')) divisions = +txt(el, 'divisions');
          if (kid(el, 'staves')) staves = +txt(el, 'staves');
          const t = kid(el, 'time'); if (t && !ts) ts = [+txt(t, 'beats'), +txt(t, 'beat-type')];
        } else if (tag === 'sound' || tag === 'direction') {
          const snd = tag === 'sound' ? el : kid(el, 'sound');
          if (snd && snd.getAttribute('tempo')) tempos.push({ ticks: cursor, bpm: +snd.getAttribute('tempo') });
        } else if (tag === 'backup') cursor -= +txt(el, 'duration') * PPQ / divisions;
        else if (tag === 'forward') cursor += +txt(el, 'duration') * PPQ / divisions;
        else if (tag === 'note') {
          if (kid(el, 'grace') || kid(el, 'cue')) continue;
          const dur = +(txt(el, 'duration') || 0) * PPQ / divisions;
          const isChord = !!kid(el, 'chord');
          const start = isChord ? lastStart : cursor;
          if (!isChord) { lastStart = cursor; cursor += dur; }
          const pitch = kid(el, 'pitch'); if (!pitch) continue;
          const midiN = (+txt(pitch, 'octave') + 1) * 12 + STEP[txt(pitch, 'step')] + Math.round(+(txt(pitch, 'alter') || 0));
          const staff = +(txt(el, 'staff') || 1), voice = txt(el, 'voice') || '1';
          const ties = kids(el, 'tie').map(t => t.getAttribute('type'));
          const key = `${midiN}|${staff}|${voice}`;
          if (ties.includes('stop') && open[key]) {
            const o = open[key]; o.dur = start + dur - o.ticks;
            if (!ties.includes('start')) delete open[key];
            continue;
          }
          const hand = staves >= 2 ? (staff === 1 ? 'R' : 'L') : 'V';
          const alt = Math.round(+(txt(pitch, 'alter') || 0));
          const n = { midi: midiN, ticks: start, dur, hand, label: txt(pitch, 'step') + (alt > 0 ? '#'.repeat(alt) : alt < 0 ? 'b'.repeat(-alt) : '') };
          partNotes.push(n);
          if (ties.includes('start')) open[key] = n;
        }
      }
    }
    // a lone single-staff part (no piano) is played as right/left by register
    notes.push(...partNotes);
    if (!barStarts) { barStarts = myStarts; barNums = myNums; }
  }
  if (!notes.some(n => n.hand !== 'V')) for (const n of notes) n.hand = n.midi >= 60 ? 'R' : 'L';
  tempos.sort((a, b) => a.ticks - b.ticks);
  if (!tempos.length || tempos[0].ticks > 0) tempos.unshift({ ticks: 0, bpm: tempos[0]?.bpm || 100 });
  const t2s = t => { let s = 0; for (let i = 0; i < tempos.length; i++) { const a = tempos[i], b = tempos[i + 1]; const end = b ? Math.min(t, b.ticks) : t; if (end > a.ticks) s += (end - a.ticks) / PPQ * 60 / a.bpm; if (!b || t <= b.ticks) break; } return s; };
  const s2t = x => { let s = 0; for (let i = 0; i < tempos.length; i++) { const a = tempos[i], b = tempos[i + 1]; const seg = b ? (b.ticks - a.ticks) / PPQ * 60 / a.bpm : Infinity; if (x <= s + seg) return a.ticks + (x - s) * a.bpm / 60 * PPQ; s += seg; } return 0; };
  for (const n of notes) n.time = t2s(n.ticks);
  return finishSong({ notes, ppq: PPQ, ts: ts || [4, 4], barStarts, barNums, bpm: Math.round(tempos[0].bpm), t2s, s2t });
}
function buildEvents(song, hands, from, to) {
  const tol = song.ppq / 16, ev = [];
  for (const n of song.notes) {
    if (!hands.includes(n.hand) || n.bar < from || n.bar > to) continue;
    const last = ev[ev.length - 1];
    if (last && n.ticks - last.ticks <= tol) last.notes.push(n); else ev.push({ ticks: n.ticks, time: n.time, bar: n.bar, notes: [n] });
  }
  return ev;
}

// one tiny synth for "listen"
const synth = {
  ctx: null, bus: null,
  // every playback gets its own bus; Stop disconnects it, which silences notes already scheduled ahead
  newBus() { this.ctx = this.ctx || metro.ctx || new (window.AudioContext || window.webkitAudioContext)(); metro.ctx = this.ctx; this.bus = this.ctx.createGain(); this.bus.connect(this.ctx.destination); },
  live: new Set(),
  silence() {
    for (const v of this.live) { try { v.forEach(o => o.stop(0)); } catch { /* not started yet is fine */ } }
    this.live.clear();
    if (this.bus) { try { this.bus.disconnect(); } catch { /* already gone */ } this.bus = null; }
  },
  play(midiNote, when, dur, vel = 0.25) {
    if (!this.bus) this.newBus();
    const f = 440 * Math.pow(2, (midiNote - 69) / 12), o = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.25;
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vel, when + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, when + Math.min(Math.max(dur, 0.25), 2.5));
    o.connect(g); o2.connect(g2).connect(g); g.connect(this.bus);
    o.start(when); o2.start(when); o.stop(when + 2.6); o2.stop(when + 2.6);
    const voice = [o, o2]; this.live.add(voice); o.onended = () => this.live.delete(voice);
  }
};

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2.2v14H6zM19 5.5v13L9.5 12z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M15.8 5H18v14h-2.2zM5 5.5v13l9.5-6.5z" fill="currentColor"/></svg>',
  loop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  listen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 16v-4a8 8 0 0 1 16 0v4"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.6" fill="currentColor"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.6" fill="currentColor"/></svg>',
  wait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 3h10M7 21h10"/><path d="M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg>'
};
const HAND_LABEL = { R: 'П', L: 'Л', V: 'М' }, HAND_NAME = { R: 'Правая', L: 'Левая', V: 'Мелодия' };

async function songPage(name) {
  const p = page(h('p', { class: 'feedback' }, 'Открываю песню…'));
  let song;
  try {
    const d = await bridge.get({ action: 'song', name });
    const bytes = b64ToBytes(d.data);
    song = /\.midi?$/i.test(name) ? prepareMidi(new Midi(bytes)) : prepareMusicXML(new TextDecoder('utf-8').decode(bytes));
    if (!song.notes.length) throw new Error('в файле нет нот');
  } catch (e) { p.innerHTML = ''; p.append(h('div', { class: 'empty' }, h('strong', {}, 'Песня не открылась'), e.message, h('p', {}, h('a', { href: '#/songs' }, 'К списку песен')))); return; }
  p.innerHTML = '';
  p.classList.add('wide');
  const st = { hands: song.hands.includes('V') ? ['R', 'L'] : ['R', 'L'], mode: 'wait', from: song.firstBar, to: song.bars, loop: true, tempo: 70,
    playing: false, running: false, idx: 0, events: [], pressed: new Set(), wrongFlash: {}, fx: [], mistakes: 0, cleanEvents: 0, evStart: 0, times: [], view: 0, raf: 0, play: null, loopA: null };
  const range = () => [Math.min(st.from, st.to), Math.max(st.from, st.to)];
  const icon = (k, label, extra = {}) => h('button', { class: 'ibtn', 'aria-label': label, title: label, html: ICON[k], ...extra });

  /* ---- setup panel (shown before playing) ---- */
  const handChips = (cls) => h('div', { class: cls }, song.hands.map(hd => {
    const b = h('button', { class: 'chip hand-' + hd, 'aria-pressed': 'false', onclick: () => {
      const on = st.hands.includes(hd); if (on && st.hands.length === 1) return;
      st.hands = on ? st.hands.filter(x => x !== hd) : [...st.hands, hd]; syncUi(); reset(true);
    } }, cls === 'chips' ? HAND_NAME[hd] : HAND_LABEL[hd]);
    b.dataset.hand = hd; return b;
  }));
  const modeBtn = (m, label, cls) => h('button', { class: cls, 'data-mode': m, onclick: () => { const was = st.playing; pause(); st.mode = m; syncUi(); if (was) resume(); }, html: ICON[m] + `<span>${label}</span>` });
  const num = (val, on) => h('input', { type: 'number', inputmode: 'numeric', min: song.firstBar, max: song.bars, value: val, class: 'num', onchange: e => { on(Math.max(song.firstBar, Math.min(song.bars, +e.target.value || song.firstBar))); syncUi(); reset(true); } });
  const fromIn = num(st.from, v => (st.from = v)), toIn = num(st.to, v => (st.to = v));
  const loopCb = h('input', { type: 'checkbox', checked: true, onchange: e => { st.loop = e.target.checked; syncUi(); } });
  const tempoVal = h('span', { class: 'tempo-val' });
  const tempoIn = h('input', { type: 'range', min: 30, max: 100, step: 5, value: st.tempo, oninput: e => setTempo(+e.target.value) });
  const setup = h('div', { class: 'setup' },
    h('div', { class: 'lesson-head' }, h('a', { class: 'back', href: '#/songs' }, '‹ Все песни'), h('h1', {}, songTitle(name)),
      h('p', { class: 'goal' }, `${song.bars} тактов, размер ${song.ts[0]}/${song.ts[1]}, в оригинале ${song.bpm} BPM`)),
    h('div', { class: 'setup-grid' },
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Кто играет'), handChips('chips')),
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Режим'), h('div', { class: 'seg' }, modeBtn('wait', 'Ждать меня', 'seg-b'), modeBtn('listen', 'Послушать', 'seg-b'))),
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Такты'), h('div', { class: 'row' }, fromIn, h('span', { class: 'dash' }, '—'), toIn, h('label', { class: 'ctl' }, loopCb, 'по кругу'))),
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Темп «Послушать»'), h('div', { class: 'row' }, tempoIn, tempoVal))),
    h('div', { class: 'row' }, h('button', { class: 'btn primary big', onclick: enterPlay, html: ICON.play + '<span>Играть</span>' }),
      h('p', { class: 'hint' }, 'В игре: тяни ноты пальцем, чтобы отмотать. Тап по номеру такта — играть оттуда, долгое нажатие на два такта — гонять кусок по кругу. На пианино: A0 — пропустить, B0 — такт назад.')));

  /* ---- play bar (fullscreen mode) ---- */
  const playBtn = icon('play', 'Пауза / продолжить', { onclick: () => (st.playing ? pause() : resume()) });
  const loopBtn = h('button', { class: 'chip loop', onclick: () => { st.loop = !st.loop; syncUi(); }, html: ICON.loop + '<span></span>' });
  const tempoChip = h('div', { class: 'tempo-chip' }, icon('minus', 'Медленнее', { onclick: () => setTempo(st.tempo - 5) }), h('span', { class: 'tempo-val' }), icon('plus', 'Быстрее', { onclick: () => setTempo(st.tempo + 5) }));
  const status = h('span', { class: 'pb-status' });
  const playBar = h('div', { class: 'play-bar' },
    icon('close', 'Выйти из игры', { onclick: exitPlay }),
    h('div', { class: 'pb-group' }, icon('prev', 'Такт назад', { onclick: () => stepBar(-1) }), playBtn, icon('next', 'Такт вперёд', { onclick: () => stepBar(1) })),
    loopBtn, handChips('pb-hands'),
    h('div', { class: 'seg small' }, modeBtn('wait', 'Ждать', 'seg-b'), modeBtn('listen', 'Слушать', 'seg-b')),
    tempoChip, status);
  const canvas = h('canvas', { class: 'roll' });
  const rollWrap = h('div', { class: 'roll-wrap' }, canvas);
  p.append(setup, playBar, rollWrap);

  function syncUi() {
    document.querySelectorAll('.chip[data-hand]').forEach(b => { const on = st.hands.includes(b.dataset.hand); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    p.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === st.mode));
    const [a, b] = range();
    fromIn.value = st.from; toIn.value = st.to; loopCb.checked = st.loop;
    loopBtn.classList.toggle('on', st.loop); loopBtn.querySelector('span').textContent = `${a}–${b}`;
    p.querySelectorAll('.tempo-val').forEach(x => (x.textContent = st.tempo + '%')); tempoIn.value = st.tempo;
    tempoChip.hidden = st.mode !== 'listen';
    playBtn.innerHTML = st.playing ? ICON.pause : ICON.play;
    updateStatus();
  }
  function setTempo(v) { st.tempo = Math.max(30, Math.min(100, v)); const was = st.playing && st.mode === 'listen'; if (was) { pause(); resume(); } syncUi(); }

  /* ---- geometry ---- */
  const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
  let lo = Math.max(21, song.lo - 2), hi = Math.min(108, song.hi + 2);
  while (isBlack(lo)) lo--; while (isBlack(hi)) hi++;
  const whites = []; for (let n = lo; n <= hi; n++) if (!isBlack(n)) whites.push(n);
  const geo = {};
  function layout() {
    const playMode = document.body.classList.contains('playing');
    rollWrap.style.top = playMode ? playBar.offsetHeight + 'px' : '';
    const dpr = window.devicePixelRatio || 1, w = rollWrap.clientWidth || canvas.clientWidth;
    const hgt = playMode ? Math.max(300, window.innerHeight - playBar.offsetHeight) : Math.round(Math.max(300, Math.min(window.innerHeight * 0.45, 520)));
    canvas.width = w * dpr; canvas.height = hgt * dpr; canvas.style.height = hgt + 'px'; canvas.style.width = w + 'px';
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ww = w / whites.length, kh = Math.min(130, Math.max(70, ww * 5.2));
    Object.assign(geo, { ctx, w, h: hgt, ww, kh, area: hgt - kh, pxPerTick: (hgt - kh) / (song.ppq * 6) });
    geo.x = {}; whites.forEach((n, i) => (geo.x[n] = { x: i * ww, w: ww }));
    for (let n = lo; n <= hi; n++) if (isBlack(n)) { const l = geo.x[n - 1]; geo.x[n] = { x: l.x + ww - ww * 0.31, w: ww * 0.62 }; }
  }

  /* ---- position ---- */
  const cur = () => st.events[st.idx];
  const barIndexAt = t => { let i = 0; while (i + 1 < song.barStarts.length && song.barStarts[i + 1] <= t) i++; return i; };
  function reset(keepPos) {
    const pos = keepPos && cur() ? cur().ticks : null;
    st.events = buildEvents(song, st.hands, ...range());
    st.idx = 0; st.pressed = new Set(); st.mistakes = 0; st.cleanEvents = 0; st.times = []; st.evMistake = false;
    if (pos != null) { const i = st.events.findIndex(e => e.ticks >= pos - 1); st.idx = i < 0 ? 0 : i; }
    st.view = cur() ? cur().ticks - song.ppq : 0; st.evStart = performance.now();
    if (st.playing && st.mode === 'listen') startListen();
    updateStatus();
  }
  function seekTicks(t, jump) {
    const i = st.events.findIndex(e => e.ticks >= t - song.ppq / 16);
    st.idx = i < 0 ? st.events.length - 1 : i; st.pressed = new Set(); st.evMistake = false; st.evStart = performance.now();
    if (jump && cur()) st.view = cur().ticks;
    if (st.playing && st.mode === 'listen') startListen();
    updateStatus();
  }
  function stepBar(d) {
    const bi = barIndexAt(cur() ? cur().ticks : st.view);
    const tb = Math.max(0, Math.min(song.barStarts.length - 1, bi + d));
    seekTicks(song.barStarts[tb]);
  }
  function updateStatus() {
    const e = cur(), [a, b] = range();
    status.textContent = st.events.length ? `Такт ${e ? e.bar : b}${st.mode === 'wait' ? ` · ошибок ${st.mistakes}` : ''}` : 'Нет нот для выбранных рук';
  }

  /* ---- drawing ---- */
  function rr(ctx, x, y, w, hh, r) { r = Math.min(r, w / 2, hh / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function draw() {
    const { ctx, w, area, kh, pxPerTick } = geo; if (!ctx) return;
    const now = performance.now();
    ctx.clearRect(0, 0, w, geo.h);
    const bg = ctx.createLinearGradient(0, 0, 0, area); bg.addColorStop(0, '#0f1320'); bg.addColorStop(1, '#171d2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, area);
    // faint key lanes for black keys
    ctx.fillStyle = 'rgba(255,255,255,0.018)';
    for (let n = lo; n <= hi; n++) if (isBlack(n)) ctx.fillRect(geo.x[n].x, 0, geo.x[n].w, area);
    // bars
    ctx.font = '600 12px Golos Text, sans-serif'; ctx.textBaseline = 'middle';
    const [ra, rb] = range();
    for (let b = 0; b < song.barStarts.length; b++) {
      const y = area - (song.barStarts[b] - st.view) * pxPerTick; if (y > area + 2) continue; if (y < -10) break;
      const num = song.barNums[b], inLoop = st.loop && num >= ra && num <= rb, isA = st.loopA === num;
      ctx.fillStyle = inLoop ? 'rgba(242,165,65,0.22)' : 'rgba(255,255,255,0.07)'; ctx.fillRect(0, y, w, 1);
      const label = String(num), tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = isA ? COLORS.right : inLoop ? 'rgba(242,165,65,0.18)' : 'rgba(255,255,255,0.06)'; rr(ctx, 6, y - 11, tw, 20, 10); ctx.fill();
      ctx.fillStyle = isA ? '#24180a' : inLoop ? COLORS.right : '#8a90a5'; ctx.fillText(label, 13, y - 1);
    }
    // notes
    const curT = cur() ? cur().ticks : Infinity;
    for (const ev of st.events) {
      if ((ev.ticks - st.view) * pxPerTick > area + 60) break;
      const isCur = ev.ticks === curT, done = st.mode === 'wait' && ev.ticks < curT;
      for (const n of ev.notes) {
        const g = geo.x[n.midi]; if (!g) continue;
        const y0 = area - (n.ticks - st.view) * pxPerTick, hh = Math.max(9, n.dur * pxPerTick - 3);
        if (y0 < -4 || y0 - hh > area) continue;
        const col = HAND_COLOR[n.hand];
        ctx.globalAlpha = done ? 0.14 : isCur ? 1 : 0.82;
        if (isCur) { ctx.shadowColor = col; ctx.shadowBlur = 18; }
        ctx.fillStyle = col; rr(ctx, g.x + 2, y0 - hh, g.w - 4, hh, 6); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; rr(ctx, g.x + 3, y0 - hh + 1, g.w - 6, Math.min(4, hh / 3), 3); ctx.fill();
        if (g.w >= 16 && hh >= 16) { ctx.fillStyle = 'rgba(15,19,32,0.85)'; ctx.font = `700 ${Math.min(13, g.w * 0.48)}px Golos Text, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(n.label || pcName(n.midi), g.x + g.w / 2, y0 - 4); ctx.textAlign = 'left'; }
        ctx.globalAlpha = 1;
      }
    }
    // now line with glow
    const glow = ctx.createLinearGradient(0, area - 26, 0, area); glow.addColorStop(0, 'rgba(237,231,217,0)'); glow.addColorStop(1, 'rgba(237,231,217,0.10)');
    ctx.fillStyle = glow; ctx.fillRect(0, area - 26, w, 26);
    ctx.fillStyle = 'rgba(237,231,217,0.85)'; ctx.fillRect(0, area - 1.5, w, 2);
    // hit bursts
    st.fx = st.fx.filter(f => now - f.t < 420);
    for (const f of st.fx) {
      const g = geo.x[f.midi]; if (!g) continue; const k = (now - f.t) / 420;
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(g.x + g.w / 2, area, g.w * (0.5 + k * 1.2), 6 + k * 22, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // keyboard
    const need = {}; for (const n of (cur()?.notes || [])) need[n.midi] = HAND_COLOR[n.hand];
    const held = midi.held;
    const fill = (n, black) => st.wrongFlash[n] > now ? COLORS.wrong : held.has(n) && need[n] ? '#ffffff' : need[n] || (held.has(n) ? (black ? '#59617e' : '#c7ccda') : black ? '#1b2030' : COLORS.paper);
    for (const n of whites) {
      const g = geo.x[n], down = held.has(n) ? 2 : 0;
      ctx.fillStyle = fill(n, false); rr(ctx, g.x + 1, area + 2 + down, g.w - 2, kh - 4, 5); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(g.x + 1, area + kh - 8 + down, g.w - 2, 4);
      if (n === 60) { ctx.fillStyle = '#8a90a5'; ctx.beginPath(); ctx.arc(g.x + g.w / 2, area + kh - 16, 3, 0, 7); ctx.fill(); }
    }
    for (let n = lo; n <= hi; n++) { if (!isBlack(n)) continue; const g = geo.x[n], down = held.has(n) ? 2 : 0; ctx.fillStyle = fill(n, true); rr(ctx, g.x, area + 2 + down, g.w, kh * 0.6, 4); ctx.fill(); }
  }

  /* ---- loop over frames ---- */
  function tick() {
    if (st.mode === 'wait' || !st.play) {
      if (!st.dragging) { const target = cur() ? cur().ticks : st.view; st.view += (target - st.view) * 0.16; }
    } else {
      pump();
      const t = (synth.ctx.currentTime - st.play.t0) * st.tempo / 100 + st.play.sec0;
      st.view = song.s2t(t);
      let moved = false; while (cur() && cur().ticks <= st.view) { st.idx++; moved = true; }
      if (moved) updateStatus();
      const last = st.events[st.events.length - 1];
      if (!cur() && last && st.view > last.ticks + song.ppq * 2) { if (st.loop) { st.idx = 0; startListen(); } else pause(); }
    }
    draw();
    st.raf = requestAnimationFrame(tick);
  }

  /* ---- MIDI input ---- */
  const ctrl = {
    onMidi(e) {
      if (!e.on || !st.playing) return;
      if (e.note === 23) { stepBar(-1); return; }
      if (st.mode !== 'wait') return;
      const ev = cur(); if (!ev) return;
      if (e.note === 21) { st.mistakes++; st.evMistake = true; advance(); return; }
      const need = new Set(ev.notes.map(n => n.midi));
      if (need.has(e.note)) { st.pressed.add(e.note); st.fx.push({ midi: e.note, t: performance.now(), color: HAND_COLOR[ev.notes.find(n => n.midi === e.note).hand] }); }
      else { st.mistakes++; st.evMistake = true; st.wrongFlash[e.note] = performance.now() + 380; }
      if ([...need].every(n => st.pressed.has(n))) advance();
      updateStatus();
    },
    stop() { pause(); }
  };
  function advance() {
    st.times.push(performance.now() - st.evStart);
    if (!st.evMistake) st.cleanEvents++;
    st.idx++; st.pressed = new Set(); st.evMistake = false; st.evStart = performance.now();
    if (!cur()) finishPass();
  }
  function finishPass() {
    const total = st.events.length, acc = total ? st.cleanEvents / total : 0, [a, b] = range();
    const status = acc >= 0.9 ? 'passed' : 'needs-practice';
    saveResult({ id: songId(name) }, { id: `${st.hands.slice().sort().join('').toLowerCase()}-${a}-${b}` },
      { accuracy: Math.round(acc * 1000) / 1000, avgResponseMs: Math.round(st.times.reduce((x, y) => x + y, 0) / Math.max(1, st.times.length)), status, checkedBy: 'midi' });
    toast(`Проход: ${Math.round(acc * 100)}% без ошибок${status === 'passed' ? ' — зачёт' : ''}`);
    st.cleanEvents = 0; st.mistakes = 0; st.times = [];
    if (st.loop) { st.idx = 0; } else { st.idx = total - 1; pause(); }
  }

  /* ---- listen ---- */
  // only the next ~1.5 s of notes are queued; pump() tops the queue up as playback moves (never the whole song at once)
  function startListen() {
    synth.silence(); synth.newBus(); synth.ctx.resume();
    const first = cur() || st.events[0]; if (!first) return;
    st.play = { t0: synth.ctx.currentTime + 0.2, sec0: first.time, next: st.events.indexOf(first) };
    pump();
  }
  function pump() {
    const pl = st.play; if (!pl || !synth.bus) return;
    const rate = st.tempo / 100, horizon = synth.ctx.currentTime + 1.5;
    while (pl.next < st.events.length) {
      const ev = st.events[pl.next], when = pl.t0 + (ev.time - pl.sec0) / rate;
      if (when > horizon) break;
      if (when >= synth.ctx.currentTime - 0.05) for (const n of ev.notes) synth.play(n.midi, when, (song.t2s(n.ticks + n.dur) - n.time) / rate);
      pl.next++;
    }
  }

  /* ---- states ---- */
  function resume() {
    if (!st.events.length) return;
    st.playing = true; activate(ctrl); keepAwake();
    if (st.mode === 'listen') startListen(); else { synth.silence(); st.play = null; st.evStart = performance.now(); }
    syncUi();
  }
  function pause() { st.playing = false; synth.silence(); st.play = null; syncUi(); }
  function enterPlay() { document.body.classList.add('playing'); window.scrollTo(0, 0); layout(); resume(); }
  function exitPlay() { pause(); document.body.classList.remove('playing'); layout(); }

  /* ---- touch: drag to scrub, tap bar number to jump, long-press two bars to loop ---- */
  let ptr = null;
  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (y > geo.area) return;
    ptr = { x, y, view: st.view, moved: false, long: false, wasPlaying: st.playing && st.mode === 'listen' };
    canvas.setPointerCapture(e.pointerId);
    ptr.timer = setTimeout(() => { if (!ptr || ptr.moved || x > 64) return; ptr.long = true; markLoop(barAtY(y)); }, 550);
  });
  canvas.addEventListener('pointermove', e => {
    if (!ptr) return;
    const r = canvas.getBoundingClientRect(), dy = e.clientY - r.top - ptr.y;
    if (!ptr.moved && Math.abs(dy) < 8) return;
    if (!ptr.moved) { ptr.moved = true; clearTimeout(ptr.timer); st.dragging = true; if (ptr.wasPlaying) { synth.silence(); st.play = null; } }
    st.view = Math.max((song.barStarts[0] || 0) - song.ppq, ptr.view + dy / geo.pxPerTick);
  });
  const endPtr = () => {
    if (!ptr) return; clearTimeout(ptr.timer);
    if (ptr.moved) { st.dragging = false; seekTicks(st.view, true); }
    else if (!ptr.long && ptr.x <= 64) { const num = barAtY(ptr.y); const i = song.barNums.indexOf(num); if (i >= 0) seekTicks(song.barStarts[i], true); }
    ptr = null;
  };
  canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
  function barAtY(y) { const t = st.view + (geo.area - y) / geo.pxPerTick; return song.barNums[barIndexAt(t)]; }
  function markLoop(num) {
    if (st.loopA == null) { st.loopA = num; toast(`Начало круга: такт ${num}. Зажми такт конца`); return; }
    st.from = Math.min(st.loopA, num); st.to = Math.max(st.loopA, num); st.loopA = null; st.loop = true;
    syncUi(); reset(false); toast(`Круг: такты ${st.from}–${st.to}`);
  }

  layout(); reset(); syncUi();
  if (window.__klavishi) { window.__klavishi.player = st; window.__klavishi.song = song; window.__klavishi.synth = synth; }
  const onResize = () => { layout(); };
  window.addEventListener('resize', onResize);
  st.raf = requestAnimationFrame(tick);
  activate(ctrl);
  const cleanup = () => { cancelAnimationFrame(st.raf); window.removeEventListener('resize', onResize); pause(); document.body.classList.remove('playing'); window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup);
}

function settingsPage() {
  const input = h('input', { id: 'url', value: bridge.url(), placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off' });
  const q = store.get(K.queue, []).length;
  page(h('div', { class: 'lesson-head' }, h('h1', {}, 'Настройки')),
    h('div', { class: 'field' }, h('label', { for: 'url' }, 'Адрес моста (Apps Script /exec)'), input),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => { const v = input.value.trim(); if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(v)) return toast('Это не похоже на адрес /exec'); store.set(K.url, v); catalog = null; toast('Сохранил'); } }, 'Сохранить'),
      h('button', { class: 'btn', onclick: async () => { try { await bridge.get({ action: 'ping' }); toast('Мост отвечает'); } catch (e) { toast('Мост молчит: ' + e.message); } } }, 'Проверить мост'),
      h('button', { class: 'btn', onclick: () => initMidi(true) }, 'Переподключить MIDI')),
    h('p', { class: 'feedback', style: 'text-align:left' }, q ? `Ждут отправки: ${q}. Уйдут сами, когда будет сеть.` : 'Все результаты отправлены.'));
}

let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch { /* not critical */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && location.hash.startsWith('#/lesson/')) keepAwake(); });

function route() {
  activate(null);
  const [, sec, arg] = (location.hash || '#/theory').split('/');
  document.body.classList.remove('drawer-open');
  const cur = sec === 'lesson' ? 'theory' : sec === 'song' ? 'songs' : (sec || 'theory');
  document.querySelectorAll('[data-nav]').forEach(a => (a.dataset.nav === cur ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#crumb').textContent = { theory: 'теория', lesson: 'урок', exercises: 'упражнения', songs: 'песни', song: 'песня', settings: 'настройки' }[sec] || '';
  if (!bridge.url() && sec !== 'settings') { location.hash = '#/settings'; toast('Сначала вставь адрес моста'); return; }
  if (sec === 'lesson' && arg) return lessonPage(decodeURIComponent(arg));
  if (sec === 'exercises') return exercisesPage();
  if (sec === 'songs') return songsPage();
  if (sec === 'song' && arg) return songPage(decodeURIComponent(arg));
  if (sec === 'settings') return settingsPage();
  return theoryPage();
}

/* ---------------- shell wiring ---------------- */
fillArt();
$('#menuBtn').onclick = () => document.body.classList.toggle('drawer-open');
$('#scrim').onclick = () => document.body.classList.remove('drawer-open');
$('#midiPill').onclick = () => initMidi(true);
$('#metroPill').onclick = () => $('#metroPop').classList.toggle('open');
$('#metroToggle').onclick = () => metro.toggle();
$('#bpmRange').oninput = e => metro.setBpm(+e.target.value);
$('#bpmMinus').onclick = () => metro.setBpm(metro.bpm - 5);
$('#bpmPlus').onclick = () => metro.setBpm(metro.bpm + 5);
document.querySelectorAll('[data-beats]').forEach(btn => (btn.onclick = () => { metro.beats = +btn.dataset.beats; metro.ui(); }));
document.addEventListener('click', e => { const pop = $('#metroPop'); if (pop.classList.contains('open') && !pop.contains(e.target) && !$('#metroPill').contains(e.target)) pop.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.body.classList.remove('drawer-open'); $('#metroPop').classList.remove('open'); } });
window.addEventListener('hashchange', route);
metro.ui();
initMidi(false);
flush();
route();
// test hook for automated checks (no effect in normal use)
window.__klavishi = { onMidi, midi, drawStaff, parseNote };
})();
