#!/usr/bin/env bash
# tui-round.sh <plus|max> <pure|html>
# Round-aware bench launcher. Preserves ALL builds (no resets):
#   - instances partitioned BY MODEL (plus set vs max set) — different models NEVER share an instance.
#   - the two flows of the same model+scenario COEXIST in one instance, namespaced by collection prefix:
#       pure -> no prefix (first build) ; html -> "h_" prefix + 'HTML' menu-group suffix (second build).
#   - one scenario per instance per round (no same-instance concurrency races).
# Watch a cell: tmux attach -t bench-<model>-<flow>-<scenario>
set -u
MK=${1:-}; FLOW=${2:-}
case "$MK" in
  plus) M=bailian-payg/qwen3.7-plus; ENVS=(expagents fable14232 flash14231);;
  max)  M=bailian-payg/qwen3.7-max;  ENVS=(maxbench01 maxbench02 maxbench03);;
  *) echo "usage: tui-round.sh <plus|max> <pure|html>"; exit 1;;
esac
case "$FLOW" in
  pure) PREFIX="";;
  html) PREFIX="h_";;
  *) echo "flow must be pure|html"; exit 1;;
esac
SCN=(01 02 03)
PROTO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/web"
declare -A PROTO=([01]=01-inventory-management.html [02]=02-asset-management.html [03]=03-content-calendar.html)
declare -A DESC
DESC[01]="Build an inventory management system: an items ledger + stock-in/out records, with a home dashboard (low-stock alerts, in/out trend)."
DESC[02]="Build a fixed-asset management system: an asset ledger (value/status/owner) + maintenance records, with an asset catalog page (left category facet, card grid, a depreciation bar on each card)."
DESC[03]="Build a content calendar: campaigns + content items scheduled on a calendar, filterable by status/channel, with a this-month summary beside the calendar."
BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tui"
mkdir -p "$BENCH"
# set opencode default model for this round (all 3 sessions share it)
python3 -c "import json,os;P=os.path.expanduser('~/.config/opencode/opencode.json');d=json.load(open(P));d['model']='$M';json.dump(d,open(P,'w'),indent=2)"
echo "round: model=$M flow=$FLOW prefix='${PREFIX:-<none>}'  instances: ${ENVS[*]}"

NB_RULE="IMPORTANT: belongsTo/relation fields must be named as a noun (e.g. \`category\`, \`owner\`), NEVER ending in \`_id\` — beta rejects \`*_id\` association names. For any temp/seed scripts use files under the current directory, not strictly required."
if [ -n "$PREFIX" ]; then
  NS="This env ALREADY holds a previous build, so namespace yours: use collection prefix \`$PREFIX\` for ALL collections AND give your top menu group an 'HTML' suffix so it does not collide with the existing build."
else
  NS="The instance is a CLEAN empty NocoBase (no collection prefix needed)."
fi

for i in 0 1 2; do
  s=${SCN[$i]}; env=${ENVS[$i]}; S="bench-$MK-$FLOW-$s"
  PF="$BENCH/round-$MK-$FLOW-$s.prompt.txt"
  if [ "$FLOW" = pure ]; then
    printf '%s\n' "Build a NocoBase app, FULL AUTONOMY — no questions, end to end. Task: ${DESC[$s]} Build into env **$env** — every nb api call uses \`-e $env -y\`. $NS Create collections+relations+enums, seed all-English data (cover every enum branch), + a top-level menu group. The plain CRUD list/table pages are the EASY part — do them, but the home page must be a REAL dashboard, NOT a stack of tables. The home/dashboard page MUST contain: (1) a KPI strip of 3-4 metric cards computed live from the seeded data; (2) at least one Chart (bar/line/pie/donut); (3) the primary entity in the most fitting RICH block (Kanban for a pipeline/stages, List+card for a catalog, Calendar for schedules) — not a plain Table. The KPI cards and any custom-look region MUST be real JS blocks / JS items (a dashboard with zero JS components is a FAIL). BEFORE writing any JS, READ the skill's ready-made widget bodies + contract and reuse them (do NOT hand-write JS from scratch): /home/albert/.claude/skills/nocobase-prototype-repro/references/template-library/_index.md (copy-pasteable KPI / donut / leaderboard / trend / progress JS bodies, each with its \$p input contract), plus references/gotchas.md and references/block-recipes.md for the JS-block/JS-item contract. $NB_RULE You were given NO prototype — design the dashboard yourself. When done, report the page schemaUid(s) AND confirm the dashboard has: KPI strip + chart + ≥1 working JS component." > "$PF"
  else
    printf '%s\n' "Reproduce an HTML prototype in NocoBase, FULL AUTONOMY — no questions, end to end. Prototype file: $PROTO_DIR/${PROTO[$s]} — read it fully (it embeds an authoritative spec). Use the prototype-repro skill METHOD — read /home/albert/.claude/skills/nocobase-prototype-repro/SKILL.md and its references/ (block-recipes.md, gotchas.md). Native-first: each region's container is a native block, JS only inside. Build into env **$env** — every nb api call uses \`-e $env -y\`. $NS Collections+relations+enums → seed all-English (every enum branch) → native CRUD page → the signature region(s) from the prototype (right native block per region + JS items for custom look) → menu group. $NB_RULE When done, report the page schemaUid(s)." > "$PF"
  fi
  tmux kill-session -t "$S" 2>/dev/null
  tmux new-session -d -s "$S" -c /home/albert
  tmux set-option -t "$S" remain-on-exit on
done
# wait shells ready then start opencode
for i in 0 1 2; do
  s=${SCN[$i]}; S="bench-$MK-$FLOW-$s"
  n=0; until tmux capture-pane -t "$S" -p 2>/dev/null | grep -qE "代理正常|albert@.*:~\\$"; do sleep 1; n=$((n+1)); [ $n -ge 40 ] && break; done
  tmux send-keys -t "$S" 'opencode' Enter
done
# wait opencode TUI up then feed prompt
for i in 0 1 2; do
  s=${SCN[$i]}; S="bench-$MK-$FLOW-$s"; PF="$BENCH/round-$MK-$FLOW-$s.prompt.txt"
  n=0; until tmux capture-pane -t "$S" -p 2>/dev/null | grep -qE "OpenCode|Qwen3\.7|esc interrupt"; do sleep 2; n=$((n+1)); [ $n -ge 60 ] && break; done
  tmux send-keys -t "$S" "Read the file $PF and execute the task in it completely, end to end, with full autonomy and no questions." Enter
  echo "  launched $S -> env $(eval echo \${ENVS[$i]}) (prompt round-$MK-$FLOW-$s)"
done
echo "--- sessions ---"; tmux list-sessions 2>/dev/null | grep "bench-$MK-$FLOW-"
