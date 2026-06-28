# AGENTS.md — operating manual

This file is the entry point for an **AI agent** working in this repo. Read it and you can
run the whole thing — dispatch experiments, supervise them, ingest results, review/score,
and iterate — without any outside context. (Humans: see [README.md](./README.md).)

---

## 1. What this system is

A closed loop for **reproducing business-app prototypes with AI and judging how well it
went**. The unit of truth is a *prototype* (an app in `web/`, catalogued in
`web/library.json`). You dispatch attempts at reproducing it, watch them, capture rich
records, let AI pre-judge, and a human confirms — retrying as needed.

### The lifecycle (and where each stage lives)

```
prototype ─┬─ batch (a dispatch: model × flow × N instances)
           │     └─ run (one CLI building into one target)        bench.py run
           │           └─ iteration / retry (child run)           bench.py retry
           │
   supervise (drive stalled runs to done)                          bench.py monitor
   collect  (ingest rich run record from the CLI's store)          bench.py collect
   ai-review (LLM pre-scores each run)                              bench.py ai-review
   human review (confirm/adopt: pass/fix/redo + score + note)      web/runs.html
   artifacts (attach result evidence: image/html/text/file)        bench.py attach
   pass ──→ (roadmap) write back to the test center / library
```

This is a **tree**: one prototype → many batches → many runs → iterations of runs. Every
record carries `lineage{prototype, batch, parent, depth}`; the run-history page renders it
as a tree. Human review is **continuous and partial** — review any node any time; AI
self-review gives you a starting verdict to adopt or override.

---

## 2. Layout

```
server/        Express: static web/ + JSON APIs (the only backend)
  scores.mjs       /api/app-library-scores   (test-center per-module human scores)
  bench-live.mjs   /api/bench-live           (live opencode session view)
  runs.mjs         /api/runs[/:id], /api/runs/:id/review  (run archive + review)
web/           vanilla frontend (no build step)
  index.html · test-report.html · bench-live.html · runs.html · dashboard.html
  library.json     SoT: modules × branches × rounds (the catalogue + test reports)
  <NN>-*.html      the prototype apps (33 embed a <script type="application/nb-spec+json">
                   authoritative spec: collections/fields/enums + region→block map — honor it)
tooling/
  validate-library.py        `npm run validate`
  bench/
    bench.py                 ⭐ the pipeline — one entry, all subcommands
    adapters.py              CLI-agnostic INGEST (opencode / claude); add more via extract()
    bench.config.json        your config (copy from .example); gitignored
    prompts/                 task prompts a run executes
    runs/                    the durable archive (opencode.db is ephemeral — this isn't)
      index.json             rollup of every collected run
      transcripts/<id>.json  full record + transcript (prompt/tokens/rounds/errors/turns)
      reviews.json           human verdict/score/note per run
      ai-reviews.json        AI self-assessment per run
      artifacts.json         result artifacts per run (kind: image|html|text|file)
      artifacts/<id>/        the artifact files (served at /runs-artifacts/<id>/<name>)
      briefs/ + supervise.json   per-launch context packets (gitignored, regenerated)
```

Config + secrets are env-driven (`.env`, copy `.env.example`). **Never commit credentials**
— ingest auto-redacts api keys / JWTs / ids; keep it that way.

---

## 3. Run the pipeline (commands)

```bash
npm install && npm start                 # the web app (gallery / test center / run history)

# experiment
cp tooling/bench/bench.config.example.json tooling/bench/bench.config.json   # edit `runs`
npm run bench                            # reset(opt) → launch each run's CLI (tmux) → send its prompt
npm run bench:status                     # one-shot state of every run
npm run bench:monitor                    # supervisor loop (see §4)
npm run bench:collect -- --all           # ingest run records (--all = discover history too)
npm run bench:ai-review                  # AI pre-score the runs
npm run bench:retry -- --only <id> --note "fix X"   # child run (iteration)
npm run bench:attach -- --only <id> --files a.png,out.html,log.txt   # result artifacts
npm run bench:summary                    # tokens/rounds/duration per cell
npm run bench:stop                       # kill tmux sessions
```

A `run` in config = `{ id, env, cli, model, promptFile, reset?, tags?, goal?, successCriteria?, watchFor?, batch?, prototype?, parent? }`.

---

## 4. Supervisor protocol (driving runs to done)

A run is an autonomous CLI session in a tmux pane. Your job as supervisor: keep the
genuinely-stuck ones moving, do nothing to the healthy ones.

- `bench.py run` emits **`runs/supervise.json`** + per-run **`runs/briefs/<id>.json`**:
  prompt, goal, success criteria, the tmux session name, and how-to inspect/nudge/collect.
  **Read these first** — they are your context for every run.
- `bench.py monitor --judge <mode>`:
  - `agent` — prints a per-pass classification (`working|stalled|permission|done`) **for you
    to act on**; pair with `--once` and run it each turn. This is the "you (the main AI) are
    the supervisor" mode.
  - `llm` — fully autonomous: the gateway model classifies and auto-nudges. Run as a loop = a
    dedicated watchdog.
  - `heuristic+llm` (default) — heuristic fast-path, LLM only for the ambiguous "is it stuck?".
- **Judge by reading the pane, not by regex.** A spinner / fresh output = working (leave it).
  Long idle + no spinner + repeating itself = stalled → one concrete nudge. An Allow/approve
  prompt = a keypress. A final report = done → `collect` it.
- Respect cooldown + max-nudges; a run that keeps stalling after N nudges needs a human.

---

## 5. Review protocol (judge a run)

1. `bench.py ai-review` writes an AI verdict/score/comment per run (`ai-reviews.json`).
2. Open `web/runs.html` → a run → the drawer shows **artifacts first** (for a build test the
   screenshot *is* the result; other runs may show an html snippet, text output, or a file),
   then metadata / errors / prompt / transcript, then the review box.
3. The **🤖 AI self-review** box has **采纳 (adopt)** — one click fills the human form; edit
   and **save** (`pass`/`fix`/`redo` + 0–10 + note → `reviews.json` via `POST /api/runs/:id/review`).
4. `fix`/`redo` → `bench.py retry --only <id> --note "<what to fix>"` spawns a child run; the
   tree grows; re-collect + re-review the child.

---

## 6. Methodology & findings (baked in — these are *our* hard-won lessons)

- **Prompt-planning quality > model tier.** Vague prompts ("a dashboard") make any model
  stack plain tables; a clear per-page "use this native block" plan makes mid models build
  complete apps. Spend effort on the prompt, not on chasing a bigger model.
- **`nb` CLI is topic-based**, not `<resource>:<action>`. `nb api collections:list` / `…:get` /
  `ai:listModels` return "command not found". Use `nb api resource list|get|create|update`,
  `nb api data-modeling …`, `nb api workflow …`, `nb api flow-surfaces …`; for plugin actions
  with no topic (AI/LLM), curl the gateway directly.
- **Reproducible NocoBase build gotchas** (pre-load these into prompts):
  - belongsTo named `*_id` → beta rejects it (`Naming collision`). Name relations as nouns.
  - Drawer sub-table `fieldGroups` validation loops when a popup has >10 / ≤10 fields — the
    boundary flip-flops; skip prepare-write or drop fieldGroups for ≤10-field popups.
  - kanban main block ≤ 2 fields; `defaultFilter` can't use relation fields; layout.rows must
    only reference defined block keys.
  - qwen's JS-contract execution is the fidelity ceiling — it builds native fine but stalls
    wiring custom JS via flow-surfaces. AI-employee shortcut containers aren't expressible via
    `add-action`; fall back to raw `flowModels:save` (never `flowModels:update` — it wipes parentId).
- **OpenCode Zen gateway** (`https://opencode.ai/zen/go/v1`, OpenAI-compatible) **403s
  non-client User-Agents** — send `User-Agent: opencode/...`. `zen/v1` (non-go) → CreditsError;
  `zen/go/v1` → a 5-hour usage cap.
- **Ingest is normalization, not driving.** Adapters read a CLI's own store and emit the
  common record; that's why opencode and claude (and the next CLI) all land in one schema.
- **Everything is first-class evidence.** Results are multimodal — image, html snippet, text,
  file. The run drawer renders each by `kind`. "Screenshot is primary" is only true for the
  build-test prototype; don't hard-code it.

---

## 7. Conventions

- Data writes go through the APIs / `bench.py`, not by hand-editing `runs/*.json` mid-flight.
- `library.json` is the catalogue SoT — `npm run validate` must pass after touching it.
- Keep prompts in `tooling/bench/prompts/`; keep secrets in `.env`; keep `runs/index.json` +
  `transcripts/` + reviews/ai-reviews/artifacts as the committed archive.
- New CLI? Add an adapter in `adapters.py` (implement `extract()`, optionally `launch()`).

---

## 8. Experiment model & media spec (platform direction)

This is evolving into a **general AI-assisted experiment pipeline platform**. The first-class
concept is an **experiment**, converged across what used to be "test center" (build-repro) and
"runs" (bench):

```
subject (prototype: kind+content, dataType, category, tags)
   └─ batch / test line          (a dispatch — model × flow, or a review branch)
        └─ run                    (one CLI build/exec → record: prompt/time/rounds/errors/chat/artifacts)
             └─ review            (AI self-review + human verdict/score/note)
```

- **Subject (prototype)** is multimodal: `kind ∈ html | prompt | info | composite` + `content`;
  classified by `dataType` (html / prompt+材料) and `category` (build 搭建 / experiment 实验 / other).
- **/experiments** is the cross-scenario overview (subject → lines → runs → review, with status).
- **Cross-links everywhere**: gallery → /tests?mod=N, run detail ↔ prototype, test modal → run chat.

### Media spec — HTML-backed, auto cover (REQUIRED)
- **Every prototype is HTML-backed.** `html` kind supplies the html; `prompt/info/composite` are
  rendered into a standalone html doc at create time (`server/prototypes.mjs#renderHtml`). So a
  prototype always has `/<slug>.html`.
- **Cover image is auto-generated from that html** via a headless screenshot
  (`npx playwright screenshot` → `web/thumbs/<num>.jpg`), fired non-blocking on create; regenerate
  via `POST /api/shot {slug,num}`. This is how a prompt-only subject (e.g. #202) gets a cover.
- **A result must carry an image.** If a run/result has no screenshot, it MUST provide an HTML
  description instead — which the same screenshot step converts to a cover image, and which the
  test detail also renders inline (so "what happened" is always visible, image or html).
- Rationale: uniform visual review across modalities; nothing is reviewable without a visual.

### Roadmap note — create → dispatch (A3, not yet built)
Wiring "create an experiment → one-click dispatch a bench run" needs existing local
resources, so it's planned, not auto-run:
- prereqs for an nb-build experiment: `nb` CLI installed, nocobase skills installed, local Docker.
- design: a subject (prompt/plan) + a target (env + cli + model) → write a `bench.config.json`
  run entry → `bench.py run --only <id>` (or a `/api/dispatch` that shells it). The subject's
  `goal`/`successCriteria`/`background` feed the run brief; results flow back via collect → review.
- keep it explicit (a "派发" button that previews the command) — never auto-launch builds from the UI
  without the operator confirming the target env.
