# Build an Inventory Management app with AI — in one paste

A stock system that actually moves: inbound and outbound entries that update on-hand
balances automatically, status transitions on each record, and summary charts that read
the live ledger. You don't build it by hand — you hand the prompt below to your AI coding
agent and it reproduces the whole thing in your own NocoBase instance.

**Live prototype:** https://static-docs.nocobase.com/solution/templates/01-inventory-management.html

![Inventory Management](https://static-docs.nocobase.com/solution/templates/01-inventory-management.html)

---

## What you'll get

| | |
|---|---|
| **Tables** | Items (catalog), Stock (on-hand by item), Inbound, Outbound |
| **Linkage** | An inbound row raises on-hand; an outbound row lowers it — no manual recount |
| **Status flow** | Draft → Confirmed → Done buttons on each entry |
| **Signature page** | KPI cards + inbound/outbound trend chart + low-stock alert table + value-by-category ring |
| **Seed data** | A handful of items and movements in English, so the charts render on first open |

---

## Before you start (one time)

You need a running NocoBase instance and the NocoBase CLI so your AI agent can operate it.
If you've already done this for another app in the series, skip ahead — it's the same setup.

👉 **[Quick Start — install the CLI, create an instance, install the skill](https://static-docs.nocobase.com/solution/quickstart.html)**

It takes about 5 minutes: `npm i -g @nocobase/cli@beta`, `nb init` to spin up a fresh
instance on `localhost:13000`, then `nb skills add nocobase-prototype-repro`.

---

## Build it

Copy this whole block and paste it to your AI coding agent (Claude Code, opencode, …).
The first paragraph is the same for every app in the series; the second is this app.

```
I've set up NocoBase per the Quick Start: the CLI and the nocobase-prototype-repro
skill are installed, and my instance is the nb env `app` (operate it with
`nb api -e app`). Read the skill first, then build the app below end to end —
data model, English seed data, list pages, and the signature page — checking your
screenshots against the prototype until they match.

Build a NocoBase app — Inventory Management: inbound/outbound linkage, status
transitions, and summary charts. Match the layout and signature visuals of this
reference prototype:
https://static-docs.nocobase.com/solution/templates/01-inventory-management.html
```

When it finishes you'll get the instance URL, the tables it created, and a link to the
signature page. Open it and compare against the live prototype above.

---

## Notes

- **It's your data, your instance.** Everything runs locally against the instance you
  created in the Quick Start — nothing is sent anywhere.
- **Want to tweak the spec?** Edit the second paragraph before you paste — add a field,
  rename a status, ask for a different chart. The agent follows your wording.
- **Stuck on a blank page or a sleeping laptop?** See the Troubleshooting section of the
  Quick Start.
