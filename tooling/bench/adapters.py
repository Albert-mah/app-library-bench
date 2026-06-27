"""
CLI adapters — make the pipeline agnostic to which agent CLI drives a run.

Every adapter knows three things about its CLI:
  • how to LAUNCH it in a tmux pane (start command, readiness pattern, model selection)
  • how to read its live PANE (shared — all are tmux)
  • how to EXTRACT a rich run-record from its persistent store
      (opencode → ~/.local/share/opencode/opencode.db ; claude → ~/.claude/projects/*.jsonl)

A run-record is CLI-agnostic so the test center / summaries treat every CLI the same:
  { id, cli, model, provider, target, prompt{file,text,sha256}, tags[],
    timing{startedAt,endedAt,durationSec}, tokens{input,output,reasoning,cacheRead,cacheWrite},
    rounds, toolCalls, outcome{status,finalText}, sessionId, transcript[...] }
"""
import os, re, json, time, sqlite3, hashlib, subprocess, glob

def expand(p):
    return os.path.expanduser(os.path.expandvars(p)) if isinstance(p, str) else p

# ---------------------------------------------------------------- shared tmux
def tmux(*args):
    return subprocess.run(["tmux", *args], capture_output=True, text=True)

def session_exists(s):
    return tmux("has-session", "-t", s).returncode == 0

def pane(s, lines=60):
    r = tmux("capture-pane", "-t", s, "-p", "-S", f"-{lines}")
    return r.stdout if r.returncode == 0 else ""

def send(s, text, enter=True):
    tmux("send-keys", "-t", s, text)
    if enter:
        time.sleep(0.4); tmux("send-keys", "-t", s, "Enter")

def wait_for(s, pattern, timeout=90, interval=2):
    rx = re.compile(pattern); t0 = time.time()
    while time.time() - t0 < timeout:
        if rx.search(pane(s, 40)): return True
        time.sleep(interval)
    return False

def _sha(t):
    return hashlib.sha256(t.encode("utf-8", "replace")).hexdigest()

# scrub credentials that may surface in a transcript (api keys, JWTs, lark ids, known pw)
SECRET_RE = re.compile(r"sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_.-]{30,}|ou_[0-9a-f]{20,}|Exp_agents_\w+|VKXb#\S+")
def redact(s):
    return SECRET_RE.sub("***REDACTED***", s) if isinstance(s, str) else s

def _iso(ms):
    if not ms: return None
    s = ms / 1000 if ms > 1e12 else ms
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(s))

# ---------------------------------------------------------------- base
class BaseAdapter:
    name = "base"
    ready_pattern = r"\$\s*$"
    def set_model(self, cfg, model): pass
    def start_cmd(self, run, cfg): raise NotImplementedError
    def launch(self, session, run, cfg, run_cwd):
        self.set_model(cfg, run.get("model"))
        tmux("kill-session", "-t", session)
        tmux("new-session", "-d", "-s", session, "-c", run_cwd)
        tmux("set-option", "-t", session, "remain-on-exit", "on")
        wait_for(session, r"代理正常|@.*:.*[$#]|\$\s*$", timeout=30)
        send(session, self.start_cmd(run, cfg))
        wait_for(session, self.ready_pattern, timeout=cfg.get("tuiReadyTimeout", 90))
    def extract(self, run, cfg): raise NotImplementedError

# ---------------------------------------------------------------- opencode
class OpencodeAdapter(BaseAdapter):
    name = "opencode"
    ready_pattern = r"OpenCode|Qwen3\.7|esc interrupt|Ask anything"

    def set_model(self, cfg, model):
        if not model: return
        p = expand(cfg.get("opencodeConfig", "~/.config/opencode/opencode.json"))
        try:
            d = json.load(open(p)); d["model"] = model
            json.dump(d, open(p, "w"), indent=2)
        except Exception as e:
            print(f"  ! opencode set-model failed: {e}")

    def start_cmd(self, run, cfg):
        return "opencode"

    def _db(self, cfg):
        return expand(cfg.get("opencodeDb", "~/.local/share/opencode/opencode.db"))

    def _find_session(self, c, run):
        """match by explicit sessionId, else by the run's prompt-file basename in early parts."""
        if run.get("sessionId"):
            return run["sessionId"]
        pf = run.get("promptFile", "")
        base = os.path.basename(pf) if pf else None
        for r in c.execute("SELECT id FROM session ORDER BY time_created DESC LIMIT 80"):
            sid = r["id"]; blob = ""
            for p in c.execute("SELECT data FROM part WHERE session_id=? ORDER BY time_created ASC LIMIT 12", (sid,)):
                blob += (p["data"] or "")
            if base and base in blob:
                return sid
        return None

    def discover(self, cfg, limit=120):
        """find historical bench sessions (those that read a *.prompt file) → synthetic runs for `collect --all`."""
        db = self._db(cfg)
        if not os.path.exists(db): return []
        c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10); c.row_factory = sqlite3.Row
        promptdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
        out = []
        for r in c.execute("SELECT id FROM session ORDER BY time_created DESC LIMIT ?", (limit,)):
            sid = r["id"]; blob = ""
            for p in c.execute("SELECT data FROM part WHERE session_id=? ORDER BY time_created ASC LIMIT 14", (sid,)):
                blob += (p["data"] or "")
            m = re.search(r"([\w./-]+\.prompt(?:\.txt)?)", blob)
            if not m: continue
            base = os.path.basename(m.group(1)); stem = re.sub(r"\.prompt(\.txt)?$", "", base)
            pf = os.path.join(promptdir, base)
            envm = re.search(r"-e\s+([a-z0-9_]+)\s+-y|env\s+\*\*([a-z0-9_]+)\*\*", blob)
            env = (envm.group(1) or envm.group(2)) if envm else None
            out.append({"id": f"{stem}-{sid[-6:]}", "sessionId": sid,
                        "promptFile": pf if os.path.exists(pf) else None, "env": env, "cli": "opencode",
                        "batch": re.sub(r"[-_]?\d+$", "", stem)})
        return out

    def extract(self, run, cfg):
        db = self._db(cfg)
        if not os.path.exists(db): return None
        c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10); c.row_factory = sqlite3.Row
        sid = self._find_session(c, run)
        if not sid: return None
        s = c.execute("SELECT * FROM session WHERE id=?", (sid,)).fetchone()
        model_raw = s["model"] or ""
        provider = model = None
        try:
            md = json.loads(model_raw); provider = md.get("providerID"); model = md.get("modelID") or md.get("id")
        except Exception:
            model = model_raw
        # walk parts → transcript + counts + final text + prompt file + errors
        transcript, rounds, tools, final_text, prompt_text, errors = [], 0, 0, "", None, []
        seen_roles = {}
        for m in c.execute("SELECT id,data FROM message WHERE session_id=? ORDER BY time_created ASC", (sid,)):
            try: seen_roles[m["id"]] = (json.loads(m["data"]) or {}).get("role")
            except Exception: pass
        for p in c.execute("SELECT message_id,data,time_created FROM part WHERE session_id=? ORDER BY time_created ASC", (sid,)):
            try: d = json.loads(p["data"])
            except Exception: continue
            t = d.get("type")
            if t == "text":
                txt = d.get("text") or ""
                role = seen_roles.get(p["message_id"])
                if role == "user" and prompt_text is None:
                    prompt_text = txt
                if role == "assistant" and txt.strip():
                    final_text = txt
                transcript.append({"t": t, "role": role, "text": txt[:4000], "ts": _iso(p["time_created"])})
            elif t == "reasoning":
                transcript.append({"t": t, "text": (d.get("text") or "")[:1500], "ts": _iso(p["time_created"])})
            elif t == "tool":
                tools += 1
                st = d.get("state", {}) or {}
                inp = st.get("input", {}); cmd = inp.get("command") or inp.get("filePath") or ""
                out = st.get("output", "") or ""
                cmd_s = cmd if isinstance(cmd, str) else json.dumps(cmd)
                out_s = out if isinstance(out, str) else json.dumps(out)
                transcript.append({"t": t, "tool": d.get("tool"), "status": st.get("status"),
                                   "cmd": cmd_s[:600], "out": out_s[:1200], "ts": _iso(p["time_created"])})
                if st.get("status") == "error" or ERR_SIG.search(out_s):
                    errors.append({"tool": d.get("tool"), "cmd": re.sub(r"\s+", " ", cmd_s)[:200],
                                   "msg": _first_err(out_s), "ts": _iso(p["time_created"])})
            elif t in ("step-finish",):
                rounds += 1
        # prompt: prefer the referenced prompt file content
        prompt_file = run.get("promptFile")
        pf_text, pf_sha = None, None
        if prompt_file:
            pf = prompt_file if os.path.isabs(prompt_file) else os.path.join(os.path.dirname(os.path.abspath(__file__)), prompt_file)
            if os.path.exists(pf):
                pf_text = open(pf, encoding="utf-8").read(); pf_sha = _sha(pf_text)
        dur = None
        if s["time_created"] and s["time_updated"]:
            a = s["time_created"]/1000 if s["time_created"] > 1e12 else s["time_created"]
            b = s["time_updated"]/1000 if s["time_updated"] > 1e12 else s["time_updated"]
            dur = round(b - a)
        rec = {
            "id": run["id"], "cli": "opencode", "sessionId": sid,
            "model": model, "provider": provider,
            "target": {"env": run.get("env")},
            "lineage": _lineage(run, os.path.splitext(os.path.basename(run.get("promptFile") or ""))[0].replace(".prompt", "")),
            "prompt": {"file": prompt_file, "sha256": pf_sha,
                       "text": pf_text or prompt_text, "launchInstruction": prompt_text},
            "tags": sorted(set((run.get("tags") or []) + [x for x in [provider, _tier(model), "opencode", run.get("env")] if x])),
            "timing": {"startedAt": _iso(s["time_created"]), "endedAt": _iso(s["time_updated"]), "durationSec": dur},
            "tokens": {"input": s["tokens_input"], "output": s["tokens_output"], "reasoning": s["tokens_reasoning"],
                       "cacheRead": s["tokens_cache_read"], "cacheWrite": s["tokens_cache_write"]},
            "cost": s["cost"], "rounds": rounds, "toolCalls": tools,
            "errors": {"count": len(errors), "samples": errors[:30]},
            "outcome": {"status": _status_from(final_text, transcript), "finalText": final_text[:2000]},
            "cliVersion": s["version"],
        }
        return rec, transcript

# ---------------------------------------------------------------- claude code
class ClaudeAdapter(BaseAdapter):
    name = "claude"
    ready_pattern = r"esc to interrupt|Claude Code|╭|Welcome|>\s*$"

    def start_cmd(self, run, cfg):
        m = run.get("model")
        return f"claude --model {m}" if m else "claude"

    def _proj_dir(self, run, cfg):
        cwd = expand(run.get("cwd") or cfg.get("runCwd", "~"))
        slug = cwd.replace("/", "-")
        return os.path.join(os.path.expanduser("~/.claude/projects"), slug)

    def extract(self, run, cfg):
        d = self._proj_dir(run, cfg)
        files = sorted(glob.glob(os.path.join(d, "*.jsonl")), key=os.path.getmtime, reverse=True)
        if run.get("sessionId"):
            cand = [f for f in files if run["sessionId"] in f]
            files = cand or files
        if not files: return None
        path = files[0]
        rows = []
        for line in open(path, encoding="utf-8", errors="replace"):
            line = line.strip()
            if line:
                try: rows.append(json.loads(line))
                except Exception: pass
        transcript, rounds, tools, final_text, prompt_text, errors = [], 0, 0, "", None, []
        tin = tout = 0; t0 = t1 = None
        for r in rows:
            ts = r.get("timestamp"); t0 = t0 or ts; t1 = ts or t1
            msg = r.get("message") or {}
            role = msg.get("role") or r.get("type")
            usage = (msg.get("usage") or {})
            tin += usage.get("input_tokens", 0) or 0; tout += usage.get("output_tokens", 0) or 0
            content = msg.get("content")
            if isinstance(content, str):
                if role == "user" and prompt_text is None: prompt_text = content
                if role == "assistant": final_text = content
                transcript.append({"t": "text", "role": role, "text": content[:4000], "ts": ts})
            elif isinstance(content, list):
                for blk in content:
                    bt = blk.get("type")
                    if bt == "text":
                        if role == "assistant": final_text = blk.get("text", "")
                        transcript.append({"t": "text", "role": role, "text": blk.get("text", "")[:4000], "ts": ts})
                    elif bt == "tool_use":
                        tools += 1
                        transcript.append({"t": "tool", "tool": blk.get("name"),
                                           "cmd": json.dumps(blk.get("input", {}))[:600], "ts": ts})
                    elif bt == "tool_result":
                        rc = blk.get("content")
                        rc = rc if isinstance(rc, str) else json.dumps(rc)
                        if blk.get("is_error") or ERR_SIG.search(rc or ""):
                            errors.append({"tool": "tool_result", "cmd": "", "msg": _first_err(rc or ""), "ts": ts})
            if role == "assistant": rounds += 1
        prompt_file = run.get("promptFile")
        pf_text = pf_sha = None
        if prompt_file:
            pf = prompt_file if os.path.isabs(prompt_file) else os.path.join(os.path.dirname(os.path.abspath(__file__)), prompt_file)
            if os.path.exists(pf): pf_text = open(pf, encoding="utf-8").read(); pf_sha = _sha(pf_text)
        rec = {
            "id": run["id"], "cli": "claude", "sessionId": os.path.basename(path)[:-6],
            "model": run.get("model"), "provider": "anthropic",
            "target": {"env": run.get("env")},
            "lineage": _lineage(run, os.path.splitext(os.path.basename(run.get("promptFile") or ""))[0].replace(".prompt", "")),
            "prompt": {"file": prompt_file, "sha256": pf_sha, "text": pf_text or prompt_text, "launchInstruction": prompt_text},
            "tags": sorted(set((run.get("tags") or []) + [x for x in ["claude", run.get("env")] if x])),
            "timing": {"startedAt": t0, "endedAt": t1, "durationSec": None},
            "tokens": {"input": tin, "output": tout, "reasoning": None, "cacheRead": None, "cacheWrite": None},
            "cost": None, "rounds": rounds, "toolCalls": tools,
            "errors": {"count": len(errors), "samples": errors[:30]},
            "outcome": {"status": _status_from(final_text, transcript), "finalText": final_text[:2000]},
            "cliVersion": None,
        }
        return rec, transcript

# ---------------------------------------------------------------- helpers
def _lineage(run, stem=None):
    """tree position: a prototype is dispatched as batches; a batch holds runs; a run can be
    iterated into child runs (parent). depth 0 = first build, >0 = an iteration."""
    batch = run.get("batch") or (re.sub(r"[-_]?\d+$", "", stem) if stem else None)
    return {"prototype": run.get("prototype"), "batch": batch,
            "parent": run.get("parent"), "depth": run.get("depth", 0)}

def _tier(model):
    if not model: return None
    m = re.search(r"(plus|max|pro|flash|mini|opus|sonnet|haiku)", str(model), re.I)
    return m.group(1).lower() if m else None

ERR_SIG = re.compile(r'"status"\s*:\s*[45]\d\d|VALIDATION_ERROR|BAD_REQUEST|"ruleId"|RULE:|Traceback|command not found|Naming collision|Error:|Exception', re.I)
_RULE = re.compile(r'"ruleId"\s*:\s*"([^"]+)"|RULE:\s*([\w-]+)')
_MSG = re.compile(r'"message"\s*:\s*"((?:[^"\\]|\\.){4,200})"|ERROR:\s*([^\n]{4,200})|command not found[^\n]*')
def _first_err(blob):
    m = _RULE.search(blob)
    rule = (m.group(1) or m.group(2)) if m else None
    mm = _MSG.search(blob)
    msg = (mm.group(1) or mm.group(2) or mm.group(0)) if mm else ""
    msg = re.sub(r"\s+", " ", (msg or "")).strip()
    return (f"[{rule}] {msg}" if rule else msg)[:240] or "error"

DONE_RE = re.compile(r"FINAL REPORT|final report|task (is )?complete|all (pages|workflows|blocks).{0,20}(done|created|verified)", re.I)
def _status_from(final_text, transcript):
    if final_text and DONE_RE.search(final_text): return "done"
    if transcript and transcript[-1].get("t") == "tool" and transcript[-1].get("status") == "error": return "error"
    return "unknown"

ADAPTERS = {"opencode": OpencodeAdapter, "claude": ClaudeAdapter}
def get_adapter(name):
    cls = ADAPTERS.get((name or "opencode").lower())
    if not cls: raise SystemExit(f"unknown cli adapter: {name} (have: {', '.join(ADAPTERS)})")
    return cls()
