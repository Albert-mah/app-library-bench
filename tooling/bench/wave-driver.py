#!/usr/bin/env python3
"""Continuous pipeline driver for the #61-90 round: 8 lanes (one per instance), each pulls its
next prototype the moment the current finishes. Pane-based + claude-aware (no LLM key needed):
the build prompt ends with `Self-Score: X/10`, so that line in the pane = done. Nudges stalled
lanes, collects finished ones, advances per lane until the queue drains or the deadline hits.
    nohup python3 wave-driver.py > runs/wave-driver.log 2>&1 &"""
import json, os, re, time, subprocess, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "bench.config.json")
PREFIX = "bench"                               # session = bench-<id>
LOG = lambda m: print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)
DEADLINE = time.time() + 2.0 * 3600            # stop launching new builds after 2h
TICK = 75
GIVE_UP_IDLE = 12 * 60                         # stalled+idle this long → collect & move on
NUDGE_EVERY = 4 * 60
MAX_NUDGES = 3

# done = the FINAL score line actually printed (a digit follows), not a bare "Self-Score"
# mention in the agent's plan. This was a false-done bug that killed builds early.
DONE_RE = re.compile(r"Self-?Score\s*[:：]?\s*\d|FINAL REPORT\b", re.I)
WORK_RE = re.compile(r"\(\d+[ms]\b|esc to interrupt|esc interrupt|[↑↓]\s*[\d.]+k?\s*tokens|thinking with|…\s*\(\d", re.I)
# CRITICAL: strip the claude status bar before hashing. The bar lines are INDENTED (leading
# spaces), so anchors must allow leading ws — else '  [Opus 4.8 (1M context)]' leaks in and
# '(1M' matches a work pattern → every pane reads as 'working' and nothing is ever collected.
CHROME_RE = re.compile(r"^\s*([─━—]{3,}|❯|\[(Opus|Claude|Sonnet|Haiku|GPT)|Context\b|Usage\b|Weekly\b)|bypass permissions|shift\+tab|ctrl\+|for ag|resets in|⏵⏵|tokens/s", re.I)
SETTLE = 45      # after a real done-marker, require this much stability
STALL_DONE = 200 # content unchanged this long = finished or stuck → collect & advance (no live build is silent this long; it streams tool calls / a ticking spinner)

def tmux(*a):
    return subprocess.run(["tmux", *a], capture_output=True, text=True)

def bench(*a, timeout=300):
    return subprocess.run(["python3", os.path.join(HERE, "bench.py"), *a],
                          cwd=HERE, capture_output=True, text=True, timeout=timeout)

def pane(sess):
    r = tmux("capture-pane", "-t", sess, "-p", "-S", "-50")
    return r.stdout if r.returncode == 0 else None

state = {}  # sess -> {hash, since, nudges, lastNudge}

def classify(rid):
    sess = f"{PREFIX}-{rid}"
    text = pane(sess)
    if text is None:
        return "absent", 0
    # hash CONTENT only (drop the volatile status bar) so an idle pane reads as idle
    content = [l for l in text.splitlines() if l.strip() and not CHROME_RE.search(l)]
    tail = "\n".join(content[-20:])
    h = hashlib.md5(tail.encode()).hexdigest(); now = time.time()
    s = state.setdefault(sess, {"hash": None, "since": now, "nudges": 0, "lastNudge": 0})
    if s["hash"] != h:
        s["hash"] = h; s["since"] = now
    idle = int(now - s["since"])
    # decide by whether CONTENT is changing, not by text patterns (a frozen pane can still
    # show a static 'thinking with…' line). A live build streams output / a ticking timer.
    if DONE_RE.search(tail) and idle > SETTLE:   # printed a real score line and settled
        return "done", idle
    if idle >= STALL_DONE:                         # content unchanged too long → finished/stuck
        return "stalled", idle
    return "working", idle

def nudge(rid):
    sess = f"{PREFIX}-{rid}"; s = state.get(sess, {}); now = time.time()
    if s.get("nudges", 0) >= MAX_NUDGES or now - s.get("lastNudge", 0) < NUDGE_EVERY:
        return False
    tmux("send-keys", "-t", sess,
         "继续。若已完成请输出一行 Self-Score: X/10 收尾;若卡住,一句话说明阻塞点后自主继续,别停下问我。")
    time.sleep(0.4); tmux("send-keys", "-t", sess, "Enter")
    s["nudges"] = s.get("nudges", 0) + 1; s["lastNudge"] = now
    # log to the intervention ledger so the run record shows it was assisted
    p = os.path.join(HERE, "runs", "interventions.json")
    try: d = json.load(open(p))
    except Exception: d = {}
    e = d.setdefault(rid, {"nudges": 0, "autoApprovals": 0, "events": []})
    e["nudges"] += 1; e["events"].append({"kind": "nudge", "detail": "driver", "at": time.strftime("%Y-%m-%dT%H:%M:%S")})
    json.dump(d, open(p, "w"), ensure_ascii=False, indent=1)
    return True

def main():
    cfg = json.load(open(CFG))
    order = {}
    for r in cfg["runs"]:
        order.setdefault(r["env"], []).append(r["id"])
    # RESUME-SAFE: a lane's current run = the latest of its ids with a LIVE tmux session;
    # ids before it are already done (killed), ids after are the queue. This way a restart
    # picks up in-flight builds instead of relaunching them or re-doing finished ones.
    running, lanes, done = {}, {}, []
    for env, ids in order.items():
        live = [rid for rid in ids if tmux("has-session", "-t", f"{PREFIX}-{rid}").returncode == 0]
        if live:
            cur = live[-1]; i = ids.index(cur)
            running[env] = cur; lanes[env] = ids[i + 1:]
        else:
            running[env] = ids[0] if ids else None; lanes[env] = ids[1:]
    LOG(f"driver up: {len(lanes)} lanes, running={list(running.values())}, "
        f"queued={sum(len(q) for q in lanes.values())}")
    while True:
        alive = 0
        for env, cur in list(running.items()):
            if not cur: continue
            st, idle = classify(cur)
            finished = st == "absent" or st == "done" or (st == "stalled" and idle >= STALL_DONE)
            if not finished:
                alive += 1
                continue
            LOG(f"{env}/{cur}: finished ({st}, idle={idle}s) → collect")
            try: bench("collect", "--only", cur, timeout=300)
            except Exception as e: LOG(f"  collect error: {e}")
            tmux("kill-session", "-t", f"{PREFIX}-{cur}")
            done.append(cur)
            nxt = lanes[env].pop(0) if lanes[env] else None
            if nxt and time.time() < DEADLINE:
                LOG(f"{env}: launch next → {nxt}")
                try: bench("run", "--only", nxt, timeout=240); running[env] = nxt; alive += 1
                except Exception as e: LOG(f"  launch error: {e}"); running[env] = None
            else:
                running[env] = None
                LOG(f"{env}: drained")
        rem = sum(len(q) for q in lanes.values())
        LOG(f"tick: alive={alive} done={len(done)}/{len(done)+rem+alive} queued={rem}")
        if alive == 0 and rem == 0:
            LOG(f"ALL DONE. collected {len(done)}: {done}"); break
        if time.time() >= DEADLINE and alive == 0:
            LOG(f"deadline; done={len(done)} queued={rem}"); break
        time.sleep(TICK)

if __name__ == "__main__":
    main()
