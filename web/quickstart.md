# Quick Start — Run NocoBase and let your AI build the app

This is a one-time setup. Once it's done, open any app in the series, copy the prompt block, and paste it to your AI coding agent — it will reproduce the prototype in your NocoBase instance for you.

## 0. Prerequisites

- **Docker** — Docker Desktop, or OrbStack on macOS. Install it and make sure it's running.
- **Node.js 18+** — used to install the NocoBase CLI (`node -v` should print a version).

## 1. Install the NocoBase CLI

```bash
npm i -g @nocobase/cli@beta
```

Keep the `@beta` tag. The default install is an older build that has **no `nb init` / `nb api` commands**, and your AI needs those to operate the system. Verify with `nb -v` — you should see `2.1.0-beta.x`.

## 2. Create an instance and register it

```bash
nb init --yes --env app --source docker \
  --auth-type=basic --username=admin@nocobase.com --password=Admin123! \
  --db-dialect=postgres --db-underscored
```

This pulls the image, starts a fresh NocoBase at `http://localhost:13000`, and registers it as the environment named **`app`** (you and your AI operate it with `nb api -e app ...`).

- **Apple Silicon (M-series):** add `--docker-platform=auto`.
- **Mainland China:** add `--docker-registry=registry.cn-shanghai.aliyuncs.com/nocobase/nocobase` for a faster pull.
- **Do not pin an old image tag** (e.g. `--version beta-full`). Older images are missing the page-building plugins, so the AI can create the data but the pages render blank. Leaving `--version` off uses the image that matches your CLI, which is what you want.

Verify it's up: run `nb env info app`, then open `http://localhost:13000` and log in with the account above.

## 3. Install the build skill

```bash
nb skills add nocobase-prototype-repro
```

If your CLI doesn't have a skills source configured, download the skill pack from `<SKILL_PACK_URL>` and unzip it into `~/.agents/skills/` instead. This is the playbook your AI follows to turn a prototype into a working NocoBase app — results are much better with it installed.

## 4. Hand it to your AI agent

Open any app in the series and copy its prompt block. It looks like this — the first paragraph is the same everywhere, the second is specific to that app:

```
I've set up NocoBase per the Quick Start: the CLI and the nocobase-prototype-repro
skill are installed, and my instance is the nb env `app` (operate it with
`nb api -e app`). Read the skill first, then build the app below end to end —
data model, English seed data, list pages, and the signature page — checking your
screenshots against the prototype until they match.

Build a NocoBase app — Employee Directory: a search hero, multi-select facets, and
avatar cards. Match the layout and signature visuals of this reference prototype:
https://static-docs.nocobase.com/solution/templates/19-employee-directory.html
```

Paste it to your AI coding agent (Claude Code, opencode, …). When it finishes you'll get the instance URL, the tables it created, and a link to the main page.

## Troubleshooting

- **A laptop that sleeps mid-build interrupts everything.** On macOS, run `caffeinate -dimsu &` before you start, or turn off auto-sleep.
- **Docker stops responding / commands hang.** Restart Docker. For OrbStack: quit it from the menu bar and reopen, or `pkill -9 OrbStack && open -ga OrbStack`.
- **`nb init` pulls the image and then times out installing plugins.** The container is usually already running — just attach to it with `nb env add app -u http://localhost:13000/api -a basic` and continue.
- **Pages render but show no data / empty cards.** You're almost certainly on an old image without the page-building plugins — recreate the instance without pinning `--version` (see step 2).
