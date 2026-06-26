// Live view of the opencode TUI bench. Ported from src/pages/api/bench-live.ts.
// Shells out to tooling/bench/bench-live.py which reads the opencode SQLite DB
// (path overridable via OPENCODE_DB env, consumed by the python script).
import { execFileSync } from 'node:child_process';

const SID_RE = /^ses_[A-Za-z0-9]+$/;

export function registerBenchLive(app, { script, mountPath = '/api/bench-live' }) {
  app.get(mountPath, (req, res) => {
    const send = (code, body) =>
      res.status(code).set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).send(body);
    try {
      const session = req.query.session;
      let args;
      if (session) {
        if (typeof session !== 'string' || !SID_RE.test(session)) return send(400, '{"error":"bad session id"}');
        const page = String(Math.max(0, parseInt(req.query.page || '0', 10) || 0));
        const size = String(Math.min(400, Math.max(1, parseInt(req.query.size || '40', 10) || 40)));
        args = [script, '--session', session, '--page', page, '--size', size];
        if (req.query.tail === '1') args.push('--tail');
      } else {
        args = [script, '--list'];
      }
      const out = execFileSync('python3', args, { encoding: 'utf-8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
      return send(200, out);
    } catch (e) {
      return send(500, JSON.stringify({ error: String(e?.message || e) }));
    }
  });
}
