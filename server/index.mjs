// app-library-bench — standalone server.
// Serves the static web/ frontend and the two dynamic endpoints
// (user scores + opencode bench-live), with zero coupling to Astro.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerScores } from './scores.mjs';
import { registerBenchLive } from './bench-live.mjs';
import { registerRuns } from './runs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = parseInt(process.env.PORT || '8080', 10);
const WEB_DIR = process.env.WEB_DIR || path.join(ROOT, 'web');
const SCORES_FILE = process.env.SCORES_FILE || path.join(WEB_DIR, 'user-scores.json');
const BENCH_LIVE_SCRIPT = process.env.BENCH_LIVE_SCRIPT || path.join(ROOT, 'tooling', 'bench', 'bench-live.py');
const RUNS_DIR = process.env.RUNS_DIR || path.join(ROOT, 'tooling', 'bench', 'runs');

const app = express();
app.use(express.json({ limit: '2mb' }));

// dynamic API (same origin as the static site, so the frontend's relative /api/* fetches just work)
registerScores(app, { file: SCORES_FILE });
registerBenchLive(app, { script: BENCH_LIVE_SCRIPT });
registerRuns(app, { dir: RUNS_DIR });

// static frontend — index.html is the gallery; test-report.html / bench-live.html / prototypes are siblings
app.use(express.static(WEB_DIR, { extensions: ['html'], maxAge: '1h' }));

app.listen(PORT, () => {
  console.log(`app-library-bench → http://localhost:${PORT}`);
  console.log(`  gallery       /index.html`);
  console.log(`  test center   /test-report.html`);
  console.log(`  bench live    /bench-live.html`);
  console.log(`  web dir       ${WEB_DIR}`);
  console.log(`  scores file   ${SCORES_FILE}`);
});
