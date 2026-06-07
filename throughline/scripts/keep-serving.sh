#!/usr/bin/env bash
# Keep the Throughline prod server + a Cloudflare quick tunnel alive.
#
# Why: `cloudflared tunnel --url` quick tunnels die silently (the edge
# connection drops while the process lingers) and the Next.js server can stop.
# This loop health-checks both and restarts whatever is down. The current public
# URL is always written to $URLFILE.
#
# Run:  nohup bash scripts/keep-serving.sh >/tmp/throughline-supervisor.out 2>&1 &
# URL:  cat /tmp/throughline-url.txt
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
cd /Users/peterhill/projects/personalWebsite/throughline || exit 1

PORT=3000
CF=/Users/peterhill/.local/bin/cloudflared
URLFILE=/tmp/throughline-url.txt
TUNLOG=/tmp/tl_tunnel.log
SRVLOG=/tmp/tl_prod.log
LOG=/tmp/throughline-supervisor.log

log(){ echo "$(date '+%F %T') $*" >> "$LOG"; }

server_up(){ curl -sf -o /dev/null --max-time 5 "http://localhost:$PORT/"; }

start_server(){
  log "server down -> starting"
  nohup npx next start -p "$PORT" >"$SRVLOG" 2>&1 &
  for _ in $(seq 1 15); do sleep 2; server_up && break; done
}

read_url(){ grep -hoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNLOG" 2>/dev/null | tail -1; }

start_tunnel(){
  pkill -f "cloudflared tunnel --url" 2>/dev/null
  sleep 2
  : > "$TUNLOG"
  nohup "$CF" tunnel --url "http://localhost:$PORT" >"$TUNLOG" 2>&1 &
  for _ in $(seq 1 15); do
    sleep 2
    u=$(read_url)
    [ -n "$u" ] && { echo "$u" > "$URLFILE"; log "tunnel up: $u"; return; }
  done
  log "tunnel failed to report a URL"
}

# Adopt an already-running tunnel if its URL is reachable; else (re)start it.
adopt_or_start_tunnel(){
  local u; u=$(read_url)
  if [ -n "$u" ] && curl -sf -o /dev/null --max-time 20 "$u/"; then
    echo "$u" > "$URLFILE"; log "adopted existing tunnel: $u"
  else
    start_tunnel
  fi
}

log "supervisor starting"
server_up || start_server
adopt_or_start_tunnel

while true; do
  server_up || start_server
  U=$(cat "$URLFILE" 2>/dev/null || true)
  if [ -z "$U" ] || ! curl -sf -o /dev/null --max-time 20 "$U/"; then
    log "tunnel unreachable (${U:-none}) -> restarting"
    start_tunnel
  fi
  sleep 60
done
