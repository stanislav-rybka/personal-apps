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
const COLORS = { paper: '#ede7d9', muted: '#a3a9bc', left: '#39c2b0', right: '#f2a541', wrong: '#ef6f6c', ok: '#7bd389', line: '#3a4361' };
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
  if (clef === 'auto') clef = all.every(n => n.midi >= 60) ? 'treble' : all.every(n => n.midi < 60) ? 'bass' : 'grand';
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
  const x = 8, sw = W - 16;
  const makeNote = (group, staffClef) => {
    if (!group.length) return new VF.GhostNote({ duration: 'w' });
    const g = group.slice().sort((a, b) => a.midi - b.midi);
    const note = new VF.StaveNote({ clef: staffClef, keys: g.map(n => `${n.letter.toLowerCase()}${n.acc}/${n.oct}`), duration: 'w' });
    note.setStyle(style); note.setLedgerLineStyle(style);
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
    stave.setStyle(style); stave.draw();
    let notes = evs.map(g => makeNote(g, clef));
    if (!notes.length) return;
    if (compact) notes = [new VF.GhostNote({ duration: 'w' }), ...notes, new VF.GhostNote({ duration: 'w' })];
    const v = voice(notes);
    new VF.Formatter().joinVoices([v]).format([v], Math.max(sw - 70, 40));
    v.draw(ctx, stave);
  } else {
    const top = new VF.Stave(x + 14, 10, sw - 14).addClef('treble').setContext(ctx);
    const bot = new VF.Stave(x + 14, 120, sw - 14).addClef('bass').setContext(ctx);
    top.setStyle(style); bot.setStyle(style); top.draw(); bot.draw();
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

const BLOCKS = {
  theory(b) {
    const el = h('div', { class: 'theory' });
    const paras = String(b.text || '').split(/\n\s*\n/);
    for (const p of paras) {
      const lines = p.split('\n');
      if (lines.every(l => /^\s*-\s+/.test(l))) el.append(h('ul', {}, lines.map(l => h('li', {}, l.replace(/^\s*-\s+/, '')))));
      else {
        const intro = []; const items = [];
        for (const l of lines) (/^\s*-\s+/.test(l) ? items : intro).push(l.replace(/^\s*-\s+/, ''));
        if (intro.length) el.append(h('p', {}, intro.join(' ')));
        if (items.length) el.append(h('ul', {}, items.map(i => h('li', {}, i))));
      }
    }
    return el;
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
      else drawStaff(view, { clef: b.clef || 'auto', events: [st.target.text], colors, scale: 2.1, compact: true });
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
      name.textContent = s.name; count.textContent = `${st.i + 1} из ${st.seq.length}`;
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
    const text = BLOCKS.theory({ text: b.text }); text.classList.add('practice-text');
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
function songsPage() {
  page(hero('Песни', 'Вставляешь аккорды песни — каждый аккорд становится кнопкой с аппликатурой для двух рук.'),
    h('div', { class: 'empty' }, h('strong', {}, 'Переезжает сюда следующим шагом'), 'Разбор «Натали» из Claude переносится в этот раздел.'));
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
  const cur = sec === 'lesson' ? 'theory' : (sec || 'theory');
  document.querySelectorAll('[data-nav]').forEach(a => (a.dataset.nav === cur ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#crumb').textContent = { theory: 'теория', lesson: 'урок', exercises: 'упражнения', songs: 'песни', settings: 'настройки' }[sec] || '';
  if (!bridge.url() && sec !== 'settings') { location.hash = '#/settings'; toast('Сначала вставь адрес моста'); return; }
  if (sec === 'lesson' && arg) return lessonPage(decodeURIComponent(arg));
  if (sec === 'exercises') return exercisesPage();
  if (sec === 'songs') return songsPage();
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
