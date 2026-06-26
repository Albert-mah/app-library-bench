#!/usr/bin/env python3
"""Auto-correlated bench summary. Joins opencode.db (per-cell tokens / duration /
iterations / attempts, auto-associated by prompt-file + session.model) with
library.json (recorded aiScore / verdict) and writes a markdown + JSON report.

  bench-summary.py            # print markdown to stdout
  bench-summary.py --json     # also print the JSON blob
  bench-summary.py --out DIR  # write bench-summary.md + bench-summary.json into DIR
"""
import sqlite3, os, json, re, sys, argparse
from collections import defaultdict

DB = os.environ.get("OPENCODE_DB") or os.path.expanduser("~/.local/share/opencode/opencode.db")
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = f"{REPO}/web/library.json"
SCN = {"01": "inventory", "02": "asset", "03": "content-cal"}
MODELS = ["qwen-plus", "qwen-max"]
FLOWS = ["pure", "html"]

def model_short(raw):
    s = str(raw or "")
    m = re.search(r"qwen3\.7-(plus|max)", s)
    return "qwen-" + m.group(1) if m else "?"

def cell_of(con, sid):
    blob = ""
    for p in con.execute("SELECT data FROM part WHERE session_id=? ORDER BY time_created LIMIT 8", (sid,)):
        blob += p["data"] or ""
    for m in con.execute("SELECT data FROM message WHERE session_id=? ORDER BY time_created LIMIT 4", (sid,)):
        blob += m["data"] or ""
    m = re.search(r"(pure|html)-(0[123])\.prompt", blob)
    return (m.group(1), m.group(2)) if m else (None, None)

def scores_from_lib():
    out = {}
    try:
        d = json.load(open(LIB))
    except Exception:
        return out
    for mod in d.get("modules", []):
        num = str(mod.get("num"))
        for bid, b in (mod.get("branches") or {}).items():
            if not bid.startswith("bench-"):
                continue
            model = "qwen-max" if "qmax" in bid else ("qwen-plus" if "qplus" in bid else "?")
            flow = "html" if bid.endswith("html") else "pure"
            r1 = (b.get("rounds") or {}).get("r1") or {}
            out[(model, flow, num)] = {"score": r1.get("aiScore"), "verdict": r1.get("verdict")}
    return out

def build():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5); con.row_factory = sqlite3.Row
    # collect sessions per cell key (model,flow,scn); keep all attempts
    cells = defaultdict(list)
    for r in con.execute("SELECT id,model,tokens_input,tokens_output,time_created,time_updated FROM session ORDER BY time_created"):
        flow, scn = cell_of(con, r["id"])
        if not flow:
            continue
        mdl = model_short(r["model"])
        if mdl == "?":
            continue
        npart = con.execute("SELECT count(*) FROM part WHERE session_id=?", (r["id"],)).fetchone()[0]
        dur = max(0, (r["time_updated"] - r["time_created"]) / 60000.0)  # minutes
        cells[(mdl, flow, scn)].append({
            "session": r["id"], "tokIn": r["tokens_input"], "tokOut": r["tokens_output"],
            "parts": npart, "durMin": round(dur, 1),
        })
    scores = scores_from_lib()
    rows = []
    for mdl in MODELS:
        for flow in FLOWS:
            for scn in ("01", "02", "03"):
                attempts = cells.get((mdl, flow, scn), [])
                latest = attempts[-1] if attempts else None
                sc = scores.get((mdl, flow, scn), {})
                recorded = sc.get("score") is not None
                rows.append({
                    "model": mdl, "flow": flow, "scenario": scn, "scenarioName": SCN[scn],
                    "attempts": len(attempts),
                    "tokOut": latest["tokOut"] if latest else 0,
                    "parts": latest["parts"] if latest else 0,
                    "durMin": latest["durMin"] if latest else 0,
                    "score": sc.get("score"), "verdict": sc.get("verdict"),
                    "status": ("recorded" if recorded else ("ran" if latest else "not-started")),
                })
    # aggregates
    def agg(filt):
        rs = [r for r in rows if filt(r) and r["status"] != "not-started"]
        n = len(rs)
        if not n: return {"n": 0}
        sc = [r["score"] for r in rs if r["score"] is not None]
        return {"n": n, "avgTokOut": round(sum(r["tokOut"] for r in rs) / n),
                "avgParts": round(sum(r["parts"] for r in rs) / n),
                "avgDurMin": round(sum(r["durMin"] for r in rs) / n, 1),
                "avgScore": round(sum(sc) / len(sc), 2) if sc else None,
                "retries": sum(1 for r in rs if r["attempts"] > 1)}
    summary = {
        "byModel": {m: agg(lambda r, m=m: r["model"] == m) for m in MODELS},
        "byFlow": {f: agg(lambda r, f=f: r["flow"] == f) for f in FLOWS},
        "byCondition": {f"{m}·{f}": agg(lambda r, m=m, f=f: r["model"] == m and r["flow"] == f) for m in MODELS for f in FLOWS},
        "overall": agg(lambda r: True),
    }
    failures = [r for r in rows if r["status"] != "not-started" and ((r["score"] is not None and r["score"] < 5) or r["tokOut"] < 3000)]
    return {"rows": rows, "summary": summary, "failures": failures}

def md(data):
    L = []
    L.append("# Bench 自动汇总 — model × flow × scenario\n")
    done = sum(1 for r in data["rows"] if r["status"] != "not-started")
    L.append(f"已跑 **{done}/12** 格 · 已录入评分 **{sum(1 for r in data['rows'] if r['status']=='recorded')}**\n")
    L.append("## 每格明细\n")
    L.append("| 模型 | 流程 | 场景 | 状态 | 出tok | 迭代(parts) | 时长(min) | 重试 | 分 |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for r in data["rows"]:
        sc = "" if r["score"] is None else r["score"]
        rt = "⚠️%d" % r["attempts"] if r["attempts"] > 1 else ""
        L.append(f"| {r['model']} | {r['flow']} | #{r['scenario']} {r['scenarioName']} | {r['status']} | {r['tokOut']} | {r['parts']} | {r['durMin']} | {rt} | {sc} |")
    L.append("\n## 聚合\n")
    L.append("| 维度 | n | 均出tok | 均迭代 | 均时长 | 均分 | 含重试 |")
    L.append("|---|---|---|---|---|---|---|")
    def line(name, a):
        if not a.get("n"): return f"| {name} | 0 | — | — | — | — | — |"
        return f"| {name} | {a['n']} | {a['avgTokOut']} | {a['avgParts']} | {a['avgDurMin']} | {a.get('avgScore')} | {a.get('retries',0)} |"
    for m in MODELS: L.append(line(f"模型 {m}", data["summary"]["byModel"][m]))
    for f in FLOWS: L.append(line(f"流程 {f}", data["summary"]["byFlow"][f]))
    for k, a in data["summary"]["byCondition"].items(): L.append(line(f"条件 {k}", a))
    L.append(line("全部", data["summary"]["overall"]))
    if data["failures"]:
        L.append("\n## ⚠️ 失败/偏弱格(分<5 或 出tok<3k)\n")
        for r in data["failures"]:
            L.append(f"- {r['model']}·{r['flow']}·#{r['scenario']} — 出tok {r['tokOut']}, 分 {r['score']}, 重试 {r['attempts']}")
    else:
        L.append("\n_无失败/偏弱格_\n")
    return "\n".join(L)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args()
    data = build()
    text = md(data)
    print(text)
    if a.json:
        print("\n<!-- JSON -->\n" + json.dumps(data, ensure_ascii=False))
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        open(f"{a.out}/bench-summary.md", "w").write(text)
        json.dump(data, open(f"{a.out}/bench-summary.json", "w"), ensure_ascii=False, indent=2)
