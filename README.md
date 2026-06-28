# app-library-bench · AI Build Pipeline

A self-contained platform for **observing and recording AI-assisted build experiments** —
a prototype **gallery**, a **review center**, and a **benchmarking pipeline**. It hosts
~90 prototype subjects (HTML mockups, prompt specs, info docs), tracks how faithfully
different models/prompts reproduce them in [NocoBase](https://www.nocobase.com/), and lets
a human score every run.

Each experiment subject is **HTML-backed** (a prompt/spec/info subject is rendered into a
standalone doc and **auto-screenshotted into a cover image**), runs flow through a
`测试中 → 待审核 → 已审核` status model, and every model run is archived with full
prompt/tokens/transcript so the build pipeline is fully traceable.

Extracted from a larger Astro site into a standalone Node app so it can be run, shared,
and open-sourced on its own.

```bash
npm install               # server deps
npm run build:ui          # build the React SPA (app/) → app/dist
npm start                 # → http://localhost:8080
```

The frontend is a **React + Vite SPA** in `app/` (one unified shell + top nav, no iframes);
the Express server serves its build (`app/dist`) plus the static assets (prototypes,
`library.json`, images) and the JSON APIs, with a catch-all that falls back to the SPA for
client-side routing. Routes (all native React): `/` gallery · `/experiments` overview ·
`/tests` test center · `/runs` run history · `/live` bench live · `/dashboard`.
Dev: `npm run dev:ui`.

- **Gallery** — `/` — the prototype library; create a subject (html / prompt / info /
  composite) and it's HTML-backed + auto-covered. Click → full-screen prototype with an
  embedded info sidebar.
- **Experiments** — `/experiments` — unified overview: subject → test lines/rounds →
  associated runs → review status, cross-filterable.
- **Test center** — `/tests` — per-subject reproduction reports: model/flow branches,
  rounds, AI + human scores, side-by-side compare images, result media, and a detail modal
  that traces the whole line (rounds timeline, related runs + transcript, review box).
- **Run history** — `/runs` — every model run as a sortable/tree table → detail drawer.
- **Live bench** — `/live` — real-time view of an in-progress model run (reads the local
  opencode session DB).
- **Dashboard** — `/dashboard` — build-pipeline analytics with live filters.

## How it fits together

```
app-library-bench/
├── app/                    # the frontend — React + Vite + TS SPA
│   ├── src/pages/          #   Gallery · Experiments · TestReport · Runs · BenchLive · Dashboard
│   ├── src/{App,lib,styles}
│   └── dist/               #   build output served by the server (gitignored)
├── server/                 # tiny Express server (the only "backend")
│   ├── index.mjs           #   static web/ + app/dist SPA + JSON APIs + SPA fallback
│   ├── scores.mjs          #   GET/POST /api/app-library-scores   → web/user-scores.json
│   ├── prototypes.mjs      #   CRUD /api/prototypes (HTML-backed + auto cover) + /api/shot
│   ├── test-results.mjs    #   GET/POST /api/test-results (result media → auto cover)
│   ├── runs.mjs            #   GET /api/runs[/:id] + POST review  (reads runs/)
│   └── bench-live.mjs      #   GET /api/bench-live → shells to tooling/bench/bench-live.py
├── web/                    # static assets served as-is
│   ├── library.json        #   SINGLE SOURCE OF TRUTH: ~90 modules × branches × rounds
│   ├── prototypes.json     #   user-created subjects (gitignored)
│   ├── user-scores.json    #   human scores · test-results.json · build-audit.json
│   ├── 01-*.html … 2xx-*.html              # prototype subjects (HTML)
│   └── thumbs/ · results/ · bench/ · acceptance-*/   # cover / result / compare images
├── tooling/
│   ├── validate-library.py # `npm run validate` — checks library.json vs schema + assets
│   ├── library.schema.json
│   └── bench/              # the model×flow run harness (see below)
└── scripts/                # optional Feishu/Lark status push
```

## Data model — `web/library.json`

The whole system is driven by one file. Each **subject** (module) has `branches`
(e.g. `main`, `blind`, `bench-*`) — each branch is one **test line** (model/flow); each
branch has `rounds` (`r1`, `r2`, …), and each round carries an image, AI reasoning/score,
a human verdict/score, and (optionally) the exact prompt used. A subject also carries its
`kind` (`html` / `prompt` / `info` / `composite`), `category` (`build` / `experiment` /
`other`), `goal` / `background` / `successCriteria`, and a status derived per round:
**测试中** (no result) → **待审核** (a result image/HTML exists, awaiting a human) →
**已审核** (human verdict). `npm run validate` enforces the shape against
`tooling/library.schema.json` and checks every referenced asset exists.

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

Each launch is a detached **tmux** session running a CLI's TUI, fed the task prompt. *How*
that TUI is created is layered: the **per-CLI** mechanics (start command, ready pattern,
model selection) live in each adapter's `launch()`; the **per-experiment-type** method is a
named **recipe** a run references — `nocobase-build` (the built-in NocoBase reproduction
method: read the repro skill → SPEC → model in one pass → English seed → list pages →
signature regions → visual self-check) or `generic`. A run picks one via its `recipe` field
(or `type: build` → `nocobase-build`); the recipe supplies the cli/cwd/ready-timeout, the
instruction template (`{promptFile}`/`{env}`/`{model}` filled per run), and the supervisor's
watch-for + nudge defaults. Built-ins are in `bench.py` `DEFAULT_RECIPES`; add or override
them under `recipes` in the config — so every build of a given type reuses one launch method.

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

**Review — AI self-review + human verdict.** The run-history page (`/runs`) is the
inspect → verify → score surface: a sortable/filterable table (or a **tree** grouped by
batch, iterations nested under their parent) → click a run → drawer with its
**screenshots** (build-result evidence — for a build test the image *is* the result),
metadata, error samples, prompt, and transcript. Each run can be scored by a human
(`pass`/`fix`/`redo` + 0–10 + note → `reviews.json`); `bench.py ai-review` pre-fills an
**AI self-assessment** (`ai-reviews.json`) that the human can **adopt in one click** then
tweak. Attach result images with `bench.py attach --only <id> --files a.png,b.png`
(stored in `screenshots.json` + `runs/shots/`, so they survive a re-collect).

**Retry = a child run.** `bench.py retry --only <id> [--note "fix X"]` launches a new run
as an *iteration* of an existing one (`parent`/`depth+1`), so the lineage grows into the
tree: prototype → batch → run → iteration → …

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
