/**
 * Piano bridge — Google Apps Script web app.
 * Deploy: Execute as = Me, Who has access = Anyone.
 * The /exec URL is NOT stored in the repo; paste it on the tablet once.
 *
 * GET  ?action=ping            -> {ok, ts}
 * GET  ?action=list            -> {ok, lessons:[{id,title,schemaVersion}], errors:[{file,error}]}
 * GET  ?action=lesson&id=<id>  -> {ok, lesson}
 * POST body (text/plain, JSON) -> {ok, saved:true, attemptId, duplicate}
 *
 * Client must send POST as Content-Type: text/plain — application/json triggers a CORS
 * preflight that Apps Script cannot answer.
 */

// Fixed locations. The script accepts no file IDs from the client.
const LESSONS_FOLDER_ID = '1PjhnS70rxpQ0Ql5HJpn9HTeeSDv9fkwf'; // Music/Piano/lessons
const RESULTS_SHEET_ID  = '1o-7dB_HxpW-Lr9fGynUfxmd_fEjZ49rOaEFCxH7q-gI'; // piano-results
const RESULTS_TAB = 'results';
const HEADERS = ['savedAt', 'attemptId', 'lessonId', 'blockId', 'accuracy', 'avgResponseMs',
                 'status', 'checkedBy', 'finishedAt', 'client'];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STATUSES = ['passed', 'needs-practice', 'in-progress', 'not-assessed'];
const CHECKED_BY = ['midi', 'self'];

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    switch (p.action) {
      case 'ping':   return json_({ ok: true, ts: new Date().toISOString() });
      case 'list':   return json_(listLessons_());
      case 'lesson': return json_({ ok: true, lesson: getLesson_(p.id) });
      default:       return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 10000) throw new Error('empty or too large body');
    const r = validateResult_(JSON.parse(raw));
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = resultsSheet_();
      const last = sheet.getLastRow();
      const dup = last > 1 && sheet.getRange(2, 2, last - 1, 1)
        .createTextFinder(r.attemptId).matchEntireCell(true).findNext();
      if (!dup) {
        sheet.appendRow([new Date().toISOString(), r.attemptId, r.lessonId, r.blockId, r.accuracy,
                         r.avgResponseMs, r.status, r.checkedBy, r.finishedAt, r.client]);
        SpreadsheetApp.flush();
      }
      return json_({ ok: true, saved: true, attemptId: r.attemptId, duplicate: !!dup });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// Live .json files only; for duplicate names the newest wins (lessons are replaced via trash + create).
function lessonFiles_() {
  const it = DriveApp.getFolderById(LESSONS_FOLDER_ID).getFiles();
  const byName = {};
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed() || !/\.json$/i.test(f.getName())) continue;
    const prev = byName[f.getName()];
    if (!prev || f.getLastUpdated() > prev.getLastUpdated()) byName[f.getName()] = f;
  }
  return byName;
}

function listLessons_() {
  const files = lessonFiles_();
  const lessons = [], errors = [];
  for (const name in files) {
    const f = files[name];
    try {
      const l = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
      if (!l.id || !l.title) throw new Error('no id or title');
      lessons.push({ id: l.id, title: l.title, schemaVersion: l.schemaVersion });
    } catch (err) {
      errors.push({ file: name, error: String(err.message || err) });
    }
  }
  lessons.sort((a, b) => a.id < b.id ? -1 : 1);
  return { ok: true, lessons: lessons, errors: errors };
}

function getLesson_(id) {
  if (!ID_RE.test(String(id || ''))) throw new Error('bad lesson id');
  const f = lessonFiles_()[id + '.json'];
  if (!f) throw new Error('lesson not found: ' + id);
  return JSON.parse(f.getBlob().getDataAsString('UTF-8'));
}

function validateResult_(b) {
  const s = (v, max) => { if (typeof v !== 'string' || !v || v.length > max) throw new Error('bad field'); return v; };
  const r = {
    attemptId: s(b.attemptId, 64),
    lessonId: s(b.lessonId, 64),
    blockId: s(b.blockId, 64),
    accuracy: Number(b.accuracy),
    avgResponseMs: Math.round(Number(b.avgResponseMs)),
    status: s(b.status, 20),
    checkedBy: s(b.checkedBy, 10),
    finishedAt: s(b.finishedAt, 40),
    client: String(b.client || '').slice(0, 100)
  };
  if (!/^[A-Za-z0-9-]{8,64}$/.test(r.attemptId)) throw new Error('bad attemptId');
  if (!ID_RE.test(r.lessonId) || !ID_RE.test(r.blockId)) throw new Error('bad lessonId/blockId');
  if (!(r.accuracy >= 0 && r.accuracy <= 1)) throw new Error('bad accuracy');
  if (!(r.avgResponseMs >= 0 && r.avgResponseMs < 600000)) throw new Error('bad avgResponseMs');
  if (STATUSES.indexOf(r.status) < 0) throw new Error('bad status');
  if (CHECKED_BY.indexOf(r.checkedBy) < 0) throw new Error('bad checkedBy');
  return r;
}

function resultsSheet_() {
  const ss = SpreadsheetApp.openById(RESULTS_SHEET_ID);
  let sh = ss.getSheetByName(RESULTS_TAB);
  if (!sh) {
    sh = ss.getSheets()[0];
    if (sh.getLastRow() === 0) sh.setName(RESULTS_TAB); else sh = ss.insertSheet(RESULTS_TAB);
  }
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); sh.setFrozenRows(1); }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to grant permissions and check the IDs. */
function selfTest() {
  Logger.log(JSON.stringify(listLessons_()));
  Logger.log(resultsSheet_().getName());
}
