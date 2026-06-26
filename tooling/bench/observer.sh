#!/usr/bin/env bash
# Observer / watchdog — periodically logs progress across all running threads and
# nudges a stalled qwen TUI (only when genuinely idle, never mid-permission-prompt).
LOG=/tmp/bench-observer.log
BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: > "$LOG"
echo "[$(date +%H:%M:%S)] observer start" >> "$LOG"
idle_prev=""
while true; do
  ts=$(date +%H:%M:%S)
  # --- qwen TUI sessions: nudge only if truly idle (no spinner, no permission dialog) ---
  for s in $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep -E '^qwen'); do
    pane=$(tmux capture-pane -t "$s" -p 2>/dev/null | grep -v '^$' | tail -8)
    if echo "$pane" | grep -qiE "Permission required|Always allow|Confirm  *Cancel|Allow once"; then
      echo "[$ts] $s NEEDS-PERMISSION (left for human)" >> "$LOG"
    elif echo "$pane" | grep -q "esc interrupt"; then
      echo "[$ts] $s working" >> "$LOG"; idle_prev=""
    else
      # idle this round; nudge only if it was idle last round too (2 strikes)
      if [ "$idle_prev" = "$s" ]; then
        tmux send-keys -t "$s" "继续,别停,把页面端到端搭完再汇报" 2>/dev/null
        tmux send-keys -t "$s" Enter 2>/dev/null
        echo "[$ts] $s NUDGED (idle 2x)" >> "$LOG"; idle_prev=""
      else
        echo "[$ts] $s idle (1st)" >> "$LOG"; idle_prev="$s"
      fi
    fi
  done
  # --- bench progress ---
  if [ -f "$BENCH/bench.log" ]; then
    d=$(grep -c "DONE " "$BENCH/bench.log" 2>/dev/null)
    l=$(grep -c "LAUNCH " "$BENCH/bench.log" 2>/dev/null)
    echo "[$ts] bench: launched ${l:-0}, finished ${d:-0} / 12" >> "$LOG"
  fi
  # --- expagents bench-cell collection counts (progress per prefix) ---
  nb api data-modeling collections list -e expagents -y 2>/dev/null | grep -v "proxy\|Warning\|nb self" | python3 -c "
import sys,json
try:
  raw=sys.stdin.read();i=raw.find('{');d=json.loads(raw[i:]);names=[c.get('name','') for c in (d.get('data') or [])]
  from collections import Counter
  c=Counter(n.split('_')[0] for n in names if n.startswith('b0'))
  print('[bench prefixes] '+(', '.join(f'{k}:{v}' for k,v in sorted(c.items())) or 'none yet'))
except Exception as e: print('[bench prefixes] read fail')
" >> "$LOG" 2>&1
  sleep 120
done
