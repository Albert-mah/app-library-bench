#!/usr/bin/env python3
"""Expose the bench's LIVE state. The primary view is tmux-driven (what is actually
running right now); the opencode-DB matrix view is kept for historical/manual use.
Output JSON to stdout.

  bench-live.py --live                      # ⭐ real tmux sessions: status + last line (+ run brief)
  bench-live.py --pane <session>            # the live tmux pane text for one session
  bench-live.py --list                      # (legacy) opencode-DB cell matrix by prompt name
  bench-live.py --session <id> --page N     # paginated opencode activity stream for one session
"""
import sqlite3, os, json, re, sys, argparse, time, glob, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("OPENCODE_DB") or os.path.expanduser("~/.local/share/opencode/opencode.db")
SCEN = {"01": "inventory", "02": "asset", "03": "content-calendar"}
ENVF = {"01": "expagents", "02": "fable14232", "03": "flash14231"}

def con():
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)
    c.row_factory = sqlite3.Row
    return c

def model_short(raw):
    if not raw: return "?"
    s = str(raw)
    m = re.search(r"qwen3\.7-(plus|max)", s)
    if m: return "qwen-" + m.group(1)
    try:
        d = json.loads(s); v = d.get("modelID") or d.get("model") or ""
        m = re.search(r"(plus|max)", v);  return "qwen-" + m.group(1) if m else v
    except Exception:
        return s[:24]

def first_prompt_cell(c, sid):
    """flow-scenario from the first message/part referencing tui/<flow>-<scn>.prompt.txt"""
    blob = ""
    for p in c.execute("SELECT data FROM part WHERE session_id=? ORDER BY time_created ASC LIMIT 8", (sid,)):
        blob += p["data"] or ""
    for m in c.execute("SELECT data FROM message WHERE session_id=? ORDER BY time_created ASC LIMIT 4", (sid,)):
        blob += m["data"] or ""
    m = re.search(r"(pure|html)-(0[123])\.prompt", blob)
    return (m.group(1), m.group(2)) if m else (None, None)

def part_summary(d):
    t = d.get("type")
    if t == "text":      return ("say",  (d.get("text") or "").strip())
    if t == "reasoning": return ("think",(d.get("text") or "").strip())
    if t == "tool":
        st = (d.get("state") or {})
        inp = st.get("input") or {}
        cmd = inp.get("command") or inp.get("filePath") or inp.get("description") or ""
        return ("tool", f"{d.get('tool')}: {str(cmd)[:120]}".strip())
    if t == "step-finish":
        tk = d.get("tokens") or {}
        return ("step", f"+{tk.get('output',0)} out tok")
    return (t or "?", "")

def session_status(c, sid):
    """done if final report present; else working/stalled by recency."""
    last = c.execute("SELECT data,time_created FROM part WHERE session_id=? ORDER BY time_created DESC LIMIT 30", (sid,)).fetchall()
    done = False
    for r in last:
        try: d = json.loads(r["data"])
        except Exception: continue
        if d.get("type") == "text" and re.search(r"schemaUid|Successfully|Built|完成|page schema|Final Report|report[- ]?:|all (pages|blocks)|done\b", d.get("text") or "", re.I):
            done = True; break
    upd = c.execute("SELECT MAX(time_updated) FROM part WHERE session_id=?", (sid,)).fetchone()[0] or 0
    now = int(time.time()*1000)
    age = (now - upd)/1000 if upd else 1e9
    if done: return "done", age
    return ("working" if age < 120 else "stalled"), age

def do_list():
    c = con()
    cells = {}  # key flow-scn -> best session
    for r in c.execute("SELECT id,title,model,tokens_input,tokens_output,cost,time_created,time_updated FROM session ORDER BY time_created DESC LIMIT 60"):
        flow, scn = first_prompt_cell(c, r["id"])
        if not flow: continue
        mdl = model_short(r["model"])
        key = f"{mdl}-{flow}-{scn}"  # model+flow+scenario → full 2x2x3 matrix, no cross-round collision
        # keep the most-recent session per cell key (latest round)
        if key in cells and r["time_created"] <= cells[key]["_t"]: continue
        status, age = session_status(c, r["id"])
        # last activity snippet
        snip = ""
        for p in c.execute("SELECT data FROM part WHERE session_id=? ORDER BY time_created DESC LIMIT 12", (r["id"],)):
            try: d = json.loads(p["data"])
            except Exception: continue
            kind, txt = part_summary(d)
            if kind in ("say","tool","think") and txt:
                snip = f"[{kind}] {txt[:140]}"; break
        npart = c.execute("SELECT count(*) FROM part WHERE session_id=?", (r["id"],)).fetchone()[0]
        cells[key] = {
            "_t": r["time_created"], "cell": key, "flow": flow, "scenario": scn,
            "scenarioName": SCEN.get(scn,""), "env": ENVF.get(scn,""),
            "session": r["id"], "title": r["title"], "model": model_short(r["model"]),
            "tokensIn": r["tokens_input"], "tokensOut": r["tokens_output"], "cost": r["cost"],
            "parts": npart, "status": status, "ageSec": round(age,1), "last": snip,
        }
    out = sorted(({k: v for k, v in cell.items() if k != "_t"} for cell in cells.values()),
                 key=lambda x: (x["flow"], x["scenario"]))
    print(json.dumps({"updated": int(time.time()), "cells": out}, ensure_ascii=False))

def do_session(sid, page, size, tail=False):
    c = con()
    total = c.execute("SELECT count(*) FROM part WHERE session_id=?", (sid,)).fetchone()[0]
    if tail:
        rows = list(reversed(c.execute("SELECT data,time_created FROM part WHERE session_id=? ORDER BY time_created DESC LIMIT ?",
                     (sid, size)).fetchall()))
    else:
        rows = c.execute("SELECT data,time_created FROM part WHERE session_id=? ORDER BY time_created ASC LIMIT ? OFFSET ?",
                     (sid, size, page*size)).fetchall()
    items = []
    for r in rows:
        try: d = json.loads(r["data"])
        except Exception: continue
        kind, txt = part_summary(d)
        if not txt and kind not in ("step",): continue
        items.append({"kind": kind, "text": txt[:2000], "ts": r["time_created"]})
    print(json.dumps({"session": sid, "page": page, "size": size, "total": total, "items": items}, ensure_ascii=False))

# ---------------------------------------------------------------- tmux-driven LIVE view
def _tmux(*a):
    try: return subprocess.run(["tmux", *a], capture_output=True, text=True, timeout=5)
    except Exception: return None

PERM_RE = re.compile(r"Allow always|Allow this|Approve|grant permission|\(y/N\)|Yes, and|❯\s*Allow", re.I)
PANE_DONE_RE = re.compile(r"FINAL REPORT|final report|task (is )?complete|all (pages|workflows|blocks).{0,20}(done|created|verified)", re.I)
WORK_RE = re.compile(r"esc to interrupt|esc interrupt|Thinking|Building|Running|Esc to|Working|✶|✻|◐|◓|◑|◒|·\s*$")

def _pane(name, lines=60):
    r = _tmux("capture-pane", "-t", name, "-p", "-S", f"-{lines}")
    return r.stdout if (r and r.returncode == 0) else ""

def _pane_dead(name):
    r = _tmux("list-panes", "-t", name, "-F", "#{pane_dead}")
    return bool(r and r.returncode == 0 and "1" in (r.stdout or ""))

def _classify_pane(text, dead=False):
    lines = [l for l in text.strip().splitlines() if l.strip()]
    tail = "\n".join(lines[-30:])
    if dead: return "ended"
    if not tail: return "idle"
    if PERM_RE.search(tail): return "permission"
    if PANE_DONE_RE.search(tail): return "done"
    if WORK_RE.search(tail): return "working"
    return "idle"

def _last_line(text):
    ls = [l.strip() for l in text.strip().splitlines() if l.strip()]
    return ls[-1][:160] if ls else ""

def _briefs_by_session():
    out = {}
    for f in glob.glob(os.path.join(HERE, "runs", "briefs", "*.json")):
        try: b = json.load(open(f))
        except Exception: continue
        if b.get("tmuxSession"): out[b["tmuxSession"]] = b
    return out

def do_live(prefix=None):
    """Real tmux sessions = what is actually running. Grouped sessions (interactive
    multiplexers like main/pc/phone) are skipped; a matching run brief adds context."""
    r = _tmux("list-sessions", "-F",
              "#{session_name}\t#{session_created}\t#{session_attached}\t#{session_group}")
    sessions = []
    if r and r.returncode == 0:
        briefs = _briefs_by_session(); now = time.time()
        for line in r.stdout.strip().splitlines():
            p = (line.split("\t") + ["", "", "", ""])[:4]
            name, created, attached, group = p
            if group: continue                       # grouped = interactive multiplexer, not a run
            if prefix and not name.startswith(prefix): continue
            dead = _pane_dead(name); text = _pane(name, 60)
            b = briefs.get(name, {})
            sessions.append({
                "name": name, "status": _classify_pane(text, dead),
                "ageSec": round(now - int(created)) if created.isdigit() else None,
                "attached": attached == "1", "last": _last_line(text),
                "run": ({"id": b.get("id"), "env": b.get("env"), "model": b.get("model"),
                         "recipe": b.get("recipe"), "goal": b.get("goal")} if b else None),
            })
    order = {"permission": 0, "working": 1, "idle": 2, "done": 3, "ended": 4}
    sessions.sort(key=lambda s: (order.get(s["status"], 9), s["name"]))
    print(json.dumps({"updated": int(time.time()), "sessions": sessions}, ensure_ascii=False))

def do_pane(name, lines=200):
    dead = _pane_dead(name); text = _pane(name, lines)
    print(json.dumps({"name": name, "pane": text[-20000:], "status": _classify_pane(text, dead),
                      "dead": dead, "updated": int(time.time())}, ensure_ascii=False))

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--pane")
    ap.add_argument("--prefix")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--session")
    ap.add_argument("--page", type=int, default=0)
    ap.add_argument("--size", type=int, default=40)
    ap.add_argument("--lines", type=int, default=200)
    ap.add_argument("--tail", action="store_true")
    a = ap.parse_args()
    try:
        if a.pane: do_pane(a.pane, a.lines)
        elif a.session: do_session(a.session, a.page, a.size, a.tail)
        elif a.list: do_list()
        else: do_live(a.prefix)
    except Exception as e:
        print(json.dumps({"error": str(e)})); sys.exit(1)
