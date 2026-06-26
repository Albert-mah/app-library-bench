# 拆解设计稿 — Pipeline CRM (Lite) → NocoBase

> Phase-1 精简版。数据建模 + 原生 CRUD 都很标准 → 只点方向。重点是**首页布局**和**特殊 JS** 部分。技术标识保留英文。

## 1. 数据模型
三个 collection,常规字段/关系:
- `crm_contacts`(titleField `name`)— 人 + `company` 字符串 + `status` `lead|active|customer`;o2m `deals`。
- `crm_deals`(titleField `company`)— `value`、`stage` `new|qualified|proposal|negotiation|won|lost`、`source`、`close`、`lost_reason`;m2o `contact`、m2o `owner`;o2m `activities`。
- `crm_activities`(titleField `subject`)— `type` `call|email|meeting|task`、`due`、`done`;m2o `deal`。

`owner` 用 `users` 或小 `crm_owners` 引用表(待定 Q4)。v2 不建 Company 表(待定 Q5)。派生值(days-to-close、open value、win rate)走 JS / Chart,不落库。

## 2. CRUD 页面(只给方向)
`crm_deals` / `crm_contacts` / `crm_activities` 各自标准原生 **Table + Filter + Add + View/Edit 抽屉**。无特殊,原生搭即可,不展开。

## 3. 首页 — 布局(重点)
一张 Modern 页,自上而下:
1. **KPI 条** — 独立 JS block,5 个数字。→ **K-KPI**
2. **Pipeline Kanban** — 原生 **Kanban**,`groupField=stage`,拖拽 = 写 stage;富卡片 = 一个 JS field。→ **K-card**
3. **Contacts** — 原生 **List block + JS item**(一个富行:头像 + name + title + company、deal 数 · 金额、status 标签)。**不用 Table。** 点行 → 联系人弹窗。
4. **Recent activity** — 原生 **List block + JS item**(类型图标 + subject + deal · owner · due + 状态)。

搜索 = 跨块 filter 到 Kanban + Contacts List。

## 4. 弹窗(原生 ViewAction)
- **Deal 抽屉** — stepper(JS)、facts、`crm_activities` association 子块、阶段操作(Won/Lost/Reopen 原生;Advance = JS action)。
- **Contact 抽屉(宽)— 关联商机** — `crm_deals` 原生 association 子块;自动选中的**最佳进行中商机内嵌 = JS item**(待定 Q2)。

## 5. 特殊 JS(唯一手写的部分)
| id | 位置 | 做什么 |
|---|---|---|
| K-card | Kanban 卡片 field | company · contact · value · owner · days-to-close |
| K-contact | Contacts List item | 富联系人行(头像、deal 数 · 金额、status) |
| K-activity | Recent-activity List item | 类型图标 + subject + meta + 状态 |
| K-KPI | 独立 block | 5 个 KPI 数字(聚合) |
| K-stepper | deal 抽屉 item | 阶段 stepper + days-to-close |
| K-bestdeal | contact 抽屉 item | 选最佳进行中商机 + 内嵌详情 + deal 切换器 |
| K-advance | deal action | 算下一阶段,写入 + 刷新 |

其余 = 原生字段 / 块。

## 6. 待定问题(搭建前定)
1. 首页:Kanban + 两个 List 竖叠 = 长滚动 — 保留,还是把一个收进 tab / 第二屏?
2. 最佳商机内嵌:**K-bestdeal** JS item(整块内嵌)vs 原生 master-detail(简单,无内嵌)。
3. New Deal:一张表单建 `contact` + `deal` — 关系选择器内联建 OK,还是必须一张扁平表单?
4. `owner` = `users` vs `crm_owners`。
5. Company 扁平字符串(v2)vs `crm_companies`(v3)。
