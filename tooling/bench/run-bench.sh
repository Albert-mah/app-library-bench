#!/usr/bin/env bash
# Model × flow bench runner — launches each matrix cell as an opencode run (qwen),
# throttled, into env expagents. Each cell builds with a unique prefix (no collision).
# Reusable: edit matrix.json (add models=columns / flows=rows / scenarios), re-run.
set -u
BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNCWD=${RUNCWD:-$HOME}               # home contains prj/ + .claude/ + .nocobase/ → those reads are "internal", avoid run-mode external-dir auto-reject
MAX=${MAX:-3}                     # concurrent opencode runs
mkdir -p "$BENCH/cells"
: > "$BENCH/bench.log"

cells=$(python3 -c "import json;print(' '.join(c['cell'] for c in json.load(open('$BENCH/matrix.json'))['cells']))")
model_of(){ python3 -c "import json;print([c['model'] for c in json.load(open('$BENCH/matrix.json'))['cells'] if c['cell']=='$1'][0])"; }

echo "[$(date +%H:%M:%S)] bench start, MAX=$MAX, cells: $cells" >> "$BENCH/bench.log"
for cell in $cells; do
  while [ "$(jobs -rp | wc -l)" -ge "$MAX" ]; do sleep 8; done
  model=$(model_of "$cell")
  echo "[$(date +%H:%M:%S)] LAUNCH $cell ($model)" >> "$BENCH/bench.log"
  (
    cd "$RUNCWD" || exit 1
    opencode run -m "$model" "$(cat "$BENCH/cells/$cell.prompt.txt")" > "$BENCH/cells/$cell.log" 2>&1
    echo "[$(date +%H:%M:%S)] DONE $cell exit=$?" >> "$BENCH/bench.log"
  ) &
done
wait
echo "[$(date +%H:%M:%S)] ALL CELLS FINISHED" >> "$BENCH/bench.log"
