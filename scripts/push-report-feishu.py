#!/usr/bin/env python3
"""
push-report-feishu.py — 把 test-report.html 里"已就绪但未推送"的模块结果批量推到飞书。

私用工具(不随 skill 发布)。数据单一真源 = test-report.html 内嵌 JSON(id="report-data")。

每个 模块×轮次 推送内容:
  1. 文本摘要:模块名 / 结论 / AI 自评分 / 用户评价(R1 原话)
  2. 对比截图(左原型右实搭,inline 图片;>4.7MB 自动改发文件)
  3. 细节 markdown(整改过程 reasoning 全文;短内容并进文本不发文件)

状态文件记录已推送 key(<round>:<module>),重复运行只推增量 —— "点一下全推未处理的"。

用法:
  python3 scripts/push-report-feishu.py                # 推所有就绪且未推送的
  python3 scripts/push-report-feishu.py --round r2     # 只看某轮
  python3 scripts/push-report-feishu.py --module 02 13 # 只看某些模块
  python3 scripts/push-report-feishu.py --dry-run      # 演练,只打印不发送
  python3 scripts/push-report-feishu.py --force        # 忽略已推送状态重推
  python3 scripts/push-report-feishu.py --reset        # 清空推送状态
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HTML = Path(__file__).resolve().parent.parent / "web" / "test-report.html"
BACKUPS = HTML.parent / "backups"   # backup-round.py 产出:<实例>-<分支>-<轮次>-<日期>.nbdata
SCORES = HTML.parent / "user-scores.json"
STATE = Path(__file__).resolve().parent / ".push-report-state.json"
PASS_SCORE = 8  # 人工分 >= 8 视为通过(用户 2026-06-07 规则)
OPEN_ID = os.environ.get("FEISHU_OPEN_ID", "")  # set in .env
MD_DIR = Path("/tmp/feishu-push")
TEXT_INLINE_LIMIT = 420   # 细节短于此并进文本,不单发 md 文件
IMG_INLINE_MB = 4.7       # 飞书 inline 图上限

VERDICT_CN = {"pass": "✅ 通过", "fix": "🔧 需修", "redo": "🔴 重做", "": "待定"}


def load_data():
    html = HTML.read_text(encoding="utf-8")
    m = re.search(r'<script type="application/json" id="report-data">(.*?)</script>', html, re.S)
    if not m:
        sys.exit("ERROR: report-data JSON block not found in " + str(HTML))
    return json.loads(m.group(1))


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {}


def save_state(state):
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1))


def lark_send(kind, path_or_text, cwd=None, dry=False):
    """kind: text | image | file。文件类用 cwd+相对路径(lark-cli 不收绝对路径)。"""
    if kind == "text":
        cmd = ["lark-cli", "im", "+messages-send", "--user-id", OPEN_ID, "--text", path_or_text]
        run_cwd = None
    else:
        p = Path(path_or_text)
        cmd = ["lark-cli", "im", "+messages-send", "--user-id", OPEN_ID, f"--{kind}", f"./{p.name}"]
        run_cwd = str(p.parent)
    if dry:
        print(f"    [dry] {kind}: {str(path_or_text)[:100]}")
        return True
    r = subprocess.run(cmd, cwd=run_cwd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        print(f"    !! lark-cli {kind} failed: {(r.stderr or r.stdout).strip()[:300]}")
        return False
    return True


def is_ready(rd):
    """就绪 = 有对比图,且 有过程说明或 AI 评分。"""
    return bool(rd.get("image")) and (rd.get("reasoning") or rd.get("aiScore") is not None)


def load_user_scores():
    """user-scores.json,兼容两种结构:{round:{module}} 旧 / {branch:{round:{module}}} 新。取 main。"""
    if not SCORES.exists():
        return {}
    d = json.loads(SCORES.read_text())
    if d and all(re.match(r"^r\d+$", k) for k in d.keys()):
        return d  # 旧结构 = main
    return d.get("main", {})


def round_passed(mod_id, mod_rounds, rid, user_scores):
    """某轮是否"通过":用户显式结论 > 人工分阈值(>=8) > AI verdict(无人工输入时)。"""
    e = user_scores.get(rid, {}).get(mod_id, {})
    if e.get("verdict") == "pass":
        return True
    if e.get("verdict") in ("fix", "redo"):
        return False
    if e.get("score") is not None:
        return e["score"] >= PASS_SCORE
    rd = mod_rounds.get(rid) or {}
    return rd.get("verdict") == "pass"


def build_md(mod, rid, rlabel, rd):
    lines = [f"# {mod['id']} {mod['name']} / {mod['en']} — {rlabel}", ""]
    if mod.get("pageUid"):
        lines += [f"- 应用页面:http://127.0.0.1:14220/admin/{mod['pageUid']}"]
    if mod.get("proto"):
        lines += [f"- 原型页:{mod['proto'].replace('http://localhost:4321', 'https://kb.mahuan.site')}"]
    lines += [f"- 评审入口:https://kb.mahuan.site/prototypes/app-library/test-report.html"]
    lines += [f"- 结论:{VERDICT_CN.get(rd.get('verdict', ''), rd.get('verdict'))}"]
    if rd.get("aiScore") is not None:
        lines += [f"- AI 自评分:{rd['aiScore']}/10"]
    if rd.get("userScore") is not None:
        lines += [f"- 用户评分:{rd['userScore']}/10"]
    if rd.get("userNote"):
        lines += ["", "## 用户评价", "", f"> {rd['userNote']}"]
    if rd.get("aiComment"):
        lines += ["", "## AI 评论", "", rd["aiComment"]]
    if rd.get("reasoning"):
        lines += ["", "## 处理过程", ""]
        lines += [f"{p}\n" for p in rd["reasoning"]]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", dest="rounds", nargs="*", help="只推这些轮次 id,如 r2")
    ap.add_argument("--module", dest="modules", nargs="*", help="只推这些模块 id,如 02 13")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="忽略已推送状态")
    ap.add_argument("--all", action="store_true", help="全部推送(默认只推上轮未通过的模块)")
    ap.add_argument("--reset", action="store_true", help="清空推送状态后退出")
    args = ap.parse_args()

    if args.reset:
        save_state({})
        print("state cleared:", STATE)
        return

    data = load_data()
    state = load_state()
    user_scores = load_user_scores()
    round_order = [r["id"] for r in data["rounds"]]
    rlabels = {r["id"]: r["label"] for r in data["rounds"]}
    queue = []
    for mod in data["modules"]:
        # 新结构 branches.main.rounds(主应用线),旧结构顶层 rounds 兼容
        mod_rounds = mod.get("branches", {}).get("main", {}).get("rounds") or mod.get("rounds", {})
        for rid, rd in mod_rounds.items():
            if args.rounds and rid not in args.rounds:
                continue
            if args.modules and mod["id"] not in args.modules:
                continue
            key = f"{rid}:{mod['id']}"
            if not is_ready(rd):
                continue
            if key in state and not args.force:
                continue
            # 默认只推"上轮未通过"的模块;首轮全推;--all 全推
            if not args.all and rid in round_order and round_order.index(rid) > 0:
                prev_rid = round_order[round_order.index(rid) - 1]
                if round_passed(mod["id"], mod_rounds, prev_rid, user_scores):
                    continue
            queue.append((key, mod, rid, rd))

    # 备份队列独立于模块队列(模块都推过了备份照样要出门)
    bk_queue = []
    if BACKUPS.exists():
        for bk in sorted(BACKUPS.glob("*-main-*.nbdata")):
            m = re.search(r"-main-(r\d+)-", bk.name)
            if not m:
                continue
            rid = m.group(1)
            if args.rounds and rid not in args.rounds:
                continue
            bkey = f"backup:{rid}:{bk.name}"
            if bkey in state and not args.force:
                continue
            bk_queue.append((bkey, rid, bk))

    if not queue and not bk_queue:
        print("nothing to push (all processed or not ready).")
        return

    by_round = {}
    for key, mod, rid, rd in queue:
        by_round.setdefault(rid, []).append((key, mod, rd))

    MD_DIR.mkdir(exist_ok=True)
    sent, failed = [], []
    for rid, items in by_round.items():
        head = f"【复刻测试报告 · {rlabels.get(rid, rid)}】本次推送 {len(items)} 个模块:" + \
               "、".join(m["id"] for _, m, _ in items) + \
               "\n交互版: https://kb.mahuan.site/prototypes/app-library/test-report.html"
        lark_send("text", head, dry=args.dry_run)
        for key, mod, rd in items:
            print(f"==> {key} {mod['name']}")
            ok = True
            md = build_md(mod, rid, rlabels.get(rid, rid), rd)
            page_line = (f"\n页面: http://127.0.0.1:14220/admin/{mod['pageUid']}"
                         if mod.get("pageUid") else "")
            summary = (f"{mod['id']} {mod['name']} / {mod['en']} — {rlabels.get(rid, rid)}\n"
                       f"结论 {VERDICT_CN.get(rd.get('verdict',''),'')} · AI {rd.get('aiScore','—')}/10"
                       f"{page_line}")
            body_len = len(md)
            if body_len <= TEXT_INLINE_LIMIT:
                ok &= lark_send("text", summary + "\n\n" + md, dry=args.dry_run)
            else:
                ok &= lark_send("text", summary + "(详情见 md 附件)", dry=args.dry_run)
            # 对比图
            img = (HTML.parent / rd["image"]).resolve()
            if img.exists():
                kind = "image" if img.stat().st_size <= IMG_INLINE_MB * 1048576 else "file"
                ok &= lark_send(kind, img, dry=args.dry_run)
            else:
                print(f"    !! image missing: {img}")
                ok = False
            # 细节 md
            if body_len > TEXT_INLINE_LIMIT:
                md_path = MD_DIR / f"{rid}-{mod['id']}-{mod['en'].replace(' ', '_')}.md"
                md_path.write_text(md, encoding="utf-8")
                ok &= lark_send("file", md_path, dry=args.dry_run)
            if ok:
                sent.append(key)
                if not args.dry_run:
                    state[key] = time.strftime("%Y-%m-%d %H:%M:%S")
                    save_state(state)
            else:
                failed.append(key)
            time.sleep(0.5)  # 轻微节流

    # 实例备份(当前状态快照)
    for bkey, rid, bk in bk_queue:
        print(f"==> {bkey}")
        size_mb = bk.stat().st_size / 1048576
        inst = bk.name.split("-")[0]
        cap = (f"【{rlabels.get(rid, rid)} · 实例备份】{bk.name}({size_mb:.1f} MB,实例 {inst})\n"
               f"本轮收口时的当前状态快照,可用 nb api backup restore-upload 恢复;"
               f"在线下载: https://kb.mahuan.site/prototypes/app-library/backups/{bk.name}")
        ok = lark_send("text", cap, dry=args.dry_run)
        ok &= lark_send("file", bk, dry=args.dry_run)
        if ok:
            sent.append(bkey)
            if not args.dry_run:
                state[bkey] = time.strftime("%Y-%m-%d %H:%M:%S")
                save_state(state)
        else:
            failed.append(bkey)

    print(f"\ndone. sent={len(sent)} failed={len(failed)}" + (f" {failed}" if failed else ""))


if __name__ == "__main__":
    main()
