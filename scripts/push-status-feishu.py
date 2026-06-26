#!/usr/bin/env python3
"""
push-status-feishu.py — 把 app-library 示例库「基本情况」概览推到飞书(Albert)。
私用工具。数据源:public/prototypes/app-library/{library.json, build-audit.json}。
与 push-report-feishu.py 区别:那个是**逐模块**详细推送;这个是**一条概览**(每次更新后发)。

用法:
  python3 scripts/push-status-feishu.py                          # 自动概览
  python3 scripts/push-status-feishu.py --note "本次更新要点..."   # 附本次更新要点(头条)
  python3 scripts/push-status-feishu.py --dry-run                 # 只打印不发
"""
import argparse
import os
import json
import subprocess
from pathlib import Path

PROTO = Path(__file__).resolve().parent.parent / "web"
OPEN_ID = os.environ.get("FEISHU_OPEN_ID", "")  # set in .env
LINE_LABEL = {
    'main': '主应用', 'blind': 'Sonnet盲测', 'blind-dspro': 'DS-Pro盲测',
    'blind-dsflash': 'DS-Flash盲测', 'flash-retest': 'Flash重测(优化skill)', 'design': '设计线',
}


def build_text(note):
    lib = json.loads((PROTO / 'library.json').read_text())
    mods = lib.get('modules', [])
    active = [m for m in mods if m.get('status') != 'deprecated']
    built = sum(1 for m in active if m.get('built') == 'done')
    proto = sum(1 for m in active if m.get('proto'))
    # 各线覆盖
    line_cnt = {}
    for m in active:
        for k in (m.get('branches') or {}):
            line_cnt[k] = line_cnt.get(k, 0) + 1

    lines = []
    try:
        aud = json.loads((PROTO / 'build-audit.json').read_text())
        al = aud.get('lines', {})
    except Exception:
        al = {}

    out = []
    out.append("📊 企业应用示例库 — 基本情况")
    out.append(f"更新:{lib.get('updated', aud.get('generated','') if al else '')}")
    if note:
        out.append(f"\n🆕 本次:{note}")
    out.append(f"\n场景:{len(active)} 活跃 · {proto} 有原型 · {built} 已搭主应用")
    # 测试线成本/时长/自评
    out.append("\n复刻线(均价 / 均时长 / 自评):")
    order = ['blind', 'blind-dspro', 'blind-dsflash', 'flash-retest']
    for k in order:
        v = al.get(k)
        if not v:
            continue
        sc = f"{v['avg_self_score']}" if v.get('avg_self_score') else '—'
        out.append(f"  · {LINE_LABEL.get(k,k)}：{v['n']}模块 ${v['avg_cost']:.3f} / {v['avg_minutes']:.0f}min / 自评{sc}")
    # 待评审线(library 有分支但 user 未评)
    out.append(f"\n测试线覆盖:" + " ".join(f"{LINE_LABEL.get(k,k)}{n}" for k, n in sorted(line_cnt.items()) if k != 'main'))
    bg = al and aud.get('claude_project_background')
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--note', default='')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    text = build_text(a.note)
    print("---- 推送内容 ----\n" + text + "\n------------------")
    if a.dry_run:
        print("[dry-run] 未发送")
        return
    cmd = ["lark-cli", "im", "+messages-send", "--user-id", OPEN_ID, "--text", text]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode == 0:
        print("✅ 已推送飞书")
    else:
        print("❌ 推送失败:", (r.stderr or r.stdout).strip()[:300])


if __name__ == '__main__':
    main()
