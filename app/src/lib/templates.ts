// One-click templates for NocoBase prototype experiments.
//  · NB_EXPERIMENT — the standard reproduction *requirement* (filled into the create form:
//    goal / background / success criteria, and a ready-to-send build prompt body).
//  · nbResultHtml() — the *result presentation* doc (filled into the result-HTML box, then
//    auto-screenshotted into a cover image). Both are click-to-autofill, then edit.

export const NB_EXPERIMENT = {
  goal: '用 nb CLI 在目标 NocoBase 实例端到端复刻该原型:数据建模 → 英文种子 → 列表页 → 招牌视图,视觉自查对齐 ≥80%。',
  background:
    '前置物料:① nb CLI 已装并配好目标 env ② nocobase skills(prototype-repro / data-modeling / ui-builder / app-discipline)③ 本地 Docker。\n' +
    '工作流:先出 SPEC(数据模型 + 每个区域 → 原生块 映射)→ 数据建模一次过(不边建边改)→ 原生 CRUD + 英文种子(覆盖每个枚举分支)→ 逐区块精修到招牌视图 → 截图对比自查。',
  criteria: [
    '所有 collection / 字段 / 关系按 SPEC 建出,关系数对得上',
    '每个主表种子 ≥2 行,覆盖所有枚举/状态分支,全英文',
    '列表页 Filter + Add + Table + View drawer 可用;子表用 associationName + sourceId 按父 id 自动过滤',
    '招牌区块用对原生块(看板/卡片/日历/图表),不是清一色表格',
    'Playwright 无缓存打开页面无报错;视觉与原型对齐 ≥80%',
    '报告:collection 列表、招牌页 pageUid、Self-Score、对比观察、已知 gap/取舍',
  ],
  prompt:
    '把本页/附件原型当作用户需求,用 nb CLI 在目标 NocoBase env 端到端复刻:\n' +
    '1) 先读 nocobase-prototype-repro skill 的 SKILL.md + references/,产出 SPEC(数据模型 + 每个区域 → 原生块 映射);\n' +
    '2) 数据建模一次过(collections / fields / relations,不边建边改);\n' +
    '3) 英文种子,覆盖每个枚举/状态分支,密度足够;\n' +
    '4) 列表页(Filter + Add + Table + View drawer + 子表)→ 逐区块精修招牌视图;\n' +
    '5) 截图对比原型做视觉自查到 ≥80%。\n' +
    '完成后报告:collection 列表、招牌页 pageUid、Self-Score(0-10)、对比观察、已知 gap/取舍。\n' +
    '全程自主多轮推进,不要停下来问我;始终显式 -e <env>。',
};

const esc = (s: string) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

// result-presentation scaffold — a clean styled doc the observer/human fills after a build,
// which the server auto-screenshots into the round's cover image (规范:结果必须有可视化).
export function nbResultHtml(name = '原型') {
  const t = esc(name);
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t} · 复刻结果</title><style>
body{margin:0;font:14px/1.7 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1f2329;background:#f7f8fa}
.doc{max-width:840px;margin:0 auto;padding:28px 26px 56px;background:#fff;min-height:100vh}
h1{font-size:22px;margin:0 0 2px}.meta{color:#8a9099;font-size:13px;margin:0 0 18px}
h3{font-size:15px;margin:20px 0 6px;border-left:3px solid #1677ff;padding-left:8px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #e5e6eb;padding:6px 9px;text-align:left}
.score{display:inline-block;font-size:26px;font-weight:700;color:#1677ff}ul{margin:6px 0;padding-left:20px}
.shot{width:100%;border:1px solid #e5e6eb;border-radius:8px;margin-top:8px}.ph{color:#bbb;font-style:italic}
</style></head><body><div class="doc">
<h1>${t} · NocoBase 复刻结果</h1>
<p class="meta">模型: __ · env: __ · 轮次: r_ · 日期: ____-__-__</p>

<h3>🎯 自评分 Self-Score</h3>
<p><span class="score">_ / 10</span> &nbsp; 结论: pass / fix / redo</p>

<h3>🧱 搭建产出</h3>
<table><tr><th>类别</th><th>产出</th></tr>
<tr><td>Collections</td><td>列出建出的集合 + 字段/关系数</td></tr>
<tr><td>Pages</td><td>列表页 / 招牌页(pageUid: ____)</td></tr>
<tr><td>Workflow / 其他</td><td>(如有)</td></tr>
</table>

<h3>🔍 视觉对比观察(原型 vs 复刻)</h3>
<ul><li>对齐到位的点:…</li><li>差异 / 未还原的点:…</li></ul>

<h3>⚠️ 已知 gap / 取舍</h3>
<ul><li>…</li></ul>

<h3>📷 截图</h3>
<p class="ph">把对比图 / 复刻结果图贴这里(&lt;img class="shot" src="…"&gt;)。本页会被自动截图为封面。</p>
</div></body></html>`;
}
