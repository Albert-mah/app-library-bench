// app-library-bench — standalone server.
// Serves the React SPA (app/dist) + static web assets (prototypes / data / images /
// legacy pages) + the dynamic JSON APIs (scores, bench-live, runs). Zero Astro coupling.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerScores } from './scores.mjs';
import { registerBenchLive } from './bench-live.mjs';
import { registerRuns } from './runs.mjs';
import { registerPrototypes } from './prototypes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = parseInt(process.env.PORT || '8080', 10);
const WEB_DIR = process.env.WEB_DIR || path.join(ROOT, 'web');
const SCORES_FILE = process.env.SCORES_FILE || path.join(WEB_DIR, 'user-scores.json');
const BENCH_LIVE_SCRIPT = process.env.BENCH_LIVE_SCRIPT || path.join(ROOT, 'tooling', 'bench', 'bench-live.py');
const RUNS_DIR = process.env.RUNS_DIR || path.join(ROOT, 'tooling', 'bench', 'runs');
const SPA_DIR = process.env.SPA_DIR || path.join(ROOT, 'app', 'dist');
const SPA_INDEX = path.join(SPA_DIR, 'index.html');
const HAS_SPA = fs.existsSync(SPA_INDEX);

const app = express();
app.use(express.json({ limit: '2mb' }));

// dynamic API (same origin as the static site, so the frontend's relative /api/* fetches just work)
registerScores(app, { file: SCORES_FILE });
registerBenchLive(app, { script: BENCH_LIVE_SCRIPT });
registerRuns(app, { dir: RUNS_DIR });
registerPrototypes(app, { file: path.join(WEB_DIR, 'prototypes.json'), webDir: WEB_DIR });
// run result artifacts (any modality: image / html / text / code / file)
app.use('/runs-artifacts', express.static(path.join(RUNS_DIR, 'artifacts'), { maxAge: '1h' }));
app.use('/runs-shots', express.static(path.join(RUNS_DIR, 'shots'), { maxAge: '1h' })); // legacy

// static assets: prototypes (NN-*.html), data (library.json…), images (thumbs/bench/…),
// and the legacy pages under /legacy/*. extensions:['html'] lets /30-foo resolve to .html.
app.use(express.static(WEB_DIR, { extensions: ['html'], maxAge: '1h' }));

// the React SPA + client-side-routing fallback (built to app/dist)
if (HAS_SPA) {
  app.use(express.static(SPA_DIR, { maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(SPA_INDEX);
  });
}

app.listen(PORT, () => {
  console.log(`app-library-bench → http://localhost:${PORT}`);
  console.log(`  SPA           ${HAS_SPA ? SPA_DIR : '(not built — run: cd app && npm run build)'}`);
  console.log(`  web/static    ${WEB_DIR}`);
  console.log(`  scores file   ${SCORES_FILE}`);
});
