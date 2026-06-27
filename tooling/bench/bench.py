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

# ---------------------------------------------------------------- tmux
def tmux(*args, check=False):
    return subprocess.run(["tmux", *args], capture_output=True, text=True, check=check)

def session_exists(s):
    return tmux("has-session", "-t", s).returncode == 0

def pane(s, lines=60):
    r = tmux("capture-pane", "-t", s, "-p", "-S", f"-{lines}")
    return r.stdout if r.returncode == 0 else ""

def send(s, text, enter=True):
    tmux("send-keys", "-t", s, text)
    if enter:
        time.sleep(0.4)
        tmux("send-keys", "-t", s, "Enter")

def wait_for(s, pattern, timeout=90, interval=2):
    rx = re.compile(pattern)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if rx.search(pane(s, 40)): return True
        time.sleep(interval)
    return False

# ---------------------------------------------------------------- opencode model
def set_opencode_model(cfg, model):
    if not model: return
    p = expand(cfg["opencodeConfig"])
    try:
        with open(p) as f: d = json.load(f)
        d["model"] = model
        with open(p, "w") as f: json.dump(d, f, indent=2)
    except Exception as e:
        print(f"  ! could not set opencode model {model}: {e}")

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

# ---------------------------------------------------------------- launch
def resolve_prompt(cfg, run):
    pf = run["promptFile"]
    if not os.path.isabs(pf): pf = os.path.join(HERE, pf)
    if not os.path.exists(pf): sys.exit(f"prompt file missing for run {run['id']}: {pf}")
    return pf

def launch_run(cfg, run):
    s = run_session_name(cfg, run)
    pf = resolve_prompt(cfg, run)
    cwd = expand(cfg["runCwd"])
    if run.get("reset"): reset_env(run)
    set_opencode_model(cfg, run.get("model"))
    tmux("kill-session", "-t", s)
    tmux("new-session", "-d", "-s", s, "-c", cwd)
    tmux("set-option", "-t", s, "remain-on-exit", "on")
    if not wait_for(s, r"代理正常|albert@|\$\s*$|@.*:.*\$", timeout=30):
        print(f"  ! {s}: shell not ready")
    send(s, "opencode")
    if not wait_for(s, r"OpenCode|Qwen3\.7|esc interrupt|Ask anything", timeout=cfg.get("tuiReadyTimeout", 90)):
        print(f"  ! {s}: opencode TUI not detected (continuing anyway)")
    instr = (f"Read the file {pf} and execute the task in it completely, end to end, "
             f"with full autonomy and no questions.")
    extra = run.get("instruction")
    if extra: instr += " " + extra
    send(s, instr)
    print(f"  launched {s}  env={run.get('env','?')}  model={run.get('model','?')}")
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

def act_on(cfg, run, verdict, st):
    s = run_session_name(cfg, run)
    rec = st.setdefault(s, {})
    now = time.time()
    state = verdict.get("state")
    if state == "stalled":
        n = rec.get("nudges", 0)
        if n >= cfg["monitor"]["maxNudgesPerSession"]:
            return "stalled (max nudges reached — needs a human)"
        if now - rec.get("lastNudge", 0) < cfg["monitor"]["nudgeCooldownSec"]:
            return "stalled (cooldown)"
        if cfg["monitor"]["judge"] == "agent":
            return f"stalled — SUGGEST nudge: {verdict.get('nudge') or cfg['monitor']['defaultNudge']}"
        send(s, verdict.get("nudge") or cfg["monitor"]["defaultNudge"])
        rec["nudges"] = n + 1; rec["lastNudge"] = now
        return f"NUDGED (#{n+1})"
    if state == "permission":
        if cfg["monitor"]["judge"] == "agent":
            return "permission — SUGGEST: approve in the TUI"
        # best-effort approve: arrow-right to 'Allow always' then enter
        tmux("send-keys", "-t", s, "Right"); time.sleep(0.2); tmux("send-keys", "-t", s, "Enter")
        return "auto-approved permission"
    return ""

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
    for r in runs:
        launch_run(cfg, r)
        time.sleep(args.stagger)
    print("done. monitor with:  python3 tooling/bench/bench.py monitor")

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
    ap.add_argument("command", choices=["run", "status", "monitor", "summary", "stop"])
    ap.add_argument("--config", default=os.path.join(HERE, "bench.config.json"))
    ap.add_argument("--only", help="comma-separated run ids")
    ap.add_argument("--once", action="store_true", help="monitor: single pass then exit")
    ap.add_argument("--judge", choices=["heuristic", "llm", "heuristic+llm", "agent"], help="monitor: override judge mode")
    ap.add_argument("--stagger", type=float, default=2.0, help="run: seconds between launches")
    args = ap.parse_args()
    cfg = load_config(args.config)
    {"run": cmd_run, "status": cmd_status, "monitor": cmd_monitor,
     "summary": cmd_summary, "stop": cmd_stop}[args.command](cfg, args)

if __name__ == "__main__":
    main()
