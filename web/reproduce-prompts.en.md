# Reproduce-in-NocoBase prompts (English / publishable)

The published artifact per scenario = **one short business sentence + the prototype link**. A Claude Code that has the `nocobase-prototype-repro` skill installed and a NocoBase connected will decompose and build it. Keep it short — the skill carries the how-to.

## Template
> Build a <domain> system in NocoBase: <2–4 core entities/views in one line>. Reference prototype: <PROTOTYPE_URL>
>
> (Use the `nocobase-prototype-repro` skill. The prototype HTML embeds an authoritative nb-spec — read it first.)

`<PROTOTYPE_URL>` = `https://kb.mahuan.site/prototypes/app-library/NN-*.html` (or local `http://localhost:4321/...`).

## Examples (first 5)
- **01 Inventory** — Build an inventory management system in NocoBase: items ledger + stock-in/out records, with a home dashboard (low-stock alerts, in/out trend). Reference prototype: .../01-inventory-management.html
- **02 Asset** — Build a fixed-asset management system: asset ledger (value/status/owner) + maintenance records, with an asset catalog page (left category facet, card grid, depreciation bar on each card). Reference prototype: .../02-asset-management.html
- **03 Content Calendar** — Build a content calendar: campaigns + content items, scheduled on a calendar, filterable by status/channel, with a this-month summary beside the calendar. Reference prototype: .../03-content-calendar.html
- **04 Social Media** — Build a social posting system: accounts + posts, with a composer (pick platform, write copy, live phone preview on the right) + a scheduled-posts list. Reference prototype: .../04-social-media-calendar.html
- **05 Knowledge Base** — Build a knowledge base: article categories + articles, with a search-portal home (big search box, round category cards, popular-articles list). Reference prototype: .../05-knowledge-base.html

The same one-line shape applies to all 50 scenarios — swap domain, entities/views, link, and collection prefix.
