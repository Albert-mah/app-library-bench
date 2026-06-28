// Live view of the bench. Default view is tmux-driven (what is actually running now);
// shells out to tooling/bench/bench-live.py. Routes:
//   (default)        → --live          real tmux sessions + status
//   ?pane=<name>     → --pane <name>    one session's live pane text
//   ?session=ses_xxx → --session …      (legacy) opencode-DB activity stream
//   ?list=1          → --list           (legacy) opencode-DB cell matrix
import { execFileSync } from 'node:child_process';

const SID_RE = /^ses_[A-Za-z0-9]+$/;
const NAME_RE = /^[A-Za-z0-9_.:-]{1,80}$/;   // tmux session name

export function registerBenchLive(app, { script, mountPath = '/api/bench-live' }) {
  app.get(mountPath, (req, res) => {
    const send = (code, body) =>
      res.status(code).set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).send(body);
    try {
      const { session, pane, list, prefix } = req.query;
      let args;
      if (session) {
        if (typeof session !== 'string' || !SID_RE.test(session)) return send(400, '{"error":"bad session id"}');
        const page = String(Math.max(0, parseInt(req.query.page || '0', 10) || 0));
        const size = String(Math.min(400, Math.max(1, parseInt(req.query.size || '40', 10) || 40)));
        args = [script, '--session', session, '--page', page, '--size', size];
        if (req.query.tail === '1') args.push('--tail');
      } else if (pane) {
        if (typeof pane !== 'string' || !NAME_RE.test(pane)) return send(400, '{"error":"bad session name"}');
        args = [script, '--pane', pane, '--lines', '200'];
      } else if (list) {
        args = [script, '--list'];
      } else {
        args = [script, '--live'];
        if (typeof prefix === 'string' && NAME_RE.test(prefix)) args.push('--prefix', prefix);
      }
      const out = execFileSync('python3', args, { encoding: 'utf-8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
      return send(200, out);
    } catch (e) {
      return send(500, JSON.stringify({ error: String(e?.message || e) }));
    }
  });
}
