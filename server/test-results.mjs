// Test-result media — enforces "every result has a visual": a result either has an image,
// or an HTML description that is auto-converted to an image (and shown inline in test detail).
// Keyed by module|branch|round. Files under web/results/, registry web/test-results.json.
//   GET  /api/test-results                       → registry
//   POST /api/test-results { module, branch, round, html }  → writes html + auto-shots image
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const KEY_RE = /^[A-Za-z0-9._-]{1,40}$/;
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf-8') || '{}'); } catch { return {}; } };
function writeAtomic(f, d) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const t = `${f}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  fs.writeFileSync(t, JSON.stringify(d, null, 2) + '\n'); fs.renameSync(t, f);
}
function shot(url, out) {
  try {
    const p = spawn('npx', ['--no-install', 'playwright', 'screenshot', '--viewport-size=1280,832', '--wait-for-timeout=700', url, out], { stdio: 'ignore', detached: true });
    p.on('error', () => {}); p.unref();
  } catch { /* ignore */ }
}

export function registerTestResults(app, { file, webDir, baseUrl }) {
  const dir = path.join(webDir, 'results');
  app.get('/api/test-results', (_req, res) => res.type('application/json; charset=utf-8').send(JSON.stringify(read(file))));

  app.post('/api/test-results', (req, res) => {
    const J = (c, o) => res.status(c).type('application/json').send(JSON.stringify(o));
    const b = req.body || {};
    if (!KEY_RE.test(b.module || '') || !KEY_RE.test(b.branch || '') || !KEY_RE.test(b.round || '')) return J(400, { error: 'bad module/branch/round' });
    if (!b.html || typeof b.html !== 'string') return J(400, { error: 'html required (a result needs an image or an html→image)' });
    const key = `${b.module}|${b.branch}|${b.round}`;
    const fname = `${b.module}_${b.branch}_${b.round}`.replace(/[^A-Za-z0-9._-]/g, '_');
    fs.mkdirSync(dir, { recursive: true });
    try { fs.writeFileSync(path.join(dir, `${fname}.html`), b.html, 'utf-8'); } catch (e) { return J(500, { error: 'write html failed: ' + e.message }); }
    if (baseUrl) shot(`${baseUrl}/results/${fname}.html`, path.join(dir, `${fname}.png`));
    const reg = read(file);
    reg[key] = { htmlFile: `results/${fname}.html`, image: `results/${fname}.png`, ts: new Date().toISOString() };
    try { writeAtomic(file, reg); } catch (e) { return J(500, { error: 'write failed: ' + e.message }); }
    return J(200, { ok: true, result: reg[key] });
  });
}
