#!/usr/bin/env bash
# Desktop edition without Tauri and without Docker: gateway (PGlite, JS PDF engine) and the Next dev server
# on 127.0.0.1, as the desktop app will run them. For development and checks; see docs/DESKTOP.md.
#
#   scripts/desktop-dev.sh            # data in ./data/desktop-dev, site http://127.0.0.1:3701
#   DTC_DATA_DIR=/some/dir GATEWAY_PORT=3800 APP_PORT=3801 scripts/desktop-dev.sh
#
# Needs Node 22+ and `npm ci` done in gateway/ and frontend/. Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_PORT="${GATEWAY_PORT:-3700}"
APP_PORT="${APP_PORT:-3701}"
# Not the real app folder: development data stays inside the repository (data/ is in .gitignore).
DTC_DATA_DIR="${DTC_DATA_DIR:-$ROOT/data/desktop-dev}"

for d in gateway frontend; do
  [ -d "$ROOT/$d/node_modules" ] || { echo "Сначала выполните: cd $d && npm ci" >&2; exit 1; }
done

pids=()
stop() {
  for p in "${pids[@]}"; do kill -TERM "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap stop EXIT INT TERM

echo "Данные: $DTC_DATA_DIR"
(cd "$ROOT/gateway" && DTC_EDITION=desktop DTC_DATA_DIR="$DTC_DATA_DIR" GATEWAY_PORT="$GATEWAY_PORT" \
  APP_URL="http://127.0.0.1:$APP_PORT" exec node src/server.js) &
pids+=($!)

for _ in $(seq 1 120); do
  curl -sf "http://127.0.0.1:$GATEWAY_PORT/health" >/dev/null && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$GATEWAY_PORT/health" >/dev/null || { echo "gateway не запустился" >&2; exit 1; }

(cd "$ROOT/frontend" && GATEWAY_INTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT" NEXT_TELEMETRY_DISABLED=1 \
  exec npx next dev -H 127.0.0.1 -p "$APP_PORT") &
pids+=($!)

echo "Откройте http://127.0.0.1:$APP_PORT"
wait
