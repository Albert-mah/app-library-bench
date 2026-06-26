// User-score persistence. Ported 1:1 from the original Astro route
// (src/pages/api/app-library-scores.ts) — branch-aware, atomic, legacy-tolerant.
// Stores to a single JSON file (default: web/user-scores.json), overridable via SCORES_FILE.
import fs from 'node:fs';
import path from 'node:path';

const ROUND_RE = /^r\d+$/;
const MODULE_RE = /^\d{2}$/;
const BRANCH_RE = /^[a-z][a-z0-9_-]{0,23}$/; // branch id: lowercase start, alnum/-/_, ≤24
const DEFAULT_BRANCH = 'main';
const VERDICTS = ['pass', 'fix', 'redo'];

// Top-level keys that are rounds (r1/r2…) instead of branches → legacy file.
function looksLikeLegacy(obj) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  return keys.some((k) => ROUND_RE.test(k));
}

function readScores(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf-8').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    if (looksLikeLegacy(parsed)) return { [DEFAULT_BRANCH]: parsed };
    return parsed;
  } catch {
    return {};
  }
}

function writeScoresAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // unique temp name (pid+hrtime) avoids concurrent-POST .tmp collisions; same-dir rename = atomic.
  const tmp = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, file);
}

// Wire the two handlers onto an Express app at `mountPath`.
export function registerScores(app, { file, mountPath = '/api/app-library-scores' }) {
  app.get(mountPath, (_req, res) => {
    res.type('application/json; charset=utf-8').send(JSON.stringify(readScores(file)));
  });

  app.post(mountPath, (req, res) => {
    const J = (code, obj) => res.status(code).type('application/json; charset=utf-8').send(JSON.stringify(obj));
    const body = req.body;
    if (!body || typeof body !== 'object') return J(400, { error: 'invalid json' });

    const round = body.round;
    const moduleId = body.module;
    const branch = (body.branch != null) ? body.branch : DEFAULT_BRANCH;

    if (typeof round !== 'string' || !ROUND_RE.test(round)) return J(400, { error: 'invalid round' });
    if (typeof moduleId !== 'string' || !MODULE_RE.test(moduleId)) return J(400, { error: 'invalid module' });
    if (typeof branch !== 'string' || !BRANCH_RE.test(branch)) return J(400, { error: 'invalid branch' });

    const hasScore = 'score' in body;
    const hasVerdict = 'verdict' in body;
    const hasNote = 'note' in body;
    if (!hasScore && !hasVerdict && !hasNote) {
      return J(400, { error: 'nothing to update (need score/verdict/note)' });
    }

    let score;
    if (hasScore) {
      const s = body.score;
      const isClear = s === null;
      const isValid = typeof s === 'number' && Number.isFinite(s) && s >= 0 && s <= 10;
      if (!isClear && !isValid) return J(400, { error: 'invalid score' });
      score = isClear ? null : s;
    }

    let verdict;
    if (hasVerdict) {
      const vd = body.verdict;
      const isClear = vd === null;
      const isValid = typeof vd === 'string' && VERDICTS.indexOf(vd) >= 0;
      if (!isClear && !isValid) return J(400, { error: 'invalid verdict (pass|fix|redo|null)' });
      verdict = isClear ? null : vd;
    }

    let note;
    if (hasNote) {
      const n = body.note;
      if (n !== null && typeof n !== 'string') return J(400, { error: 'invalid note' });
      note = n === null ? '' : n;
    }

    const data = readScores(file);
    if (!data[branch]) data[branch] = {};
    if (!data[branch][round]) data[branch][round] = {};
    const prev = data[branch][round][moduleId] || {};

    const next = { ...prev };
    if (hasScore) { if (score === null) delete next.score; else next.score = score; }
    if (hasVerdict) { if (verdict === null) delete next.verdict; else next.verdict = verdict; }
    if (hasNote) { if (note === '') delete next.note; else next.note = note; }
    next.ts = new Date().toISOString();

    const isEmpty = next.score === undefined && next.verdict === undefined && (next.note === undefined || next.note === '');
    if (isEmpty) {
      delete data[branch][round][moduleId];
      if (Object.keys(data[branch][round]).length === 0) delete data[branch][round];
      if (Object.keys(data[branch]).length === 0) delete data[branch];
    } else {
      data[branch][round][moduleId] = next;
    }

    try {
      writeScoresAtomic(file, data);
    } catch (e) {
      return J(500, { error: 'write failed: ' + (e?.message || String(e)) });
    }
    res.type('application/json; charset=utf-8').send(JSON.stringify(data));
  });
}
