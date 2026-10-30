# Клавиши — piano app

A piano trainer for an Android tablet on the music stand, played on a Roland FP-30X over Bluetooth MIDI.
Live: `https://stanislav-rybka.github.io/personal-apps/piano/` (installable: Chrome → Install app).

No build step: `index.html` + `css/app.css` + `js/app.js` (one file on purpose), libraries vendored in `vendor/`.
Bump the `?v=` query on the CSS/JS links in `index.html` with every change so the tablet doesn't serve a stale copy.

## Sections

| Section | What it does | Data |
|---|---|---|
| Теория | Lessons made of blocks (theory text, staff, keyboard, image, note reading, chord, guided practice); MIDI-checked blocks save a result | Lesson JSON in Drive, via the bridge |
| Упражнения | Library by category + «now in focus»; exercise page with texts, tempo ladder and metronome; an optional note pattern is played in the song player; the player rates «clean at N BPM» himself, MIDI checks only the notes | Exercise JSON in Drive, via the bridge |
| Песни → По нотам | MIDI / MusicXML / .mxl player: falling notes, staff strip or engraved score (OSMD), wait-for-me mode, hands, bar loop, listen mode, simplified arrangement | Song files in Drive, via the bridge |
| Песни → По аккордам | A chord sheet (chords over lyrics) pasted from any site. «Разучить»: the song's chords one by one with live held-key check, inversions and its chord changes ranked by difficulty. «Играть»: one keyboard shows the chord now and the next one, and the app follows the song as you play | **Only in this browser** (localStorage); backup = an exported JSON file |

Content formats (lessons, exercises) are specified outside this repo; the engine contains no content.

## Parts

- `js/app.js` — everything, in sections marked `/* ---- name ---- */`: storage, notes, staff (VexFlow), keyboards,
  MIDI, metronome, bridge + offline queue, lesson blocks, pages (theory, exercises, songs, chords), song player.
- `sw.js` — service worker: network first, cache only as the offline fallback (never serves a stale app when online).
- `manifest.webmanifest` — installable app; Share target opens the chord editor with the shared text.
- `../bridge/piano/Code.gs` — Google Apps Script web app between the page and Drive: lists/returns lessons, exercises,
  images and songs; writes results to a sheet. Folder and sheet IDs are fixed in the script; it takes no file IDs from
  the client. Its `/exec` URL is never committed — it is pasted once in the app's Settings. Deploy: Apps Script →
  paste `Code.gs` → run `selfTest` → Deploy → Manage deployments → edit → New version (the URL stays the same).
- `spike/` — the first plumbing test (MIDI → lesson from Drive → result saved). Kept for reference.

## Songs by chords — how it works

- **Parsing** (`parseSheet`): a line is a chord line when every token is a chord symbol or filler (`|`, `x2`, `N.C.`);
  `Label: Am Dm` lines are split. Chords keep their column so they render over the right word.
- **Voicing** (`voiceChord`): left hand = bass in octave 2 (+ fifth or octave); right hand = three close notes above it.
  Four-note chords drop the fifth, then the root. Candidates are every rotation of the chord tones (= inversions);
  «root position» picks the one with the root at the bottom, «nearest form» the one closest to the previous chord,
  `set.inv` forces one. Fingers by a general rule (1-3-5, or 1-2-5 when the top interval is a fourth or wider).
- **Following the song** (`chartPage` → `judge`): the app stays on a chord while it's played (repeats, broken,
  any octave) and moves only when the *next* chord of the song is played. A move counts only the latest stretch of
  playing that no longer adds up to the current chord; a next chord built only from the current chord's notes
  (C7 → C) starts after all keys are released. Repeated chords (Am Am Am) are one step. Nothing skips ahead.
- **Keyboard** (`drawChordKeyboard`): now — left teal, right violet, solid with fingers and names; next — left blue,
  right orange, pale with a frame and names; a key in both flows from one into the other; held keys (study mode)
  colour the finger circle green / amber / red.
- **Transitions** (`moveCost`): right-hand semitones moved note by note + bass move at half weight + keys to find
  (black ones extra); under 10 = easy, 17+ = hard.

## MIDI notes

- The piano can show up as two inputs on Android (Bluetooth + MIDI BLE Connect): the same note-on twice with no
  note-off between is counted once.
- A0 = skip / next, B0 = back, in the player and the chord pages.
- MIDI files carry no pickup or short-bar markers: the bar grid's phase is guessed per bar (`midiBarGrid`).

## Checking a change

There are no unit tests. Every change is checked in a headless Chromium (Playwright) against the real page:
a fake `navigator.requestMIDIAccess` sends note-on/off, a routed fake bridge serves fixtures, and the page exposes
`window.__klavishi` (player, song, chart, study state) for assertions. Then on the real piano.
