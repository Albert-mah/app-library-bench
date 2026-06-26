#!/usr/bin/env python3
"""Read opencode.db (read-only) and expose the TUI bench's live sessions,
auto-associated to matrix cells by the prompt-file referenced in each session's
first user message. Output JSON to stdout.

  bench-live.py --list                      # 12-cell summary (status/model/tokens/last activity)
  bench-live.py --session <id> --page N     # paginated activity stream for one session
"""
import sqlite3, os, json, re, sys, argparse, time

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

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--session")
    ap.add_argument("--page", type=int, default=0)
    ap.add_argument("--size", type=int, default=40)
    ap.add_argument("--tail", action="store_true")
    a = ap.parse_args()
    try:
        if a.session: do_session(a.session, a.page, a.size, a.tail)
        else: do_list()
    except Exception as e:
        print(json.dumps({"error": str(e)})); sys.exit(1)
