#!/usr/bin/env bash
# Lightweight nudge-only watchdog for the TUI bench. Pushes ONLY genuinely-stalled
# cells (reuses bench-live.py status: done=skip, working=skip, stalled=nudge).
# Never touches done cells. De-dups: won't re-nudge the same session within COOLDOWN.
LOG=/tmp/bench-watch.log
PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bench-live.py"
COOLDOWN=200   # seconds between nudges to the same session
declare -A LASTNUDGE
: > "$LOG"
echo "[$(date +%H:%M:%S)] bench-watch start (nudge stalled bench-* TUIs only)" >> "$LOG"
while true; do
  ts=$(date +%H:%M:%S); now=$(date +%s)
  # cells that are stalled, as "flow-scn" (e.g. pure-01) from bench-live
  stalled=$(python3 "$PY" --list 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  for c in d.get('cells',[]):
    if c.get('status')=='stalled': print(c['flow']+'-'+c['scenario'])
except: pass
")
  for fs in $stalled; do
    S="bench-$fs"
    tmux has-session -t "$S" 2>/dev/null || continue
    pane=$(tmux capture-pane -t "$S" -p 2>/dev/null | grep -v '^$' | tail -6)
    # leave human-required permission dialogs alone
    if echo "$pane" | grep -qiE "Permission|Always allow|Allow once|Confirm.*Cancel|grant"; then
      echo "[$ts] $S NEEDS-PERMISSION (left for human)" >> "$LOG"; continue
    fi
    last=${LASTNUDGE[$S]:-0}
    if [ $((now - last)) -lt $COOLDOWN ]; then continue; fi
    tmux send-keys -t "$S" "继续,立刻把剩下步骤做完(集合/seed/页面/菜单),端到端搭完再停,别问。" 2>/dev/null
    tmux send-keys -t "$S" Enter 2>/dev/null
    LASTNUDGE[$S]=$now
    echo "[$ts] $S NUDGED (stalled)" >> "$LOG"
  done
  sleep 60
done
