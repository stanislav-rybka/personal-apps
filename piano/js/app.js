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
const K = { url: 'pa.piano.bridgeUrl', queue: 'pa.piano.queue', progress: 'pa.piano.progress', read: 'pa.piano.read', bpm: 'pa.piano.bpm', exTempo: 'pa.piano.exTempo', charts: 'pa.piano.charts' };

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
function drawKeyboard(host, { from = 'C3', to = 'C5', highlight = {}, labels = false, names = {}, fingers = {} } = {}) {
  const a = parseNote(from).midi, b = parseNote(to).midi;
  const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
  const whites = []; for (let n = a; n <= b; n++) if (!isBlack(n)) whites.push(n);
  const ww = 40, wh = 150, bw = 24, bh = 94;
  const pos = {}; whites.forEach((n, i) => (pos[n] = i * ww));
  let svg = `<svg viewBox="0 0 ${whites.length * ww + 2} ${wh + 2}" role="img" aria-label="Клавиатура">`;
  for (const n of whites) {
    const c = highlight[n];
    svg += `<rect x="${pos[n] + 1}" y="1" width="${ww - 2}" height="${wh}" rx="5" fill="${c || '#ede7d9'}" />`;
    if (labels && c) svg += `<text x="${pos[n] + ww / 2}" y="${wh - 12}" text-anchor="middle" font-family="Golos Text" font-size="15" font-weight="600" fill="#161b29">${names[n] || pcName(n)}</text>`;
    if (fingers[n]) svg += `<circle cx="${pos[n] + ww / 2}" cy="${wh - 44}" r="11" fill="#161b29"/><text x="${pos[n] + ww / 2}" y="${wh - 39}" text-anchor="middle" font-family="Golos Text" font-size="14" font-weight="700" fill="#fff">${fingers[n]}</text>`;
    if (n === 60) svg += `<circle cx="${pos[n] + ww / 2}" cy="${wh - (labels && c ? 34 : 14)}" r="3" fill="${c ? '#161b29' : '#a3a9bc'}"/>`;
  }
  for (let n = a; n <= b; n++) {
    if (!isBlack(n)) continue;
    const left = pos[n - 1]; if (left == null) continue;
    const c = highlight[n];
    svg += `<rect x="${left + ww - bw / 2}" y="1" width="${bw}" height="${bh}" rx="4" fill="${c || '#1b2030'}" stroke="#0e121d" />`;
    if (labels && c) svg += `<text x="${left + ww}" y="${bh - 10}" text-anchor="middle" font-family="Golos Text" font-size="12" font-weight="600" fill="#161b29">${names[n] || pcName(n)}</text>`;
    if (fingers[n]) svg += `<circle cx="${left + ww}" cy="${bh - 36}" r="10" fill="#161b29"/><text x="${left + ww}" y="${bh - 31.5}" text-anchor="middle" font-family="Golos Text" font-size="13" font-weight="700" fill="#fff">${fingers[n]}</text>`;
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

/* ---------------- exercises (format: piano-content-spec, "Exercise file") ---------------- */
const CATEGORY = { arpeggios: 'Арпеджио', coordination: 'Синхронность рук', chords: 'Аккорды и смены', intervals: 'Интервалы', scales: 'Гаммы и знаки' };
const exResultId = id => 'ex-' + id;
let exCatalog = null;
async function loadExercises(force) {
  if (exCatalog && !force) return exCatalog;
  const [list, prog] = await Promise.all([bridge.get({ action: 'exercises' }), bridge.get({ action: 'progress' }).catch(() => null)]);
  if (prog && prog.latest) {
    store.set(K.progress, mergeProgress(store.get(K.progress, {}), prog.latest));
    const clean = store.get(K.exTempo, {});
    for (const [lid, blocks] of Object.entries(prog.latest)) if (lid.startsWith('ex-') && blocks.practice?.cleanTempo && clean[lid] == null) clean[lid] = blocks.practice.cleanTempo;
    store.set(K.exTempo, clean);
  }
  exCatalog = list;
  return list;
}
const exStatus = id => (store.get(K.progress, {})[exResultId(id)] || {}).practice || null;
const exClean = id => store.get(K.exTempo, {})[exResultId(id)] || null;
function focusFor(id) { return (exCatalog?.focus?.items || []).find(f => f.exercise === id) || null; }
// tempo the engine offers: Palych's recommendation if he gave one, else one step above the last clean tempo, capped at target
function offeredTempo(x) {
  const t = x.tempo; if (!t) return null;
  const f = focusFor(x.id); if (f && f.tempo) return { bpm: f.tempo, why: f.why ? `Палыч советует ${f.tempo}: ${f.why}` : `Палыч советует ${f.tempo}` };
  const c = exClean(x.id);
  if (c == null) return { bpm: t.start, why: 'первый раз — со стартового темпа' };
  return { bpm: Math.min(t.target, c + t.step), why: c >= t.target ? `цель ${t.target} уже взята — держи её` : `в прошлый раз чисто на ${c}` };
}

// pattern → a tiny "song" the player can run: one step = 1/stepsPerBeat of a beat, bars of `beats` beats
function patternToSong(x, bpm) {
  const pat = x.pattern, PPQ = 480, beats = x.tempo?.beats || 4, spb = x.tempo?.stepsPerBeat || 1, stepT = PPQ / spb;
  const reps = Math.max(1, Math.min(20, pat.repetitions || 1)), notes = [];
  const tok = (raw, hand, ticks) => {
    const [n, f] = String(raw).trim().split('/'), pn = parseNote(n);
    if (pn.midi == null) throw new Error(`нота «${raw}»: нужна октава`);
    if (f != null && !/^[1-5]$/.test(f)) throw new Error(`нота «${raw}»: палец 1–5`);
    notes.push({ midi: pn.midi, ticks, dur: stepT * 0.92, hand: hand || (pn.midi >= 60 ? 'R' : 'L'), label: pn.letter + pn.acc, oct: pn.oct, finger: f ? +f : null });
  };
  const list = v => (Array.isArray(v) ? v : [v]);
  const steps = pat.steps || [];
  if (!steps.length) throw new Error('в pattern нет шагов');
  for (let r = 0, k = 0; r < reps; r++) for (const step of steps) {
    const t = k++ * stepT;
    if (step && typeof step === 'object' && !Array.isArray(step)) {
      for (const hd of ['R', 'L']) if (step[hd] != null) list(step[hd]).forEach(n => tok(n, hd, t));
      if (step.R == null && step.L == null) throw new Error('шаг-объект без R и L');
    } else list(step).forEach(n => tok(n, pat.hand === 'both' ? null : pat.hand, t));
  }
  const bar = PPQ * beats, last = notes.reduce((a, n) => Math.max(a, n.ticks), 0);
  const barStarts = [], barNums = [];
  for (let i = 0; i * bar <= last; i++) { barStarts.push(i * bar); barNums.push(i + 1); }
  const t2s = t => t / PPQ * 60 / bpm, s2t = sec => sec * bpm / 60 * PPQ;
  for (const n of notes) n.time = t2s(n.ticks);
  return finishSong({ notes, ppq: PPQ, ts: [beats, 4], barStarts, barNums, keySpec: 'C', bpm, t2s, s2t });
}

async function exercisesPage() {
  const p = page(hero('Упражнения', 'Техника по темам: зачем, как правильно, ступени темпа. Ноты проверяет MIDI, чистоту — ты сам.'));
  const body = h('div', {}, h('p', { class: 'feedback' }, 'Загружаю упражнения…')); p.append(body);
  let list;
  try { list = await loadExercises(true); }
  catch (e) { body.innerHTML = ''; body.append(h('div', { class: 'empty' }, h('strong', {}, 'Упражнения не загрузились'), e.message.includes('unknown action') ? 'Мост ещё старой версии — обнови Code.gs в Apps Script (v6).' : e.message)); return; }
  body.innerHTML = '';
  const xs = list.exercises.filter(x => x.schemaVersion === 1), byId = Object.fromEntries(xs.map(x => [x.id, x]));
  const row = (x, extra) => {
    const s = exStatus(x.id), c = exClean(x.id);
    const state = c ? `чисто на ${c}` : s === 'needs-practice' ? 'в работе' : s === 'passed' ? 'получилось' : 'новое';
    return h('li', {}, h('a', { class: 'lesson-row', href: `#/exercise/${x.id}` },
      h('div', { class: 'motif', html: motif(x.id, { w: 96, h: 44, n: 4 }) }),
      h('div', {}, h('div', { class: 't' }, x.title), h('div', { class: 'g' }, extra || x.goal || '')),
      h('span', { class: 'state ' + (c || s === 'passed' ? 'done' : s ? 'going' : '') }, state)));
  };
  const focus = (list.focus?.items || []).filter(f => byId[f.exercise]).slice(0, 3);
  if (focus.length) {
    body.append(h('h2', { class: 'section' }, 'Сейчас в фокусе'));
    body.append(h('ul', { class: 'lesson-list focus-list' }, focus.map(f => row(byId[f.exercise], [f.why, f.tempo ? `темп ${f.tempo}` : ''].filter(Boolean).join(' · ')))));
  }
  if (!xs.length) body.append(h('div', { class: 'empty' }, h('strong', {}, 'Упражнений пока нет'), 'Попроси Палыча написать упражнения — они появятся здесь по темам.'));
  const cats = [...new Set([...Object.keys(CATEGORY), ...xs.map(x => x.category)])];
  for (const c of cats) {
    const items = xs.filter(x => x.category === c); if (!items.length) continue;
    body.append(h('h2', { class: 'section' }, CATEGORY[c] || c));
    body.append(h('ul', { class: 'lesson-list' }, items.map(x => row(x))));
  }
  for (const e of list.errors || []) body.append(h('p', { class: 'note-bad' }, `Файл ${e.file} не читается: ${e.error}`));
  for (const f of (list.focus?.items || []).filter(f => !byId[f.exercise])) body.append(h('p', { class: 'note-bad' }, `В фокусе упражнение «${f.exercise}», но такого файла нет.`));
  for (const o of list.exercises.filter(x => x.schemaVersion !== 1)) body.append(h('p', { class: 'note-bad' }, `Упражнение ${o.id} в другом формате (schemaVersion ${o.schemaVersion}) — пропущено.`));
}

const EX_TEXTS = [['about', 'Что это и зачем'], ['howTo', 'Как делать правильно'], ['mistakes', 'Чего не делать'], ['variants', 'Варианты'], ['moveOn', 'Когда идти дальше']];
async function exercisePage(id) {
  const p = page(h('p', { class: 'feedback' }, 'Открываю упражнение…'));
  let x;
  try { if (!exCatalog) await loadExercises(); x = (await bridge.get({ action: 'exercise', id })).exercise; }
  catch (e) { p.innerHTML = ''; p.append(h('div', { class: 'empty' }, h('strong', {}, 'Упражнение не открылось'), e.message, h('p', {}, h('a', { href: '#/exercises' }, 'К упражнениям')))); return; }
  p.innerHTML = '';
  const missing = EX_TEXTS.map(t => t[0]).concat('basis').filter(k => !String(x[k] || '').trim());
  p.append(h('div', { class: 'lesson-head' }, h('a', { class: 'back', href: '#/exercises' }, '‹ Все упражнения'), h('h1', {}, x.title),
    x.goal ? h('p', { class: 'goal' }, x.goal) : null, h('span', { class: 'chip-tag' }, CATEGORY[x.category] || x.category || 'без темы')));
  if (missing.length) p.append(h('p', { class: 'note-bad' }, `В файле не хватает: ${missing.join(', ')} — скажи Палычу.`));
  for (const [k, title] of EX_TEXTS) {
    if (!x[k]) continue;
    const sec = h('section', { class: 'block' }, h('h3', {}, title), renderMarkup(x[k]));
    p.append(sec);
    if (k === 'howTo') for (const b of x.blocks || []) {
      const wrap = h('section', { class: 'block' }); if (b.title) wrap.append(h('h3', {}, b.title));
      try { if (!['staff', 'keyboard', 'image'].includes(b.type)) throw new Error(`в упражнении только staff, keyboard, image, не «${b.type}»`); wrap.append(BLOCKS[b.type](b, x)); }
      catch (e) { wrap.append(h('p', { class: 'note-bad' }, `Блок ${b.id || ''} не показан: ${e.message}`)); }
      p.append(wrap);
    }
  }
  if (x.basis) { const d = h('details', { class: 'toggle block' }, h('summary', {}, 'На чём основано')); d.append(renderMarkup(x.basis)); p.append(d); }

  /* practice: tempo, optional pattern through the player, then Stas rates the attempt */
  const offer = offeredTempo(x);
  let bpm = offer ? offer.bpm : null, lastPass = null;
  const prac = h('section', { class: 'block stage practice' }, h('div', { class: 'top' }, h('span', { class: 'kind' }, 'Практика'), h('span')));
  p.append(prac);
  const bpmVal = h('span', { class: 'bpm-big' });
  const ladder = h('div', { class: 'ladder' });
  const drawLadder = () => {
    const t = x.tempo; ladder.innerHTML = ''; if (!t) return;
    const c = exClean(x.id);
    for (let v = t.start; v <= t.target; v += t.step) ladder.append(h('span', { class: 'rung' + (c && v <= c ? ' clean' : '') + (v === bpm ? ' cur' : '') }, String(v)));
  };
  const setBpm = v => { bpm = Math.max(20, Math.min(300, v)); bpmVal.textContent = bpm; drawLadder(); if (metro.on && !document.body.classList.contains('playing')) metro.setBpm(bpm); rebuild(); };
  if (x.tempo) {
    prac.append(h('div', { class: 'tempo-row' },
      h('button', { class: 'ibtn', 'aria-label': 'Медленнее', html: ICON.minus, onclick: () => setBpm(bpm - (x.tempo.step || 5)) }),
      h('div', { class: 'tempo-mid' }, bpmVal, h('span', { class: 'hint' }, 'BPM')),
      h('button', { class: 'ibtn', 'aria-label': 'Быстрее', html: ICON.plus, onclick: () => setBpm(bpm + (x.tempo.step || 5)) }),
      h('button', { class: 'btn', 'data-metro-toggle': true, onclick: () => { metro.beats = x.tempo.beats || 4; metro.setBpm(bpm); metro.toggle(); } }, metro.on ? 'Стоп' : 'Метроном')),
      h('p', { class: 'hint' }, offer.why), ladder);
  }
  const playerHost = h('div', { class: 'ex-player' }); prac.append(playerHost);
  const fb = h('div', { class: 'feedback' });
  let unmount = null;
  function rebuild() {
    if (!x.pattern) return;
    unmount?.(); playerHost.innerHTML = '';
    try {
      const song = patternToSong(x, bpm || 60);
      unmount = mountPlayer(playerHost, song, { resultId: exResultId(x.id), exercise: { bpm, beats: x.tempo?.beats || 4, onPass: r => {
        lastPass = r; fb.className = 'feedback'; fb.textContent = `Ноты: ${Math.round(r.accuracy * 100)}% без ошибок. Теперь честно: ровно ли, свободна ли кисть, те ли пальцы?`;
        rate.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } } });
    } catch (e) { playerHost.append(h('p', { class: 'note-bad' }, `Ноты упражнения не читаются: ${e.message}`)); }
  }
  const save = status => {
    saveResult({ id: exResultId(x.id) }, { id: 'practice' }, { accuracy: lastPass ? lastPass.accuracy : status === 'passed' ? 1 : 0, avgResponseMs: lastPass ? lastPass.avgResponseMs : 0,
      status, checkedBy: 'self', tempo: x.tempo ? bpm : '' });
    if (status === 'passed' && x.tempo) { const c = store.get(K.exTempo, {}); c[exResultId(x.id)] = bpm; store.set(K.exTempo, c); }
    fb.className = 'feedback ok';
    fb.textContent = status === 'passed' ? (x.tempo ? `Записал: чисто на ${bpm}.` + (bpm < x.tempo.target ? ` В следующий раз предложу ${Math.min(x.tempo.target, bpm + x.tempo.step)}.` : ' Цель взята.') : 'Записал: получилось.') : 'Записал: ещё надо. Темп оставлю.';
    lastPass = null; drawLadder();
  };
  const rate = h('div', { class: 'row rate' },
    h('button', { class: 'btn primary', onclick: () => save('passed') }, x.tempo ? h('span', {}, 'Чисто на ', h('span', { 'data-bpm': true }), ' BPM') : 'Получилось'),
    h('button', { class: 'btn', onclick: () => save('needs-practice') }, 'Ещё надо'));
  prac.append(rate, fb);
  const syncBpmLabels = () => rate.querySelectorAll('[data-bpm]').forEach(el => (el.textContent = bpm));
  if (x.tempo) { bpmVal.textContent = bpm; drawLadder(); syncBpmLabels(); }
  rebuild();
  // keep the rating button's tempo in step with the selector
  prac.addEventListener('click', () => setTimeout(syncBpmLabels, 0));
  keepAwake();
  const stopMetro = () => { if (metro.on) metro.stop(); window.removeEventListener('hashchange', stopMetro); };
  window.addEventListener('hashchange', stopMetro);
}
/* ---------------- songs by chords: a chord sheet pasted from any site ---------------- */
// The pasted text (lyrics included) stays in this browser only; nothing is sent to Drive or the repo.
const CH_RE = /^([A-H])([#b]?)(maj7|maj9|maj|M7|m7b5|mmaj7|m7|m6|m9|m11|madd9|min|m|dim7|dim|o7|o|aug|\+|sus2|sus4|sus|add9|add2|7sus4|7sus2|6\/9|69|6|7|9|11|13)?(\/([A-H])([#b]?))?$/;
const CH_Q = { '': [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], M7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14], mmaj7: [0, 3, 7, 11], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 14], 11: [0, 4, 7, 10, 14, 17], 13: [0, 4, 7, 10, 14, 21],
  m9: [0, 3, 7, 10, 14], m11: [0, 3, 7, 10, 14, 17], add9: [0, 4, 7, 14], add2: [0, 2, 4, 7], madd9: [0, 3, 7, 14], '6/9': [0, 4, 7, 9, 14], 69: [0, 4, 7, 9, 14],
  dim: [0, 3, 6], o: [0, 3, 6], dim7: [0, 3, 6, 9], o7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8], '+': [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7], '7sus4': [0, 5, 7, 10], '7sus2': [0, 2, 7, 10] };
const CH_TRIAD = q => /^(m7b5|dim|o)/.test(q) ? [0, 3, 6] : /^(aug|\+)/.test(q) ? [0, 4, 8] : /sus2/.test(q) ? [0, 2, 7] : /sus/.test(q) ? [0, 5, 7] : /^m(?!aj)/.test(q) || q === 'min' ? [0, 3, 7] : [0, 4, 7];
const LET = 'CDEFGAB', LPC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STEP_OF = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5, 10: 6, 11: 6 };

function chParse(sym) {
  const m = CH_RE.exec(sym); if (!m) return null;
  const L = m[1] === 'H' ? 'B' : m[1], acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const root = (LPC[L] + acc + 12) % 12, q = m[3] || '';
  let bass = root, bassL = L;
  if (m[4]) { bassL = m[5] === 'H' ? 'B' : m[5]; bass = (LPC[bassL] + (m[6] === '#' ? 1 : m[6] === 'b' ? -1 : 0) + 12) % 12; }
  return { root, rootL: L, q, bass, bassL, flat: m[2] === 'b' || m[6] === 'b' };
}
// spell a pitch class on a given letter step above the root letter (so E7 shows G#, not Ab)
function chName(pc, letterIdx) {
  const L = LET[((letterIdx % 7) + 7) % 7], d = ((pc - LPC[L]) % 12 + 12) % 12;
  return L + (d === 1 ? '#' : d === 2 ? '##' : d === 11 ? 'b' : d === 10 ? 'bb' : '');
}
const SH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], FL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
function chTranspose(sym, n) {
  const p = chParse(sym); if (!p || !n) return sym;
  const m = CH_RE.exec(sym), names = p.flat ? FL : SH;
  return names[(p.root + n + 120) % 12] + (m[3] || '') + (m[4] ? '/' + names[(p.bass + n + 120) % 12] : '');
}
function isChordToken(t) { return CH_RE.test(t.replace(/[()[\]]/g, '')); }
function isFillerToken(t) { return /^([|\-–—x×*.:,]+|x?\d+x?|\(x?\d+\)|N\.?C\.?)$/i.test(t); }
function chordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.some(isChordToken) && toks.every(t => isChordToken(t) || isFillerToken(t));
}
// parse a pasted sheet into display lines; chords keep their column so they sit over the right word
function parseSheet(text) {
  const lines = String(text || '').replace(/\r/g, '').replace(/\t/g, '    ').split('\n'), out = [], items = [];
  for (const raw of lines) {
    let label = '', body = raw;
    const lm = /^(\s*[^\s:]{2,20}(?:\s[^\s:]{1,12})?\s*:)(.*)$/.exec(raw);
    if (lm && chordLine(lm[2]) && !chordLine(lm[1].replace(':', ''))) { label = lm[1]; body = ' '.repeat(lm[1].length) + lm[2]; }
    if (chordLine(body)) {
      const parts = []; const re = /\S+/g; let m, last = 0;
      while ((m = re.exec(body))) {
        if (m.index > last) parts.push({ text: body.slice(last, m.index) });
        const clean = m[0].replace(/[()[\]]/g, '');
        if (isChordToken(m[0])) { parts.push({ chord: items.length, raw: m[0] }); items.push({ sym: clean, line: out.length }); }
        else parts.push({ text: m[0] });
        last = m.index + m[0].length;
      }
      out.push({ kind: 'chords', parts, label });
    } else out.push({ kind: /^\s*[[(]?\s*(припев|куплет|бридж|вступление|проигрыш|кода|интро|аутро|chorus|verse|bridge|intro|outro|pre-?chorus)/i.test(raw) ? 'label' : 'text', text: raw });
  }
  return { lines: out, items };
}

// voicing: right hand three notes (root position or nearest to the previous chord), left hand bass (+ fifth)
const CH_SET_DEFAULT = { rh: 'root', lh: 'bass', sev: 'keep', tr: 0, beats: 4 };
function chordTones(p, sev) {
  const iv = (sev === 'triad' ? CH_TRIAD(p.q) : (CH_Q[p.q] || CH_TRIAD(p.q))).map(x => x % 12);
  const uniq = [...new Set(iv)];
  if (uniq.length <= 3) return uniq.length === 3 ? uniq : [...uniq, 7].slice(0, 3);
  // four or more tones: keep the third and the colour tone (7th/6th/9th), drop the fifth first, then the root (the bass has it)
  const third = uniq.find(x => x === 3 || x === 4 || x === 2 || x === 5);
  const colour = uniq.filter(x => ![0, 7, third].includes(x));
  const pick = [third, ...colour].filter(x => x != null);
  if (pick.length >= 3) return pick.slice(0, 3);
  return [0, ...pick].slice(0, 3);
}
function voiceChord(sym, set, prev) {
  const p = chParse(sym); if (!p) return null;
  const iv = chordTones(p, set.sev);
  const label = n => chName(n % 12, LET.indexOf(p.rootL) + STEP_OF[((n % 12) - p.root + 12) % 12]);
  // left hand first: bass between C2 and B2 (+ fifth or the chord root above it)
  let b = 36; while (b % 12 !== p.bass) b++;
  const lh = [b];
  if (set.lh === 'bass5') {
    const fifthIv = /^(dim|o|m7b5)/.test(p.q) ? 6 : /^(aug|\+)/.test(p.q) ? 8 : 7;
    lh.push(p.bass === p.root ? b + fifthIv : (() => { let n = b + 1; while (n % 12 !== p.root) n++; return n; })());
  }
  // right hand: close three-note voicings, every rotation, always above the left hand (one key can't be in both hands)
  const pcs = iv.map(x => (p.root + x) % 12), cands = [], low = Math.max(52, lh[lh.length - 1] + 1);
  for (let r = 0; r < 3; r++) {
    const order = pcs.slice(r).concat(pcs.slice(0, r));
    for (let base = low; base <= 67; base++) {
      if (base % 12 !== order[0]) continue;
      const v = [base]; for (const pc of order.slice(1)) { let n = v[v.length - 1] + 1; while (n % 12 !== pc) n++; v.push(n); }
      if (v[2] - v[0] <= 12) cands.push({ v, r });
    }
  }
  const lowestTone = iv.includes(0) ? 0 : iv[0], rootFirst = cands.filter(c => (c.v[0] - p.root - lowestTone + 120) % 12 === 0);
  const centre = c => Math.abs(c.v[1] - 62);
  let rh;
  if (set.rh === 'near' && prev) {
    const cost = c => c.v.reduce((a, n, i) => a + Math.abs(n - prev.rh[i]), 0);
    rh = cands.slice().sort((a, b) => cost(a) - cost(b) || centre(a) - centre(b))[0].v;
  } else rh = (rootFirst.length ? rootFirst : cands).slice().sort((a, b) => centre(a) - centre(b))[0].v;
  // fingers: right hand 1-3-5, or 1-2-5 when the upper interval is a fourth or wider; left hand 5 on the bass, 1 above
  const fingers = { [rh[0]]: 1, [rh[1]]: rh[2] - rh[1] >= 5 ? 2 : 3, [rh[2]]: 5, [lh[0]]: 5 };
  if (lh[1]) fingers[lh[1]] = 1;
  const names = {};
  for (const n of rh) names[n] = label(n);
  names[lh[0]] = chName(p.bass, LET.indexOf(p.bassL)); if (lh[1]) names[lh[1]] = label(lh[1]);
  return { sym, lh, rh, fingers, names };
}
function voiceAll(items, set) {
  let prev = null;
  return items.map(it => { const v = voiceChord(chTranspose(it.sym, set.tr), set, prev); if (v) prev = v; return v; });
}

const charts = {
  all: () => store.get(K.charts, []),
  get: id => charts.all().find(c => c.id === id) || null,
  put(c) { const a = charts.all().filter(x => x.id !== c.id); a.unshift({ ...c, updated: new Date().toISOString() }); store.set(K.charts, a); },
  del(id) { store.set(K.charts, charts.all().filter(c => c.id !== id)); }
};

function chartEditPage(id) {
  const c = id ? charts.get(id) : null;
  const p = page(h('div', { class: 'lesson-head' }, h('a', { class: 'back', href: c ? `#/chart/${c.id}` : '#/songs' }, c ? '‹ К песне' : '‹ Все песни'),
    h('h1', {}, c ? 'Изменить шпаргалку' : 'Песня по аккордам'),
    h('p', { class: 'goal' }, 'Скопируй с любого сайта текст с аккордами над строками и вставь сюда как есть. Текст остаётся только на этом планшете.')));
  const title = h('input', { class: 'text-in', placeholder: 'Название', value: c ? c.title : '' });
  const ta = h('textarea', { class: 'sheet-in', spellcheck: 'false', placeholder: 'Am           Dm\nстрока текста\nE7           Am\nстрока текста' });
  ta.value = c ? c.text : '';
  const info = h('p', { class: 'hint' });
  const check = () => { const it = parseSheet(ta.value).items, u = [...new Set(it.map(i => i.sym))]; info.textContent = it.length ? `Аккорды: ${u.join(' · ')} — разных ${u.length}, по тексту ${it.length} смен` : 'Аккордов пока не вижу — нужна строка, где только аккорды.'; };
  ta.addEventListener('input', () => { if (!title.value.trim()) { const first = ta.value.split('\n').map(s => s.trim()).find(s => s && !chordLine(s)); if (first) title.placeholder = first.slice(0, 60); } check(); });
  const save = () => {
    const parsed = parseSheet(ta.value);
    if (!parsed.items.length) { toast('В тексте нет строк с аккордами'); return; }
    const nid = c ? c.id : 'c' + Date.now().toString(36);
    charts.put({ id: nid, title: title.value.trim() || title.placeholder.replace(/^Название$/, '') || 'Без названия', text: ta.value, set: c ? c.set : { ...CH_SET_DEFAULT }, pos: 0 });
    location.hash = `#/chart/${nid}`;
  };
  const paste = navigator.clipboard?.readText ? h('button', { class: 'btn', onclick: async () => {
    try { const t = await navigator.clipboard.readText(); if (!t.trim()) { toast('Буфер пустой'); return; } ta.value = t; ta.dispatchEvent(new Event('input')); }
    catch { toast('Браузер не дал прочитать буфер — вставь долгим нажатием в поле'); }
  } }, 'Вставить из буфера') : null;
  p.append(h('div', { class: 'chart-edit' }, title, paste, ta, info,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Готово'),
      c ? h('button', { class: 'btn quiet', onclick: () => { if (confirm('Удалить песню с планшета?')) { charts.del(c.id); location.hash = '#/songs'; } } }, 'Удалить') : null)));
  check();
}

function chartPage(id) {
  const c = charts.get(id);
  if (!c) { page(h('div', { class: 'empty' }, h('strong', {}, 'Песни нет на этом планшете'), h('p', {}, h('a', { href: '#/songs' }, 'К списку песен')))); return; }
  const set = { ...CH_SET_DEFAULT, ...(c.set || {}) };
  const parsed = parseSheet(c.text);
  let voices = voiceAll(parsed.items, set), pos = Math.min(c.pos || 0, parsed.items.length - 1);
  const p = page();
  p.classList.add('chart-page');
  const save = () => charts.put({ ...charts.get(id), set, pos });

  /* sticky panel: chord now / next, hands, keyboard, controls */
  const nowEl = h('span', { class: 'ch-now' }), nextEl = h('span', { class: 'ch-next' }), whereEl = h('span', { class: 'ch-where' });
  const lhEl = h('b'), rhEl = h('b'), kb = h('div', { class: 'kb ch-kb' }), fb = h('div', { class: 'feedback ch-fb' });
  const btn = (label, on, cls = 'btn') => h('button', { class: cls, onclick: on }, label);
  const listenBtn = btn('Послушать', () => (listening ? stopListen() : startListen()));
  let bpm = c.bpm || 72;
  const bpmV = h('span', {}, String(bpm));
  const panel = h('div', { class: 'ch-panel' },
    h('div', { class: 'ch-top' }, h('a', { class: 'back', href: '#/songs' }, '‹'), nowEl, nextEl, whereEl),
    h('div', { class: 'ch-hands' }, h('span', {}, h('i', { class: 'dot l' }), 'Левая: ', lhEl), h('span', {}, h('i', { class: 'dot r' }), 'Правая: ', rhEl)),
    kb, fb,
    h('div', { class: 'row ch-ctl' }, btn('← Назад', () => go(pos - 1, true)), btn('Дальше →', () => go(pos + 1, true), 'btn primary'), listenBtn,
      h('label', { class: 'ctl' }, 'Темп ', h('input', { type: 'range', min: 50, max: 140, step: 2, value: bpm, oninput: e => { bpm = +e.target.value; bpmV.textContent = bpm; } }), bpmV)));

  /* settings */
  const seg = (key, opts) => h('div', { class: 'seg' }, opts.map(([v, label]) => {
    const b = h('button', { class: 'seg-b' + (set[key] === v ? ' on' : ''), onclick: () => { set[key] = v; applySettings(); } }, label); b.dataset.k = key; b.dataset.v = v; return b;
  }));
  const trVal = h('b', { class: 'tr-v' });
  const settings = h('details', { class: 'toggle ch-set' }, h('summary', {}, 'Настройки разбора'),
    h('div', { class: 'setup-grid' },
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Правая рука'), seg('rh', [['root', 'Основной вид'], ['near', 'Ближайшая форма']])),
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Левая рука'), seg('lh', [['bass', 'Только бас'], ['bass5', 'Бас + квинта']])),
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Септаккорды'), seg('sev', [['keep', 'Как в шпаргалке'], ['triad', 'Упростить']])),
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Тональность'), h('div', { class: 'row' },
        btn('−', () => { set.tr = Math.max(-11, set.tr - 1); applySettings(); }), trVal, btn('+', () => { set.tr = Math.min(11, set.tr + 1); applySettings(); }))),
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, '«Послушать»: долей на аккорд'), seg('beats', [[2, '2'], [3, '3'], [4, '4']]))),
    h('div', { class: 'row' }, h('a', { class: 'btn quiet', href: `#/chart/${id}/edit`, style: 'text-decoration:none' }, 'Изменить текст')));

  /* the sheet: lyrics as pasted, chords as buttons over the words */
  const sheet = h('pre', { class: 'ch-sheet' }), chipEls = [];
  function drawSheet() {
    sheet.innerHTML = ''; chipEls.length = 0;
    parsed.lines.forEach(l => {
      const row = h('span', { class: 'ln ' + l.kind });
      if (l.kind === 'chords') {
        let skip = 0;
        if (l.label) { row.append(h('span', { class: 'lbl' }, l.label)); skip = l.label.length; }
        for (const part of l.parts) {
          if (part.text != null) { const t = skip ? part.text.slice(skip) : part.text; skip = Math.max(0, skip - part.text.length); row.append(t); continue; }
          const shown = chTranspose(parsed.items[part.chord].sym, set.tr), i = part.chord;
          const b = h('button', { class: 'sc', onclick: () => go(i, true) }, part.raw.replace(parsed.items[i].sym, shown));
          chipEls[i] = b; row.append(b, ' '.repeat(Math.max(0, part.raw.length - part.raw.replace(parsed.items[i].sym, shown).length)));
        }
      } else row.textContent = l.text;
      sheet.append(row, '\n');
    });
  }

  function applySettings() {
    voices = voiceAll(parsed.items, set);
    settings.querySelectorAll('.seg-b').forEach(b => b.classList.toggle('on', String(set[b.dataset.k]) === String(b.dataset.v)));
    trVal.textContent = (set.tr > 0 ? '+' : '') + set.tr;
    drawSheet(); go(pos, false); save();
  }
  function go(i, sound) {
    if (!parsed.items.length) return;
    pos = Math.max(0, Math.min(parsed.items.length - 1, i));
    const v = voices[pos], nx = voices[pos + 1];
    nowEl.textContent = v ? v.sym : parsed.items[pos].sym + ' ?';
    nextEl.textContent = nx ? 'дальше ' + nx.sym : pos + 1 >= parsed.items.length ? 'конец' : '';
    whereEl.textContent = `${pos + 1} из ${parsed.items.length}`;
    lhEl.textContent = v ? v.lh.map(n => v.names[n] + (Math.floor(n / 12) - 1)).join(' + ') : '—';
    rhEl.textContent = v ? v.rh.map(n => v.names[n] + (Math.floor(n / 12) - 1)).join(' ') : 'аккорд не разобрал';
    const hl = {}; if (v) { v.lh.forEach(n => (hl[n] = COLORS.left)); v.rh.forEach(n => (hl[n] = COLORS.right)); }
    drawKeyboard(kb, { from: 'C2', to: 'C5', highlight: hl, labels: true, names: v ? v.names : {}, fingers: v ? v.fingers : {} });
    chipEls.forEach((b, k) => b && b.classList.toggle('cur', k === pos));
    const el = chipEls[pos];
    if (el && sound !== 'listen') {
      const r = el.getBoundingClientRect(), top = panel.getBoundingClientRect().bottom;
      if (r.top < top + 8 || r.bottom > window.innerHeight - 8) window.scrollBy({ top: r.top - top - 80, behavior: 'smooth' });
    }
    if (sound === true && v && !listening) playVoice(v, 1.2);
    fb.className = 'feedback ch-fb'; fb.textContent = '';
    save();
  }
  function playVoice(v, dur) { synth.silence(); synth.newBus(); synth.ctx.resume(); const t = synth.ctx.currentTime + 0.03; v.lh.forEach(n => synth.play(n, t, dur, 0.3)); v.rh.forEach(n => synth.play(n, t, dur, 0.18)); }

  /* play the chord → next one. Strict: exactly the keys shown, both hands together */
  let timer = null;
  const ctrl = {
    onMidi(e) {
      if (!e.on) return;
      if (e.note === 21) { go(pos + 1, false); return; }
      if (e.note === 23) { go(pos - 1, false); return; }
      const v = voices[pos]; if (!v) return;
      clearTimeout(timer);
      if (midi.held.size >= new Set([...v.lh, ...v.rh]).size) timer = setTimeout(judge, 140);
    },
    stop() { clearTimeout(timer); stopListen(); }
  };
  function judge() {
    const v = voices[pos]; if (!v) return;
    const want = [...new Set([...v.lh, ...v.rh])].sort((a, b) => a - b), got = [...midi.held].sort((a, b) => a - b);
    if (want.length === got.length && want.every((n, i) => n === got[i])) { fb.className = 'feedback ok ch-fb'; fb.textContent = 'Верно'; setTimeout(() => go(pos + 1, false), 180); }
    else { fb.className = 'feedback bad ch-fb'; fb.textContent = `Сыграл ${got.map(midiName).join(' ')} — нужно ${want.map(n => v.names[n] + (Math.floor(n / 12) - 1)).join(' ')}`; }
  }

  /* listen: each chord for N beats at the chosen tempo, from the current one */
  let listening = false, lt = null;
  function startListen() {
    listening = true; listenBtn.textContent = 'Стоп'; synth.silence(); synth.newBus(); synth.ctx.resume();
    const step = () => {
      if (!listening) return;
      const v = voices[pos], dur = 60 / bpm * set.beats;
      if (v) { const t = synth.ctx.currentTime + 0.03; v.lh.forEach(n => synth.play(n, t, dur, 0.3)); v.rh.forEach(n => synth.play(n, t, dur * 0.9, 0.18)); }
      lt = setTimeout(() => { if (pos + 1 >= parsed.items.length) return stopListen(); go(pos + 1, 'listen'); step(); }, dur * 1000);
    };
    step();
  }
  function stopListen() { listening = false; clearTimeout(lt); synth.silence(); listenBtn.textContent = 'Послушать'; }

  p.append(panel, settings, h('div', { class: 'ch-sheet-wrap' }, sheet));
  // the panel sticks right under the top bar
  const pin = () => { panel.style.top = ($('.topbar')?.offsetHeight || 0) + 'px'; };
  pin(); window.addEventListener('resize', pin);
  if (!parsed.items.length) p.append(h('p', { class: 'note-bad' }, 'В тексте нет строк с аккордами.'));
  midi.held.clear();
  activate(ctrl);
  applySettings();
  keepAwake();
  const cleanup = () => { stopListen(); clearTimeout(timer); window.removeEventListener('resize', pin); c.bpm = bpm; charts.put({ ...charts.get(id), set, pos, bpm }); window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup);
  if (window.__klavishi) Object.assign(window.__klavishi, { chart: { parsed, get voices() { return voices; }, get pos() { return pos; }, set } });
}

/* ---------------- songs: list + MIDI player ---------------- */
const b64ToBytes = b64 => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
const songTitle = n => n.replace(/\.(mid|midi|musicxml|xml|mxl)$/i, '');
const songId = n => 'song-' + (songTitle(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x');
const HAND_COLOR = { R: COLORS.right, L: COLORS.left, V: '#b9a6f2' };

async function songsPage() {
  const p = page(hero('Песни', 'Мелодия и аккомпанемент по нотам: приложение ждёт, пока сыграешь нужные клавиши, и ведёт дальше.'));
  const mine = charts.all();
  p.append(h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' }, h('h2', { class: 'section' }, 'По аккордам'), h('a', { class: 'btn primary', href: '#/chart/new', style: 'text-decoration:none' }, '+ Вставить шпаргалку')));
  p.append(mine.length ? h('ul', { class: 'lesson-list' }, mine.map(cc => { const items = parseSheet(cc.text).items; return h('li', {}, h('a', { class: 'lesson-row', href: '#/chart/' + cc.id },
    h('div', { class: 'motif', html: motif(cc.id, { w: 96, h: 44, n: 4 }) }),
    h('div', {}, h('div', { class: 't' }, cc.title), h('div', { class: 'g' }, [...new Set(items.map(i => i.sym))].slice(0, 6).join(' · '))),
    h('span', { class: 'state' }, `${new Set(items.map(i => i.sym)).size} акк.`))); })) : h('p', { class: 'hint' }, 'Скопируй с любого сайта текст с аккордами и вставь — приложение покажет, что нажимать обеими руками.'));
  p.append(h('h2', { class: 'section' }, 'По нотам'));
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
      h('div', {}, h('div', { class: 't' }, songTitle(s.name)), h('div', { class: 'g' }, /\.midi?$/i.test(s.name) ? 'MIDI' : 'MusicXML')),
      h('span', { class: 'state ' + st }, done.length ? `проходов: ${done.length}` : 'новая')));
  })));
  body.append(h('p', { class: 'feedback', style: 'text-align:left;margin-top:22px' }, 'Добавить песню по нотам: MIDI или MusicXML в Google Drive → Music/Piano/songs.'));
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
// MIDI carries no pickup or short-bar markers (LilyPond starts the file with the anacrusis, and a volta bar that is
// shorter than the meter shifts everything after it). So the bar grid's phase is guessed per bar: the phase that puts
// the most note weight (left hand double) on the downbeat, with a penalty for changing phase (Viterbi over bars).
// Returns bar start ticks; a leading [0, phase) pickup gets its own bar.
function midiBarGrid(notes, bar, grid, last) {
  const P = Math.max(1, Math.round(bar / grid)), N = Math.floor(last / bar) + 2;
  const w = Array.from({ length: N }, () => new Float64Array(P));
  for (const n of notes) { const ph = Math.round((n.ticks % bar) / grid), k = Math.floor(n.ticks / bar); if (Math.abs(n.ticks % bar - ph * grid) < 1 && ph < P) w[k][ph] += n.dur * (n.hand === 'L' ? 2 : 1); }
  const avg = w.reduce((a, r) => a + Math.max(...r), 0) / N, pen = avg * 2;
  let cost = Float64Array.from(w[0], (x, ph) => -x + (ph ? avg * 0.25 : 0)); const back = [];
  for (let k = 1; k < N; k++) {
    const nc = new Float64Array(P), bk = new Int16Array(P);
    let bi = 0; for (let q = 1; q < P; q++) if (cost[q] < cost[bi]) bi = q;
    for (let ph = 0; ph < P; ph++) { const stay = cost[ph], move = cost[bi] + pen; bk[ph] = stay <= move ? ph : bi; nc[ph] = Math.min(stay, move) - w[k][ph]; }
    cost = nc; back.push(bk);
  }
  const phase = new Array(N); let cur = 0; for (let q = 1; q < P; q++) if (cost[q] < cost[cur]) cur = q;
  for (let k = N - 1; k >= 0; k--) { phase[k] = cur; if (k) cur = back[k - 1][cur]; }
  const starts = []; midiBarGrid.pickup = phase[0] > 0;
  if (phase[0] > 0) starts.push(0);
  for (let k = 0; k < N; k++) {
    const t = k * bar + phase[k] * grid, prev = starts[starts.length - 1];
    if (prev != null && t - prev > bar + 1) starts.push(prev + bar);   // phase moved later: a short bar fills the gap
    if (prev == null || t > prev + 1) starts.push(t);
  }
  while (starts.length > 1 && starts[starts.length - 2] > last) starts.pop();
  return starts;
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
  const gridStarts = midiBarGrid(notes, bar, ppq / 4, last), first = midiBarGrid.pickup ? 0 : 1;
  gridStarts.forEach((t, i) => { barStarts.push(t); barNums.push(first + i); });
  const ks = m.header.keySignatures[0];
  // @tonejs/midi names the key by its accidentals (A minor → 'C', scale 'minor'), so the name is already the staff key
  const keySpec = ks ? ks.key : 'C', flats = /b/.test(keySpec) || keySpec === 'F';
  for (const n of notes) { n.label = (flats ? FLAT_NAMES : SHARP_NAMES)[n.midi % 12]; n.oct = Math.floor(n.midi / 12) - 1; }
  return finishSong({ notes, ppq, ts, barStarts, barNums, keySpec, bpm: Math.round(m.header.tempos[0]?.bpm || 100),
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
  let ts = null, barStarts = null, barNums = null, fifths = null;
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
          const k = kid(el, 'key'); if (k && fifths == null && kid(k, 'fifths')) fifths = +txt(k, 'fifths');
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
          const fing = el.querySelector('notations technical fingering');
          const n = { midi: midiN, ticks: start, dur, hand, oct: +txt(pitch, 'octave'), finger: fing ? +fing.textContent.trim() || null : null,
            label: txt(pitch, 'step') + (alt > 0 ? '#'.repeat(alt) : alt < 0 ? 'b'.repeat(-alt) : '') };
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
  const KEYS = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
  return finishSong({ notes, ppq: PPQ, ts: ts || [4, 4], barStarts, barNums, keySpec: KEYS[fifths ?? 0] || 'C', bpm: Math.round(tempos[0].bpm), t2s, s2t });
}
// "Simple" arrangement from a dense file: right hand → its top line, left hand → one bass note per half bar
// (whole bar in odd meters). Melody parts ('V') stay as they are. Own heuristic; nothing is copied from elsewhere.
function simplifySong(song) {
  const tol = song.ppq / 16, copy = (n, extra) => ({ ...n, ...extra });
  const out = song.notes.filter(n => n.hand === 'V').map(n => copy(n));
  // right hand: highest note of every onset, inner notes under a held melody note dropped, line made monophonic
  const R = song.notes.filter(n => n.hand === 'R'), tops = [];
  for (const n of R) { const t = tops[tops.length - 1]; if (t && n.ticks - t.ticks <= tol) { if (n.midi > t.midi) tops[tops.length - 1] = n; } else tops.push(n); }
  const mel = [];
  for (const n of tops) {
    const p = mel[mel.length - 1];
    if (p && n.ticks < p.ticks + p.dur - song.ppq / 4 && n.midi < p.midi - 2) continue;
    mel.push(copy(n));
  }
  mel.forEach((n, i) => { const nx = mel[i + 1]; if (nx && n.ticks + n.dur > nx.ticks) n.dur = Math.max(tol, nx.ticks - n.ticks); });
  // left hand: per window, the lowest note starting in its first beat, else the lowest starting anywhere in it
  const L = song.notes.filter(n => n.hand === 'L'), full = song.ppq * 4 * song.ts[0] / song.ts[1], beat = song.ppq * 4 / song.ts[1];
  const lastEnd = song.notes.reduce((a, n) => Math.max(a, n.ticks + n.dur), 0), bass = [];
  song.barStarts.forEach((s, i) => {
    const e = song.barStarts[i + 1] ?? Math.max(s + full, lastEnd);
    const parts = song.ts[0] % 2 === 0 && Math.abs(e - s - full) < tol ? 2 : 1, w = (e - s) / parts;
    for (let k = 0; k < parts; k++) {
      const a = s + k * w, b = a + w, inWin = L.filter(n => n.ticks >= a - tol && n.ticks < b - tol);
      if (!inWin.length) continue;
      const early = inWin.filter(n => n.ticks < a + beat - tol), pool = early.length ? early : inWin;
      const pick = pool.reduce((x, y) => (y.midi < x.midi || (y.midi === x.midi && y.ticks < x.ticks) ? y : x));
      const prev = bass[bass.length - 1];
      // same bass note again in the same bar: just keep holding it
      if (prev && prev.midi === pick.midi && prev.bar === pick.bar && prev.end >= a - tol) { prev.end = b; continue; }
      bass.push({ n: pick, bar: pick.bar, midi: pick.midi, end: Math.max(b, pick.ticks + pick.dur) });
    }
  });
  bass.forEach((x, i) => { const nx = bass[i + 1]; const end = nx ? Math.min(x.end, nx.n.ticks) : x.end; out.push(copy(x.n, { dur: Math.max(tol, end - x.n.ticks), finger: null })); });
  out.push(...mel);
  out.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
  return out;
}
function buildEvents(song, hands, from, to, simple) {
  const tol = song.ppq / 16, ev = [];
  const src = simple ? (song.simple ||= simplifySong(song)) : song.notes;
  for (const n of src) {
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

const scriptsLoaded = {};
function loadScript(src) {
  return (scriptsLoaded[src] ||= new Promise((ok, fail) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => fail(new Error('не загрузилось: ' + src)); document.head.append(el); }));
}

// .mxl = zipped MusicXML; Chrome can inflate natively, so no zip library is needed
async function unzipMxl(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('файл .mxl повреждён');
  const files = {}; let off = dv.getUint32(eocd + 16, true);
  for (let k = 0, cnt = dv.getUint16(eocd + 10, true); k < cnt && dv.getUint32(off, true) === 0x02014b50; k++) {
    const nlen = dv.getUint16(off + 28, true), name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nlen));
    files[name] = { method: dv.getUint16(off + 10, true), csize: dv.getUint32(off + 20, true), lho: dv.getUint32(off + 42, true) };
    off += 46 + nlen + dv.getUint16(off + 30, true) + dv.getUint16(off + 32, true);
  }
  const read = async name => {
    const f = files[name]; if (!f) return null;
    const start = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true), data = bytes.subarray(start, start + f.csize);
    if (f.method === 0) return new TextDecoder().decode(data);
    const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return new TextDecoder().decode(out);
  };
  const container = await read('META-INF/container.xml');
  const rootPath = (container && /full-path="([^"]+)"/.exec(container)?.[1]) || Object.keys(files).find(n => /\.(xml|musicxml)$/i.test(n) && !n.startsWith('META-INF'));
  if (!rootPath) throw new Error('в .mxl нет нот');
  return read(rootPath);
}

// staff strip for the player: current + next bar, stemless heads (no rhythm yet), right hand / melody on top, left below
function drawStrip(host, { evs, keySpec, scale = 1 }) {
  host.innerHTML = '';
  const VF = window.Vex && Vex.Flow; if (!VF || !evs.length) return;
  const width = Math.max(host.clientWidth, 300), W = width / scale;
  const renderer = new VF.Renderer(host, VF.Renderer.Backends.SVG);
  renderer.resize(width, 220 * scale);
  const ctx = renderer.getContext(); ctx.scale(scale, scale);
  const line = { fillStyle: COLORS.staffLine, strokeStyle: COLORS.staffLine, lineWidth: 1.3 };
  const top = new VF.Stave(22, 0, W - 30).addClef('treble').addKeySignature(keySpec).setContext(ctx);
  const bot = new VF.Stave(22, 105, W - 30).addClef('bass').addKeySignature(keySpec).setContext(ctx);
  ctx.setFillStyle(COLORS.paper); ctx.setStrokeStyle(COLORS.paper);
  top.setStyle(line); bot.setStyle(line); top.draw(); bot.draw();
  new VF.StaveConnector(top, bot).setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
  new VF.StaveConnector(top, bot).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
  const COL = { cur: COLORS.right, done: '#6f7690', next: COLORS.paper };
  const mk = (notes, clef, state) => {
    if (!notes.length) return new VF.GhostNote({ duration: 'q' });
    const g = notes.slice().sort((a, b) => a.midi - b.midi);
    const sn = new VF.StaveNote({ clef, keys: g.map(n => `${n.label[0].toLowerCase()}${n.label.slice(1).replace(/x/, '##')}/${n.oct}`), duration: 'q' });
    const c = COL[state]; const sty = { fillStyle: c, strokeStyle: c };
    sn.setStyle(sty); sn.setLedgerLineStyle({ ...line }); sn.setStemStyle({ strokeStyle: 'transparent', fillStyle: 'transparent' });
    const f = g.map(n => n.finger).filter(Boolean);
    if (f.length) { const a = new VF.Annotation(f.join(' ')); a.setFont('Golos Text', 11, 'bold'); a.setVerticalJustification(clef === 'treble' ? VF.Annotation.VerticalJustify.TOP : VF.Annotation.VerticalJustify.BOTTOM); sn.addModifier(a, 0); }
    return sn;
  };
  const tn = [], bn = [];
  for (const e of evs) {
    if (e.barBreak) { tn.push(new VF.BarNote()); bn.push(new VF.BarNote()); }
    tn.push(mk(e.notes.filter(n => n.hand !== 'L'), 'treble', e.state));
    bn.push(mk(e.notes.filter(n => n.hand === 'L'), 'bass', e.state));
  }
  const voice = arr => new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT).addTickables(arr);
  const v1 = voice(tn), v2 = voice(bn);
  try { VF.Accidental.applyAccidentals([v1, v2], keySpec); } catch { /* accidentals are a nicety */ }
  new VF.Formatter().joinVoices([v1]).joinVoices([v2]).format([v1, v2], W - 130);
  v1.draw(ctx, top); v2.draw(ctx, bot);
}

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
    if (/\.midi?$/i.test(name)) song = prepareMidi(new Midi(bytes));
    else { const xml = /\.mxl$/i.test(name) ? await unzipMxl(bytes) : new TextDecoder('utf-8').decode(bytes); song = prepareMusicXML(xml); song.xml = xml; }
    if (!song.notes.length) throw new Error('в файле нет нот');
  } catch (e) { p.innerHTML = ''; p.append(h('div', { class: 'empty' }, h('strong', {}, 'Песня не открылась'), e.message, h('p', {}, h('a', { href: '#/songs' }, 'К списку песен')))); return; }
  p.innerHTML = '';
  mountPlayer(p, song, { resultId: songId(name), arrange: true,
    head: h('div', { class: 'lesson-head' }, h('a', { class: 'back', href: '#/songs' }, '‹ Все песни'), h('h1', {}, songTitle(name)),
      h('p', { class: 'goal' }, `${song.bars} тактов, размер ${song.ts[0]}/${song.ts[1]}, в оригинале ${song.bpm} BPM`)) });
}

// The player: falling notes, staff, wait / listen. Songs use it as a page; an exercise mounts it under its text
// (cfg.exercise: {bpm, beats, onPass}) — no bar range, no arrangement, metronome in wait mode, pass handed back.
function mountPlayer(p, song, cfg) {
  const ex = cfg.exercise || null;
  if (!ex) p.classList.add('wide');
  const st = { hands: song.hands.filter(x => x !== 'V').length ? song.hands.filter(x => x !== 'V') : song.hands, simple: false, mode: 'wait', from: song.firstBar, to: song.bars, loop: !ex, tempo: ex ? 100 : 70,
    playing: false, running: false, letters: true, staff: true, stripKey: '', stripAt: 0, idx: 0, events: [], pressed: new Set(), wrongFlash: {}, fx: [], mistakes: 0, cleanEvents: 0, evStart: 0, times: [], view: 0, raf: 0, play: null, loopA: null };
  const range = () => [Math.min(st.from, st.to), Math.max(st.from, st.to)];
  const icon = (k, label, extra = {}) => h('button', { class: 'ibtn', 'aria-label': label, title: label, html: ICON[k], ...extra });

  /* ---- setup panel (shown before playing) ---- */
  const handChips = (cls) => h('div', { class: cls }, song.hands.map(hd => {
    const b = h('button', { class: 'chip hand-' + hd, 'aria-pressed': 'false', onclick: () => {
      const on = st.hands.includes(hd); if (on && st.hands.length === 1) return;
      st.hands = on ? st.hands.filter(x => x !== hd) : [...st.hands, hd]; syncUi(); reset(true); if (score.osmd && !st.simple) renderScore();
    } }, cls === 'chips' ? HAND_NAME[hd] : HAND_LABEL[hd]);
    b.dataset.hand = hd; return b;
  }));
  const modeBtn = (m, label, cls) => h('button', { class: cls, 'data-mode': m, onclick: () => { const was = st.playing; pause(); st.mode = m; syncUi(); if (was) resume(); }, html: ICON[m] + `<span>${label}</span>` });
  const num = (val, on) => h('input', { type: 'number', inputmode: 'numeric', min: song.firstBar, max: song.bars, value: val, class: 'num', onchange: e => { on(Math.max(song.firstBar, Math.min(song.bars, +e.target.value || song.firstBar))); syncUi(); reset(true); } });
  // arrangement: original file or the simplified one (top line + bass); the engraved score shows only the original
  const setSimple = v => { if (st.simple === v) return; st.simple = v; stripMode(); reset(true); syncUi(); if (!v && score.osmd) renderScore(); else layout(); };
  const arrBtn = (v, label) => h('button', { class: 'seg-b', 'data-arr': v ? 's' : 'o', onclick: () => setSimple(v) }, label);
  const arrInfo = h('span', { class: 'hint' });
  const simpleChip = h('button', { class: 'chip simple', onclick: () => setSimple(!st.simple) }, 'Упрощ.');
  const fromIn = num(st.from, v => (st.from = v)), toIn = num(st.to, v => (st.to = v));
  const loopCb = h('input', { type: 'checkbox', checked: true, onchange: e => { st.loop = e.target.checked; syncUi(); } });
  const tempoVal = h('span', { class: 'tempo-val' });
  const tempoIn = h('input', { type: 'range', min: 30, max: 100, step: 5, value: st.tempo, oninput: e => setTempo(+e.target.value) });
  const setup = h('div', { class: 'setup' },
    cfg.head || null,
    h('div', { class: 'setup-grid' },
      song.hands.length > 1 ? h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Кто играет'), handChips('chips')) : null,
      cfg.arrange ? h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Аранжировка'), h('div', { class: 'row' }, h('div', { class: 'seg' }, arrBtn(false, 'Как в файле'), arrBtn(true, 'Упрощённо')), arrInfo)) : null,
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Режим'), h('div', { class: 'seg' }, modeBtn('wait', 'Ждать меня', 'seg-b'), modeBtn('listen', 'Послушать', 'seg-b'))),
      ex ? null : h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Такты'), h('div', { class: 'row' }, fromIn, h('span', { class: 'dash' }, '—'), toIn, h('label', { class: 'ctl' }, loopCb, 'по кругу'))),
      ex ? null : h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Темп «Послушать»'), h('div', { class: 'row' }, tempoIn, tempoVal)),
      h('div', { class: 'field-g' }, h('span', { class: 'lbl' }, 'Подсказки'), h('div', { class: 'row' },
        h('label', { class: 'ctl' }, h('input', { type: 'checkbox', checked: true, onchange: e => { st.staff = e.target.checked; st.stripKey = ''; stripHost.hidden = !st.staff; layout(); } }), 'нотный стан'),
        h('label', { class: 'ctl' }, h('input', { type: 'checkbox', checked: true, onchange: e => { st.letters = e.target.checked; } }), 'буквы на нотах')))),
    h('div', { class: 'row' }, h('button', { class: 'btn primary big', onclick: enterPlay, html: ICON.play + '<span>Играть</span>' }),
      h('p', { class: 'hint' }, ex ? `Метроном в режиме «Ждать меня» тикает на ${ex.bpm || '—'} BPM; приложение проверяет только ноты, ровность оцениваешь сам. На пианино: A0 — пропустить, B0 — назад.` : 'В игре: тяни ноты пальцем, чтобы отмотать. Тап по номеру такта — играть оттуда, долгое нажатие на два такта — гонять кусок по кругу. На пианино: A0 — пропустить, B0 — такт назад.')));

  /* ---- play bar (fullscreen mode) ---- */
  const playBtn = icon('play', 'Пауза / продолжить', { onclick: () => (st.playing ? pause() : resume()) });
  const loopBtn = h('button', { class: 'chip loop', onclick: () => { st.loop = !st.loop; syncUi(); }, html: ICON.loop + '<span></span>' });
  const tempoChip = h('div', { class: 'tempo-chip' }, icon('minus', 'Медленнее', { onclick: () => setTempo(st.tempo - 5) }), h('span', { class: 'tempo-val' }), icon('plus', 'Быстрее', { onclick: () => setTempo(st.tempo + 5) }));
  const status = h('span', { class: 'pb-status' });
  const playBar = h('div', { class: 'play-bar' },
    icon('close', 'Выйти из игры', { onclick: exitPlay }),
    h('div', { class: 'pb-group' }, icon('prev', 'Такт назад', { onclick: () => stepBar(-1) }), playBtn, icon('next', 'Такт вперёд', { onclick: () => stepBar(1) })),
    ex ? null : loopBtn, song.hands.length > 1 ? handChips('pb-hands') : null, cfg.arrange ? simpleChip : null,
    h('div', { class: 'seg small' }, modeBtn('wait', 'Ждать', 'seg-b'), modeBtn('listen', 'Слушать', 'seg-b')),
    tempoChip, status);
  const canvas = h('canvas', { class: 'roll' });
  const rollWrap = h('div', { class: 'roll-wrap' }, canvas);
  const stripHost = h('div', { class: 'strip' }), plainHost = h('div', { class: 'strip-plain' }), scoreHost = h('div', { class: 'score-inner', hidden: true });
  stripHost.append(plainHost, scoreHost);
  p.append(setup, playBar, stripHost, rollWrap);
  // MusicXML: real engraved score (OpenSheetMusicDisplay) instead of the heads-only strip
  const score = { osmd: null, ts: -1, ready: false };
  async function initScore() {
    if (!song.xml) return;
    try {
      await loadScript('vendor/osmd-1.8.9.min.js');
      score.osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(scoreHost, {
        autoResize: false, backend: 'svg', drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false,
        drawCredits: false, drawPartNames: false, drawMeasureNumbers: true, renderSingleHorizontalStaffline: true,
        defaultColorMusic: COLORS.paper, cursorsOptions: [{ type: 0, color: COLORS.right, alpha: 0.35, follow: false }]
      });
      await score.osmd.load(song.xml);
      stripMode(); renderScore();
    } catch (e) { score.osmd = null; stripMode(); st.stripKey = ''; }
  }
  function stripMode() {
    const engraved = !!score.osmd && !st.simple;
    stripHost.classList.toggle('score', engraved); scoreHost.hidden = !engraved; plainHost.hidden = engraved; st.stripKey = '';
  }
  function renderScore() {
    const o = score.osmd; if (!o || st.simple) return;
    const insts = o.Sheet.Instruments;
    // the voice part shows only when the melody is selected; piano parts otherwise
    insts.forEach(ins => { const isVoice = !/piano|keyboard|клав|фортеп/i.test(ins.Name || '') && insts.length > 1; ins.Visible = isVoice ? st.hands.includes('V') : st.hands.some(x => x !== 'V') || !insts.some(i2 => i2 !== ins); });
    o.zoom = stripHost.clientWidth < 700 ? 0.7 : 0.8;
    o.render(); o.cursor.show(); score.ts = -1; score.ready = true;
    st.stripKey = ''; layout();
  }
  function moveScore() {
    const o = score.osmd; if (!o || !score.ready) return;
    const target = (cur() ? cur().ticks : st.view) / (song.ppq * 4), c = o.cursor;
    if (Math.abs(target - score.ts) < 1e-6) return;
    const now = () => c.Iterator.currentTimeStamp.RealValue;
    if (target < now() - 1e-6 || score.ts < 0) c.reset();
    let guard = 0;
    while (!c.Iterator.EndReached && now() < target - 1e-6 && guard++ < 5000) c.next();
    score.ts = target;
    const el = c.cursorElement;
    if (el) stripHost.scrollTo({ left: Math.max(0, el.offsetLeft - stripHost.clientWidth * 0.3), behavior: 'smooth' });
  }

  function syncUi() {
    document.querySelectorAll('.chip[data-hand]').forEach(b => { const on = st.hands.includes(b.dataset.hand); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    p.querySelectorAll('[data-arr]').forEach(b => b.classList.toggle('on', (b.dataset.arr === 's') === st.simple));
    simpleChip.classList.toggle('on', st.simple);
    if (st.simple) { const all = song.notes.filter(n => n.hand !== 'V').length, s = (song.simple || []).filter(n => n.hand !== 'V').length; arrInfo.textContent = `нот: ${s} вместо ${all}`; } else arrInfo.textContent = '';
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
    const stripH = st.staff ? stripHost.offsetHeight : 0;
    stripHost.style.top = playMode ? playBar.offsetHeight + 'px' : '';
    rollWrap.style.top = playMode ? playBar.offsetHeight + stripH + 'px' : '';
    st.stripKey = '';
    const dpr = window.devicePixelRatio || 1, w = rollWrap.clientWidth || canvas.clientWidth;
    const hgt = playMode ? Math.max(260, window.innerHeight - playBar.offsetHeight - stripH) : Math.round(Math.max(300, Math.min(window.innerHeight * 0.45, 520)));
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
    st.events = buildEvents(song, st.hands, ...range(), st.simple);
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
    // "now" for sustain: the note being waited for (wait) or the playhead (listen)
    const posT = st.mode === 'wait' && cur() ? cur().ticks : st.view;
    const sounding = n => n.ticks < posT && n.ticks + n.dur > posT + 1;
    const hold = {};
    for (const ev of st.events) { if (ev.ticks >= posT) break; for (const n of ev.notes) if (sounding(n)) hold[n.midi] = HAND_COLOR[n.hand]; }
    for (const ev of st.events) {
      if ((ev.ticks - st.view) * pxPerTick > area + 60) break;
      const isCur = ev.ticks === curT, done = st.mode === 'wait' && ev.ticks < curT;
      for (const n of ev.notes) {
        const g = geo.x[n.midi]; if (!g) continue;
        const y0 = area - (n.ticks - st.view) * pxPerTick, hh = Math.max(9, n.dur * pxPerTick - 3);
        if (y0 < -4 || y0 - hh > area) continue;
        const col = HAND_COLOR[n.hand];
        const sus = sounding(n);
        ctx.globalAlpha = sus ? 0.92 : done ? 0.14 : isCur ? 1 : 0.82;
        if (isCur || sus) { ctx.shadowColor = col; ctx.shadowBlur = sus ? 10 : 18; }
        ctx.fillStyle = col; rr(ctx, g.x + 2, y0 - hh, g.w - 4, hh, 6); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; rr(ctx, g.x + 3, y0 - hh + 1, g.w - 6, Math.min(4, hh / 3), 3); ctx.fill();
        if (n.finger && g.w >= 14 && hh >= 18) { ctx.fillStyle = 'rgba(15,19,32,0.75)'; ctx.beginPath(); ctx.arc(g.x + g.w / 2, y0 - hh + 10, Math.min(8, g.w / 2 - 2), 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.min(11, g.w * 0.42)}px Golos Text, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n.finger), g.x + g.w / 2, y0 - hh + 10.5); ctx.textAlign = 'left'; }
        if (st.letters && g.w >= 16 && hh >= 16) { ctx.fillStyle = 'rgba(15,19,32,0.85)'; ctx.font = `700 ${Math.min(13, g.w * 0.48)}px Golos Text, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(n.label || pcName(n.midi), g.x + g.w / 2, y0 - 4); ctx.textAlign = 'left'; }
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
    const fill = (n, black) => st.wrongFlash[n] > now ? COLORS.wrong : held.has(n) && need[n] ? '#ffffff' : need[n] || (hold[n] && held.has(n) ? hold[n] : null) || (held.has(n) ? (black ? '#59617e' : '#c7ccda') : black ? '#1b2030' : COLORS.paper);
    // a key that should still be held but was released: pale hand colour as a "keep holding" hint
    const hint = n => hold[n] && !held.has(n) && !need[n];
    for (const n of whites) {
      const g = geo.x[n], down = held.has(n) ? 2 : 0;
      ctx.fillStyle = fill(n, false); rr(ctx, g.x + 1, area + 2 + down, g.w - 2, kh - 4, 5); ctx.fill();
      if (hint(n)) { ctx.globalAlpha = 0.45; ctx.fillStyle = hold[n]; rr(ctx, g.x + 1, area + 2, g.w - 2, kh - 4, 5); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(g.x + 1, area + kh - 8 + down, g.w - 2, 4);
      if (n === 60) { ctx.fillStyle = '#8a90a5'; ctx.beginPath(); ctx.arc(g.x + g.w / 2, area + kh - 16, 3, 0, 7); ctx.fill(); }
    }
    for (let n = lo; n <= hi; n++) { if (!isBlack(n)) continue; const g = geo.x[n], down = held.has(n) ? 2 : 0; ctx.fillStyle = fill(n, true); rr(ctx, g.x, area + 2 + down, g.w, kh * 0.6, 4); ctx.fill(); if (hint(n)) { ctx.globalAlpha = 0.5; ctx.fillStyle = hold[n]; rr(ctx, g.x, area + 2, g.w, kh * 0.6, 4); ctx.fill(); ctx.globalAlpha = 1; } }
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
    updateStrip();
    st.raf = requestAnimationFrame(tick);
  }
  function updateStrip() {
    if (!st.staff || !st.events.length) return;
    if (score.osmd && !st.simple) { moveScore(); return; }
    const pos = cur() ? cur().ticks : st.view, bi = barIndexAt(pos);
    const key = `${bi}|${st.idx}|${st.hands.join('')}|${st.simple}|${stripHost.clientWidth}`;
    const now = performance.now();
    if (key === st.stripKey || now - st.stripAt < 120) return;
    st.stripKey = key; st.stripAt = now;
    const t0 = song.barStarts[bi], t1 = song.barStarts[bi + 2] ?? Infinity;
    const evs = []; let lastBar = null;
    st.events.forEach((e, i) => {
      if (e.ticks < t0 || e.ticks >= t1) return;
      const b = barIndexAt(e.ticks);
      evs.push({ notes: e.notes, barBreak: lastBar != null && b !== lastBar, state: i === st.idx ? 'cur' : i < st.idx && st.mode === 'wait' ? 'done' : 'next' });
      lastBar = b;
    });
    try { drawStrip(plainHost, { evs, keySpec: song.keySpec || 'C', scale: stripHost.clientWidth < 700 ? 0.95 : 1.12 }); } catch (err) { plainHost.textContent = ''; }
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
    if (ex) { ex.onPass({ accuracy: Math.round(acc * 1000) / 1000, avgResponseMs: Math.round(st.times.reduce((x, y) => x + y, 0) / Math.max(1, st.times.length)) }); st.cleanEvents = 0; st.mistakes = 0; st.times = []; st.idx = 0; exitPlay(); return; }
    saveResult({ id: cfg.resultId }, { id: `${st.hands.slice().sort().join('').toLowerCase()}${st.simple ? '-s' : ''}-${a}-${b}` },
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
    if (ex && ex.bpm) { if (st.mode === 'wait') { metro.beats = ex.beats || 4; metro.setBpm(ex.bpm); if (!metro.on) metro.start(); } else if (metro.on) metro.stop(); }
    syncUi();
  }
  function pause() { st.playing = false; synth.silence(); st.play = null; if (ex && metro.on) metro.stop(); syncUi(); }
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

  layout(); reset(); syncUi(); initScore();
  if (window.__klavishi) { window.__klavishi.player = st; window.__klavishi.song = song; window.__klavishi.synth = synth; window.__klavishi.score = score; }
  const onResize = () => { layout(); };
  window.addEventListener('resize', onResize);
  st.raf = requestAnimationFrame(tick);
  activate(ctrl);
  const cleanup = () => { cancelAnimationFrame(st.raf); window.removeEventListener('resize', onResize); pause(); document.body.classList.remove('playing'); window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup);
  return cleanup;
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
  const [, sec, arg, rest] = (location.hash || '#/theory').split('/');
  document.body.classList.remove('drawer-open');
  const cur = sec === 'lesson' ? 'theory' : sec === 'song' ? 'songs' : sec === 'exercise' ? 'exercises' : sec === 'chart' ? 'songs' : (sec || 'theory');
  document.querySelectorAll('[data-nav]').forEach(a => (a.dataset.nav === cur ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#crumb').textContent = { theory: 'теория', lesson: 'урок', exercises: 'упражнения', exercise: 'упражнение', songs: 'песни', song: 'песня', chart: 'по аккордам', settings: 'настройки' }[sec] || '';
  if (!bridge.url() && sec !== 'settings' && sec !== 'chart') { location.hash = '#/settings'; toast('Сначала вставь адрес моста'); return; }
  if (sec === 'lesson' && arg) return lessonPage(decodeURIComponent(arg));
  if (sec === 'exercises') return exercisesPage();
  if (sec === 'exercise' && arg) return exercisePage(decodeURIComponent(arg));
  if (sec === 'songs') return songsPage();
  if (sec === 'song' && arg) return songPage(decodeURIComponent(arg));
  if (sec === 'chart' && arg === 'new') return chartEditPage(null);
  if (sec === 'chart' && arg && rest === 'edit') return chartEditPage(decodeURIComponent(arg));
  if (sec === 'chart' && arg) return chartPage(decodeURIComponent(arg));
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
// test hook for automated checks (no effect in normal use)
window.__klavishi = { onMidi, midi, drawStaff, parseNote };
route();
})();
