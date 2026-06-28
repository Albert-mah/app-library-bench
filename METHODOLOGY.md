# Methodology — how an experiment is run and judged

This is the **protocol** that makes results here comparable and reproducible. AGENTS.md says
*how to drive the tooling*; this says *what makes a result trustworthy*. If you publish or
compare numbers from this repo, follow it — and read "Threats to validity" before believing
any single score.

## 1. Unit of analysis

- **Subject** — a prototype (an app/spec in `web/`, catalogued in `web/library.json`). What we
  try to reproduce. Multimodal: `kind ∈ html|prompt|info|composite`, `category ∈ build|experiment|other`.
- **Run** — one CLI session attempting one subject into one target (env), under one model.
  The atomic data point. Archived in `tooling/bench/runs/` with prompt/tokens/rounds/errors/transcript.
- **Batch** — a set of runs sharing a subject + prompt, varying one factor (usually model). The
  comparison unit.
- **Review** — a verdict on a run: AI self-review (a *claim*) + human verdict (the *truth of record*).

## 2. Validity rules (the protocol)

A run only counts toward a comparison if these hold. Each maps to a gap we either **enforce in
code** or leave to **operator discipline** (marked).

1. **Controlled start.** Every run in a batch starts from the *same* known baseline — a golden
   `reset.from` backup of the target env. Different starting states ⇒ not comparable.
   *Discipline (set `reset` per run); the reset baseline path is recorded in the run config.*
2. **Prompt parity.** Cross-model comparison requires the *same prompt* — same file, same
   `sha256` (recorded on every record under `prompt.sha256`). If the prompt differs, it's a
   different experiment, not a fairer model. *Enforced: sha recorded; check it matches across a batch.*
3. **Difficulty normalization.** A model that only attempted easy subjects is not "better".
   Compare within a difficulty/scale tier (≈ #collections + #pages + #signature regions), not
   across the whole library. *Discipline / TODO: a `difficulty` field on subjects.*
4. **Intervention accounting.** The supervisor's nudges and auto-approvals change outcomes. Each
   run records `interventions{nudges, autoApprovals, assisted}`. An `assisted:true` run is **not**
   comparable to an unassisted one in a "can the model do it alone?" claim — segment by it.
   *Enforced: `monitor` logs every action → `collect` merges it into the record.*
5. **Evidence required.** A result is not reviewable without a visual. Every result carries a
   screenshot, or an HTML description that is auto-screenshotted into one. The transcript +
   error samples are kept as provenance. *Enforced: result-media spec + `attach`.*
6. **Independent review.** The builder must not be the sole judge. AI *self-score* (`outcome.selfScore`)
   is a **claim by the builder** — capture it, don't trust it. The scoring verdict should come from
   an independent model (`ai-review`, ideally a different model than the builder) and/or a human.
   *Discipline: run `ai-review` with a non-builder model; human verdict overrides.*
7. **Status honesty.** `outcome.status` is a regex guess (`statusSource:"heuristic"`): "done" means
   the agent *printed* a final report, not that the app was *verified to exist*. Truth = the human
   verdict, ideally backed by querying the target env for the claimed collections/pages.
   *Enforced: status flagged heuristic. TODO: an optional post-run env verifier.*
8. **No leakage.** Public demo seed data is all-English and synthetic; credentials are redacted at
   ingest (api keys, JWTs, ids, passwords, `~`-scrubbed home paths). *Enforced: `redact()`.*

## 3. Metrics — how to read results

- **Pass rate** — fraction of runs a human marked `pass`, *within a difficulty tier and assisted
  segment*. The headline number; meaningless without those two qualifiers.
- **Reliability** — for a repeated (subject × model) cell, the pass-rate / verdict variance across
  N runs. The example config's "consistency check" is exactly this; one green run is not reliability.
- **Fidelity** — `outcome.selfScore` (builder's claim) vs the human/independent score (the check).
  Report the gap; a large self-vs-verified gap is itself a finding.
- **Cost** — tokens (in/out/reasoning/cache) and wall-clock duration per run; normalize per
  passed run for an economics view.
- **Assisted rate** — share of runs that needed a nudge to finish. A capability signal, not noise.

## 4. Threats to validity (read before trusting a number)

- **Self-review bias.** A model judging its own build skews high. Mitigate with an independent
  reviewer; never publish self-score as the result.
- **Heuristic outcome.** "done"/"unknown" is text-pattern only; ~half of historical runs are
  "unknown" yet completed. Don't aggregate on `status` — aggregate on reviewed verdicts.
- **Small N.** Most cells have 1 run. Treat per-cell results as anecdotes until repeated.
- **Prototype drift.** If a subject's HTML changes, older runs' fidelity claims are against a
  different target. *TODO: subject content hash + record the version a run targeted.*
- **Supervisor contamination.** Heavy nudging can carry a weak model to "done"; always segment by
  `assisted`.
- **Single environment.** Results are NocoBase-version- and instance-specific; state the env/version.

## 5. Enforced vs. roadmap

| Rule | State |
|---|---|
| Prompt sha recorded · intervention accounting · evidence required · redaction · status-source flag · self-score captured | ✅ in code |
| Controlled start · prompt-parity check · independent-reviewer choice | 🟡 operator discipline |
| Difficulty field · post-run env verifier · subject content-hash/versioning · coverage & reliability views · matrix dispatch generator | ⬜ roadmap |

## See also

- [AGENTS.md](./AGENTS.md) — operating manual (drive / supervise / collect / review).
- [README.md](./README.md) — what the platform is + how to run it.
