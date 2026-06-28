#!/usr/bin/env python3
"""
Config-driven bench pipeline — one entry, parameterized by a JSON config.

  bench.py run      [--config bench.config.json] [--only id1,id2]   # reset? -> launch TUI -> send prompt
  bench.py status   [--config ...]                                  # one-shot state of every run
  bench.py monitor  [--config ...] [--once] [--judge heuristic|llm|agent]
  bench.py summary  [--config ...]                                  # tokens/rounds per cell (reads opencode db)
  bench.py stop     [--config ...] [--only ...]                     # kill tmux sessions + opencode

Supervisor (`monitor`) covers both options you can pick in config/flags:
  --judge llm    : fully autonomous — asks the LLM gateway "working/stalled/done/permission?"
                   and auto-nudges genuinely-stalled cells. Run it as a loop = a dedicated watchdog.
  --judge agent  : prints classification + a suggested nudge but does NOT act — for the main AI
                   (you) to read each pass (`--once`) and decide.
  --judge heuristic : timing/keyword only, no LLM (cheap, less reliable on "stalled vs thinking").
"""
import argparse, json, os, re, subprocess, sys, time, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- config
def expand(p):
    return os.path.expanduser(os.path.expandvars(p)) if isinstance(p, str) else p

def load_config(path):
    path = expand(path)
    if not os.path.exists(path):
        sys.exit(f"config not found: {path}  (copy tooling/bench/bench.config.example.json)")
    with open(path) as f:
        cfg = json.load(f)
    cfg.setdefault("runCwd", "~")
    cfg.setdefault("opencodeConfig", "~/.config/opencode/opencode.json")
    cfg.setdefault("opencodeDb", "~/.local/share/opencode/opencode.db")
    cfg.setdefault("sessionPrefix", "bench")
    cfg.setdefault("monitor", {})
    m = cfg["monitor"]
    m.setdefault("intervalSec", 60)
    m.setdefault("stallSec", 300)
    m.setdefault("judge", "heuristic+llm")
    m.setdefault("judgeModel", "qwen3.7-plus")
    m.setdefault("maxNudgesPerSession", 3)
    m.setdefault("nudgeCooldownSec", 200)
    m.setdefault("defaultNudge", "Continue. If you are blocked, state the exact blocker, then proceed autonomously.")
    cfg.setdefault("gateway", {})
    cfg["gateway"].setdefault("baseURL", os.environ.get("LLM_BASE_URL", "https://opencode.ai/zen/go/v1"))
    cfg["gateway"].setdefault("apiKeyEnv", "LLM_API_KEY")
    cfg["_path"] = path
    return cfg

def run_session_name(cfg, run):
    p = cfg.get("sessionPrefix", "")
    return f'{p}-{run["id"]}' if p else run["id"]

def state_file(cfg):
    return os.path.join(HERE, ".bench-state.json")

def load_state(cfg):
    p = state_file(cfg)
    try:
        with open(p) as f: return json.load(f)
    except Exception:
        return {}

def save_state(cfg, st):
    with open(state_file(cfg), "w") as f: json.dump(st, f, indent=1)

# shared tmux helpers + CLI adapters. Launch is opencode-centric; the adapters'
# main job is INGEST — normalizing each CLI's stored run data (time/rounds/errors/
# prompt/tokens/transcript) into one common run-record. See adapters.py + `collect`.
from adapters import tmux, session_exists, pane, send, wait_for, get_adapter, redact, ADAPTERS

# ---------------------------------------------------------------- nb golden reset
def reset_env(run):
    r = run.get("reset")
    if not r: return
    bf = expand(r["from"]); env = run["env"]
    print(f"  reset {env} <- {bf}")
    cmd = ["nb", "backup", "restore", "-f", bf, "-e", env, "-y", "--force"]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=r.get("timeoutSec", 600))
    if res.returncode != 0:
        print(f"  ! reset failed: {(res.stderr or res.stdout)[-200:]}")

# ---------------------------------------------------------------- dispatch recipes
# A *recipe* is a reusable launch method keyed by experiment type. It decides which CLI to use,
# the cwd, the TUI-ready timeout, the instruction sent into the pane, and the supervisor's
# watch-for / nudge defaults. The per-CLI TUI *creation* stays in the adapters (launch/start_cmd);
# a recipe sits above them and is what runs of a given type all REFERENCE (run.recipe or run.type).
DEFAULT_RECIPES = {
    "generic": {
        "instruction": "Read the file {promptFile} and execute the task in it completely, "
                       "end to end, with full autonomy and no questions.",
    },
    # the NocoBase build/repro method — every build-type run references this one.
    "nocobase-build": {
        "cli": "opencode",
        "cwd": "~",
        "readyTimeout": 90,
        "instruction": (
            "First read the nocobase-prototype-repro skill (SKILL.md + references/). Then read "
            "{promptFile} as the user requirement and reproduce it END-TO-END in the NocoBase env "
            "'{env}' via the nb CLI (ALWAYS pass -e {env}): produce a SPEC (data model + each region "
            "-> native block) -> data modeling in ONE pass -> all-English seed covering every enum "
            "branch -> list pages (Filter + Add + Table + View drawer + sub-tables) -> refine the "
            "signature regions to match -> screenshot-compare visual self-check to >=80%. Work "
            "autonomously across turns; do NOT stop to ask. When done print a FINAL REPORT: "
            "collections, signature pageUid(s), Self-Score (0-10), comparison notes, known gaps."
        ),
        "defaultNudge": "Continue the NocoBase build. If blocked, state the exact blocker in one "
                        "line, then proceed autonomously; always pass -e <env>.",
        "watchFor": [
            "belongsTo named *_id -> beta rejects it (use a noun fk)",
            "sub-table fieldGroups validation loop",
            "pie/donut rendering as a solid circle (series not paired)",
            "page collapsed into one giant JS block instead of native blocks",
        ],
    },
}
# map a run's coarse `type` to a recipe when `recipe` is not given explicitly
TYPE_RECIPE = {"build": "nocobase-build", "nocobase": "nocobase-build"}

def resolve_recipe(cfg, run):
    recipes = {**DEFAULT_RECIPES, **(cfg.get("recipes") or {})}
    name = run.get("recipe") or TYPE_RECIPE.get(run.get("type") or "") or "generic"
    rec = dict(recipes.get(name) or recipes["generic"]); rec["_name"] = name
    return rec

def build_instruction(recipe, run, pf):
    fields = {"promptFile": pf, "env": run.get("env") or "<env>", "model": run.get("model") or ""}
    try: instr = (recipe.get("instruction") or DEFAULT_RECIPES["generic"]["instruction"]).format(**fields)
    except Exception: instr = f"Read the file {pf} and execute the task in it completely, end to end."
    extra = run.get("instruction")  # per-run extra (e.g. a retry note)
    if extra: instr += " " + extra
    return instr

# ---------------------------------------------------------------- launch
def resolve_prompt(cfg, run):
    pf = run["promptFile"]
    if not os.path.isabs(pf): pf = os.path.join(HERE, pf)
    if not os.path.exists(pf): sys.exit(f"prompt file missing for run {run['id']}: {pf}")
    return pf

def launch_run(cfg, run):
    s = run_session_name(cfg, run)
    pf = resolve_prompt(cfg, run)
    recipe = resolve_recipe(cfg, run)
    cli = run.get("cli") or recipe.get("cli") or cfg.get("cli", "opencode")
    run["cli"] = cli                                   # so collect/brief see the resolved CLI
    if recipe.get("readyTimeout"): run.setdefault("readyTimeout", recipe["readyTimeout"])
    cwd = expand(run.get("cwd") or recipe.get("cwd") or cfg["runCwd"])
    if run.get("reset"): reset_env(run)
    ad = get_adapter(cli)
    ad.launch(s, run, cfg, cwd)
    send(s, build_instruction(recipe, run, pf))
    write_brief(cfg, run, s, pf, recipe)
    print(f"  launched {s}  recipe={recipe['_name']} cli={cli} env={run.get('env','?')} model={run.get('model','?')}")
    return s

# ---------------------------------------------------------------- LLM judge
JUDGE_SYS = (
    "You watch an opencode TUI building a NocoBase app via CLI. Given the tail of its terminal pane, "
    "classify the current state. Reply ONLY compact JSON: "
    '{"state":"working|stalled|permission|done|error","reason":"<=15 words","nudge":"<one actionable sentence, only if stalled>"}. '
    "working=actively producing output / spinner moving. "
    "stalled=idle, waiting for input, repeating itself, or finished a step but not continuing. "
    "permission=blocked on an allow/approve prompt needing a keypress. "
    "done=printed a final report / declared the whole task complete. error=fatal/crash."
)

def llm_judge(cfg, pane_text):
    import urllib.request
    g = cfg["gateway"]
    key = os.environ.get(g.get("apiKeyEnv", "LLM_API_KEY")) or g.get("apiKey")
    if not key:
        return {"state": "unknown", "reason": "no LLM key (set LLM_API_KEY)"}
    body = {
        "model": cfg["monitor"]["judgeModel"],
        "messages": [{"role": "system", "content": JUDGE_SYS},
                     {"role": "user", "content": pane_text[-4000:]}],
        "max_tokens": 200, "temperature": 0,
    }
    req = urllib.request.Request(
        g["baseURL"].rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 # some gateways (OpenCode Zen) 403 non-client User-Agents
                 "User-Agent": g.get("userAgent", "opencode/1.16.2")},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            d = json.loads(r.read())
        txt = d["choices"][0]["message"]["content"]
        mm = re.search(r"\{.*\}", txt, re.S)
        return json.loads(mm.group(0)) if mm else {"state": "unknown", "reason": txt[:120]}
    except Exception as e:
        return {"state": "unknown", "reason": f"judge error: {e}"}

# ---------------------------------------------------------------- classify (heuristic + idle timing)
PERM_RE = re.compile(r"Allow always|Allow this|Approve|grant permission|\(y/N\)|Yes, and|❯\s*Allow", re.I)
DONE_RE = re.compile(r"FINAL REPORT|final report|task (is )?complete|all (pages|workflows|blocks).{0,20}(done|created|verified)", re.I)
WORK_RE = re.compile(r"esc interrupt|Thinking|■■|⬝⬝|Building|Running|\$ nb |tool ")

def classify(cfg, run, st):
    s = run_session_name(cfg, run)
    if not session_exists(s):
        return {"state": "absent", "reason": "no tmux session"}
    pn = pane(s, 60)
    h = hashlib.md5(pn.encode()).hexdigest()
    rec = st.setdefault(s, {})
    now = time.time()
    if rec.get("hash") != h:
        rec["hash"] = h; rec["changed"] = now
    idle = now - rec.get("changed", now)
    rec["idle"] = round(idle)

    tail = "\n".join(pn.strip().splitlines()[-30:])
    if PERM_RE.search(tail):
        return {"state": "permission", "reason": "permission prompt", "idle": round(idle)}
    if DONE_RE.search(tail) and idle > 20:
        return {"state": "done", "reason": "final report / completion text", "idle": round(idle)}
    moving = WORK_RE.search(tail) and idle < cfg["monitor"]["stallSec"]
    if moving:
        return {"state": "working", "reason": "active output / recent change", "idle": round(idle)}
    # ambiguous: idle long enough OR no work markers
    judge = cfg["monitor"]["judge"]
    if idle >= cfg["monitor"]["stallSec"] or not WORK_RE.search(tail):
        if "llm" in judge:
            j = llm_judge(cfg, pn); j["idle"] = round(idle); return j
        return {"state": "stalled" if idle >= cfg["monitor"]["stallSec"] else "working",
                "reason": f"idle {round(idle)}s (heuristic)", "idle": round(idle)}
    return {"state": "working", "reason": "recent activity", "idle": round(idle)}

# intervention ledger — every supervisor action (nudge / auto-approve) is logged per run id so a
# run's record can show how much it was ASSISTED. An unassisted run and a heavily-nudged one are
# not comparable; methodology requires this be visible. `collect` merges it into the record.
def log_intervention(run, kind, detail=""):
    p = os.path.join(RUNS_DIR, "interventions.json")
    try: d = json.load(open(p))
    except Exception: d = {}
    e = d.setdefault(run["id"], {"nudges": 0, "autoApprovals": 0, "events": []})
    if kind == "nudge": e["nudges"] += 1
    elif kind == "approve": e["autoApprovals"] += 1
    e["events"].append({"kind": kind, "detail": detail[:200], "at": _now()})
    os.makedirs(RUNS_DIR, exist_ok=True)
    json.dump(d, open(p, "w"), ensure_ascii=False, indent=1)

def act_on(cfg, run, verdict, st):
    s = run_session_name(cfg, run)
    rec = st.setdefault(s, {})
    now = time.time()
    state = verdict.get("state")
    default_nudge = resolve_recipe(cfg, run).get("defaultNudge") or cfg["monitor"]["defaultNudge"]
    if state == "stalled":
        n = rec.get("nudges", 0)
        if n >= cfg["monitor"]["maxNudgesPerSession"]:
            return "stalled (max nudges reached — needs a human)"
        if now - rec.get("lastNudge", 0) < cfg["monitor"]["nudgeCooldownSec"]:
            return "stalled (cooldown)"
        if cfg["monitor"]["judge"] == "agent":
            return f"stalled — SUGGEST nudge: {verdict.get('nudge') or default_nudge}"
        nudge = verdict.get("nudge") or default_nudge
        send(s, nudge)
        rec["nudges"] = n + 1; rec["lastNudge"] = now
        log_intervention(run, "nudge", nudge)
        return f"NUDGED (#{n+1})"
    if state == "permission":
        if cfg["monitor"]["judge"] == "agent":
            return "permission — SUGGEST: approve in the TUI"
        # best-effort approve: arrow-right to 'Allow always' then enter
        tmux("send-keys", "-t", s, "Right"); time.sleep(0.2); tmux("send-keys", "-t", s, "Enter")
        log_intervention(run, "approve")
        return "auto-approved permission"
    return ""

# ---------------------------------------------------------------- run briefs (driver -> supervisor handoff)
RUNS_DIR = os.path.join(HERE, "runs")

def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")

def write_brief(cfg, run, session, pf, recipe=None):
    """One-click background packet so an inspector/supervisor agent can drive + watch a run with full context."""
    os.makedirs(os.path.join(RUNS_DIR, "briefs"), exist_ok=True)
    try: prompt_text = open(pf, encoding="utf-8").read()
    except Exception: prompt_text = ""
    recipe = recipe or {}
    brief = {
        "id": run["id"], "cli": run.get("cli", cfg.get("cli", "opencode")), "tmuxSession": session,
        "recipe": recipe.get("_name"),
        "model": run.get("model"), "env": run.get("env"), "tags": run.get("tags", []),
        "lineage": {"prototype": run.get("prototype"), "batch": run.get("batch"),
                    "parent": run.get("parent"), "depth": run.get("depth", 0)},
        "goal": run.get("goal"), "successCriteria": run.get("successCriteria", []),
        "watchFor": run.get("watchFor") or recipe.get("watchFor") or cfg.get("watchFor", []),
        "promptFile": pf, "promptText": prompt_text,
        "howToInspect": f"tmux capture-pane -t {session} -p -S -80   (or: bench.py status --only {run['id']})",
        "howToNudge": f"tmux send-keys -t {session} '<one concrete next step>' Enter",
        "howToCollect": f"bench.py collect --only {run['id']}",
        "launchedAt": _now(),
    }
    json.dump(brief, open(os.path.join(RUNS_DIR, "briefs", f"{run['id']}.json"), "w"), ensure_ascii=False, indent=1)
    return brief

def write_supervise(cfg, briefs):
    os.makedirs(RUNS_DIR, exist_ok=True)
    sup = {
        "generatedAt": _now(), "monitor": cfg["monitor"], "runs": briefs,
        "howTo": ("For each run: read promptText + successCriteria, watch its tmuxSession pane, "
                  "nudge ONLY genuinely-stalled ones (idle + no spinner + repeating), and run "
                  "`bench.py collect` once it prints its final report. `bench.py monitor --judge agent --once` "
                  "gives you a per-pass classification to act on."),
    }
    json.dump(sup, open(os.path.join(RUNS_DIR, "supervise.json"), "w"), ensure_ascii=False, indent=1)

# ---------------------------------------------------------------- commands
def select_runs(cfg, only):
    runs = cfg["runs"]
    if only:
        ids = set(only.split(","))
        runs = [r for r in runs if r["id"] in ids]
    return runs

def cmd_run(cfg, args):
    runs = select_runs(cfg, args.only)
    print(f"launching {len(runs)} run(s)")
    briefs = []
    for r in runs:
        launch_run(cfg, r)
        bp = os.path.join(RUNS_DIR, "briefs", f"{r['id']}.json")
        if os.path.exists(bp):
            briefs.append(json.load(open(bp)))
        time.sleep(args.stagger)
    write_supervise(cfg, briefs)
    print("done. supervisor briefing -> runs/supervise.json")
    print("monitor with:  python3 tooling/bench/bench.py monitor   (--judge agent for you to drive)")

def cmd_brief(cfg, args):
    """(re)generate the background packets without launching — e.g. for already-running sessions."""
    briefs = []
    for r in select_runs(cfg, args.only):
        briefs.append(write_brief(cfg, r, run_session_name(cfg, r), resolve_prompt(cfg, r)))
    write_supervise(cfg, briefs)
    print(f"wrote {len(briefs)} brief(s) -> runs/briefs/ + runs/supervise.json")

_IMG = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
_TXT = {".txt", ".md", ".json", ".log", ".csv", ".js", ".ts", ".py", ".css", ".sql", ".yaml", ".yml", ".sh"}
def _art_kind(name):
    e = os.path.splitext(name)[1].lower()
    if e in _IMG: return "image"
    if e in (".html", ".htm"): return "html"
    if e in _TXT: return "text"
    return "file"

def cmd_attach(cfg, args):
    """attach result ARTIFACTS to a run — any modality: image / html snippet / text / code / file.
    Kind is inferred from the extension. Stored in artifacts.json + runs/artifacts/ (survives re-collect),
    merged into the record server-side and displayed by kind in the run-history page."""
    import shutil
    if not args.only or not args.files:
        sys.exit("attach needs --only <run-id> --files <path1,path2,...> (image/html/text/code/any file)")
    rid = args.only.split(",")[0]
    af = os.path.join(RUNS_DIR, "artifacts.json")
    store = json.load(open(af)) if os.path.exists(af) else {}
    arts = store.get(rid, [])
    have = {a.get("file") for a in arts}
    dest = os.path.join(RUNS_DIR, "artifacts", rid)
    os.makedirs(dest, exist_ok=True)
    for src in [f.strip() for f in args.files.split(",") if f.strip()]:
        src = expand(src)
        if not os.path.exists(src):
            print(f"  ! not found: {src}"); continue
        name = os.path.basename(src)
        shutil.copy(src, os.path.join(dest, name))
        rel = f"{rid}/{name}"
        kind = args.kind or _art_kind(name)
        if rel not in have:
            arts.append({"kind": kind, "file": rel, "label": os.path.splitext(name)[0]}); have.add(rel)
        print(f"  + [{kind}] {rel}")
    store[rid] = arts
    json.dump(store, open(af, "w"), ensure_ascii=False, indent=1)
    print(f"{len(arts)} artifact(s) on {rid}. served at /runs-artifacts/{rid}/<name>")

def cmd_retry(cfg, args):
    """launch a NEW run as a child (iteration) of an existing one — grows the lineage tree."""
    if not args.only:
        sys.exit("retry needs --only <run-id>")
    src_id = args.only.split(",")[0]
    cfg_run = next((r for r in cfg["runs"] if r["id"] == src_id), None)
    idxp = os.path.join(RUNS_DIR, "index.json")
    rec = None
    if os.path.exists(idxp):
        rec = next((r for r in json.load(open(idxp)) if r["id"] == src_id), None)
    if not cfg_run and not rec:
        sys.exit(f"run '{src_id}' not found in config or runs/index.json")
    g = lambda k, d=None: (cfg_run or {}).get(k) or (rec or {}).get(k, d)
    env = (cfg_run or {}).get("env") or ((rec or {}).get("target") or {}).get("env")
    model = (cfg_run or {}).get("model") or (rec or {}).get("model")
    promptfile = (cfg_run or {}).get("promptFile") or ((rec or {}).get("prompt") or {}).get("file")
    lin = (rec or {}).get("lineage") or {}
    depth = (lin.get("depth") or 0) + 1
    child = {
        "id": f"{src_id}-retry{depth}", "cli": g("cli", "opencode"), "env": env, "model": model,
        "promptFile": promptfile, "parent": src_id, "depth": depth,
        "batch": (cfg_run or {}).get("batch") or lin.get("batch"),
        "prototype": (cfg_run or {}).get("prototype") or lin.get("prototype"),
        "tags": g("tags", []),
        "instruction": args.note or "This is a RETRY of a previous attempt. Review what the prior run left broken or missing and fix it; do not rebuild what already works.",
        "reset": (cfg_run or {}).get("reset"),
        "goal": (cfg_run or {}).get("goal"), "successCriteria": (cfg_run or {}).get("successCriteria", []),
    }
    print(f"retry: {src_id} -> {child['id']} (parent={src_id}, depth={depth}, env={env})")
    launch_run(cfg, child)
    bp = os.path.join(RUNS_DIR, "briefs", f"{child['id']}.json")
    write_supervise(cfg, [json.load(open(bp))] if os.path.exists(bp) else [])
    print("done. collect it after it finishes:  bench.py collect --only " + child["id"])

# ---------------------------------------------------------------- pause / resume (interrupt-recovery)
# A claude run's full conversation persists in its cwd's project .jsonl, so a session can be killed
# (pause) and later continued from the exact breakpoint with `claude --continue` (resume). Useful to
# park slow builds before a usage-cap reset, then pick them back up. Registry: runs/paused.json.
PAUSED_FILE = os.path.join(RUNS_DIR, "paused.json")
def _load_paused():
    try: return json.load(open(PAUSED_FILE))
    except Exception: return {}
def _save_paused(d):
    os.makedirs(RUNS_DIR, exist_ok=True); json.dump(d, open(PAUSED_FILE, "w"), ensure_ascii=False, indent=1)

def cmd_pause(cfg, args):
    if not args.only: sys.exit("pause needs --only <ids>")
    reg = _load_paused()
    for rid in args.only.split(","):
        run = next((r for r in cfg["runs"] if r["id"] == rid), None)
        if not run: print(f"  ! {rid} not in config"); continue
        s = run_session_name(cfg, run)
        tmux("kill-session", "-t", s)
        reg[rid] = {"id": rid, "env": run.get("env"), "cwd": run.get("cwd"),
                    "promptFile": run.get("promptFile"), "module": run.get("module"),
                    "batch": run.get("batch"), "recipe": run.get("recipe"), "pausedAt": _now()}
        print(f"  paused {rid} (session {s} killed; .jsonl kept for --continue)")
    _save_paused(reg)
    print(f"paused {len(args.only.split(','))} -> {PAUSED_FILE}  (resume with: bench.py resume)")

def cmd_resume(cfg, args):
    """relaunch paused runs with `claude --continue` (picks up the prior conversation in the cwd)."""
    reg = _load_paused()
    ids = args.only.split(",") if args.only else list(reg)
    if not ids: print("nothing paused"); return
    for rid in ids:
        e = reg.get(rid)
        if not e: print(f"  ! {rid} not in paused registry"); continue
        run = {"id": rid, "env": e["env"], "cwd": e["cwd"], "cli": "claude", "resume": True,
               "recipe": e.get("recipe") or "nocobase-build", "promptFile": e.get("promptFile"),
               "module": e.get("module"), "batch": e.get("batch")}
        s = run_session_name(cfg, run)
        cwd = expand(run["cwd"])
        get_adapter("claude").launch(s, run, cfg, cwd)   # `claude --continue --dangerously-skip-permissions`
        send(s, f"继续完成这个 NocoBase 搭建(从上次中断处续):补齐未完成的招牌区块/视觉自查,"
                f"始终 -e {e['env']} -y;完成后务必输出一行 Self-Score: X/10 收尾。")
        pf = e.get("promptFile"); pf = pf if (pf and os.path.isabs(pf)) else os.path.join(HERE, pf or "")
        write_brief(cfg, run, s, pf if os.path.exists(pf) else __file__, resolve_recipe(cfg, run))
        del reg[rid]
        print(f"  resumed {rid} -> {s} (claude --continue, env {e['env']})")
    _save_paused(reg)
    print(f"resumed; remaining paused: {sorted(reg)}")

def cmd_collect(cfg, args):
    os.makedirs(os.path.join(RUNS_DIR, "transcripts"), exist_ok=True)
    if args.all:
        # sweep EVERY CLI's store (opencode db + claude ~/.claude/projects), so a single
        # `collect --all` ingests builds from all CLIs. --cli <name> restricts to one.
        names = [args.cli] if args.cli else list(ADAPTERS)
        runs, seen = [], set()
        for name in names:
            ad = get_adapter(name)
            if not hasattr(ad, "discover"): continue
            got = [r for r in ad.discover(cfg) if r.get("id") not in seen]
            seen.update(r.get("id") for r in got)
            print(f"  {name}: discovered {len(got)} historical build session(s)")
            runs += got
        print(f"discovered {len(runs)} session(s) total across {len(names)} CLI(s)")
    else:
        runs = select_runs(cfg, args.only)
    idxp = os.path.join(RUNS_DIR, "index.json")
    index = json.load(open(idxp)) if os.path.exists(idxp) else []
    by_id = {r.get("id"): i for i, r in enumerate(index)}
    try: interventions = json.load(open(os.path.join(RUNS_DIR, "interventions.json")))
    except Exception: interventions = {}
    n = 0
    for r in runs:
        ad = get_adapter(r.get("cli", cfg.get("cli", "opencode")))
        res = ad.extract(r, cfg)
        if not res:
            print(f"  - {r['id']}: no session found"); continue
        rec, transcript = res
        # scrub any credentials that leaked into the captured text before persisting
        rec = json.loads(redact(json.dumps(rec, ensure_ascii=False)))
        transcript = json.loads(redact(json.dumps(transcript, ensure_ascii=False)))
        # how much the supervisor ASSISTED this run (nudges / auto-approves) — for fair comparison
        iv = interventions.get(rec["id"], {})
        rec["interventions"] = {"nudges": iv.get("nudges", 0), "autoApprovals": iv.get("autoApprovals", 0),
                                "assisted": bool(iv.get("nudges") or iv.get("autoApprovals"))}
        rec["collectedAt"] = _now()
        tf = os.path.join(RUNS_DIR, "transcripts", f"{rec['id']}.json")
        json.dump({"record": rec, "transcript": transcript}, open(tf, "w"), ensure_ascii=False, indent=1)
        rec["transcriptFile"] = os.path.relpath(tf, HERE)
        if rec["id"] in by_id: index[by_id[rec["id"]]] = rec
        else: by_id[rec["id"]] = len(index); index.append(rec)
        tk = rec["tokens"].get("output")
        print(f"  + {rec['id']:30} {rec['cli']:8} {str(rec.get('model')):16} {rec['outcome']['status']:8} "
              f"out={tk} tools={rec['toolCalls']} err={rec.get('errors',{}).get('count',0)} dur={rec['timing'].get('durationSec')}s")
        n += 1
    json.dump(index, open(idxp, "w"), ensure_ascii=False, indent=1)
    print(f"collected {n} run-record(s) -> runs/index.json ({len(index)} total)")

def cmd_status(cfg, args):
    st = load_state(cfg)
    for r in select_runs(cfg, args.only):
        v = classify(cfg, r, st)
        print(f"  {run_session_name(cfg,r):28} {v.get('state','?'):11} idle={v.get('idle','?'):>5}  {v.get('reason','')}")
    save_state(cfg, st)

def cmd_monitor(cfg, args):
    if args.judge: cfg["monitor"]["judge"] = args.judge
    interval = cfg["monitor"]["intervalSec"]
    print(f"monitor: judge={cfg['monitor']['judge']} interval={interval}s stall={cfg['monitor']['stallSec']}s "
          f"{'(single pass)' if args.once else '(loop, Ctrl-C to stop)'}")
    while True:
        st = load_state(cfg)
        alive = 0
        for r in select_runs(cfg, args.only):
            v = classify(cfg, r, st)
            action = act_on(cfg, r, v, st) if v.get("state") in ("stalled", "permission") else ""
            if v.get("state") not in ("absent", "done"): alive += 1
            ts = time.strftime("%H:%M:%S")
            line = f"[{ts}] {run_session_name(cfg,r):26} {v.get('state','?'):11} idle={v.get('idle','?'):>5} {v.get('reason','')}"
            if action: line += f"  -> {action}"
            print(line)
        save_state(cfg, st)
        if args.once or alive == 0:
            if alive == 0 and not args.once: print("all runs done/absent — exiting monitor")
            break
        time.sleep(interval)

AI_REVIEW_SYS = (
    "You are a senior reviewer of AI-built NocoBase apps. Given a build run's prompt, outcome, "
    "errors and transcript excerpts, judge how well it met the goal. Reply ONLY compact JSON: "
    '{"score": <0-10 number>, "verdict": "pass|fix|redo", '
    '"comment": "<2-4 sentences: what it achieved, what is wrong/missing, the single biggest issue>"}. '
    "pass = meets the goal with minor nits. fix = mostly there, specific fixable gaps. redo = missed the goal / broken."
)

def _chat(cfg, system, user, max_tokens=500, model=None):
    """one-shot call to the OpenAI-compatible gateway; returns assistant text or '__ERR__ ...'."""
    import urllib.request
    g = cfg["gateway"]
    key = os.environ.get(g.get("apiKeyEnv", "LLM_API_KEY")) or g.get("apiKey")
    if not key:
        return "__ERR__ no LLM key (set LLM_API_KEY)"
    body = {"model": model or cfg["monitor"]["judgeModel"],
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "max_tokens": max_tokens, "temperature": 0}
    req = urllib.request.Request(g["baseURL"].rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "User-Agent": g.get("userAgent", "opencode/1.16.2")})
    try:
        with urllib.request.urlopen(req, timeout=70) as r:
            return json.loads(r.read())["choices"][0]["message"]["content"]
    except Exception as e:
        return f"__ERR__ {e}"

def _run_digest(rec, transcript):
    """compact, token-bounded description of a run for the AI reviewer."""
    p = (rec.get("prompt") or {}).get("text") or ""
    fin = (rec.get("outcome") or {}).get("finalText") or ""
    errs = (rec.get("errors") or {}).get("samples") or []
    says = [t.get("text", "") for t in transcript if t.get("t") == "text" and t.get("role") == "assistant"][-3:]
    parts = [
        f"GOAL/PROMPT:\n{p[:1800]}",
        f"\nOUTCOME status={rec.get('outcome',{}).get('status')} rounds={rec.get('rounds')} tools={rec.get('toolCalls')} errors={rec.get('errors',{}).get('count')}",
        f"\nFINAL REPORT:\n{fin[:1200]}",
    ]
    if errs:
        parts.append("\nERROR SAMPLES:\n" + "\n".join(f"- [{e.get('tool')}] {e.get('msg','')}" for e in errs[:12]))
    if says:
        parts.append("\nLAST ASSISTANT NOTES:\n" + "\n".join(s[:400] for s in says))
    return "\n".join(parts)

def cmd_ai_review(cfg, args):
    idxp = os.path.join(RUNS_DIR, "index.json")
    if not os.path.exists(idxp):
        print("no runs/index.json — run `collect` first"); return
    index = json.load(open(idxp))
    arf = os.path.join(RUNS_DIR, "ai-reviews.json")
    ai = json.load(open(arf)) if os.path.exists(arf) else {}
    only = set(args.only.split(",")) if args.only else None
    targets = [r for r in index if (only and r["id"] in only) or (not only and (args.all or r["id"] not in ai))]
    print(f"ai-review: {len(targets)} run(s) (model={cfg['monitor']['judgeModel']})")
    for rec in targets:
        tf = os.path.join(RUNS_DIR, "transcripts", f"{rec['id']}.json")
        transcript = json.load(open(tf)).get("transcript", []) if os.path.exists(tf) else []
        out = _chat(cfg, AI_REVIEW_SYS, _run_digest(rec, transcript))
        if out.startswith("__ERR__"):
            print(f"  ! {rec['id']}: {out}"); continue
        m = re.search(r"\{.*\}", out, re.S)
        try:
            j = json.loads(m.group(0)) if m else {}
        except Exception:
            j = {"comment": out[:300]}
        ai[rec["id"]] = {"score": j.get("score"), "verdict": j.get("verdict"),
                         "comment": j.get("comment"), "model": cfg["monitor"]["judgeModel"], "ts": _now()}
        print(f"  + {rec['id']:30} ai: {j.get('verdict')} {j.get('score')}  {str(j.get('comment',''))[:70]}")
    json.dump(ai, open(arf, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {len(ai)} ai-review(s) -> runs/ai-reviews.json")

def cmd_stop(cfg, args):
    for r in select_runs(cfg, args.only):
        s = run_session_name(cfg, r)
        if session_exists(s):
            tmux("kill-session", "-t", s); print(f"  killed {s}")
    # sweep orphaned opencode procs (exact match, never pkill -f opencode which would hit this cmd)
    subprocess.run("pgrep -x opencode | xargs -r kill", shell=True)
    print("stopped.")

def cmd_summary(cfg, args):
    script = os.path.join(HERE, "bench-summary.py")
    if os.path.exists(script):
        env = dict(os.environ); env["OPENCODE_DB"] = expand(cfg["opencodeDb"])
        subprocess.run([sys.executable, script], env=env)
    else:
        print("bench-summary.py not found")

def main():
    ap = argparse.ArgumentParser(description="config-driven opencode bench pipeline")
    ap.add_argument("command", choices=["run", "status", "monitor", "summary", "stop", "collect", "brief", "ai-review", "retry", "attach", "pause", "resume"])
    ap.add_argument("--config", default=os.path.join(HERE, "bench.config.json"))
    ap.add_argument("--only", help="comma-separated run ids")
    ap.add_argument("--once", action="store_true", help="monitor: single pass then exit")
    ap.add_argument("--judge", choices=["heuristic", "llm", "heuristic+llm", "agent"], help="monitor: override judge mode")
    ap.add_argument("--stagger", type=float, default=2.0, help="run: seconds between launches")
    ap.add_argument("--all", action="store_true", help="collect/ai-review: cover ALL runs (else: new ones)")
    ap.add_argument("--cli", choices=list(ADAPTERS), help="collect --all: restrict discovery to one CLI (default: all)")
    ap.add_argument("--note", help="retry: the iteration instruction")
    ap.add_argument("--files", help="attach: comma-separated artifact paths (image/html/text/code/file)")
    ap.add_argument("--kind", choices=["image", "html", "text", "file"], help="attach: force artifact kind (else inferred from extension)")
    args = ap.parse_args()
    cfg = load_config(args.config)
    {"run": cmd_run, "status": cmd_status, "monitor": cmd_monitor, "summary": cmd_summary,
     "stop": cmd_stop, "collect": cmd_collect, "brief": cmd_brief, "pause": cmd_pause, "resume": cmd_resume,
     "ai-review": cmd_ai_review, "retry": cmd_retry, "attach": cmd_attach}[args.command](cfg, args)

if __name__ == "__main__":
    main()
