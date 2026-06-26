# SPEC — Pipeline CRM (Lite) → NocoBase

> Phase-1, lean. Data modeling + native CRUD are standard → only sketched. The focus is the **homepage layout** and the **special JS** kernels.

## 1. Data model
Three collections, conventional fields/relations:
- `crm_contacts` (titleField `name`) — person + `company` string + `status` `lead|active|customer`; o2m `deals`.
- `crm_deals` (titleField `company`) — `value`, `stage` `new|qualified|proposal|negotiation|won|lost`, `source`, `close`, `lost_reason`; m2o `contact`, m2o `owner`; o2m `activities`.
- `crm_activities` (titleField `subject`) — `type` `call|email|meeting|task`, `due`, `done`; m2o `deal`.

`owner` = `users` or a small `crm_owners` ref (open Q4). No Company collection in v2 (open Q5). Derived values (days-to-close, open value, win rate) live in JS / Chart, not stored.

## 2. CRUD pages (direction only)
`crm_deals` / `crm_contacts` / `crm_activities` each get a standard native **Table + Filter + Add new + View/Edit drawer**. Nothing special — build native, not detailed here.

## 3. Home page — LAYOUT (the point)
One Modern page, top → bottom:
1. **KPI strip** — freestanding JS block, 5 numbers. → **K-KPI**
2. **Pipeline Kanban** — native **Kanban**, `groupField=stage`, drag = stage write; rich card = one JS field. → **K-card**
3. **Contacts** — native **List block + JS item** (one rich row: avatar + name + title + company, deal count · value, status tag). **Not a Table.** Click row → contact popup.
4. **Recent activity** — native **List block + JS item** (typed icon + subject + deal · owner · due + status).

Search = cross-block filter into the Kanban + Contacts List.

## 4. Popups (native ViewAction)
- **Deal drawer** — stepper (JS), facts, `crm_activities` association sub-block, stage actions (Won/Lost/Reopen native; Advance = JS action).
- **Contact drawer (wide) — related deals** — native association sub-block of `crm_deals`; the auto-selected **best-open-deal embed = JS item** (open Q2).

## 5. Special JS (the only hand-written bits)
| id | where | what |
|---|---|---|
| K-card | Kanban card field | company · contact · value · owner · days-to-close |
| K-contact | Contacts List item | rich contact row (avatar, deal count · value, status) |
| K-activity | Recent-activity List item | typed icon + subject + meta + status |
| K-KPI | freestanding block | 5 KPI numbers (aggregates) |
| K-stepper | deal drawer item | stage stepper + days-to-close |
| K-bestdeal | contact drawer item | pick best open deal + embed its detail + deal selector |
| K-advance | deal action | compute next stage, write + refresh |

Everything else = native fields / blocks.

## 6. Open questions (decide before build)
1. Home: Kanban + two Lists stacked = long scroll — keep, or move one to a tab / second row?
2. Best-open-deal embed: **K-bestdeal** JS item (full embed) vs native master-detail (simpler, no embed).
3. New Deal: create `contact` + `deal` in one form — relation-picker inline-create OK, or must stay one flat form?
4. `owner` = `users` vs `crm_owners`.
5. Company as flat string (v2) vs `crm_companies` (v3).
