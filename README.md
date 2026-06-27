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

**One entry, fully config-driven** — `bench.py`, parameterized by a JSON config
(copy `bench.config.example.json` → `bench.config.json`). Each `run` = one model
building into one NocoBase env from one prompt:

```bash
cp tooling/bench/bench.config.example.json tooling/bench/bench.config.json   # edit runs
npm run bench            # reset env (optional) → launch each opencode TUI → send its prompt
npm run bench:status     # one-shot state of every run
npm run bench:monitor    # the supervisor (see below)
npm run bench:summary    # tokens / rounds / duration per cell (reads the opencode db)
npm run bench:stop       # kill the tmux sessions
```

**The supervisor** (`bench:monitor`) is how runs get driven to completion without a
human babysitting — you pick who watches via `--judge`:

| `--judge` | who decides | behavior |
|---|---|---|
| `llm` | the gateway model | autonomous: classifies each pane (working / stalled / permission / done) and **auto-nudges** genuinely-stuck cells. Run it as a loop = a dedicated watchdog. |
| `agent` | the main AI (you) | prints the classification + a *suggested* nudge but **does not act** — meant to be read each pass (`--once`) by an overseeing agent/human who decides. |
| `heuristic` | timing/keywords | no LLM calls; cheap, weaker at "stalled vs still thinking". |
| `heuristic+llm` | both (default) | heuristic fast-path, LLM only for the ambiguous "is it stuck?" call. |

**Run records & history** — `bench.py collect` pulls each run's full detail out of the
CLI's own store into a persistent, CLI-agnostic record under `runs/` (the source DB is
ephemeral — this is the durable archive):

```bash
npm run bench:collect              # ingest the configured runs
npm run bench:collect -- --all     # discover + ingest ALL historical sessions
```

Each record carries **prompt (+ sha), model, provider, target env, tags, timing
(start/end/duration), tokens (in/out/reasoning/cache), rounds, tool calls, error
count + samples, outcome, and the full transcript** (`runs/transcripts/<id>.json`).
Credentials are scrubbed at ingest. `runs/index.json` is the rollup.

**CLI adapters** (`adapters.py`) are how that ingest stays CLI-agnostic: each adapter
**normalizes one CLI's stored run data** into the common record — `opencode` (reads
`opencode.db`) and `claude` (reads `~/.claude/projects/*.jsonl`) ship; add more by
implementing `extract()`.

**Driver → supervisor handoff** — on `bench run`, each launch also emits a *brief*
(`runs/briefs/<id>.json`) and a combined `runs/supervise.json`: the prompt, goal,
success criteria, tmux session, and how-to-inspect/nudge/collect — a one-click context
packet an inspector agent reads to drive + watch the runs. Regenerate anytime with
`npm run bench:brief`.

Supporting pieces: `bench-live.py` (db → cell association, powers `/api/bench-live`),
`bench-summary.py` (aggregation), and the older `run-bench.sh` / `tui-round.sh` /
`observer.sh` (superseded by `bench.py`, kept for reference).

> **This harness is environment-specific.** It expects a local `opencode`, the `nb`
> NocoBase CLI with configured instances, and `tmux`. It is provided as-is; the **web
> app above runs without any of it**. Configure via `.env` + `bench.config.json`.

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
