#!/usr/bin/env bash
# Reset the 3 bench instances to the clean golden beta snapshot (between rounds).
# restore golden .nbdata -> docker restart (parseName cache) -> wait ready -> refresh nb token
GOLDEN=~/nocobase-cleanbeta/storage/backups/main/backup_20260626_095931_2877.nbdata
declare -A PORT=([expagents]=14230 [fable14232]=14232 [flash14231]=14231)
for env in expagents fable14232 flash14231; do
  p=${PORT[$env]}
  echo "[reset] $env: restoring golden..."
  nb backup restore -f "$GOLDEN" -e "$env" -y --force 2>&1 | grep -iE "restored|fail|error" | tail -1
  (cd ~/nocobase-$env && docker compose restart app >/dev/null 2>&1)
  n=0; until curl -s -m5 http://127.0.0.1:$p/api/app:getInfo 2>/dev/null | grep -q '"version"' || [ $n -ge 36 ]; do sleep 4; n=$((n+1)); done
  tok=$(curl -s -m10 -X POST http://127.0.0.1:$p/api/auth:signIn -H "Content-Type: application/json" -H "X-Authenticator: basic" -d '{"account":"admin@nocobase.com","password":"admin123"}' 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('token',''))" 2>/dev/null)
  python3 -c "import json,os;P=os.path.expanduser('~/.nocobase/config.json');d=json.load(open(P));d.get('envs',d).setdefault('$env',{}).setdefault('auth',{})['accessToken']='$tok';json.dump(d,open(P,'w'),indent=2,ensure_ascii=False)" 2>/dev/null
  echo "[reset] $env ready (token len ${#tok})"
done
echo "[reset] all 3 instances are clean golden again."
