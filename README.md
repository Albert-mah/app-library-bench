# app-library-bench

A self-contained **gallery + review center + benchmarking pipeline** for AI-reproduced
business apps. It showcases ~60 prototype apps, tracks how faithfully different
models/prompts reproduce them in [NocoBase](https://www.nocobase.com/), and lets a
human score every run.

Extracted from a larger Astro site into a standalone Node app so it can be run, shared,
and open-sourced on its own.

```bash
npm install
npm start                 # → http://localhost:8080
```

- **Gallery** — `/index.html` — the prototype app library.
- **Test center** — `/test-report.html` — per-module reproduction reports: model/flow
  branches, rounds, AI + human scores, side-by-side compare images.
- **Live bench** — `/bench-live.html` — real-time view of an in-progress model run
  (reads the local opencode session DB).

## How it fits together

```
app-library-bench/
├── server/                 # tiny Express server (the only "backend")
│   ├── index.mjs           #   static web/ + two JSON endpoints
│   ├── scores.mjs          #   GET/POST /api/app-library-scores  → web/user-scores.json
│   └── bench-live.mjs      #   GET /api/bench-live  → shells to tooling/bench/bench-live.py
├── web/                    # the frontend — plain HTML/JS, no build step
│   ├── index.html · test-report.html · bench-live.html · dashboard.html
│   ├── library.json        #   SINGLE SOURCE OF TRUTH: 94 modules × branches × rounds
│   ├── user-scores.json    #   human scores (written by the scores endpoint)
│   ├── build-audit.json
│   ├── 01-*.html … 59-*.html, 201-*.html   # the prototype apps
│   └── thumbs/ · bench/ · acceptance-*/     # compare/result screenshots
├── tooling/
│   ├── validate-library.py # `npm run validate` — checks library.json vs schema + assets
│   ├── library.schema.json
│   └── bench/              # the model×flow run harness (see below)
└── scripts/                # optional Feishu/Lark status push
```

The frontend is intentionally still **vanilla HTML/JS** (the test center is a single
self-contained page). Everything it needs is a static file or one of the two `/api`
endpoints — no framework, no bundler.

## Data model — `web/library.json`

The whole system is driven by one file. Each **module** has `branches` (e.g. `main`,
`blind`, `bench-*`), each branch has `rounds` (`r1`, `r2`, …), and each round carries an
image, AI reasoning/score, a human verdict/score, and (optionally) the exact prompt used.
`npm run validate` enforces its shape against `tooling/library.schema.json` and checks
every referenced asset exists.

## The bench pipeline — `tooling/bench/`

Drives non-Claude models (via an OpenAI-compatible gateway such as
[OpenCode Zen](https://opencode.ai)) through [opencode](https://opencode.ai) to
reproduce the prototypes in real NocoBase instances, then feeds results back into the
test center.

- `bench-live.py` — reads the opencode SQLite DB, auto-associates each session to a
  matrix cell; powers `/api/bench-live`.
- `bench-summary.py` — per-cell tokens / duration / rounds, aggregated by model & flow.
- `run-bench.sh` / `tui-round.sh` — launch matrix cells (one per `matrix.json` row).
- `observer.sh` / `bench-watch.sh` — judgment-style watchdogs that nudge stalled runs.

> **This harness is environment-specific.** It expects a local `opencode`, the `nb`
> NocoBase CLI with configured instances, and `tmux`. It is provided as-is; the **web
> app above runs without any of it**. Configure via `.env` (copy `.env.example`).

## Configuration

All secrets and machine paths are externalized — copy `.env.example` to `.env`:

| var | what |
|---|---|
| `PORT` | server port (default 8080) |
| `OPENCODE_DB` | opencode SQLite db the live viewer reads |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI-compatible gateway for the bench |
| `FEISHU_OPEN_ID` | Lark user id for the optional status push |

Nothing sensitive is committed (`.env`, `*.log`, and per-run bench artifacts are gitignored).

## License

MIT — see [LICENSE](./LICENSE).
