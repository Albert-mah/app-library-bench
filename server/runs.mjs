// Run history + human review — serves archived run records (tooling/bench/runs/)
// and persists a per-run review (score / verdict / note), so the run-history page is
// a real inspect → verify → score surface.
//   GET  /api/runs               → index.json, each record with .review merged in
//   GET  /api/runs/:id           → full record + transcript (+ .review)
//   POST /api/runs/:id/review    → upsert { score?, verdict?, note? } into reviews.json
import fs from 'node:fs';
import path from 'node:path';

const ID_RE = /^[A-Za-z0-9._-]+$/;
const VERDICTS = ['pass', 'fix', 'redo'];

function readJSON(f, fallback) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8') || 'null') ?? fallback : fallback; }
  catch { return fallback; }
}
function writeAtomic(f, data) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, f);
}

export function registerRuns(app, { dir, mountPath = '/api/runs' }) {
  const indexFile = () => path.join(dir, 'index.json');
  const reviewsFile = () => path.join(dir, 'reviews.json');
  const aiReviewsFile = () => path.join(dir, 'ai-reviews.json');
  const shotsFile = () => path.join(dir, 'screenshots.json');

  app.get(mountPath, (_req, res) => {
    const index = readJSON(indexFile(), []);
    const reviews = readJSON(reviewsFile(), {});
    const ai = readJSON(aiReviewsFile(), {});
    const shots = readJSON(shotsFile(), {});
    for (const r of index) {
      if (!r || !r.id) continue;
      if (reviews[r.id]) r.review = reviews[r.id];
      if (ai[r.id]) r.aiReview = ai[r.id];
      if (shots[r.id]) r.screenshots = shots[r.id];
    }
    res.type('application/json; charset=utf-8').send(JSON.stringify(index));
  });

  app.get(`${mountPath}/:id`, (req, res) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) return res.status(400).type('application/json').send('{"error":"bad id"}');
    const f = path.join(dir, 'transcripts', `${id}.json`);
    if (!fs.existsSync(f)) return res.status(404).type('application/json').send('{"error":"not found"}');
    const data = readJSON(f, {});
    const reviews = readJSON(reviewsFile(), {});
    const ai = readJSON(aiReviewsFile(), {});
    const shots = readJSON(shotsFile(), {});
    if (reviews[id]) data.review = reviews[id];
    if (ai[id]) data.aiReview = ai[id];
    if (shots[id] && data.record) data.record.screenshots = shots[id];
    res.type('application/json; charset=utf-8').send(JSON.stringify(data));
  });

  app.post(`${mountPath}/:id/review`, (req, res) => {
    const J = (code, o) => res.status(code).type('application/json').send(JSON.stringify(o));
    const id = req.params.id;
    if (!ID_RE.test(id)) return J(400, { error: 'bad id' });
    const b = req.body || {};
    const hasScore = 'score' in b, hasVerdict = 'verdict' in b, hasNote = 'note' in b;
    if (!hasScore && !hasVerdict && !hasNote) return J(400, { error: 'nothing to update' });

    const reviews = readJSON(reviewsFile(), {});
    const prev = reviews[id] || {};
    const next = { ...prev };
    if (hasScore) {
      const s = b.score;
      if (s === null) delete next.score;
      else if (typeof s === 'number' && s >= 0 && s <= 10) next.score = s;
      else return J(400, { error: 'invalid score' });
    }
    if (hasVerdict) {
      const v = b.verdict;
      if (v === null) delete next.verdict;
      else if (VERDICTS.includes(v)) next.verdict = v;
      else return J(400, { error: 'invalid verdict (pass|fix|redo|null)' });
    }
    if (hasNote) { if (!b.note) delete next.note; else if (typeof b.note === 'string') next.note = b.note; else return J(400, { error: 'invalid note' }); }
    next.ts = new Date().toISOString();

    const empty = next.score === undefined && next.verdict === undefined && next.note === undefined;
    if (empty) delete reviews[id]; else reviews[id] = next;
    try { writeAtomic(reviewsFile(), reviews); } catch (e) { return J(500, { error: 'write failed: ' + e.message }); }
    return J(200, { ok: true, review: reviews[id] || null });
  });
}
