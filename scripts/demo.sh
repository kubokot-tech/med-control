#!/usr/bin/env bash
# Demo stack with an invented patient, next to (and isolated from) a real installation.
#   scripts/demo.sh            start, pass the first-run wizard, load demo data; prints the address and password
#   scripts/demo.sh reset      throw the demo database away and start over
#   scripts/demo.sh down       stop the demo and delete its data
# DEMO_PASSWORD chooses the password (default: a generated one). The wizard's rule applies: at least 10 characters,
# not a common password or a keyboard run; a weak one stops the script with the gateway's answer.
# DEMO_LANG=en installs an English demo: an American patient's formats and units. Default: Russian.
# The demo uses scripts/demo.env instead of .env, its own Docker project, port 3101 and no backup service.
set -euo pipefail
cd "$(dirname "$0")/.."
ENVF=scripts/demo.env
dc() { docker compose --env-file "$ENVF" "$@"; }
PORT=$(grep -E '^APP_PORT=' "$ENVF" | cut -d= -f2)
URL="http://localhost:${PORT}"

case "${1:-up}" in
  down) dc down -v; exit 0 ;;
  reset) dc down -v ;;
  up) ;;
  *) echo "usage: scripts/demo.sh [up|reset|down]" >&2; exit 2 ;;
esac

dc up -d --build --scale backup=0
echo "demo: waiting for the gateway at ${URL}"
for _ in $(seq 1 90); do
  status=$(curl -fsS "${URL}/api/gateway/setup/status" 2>/dev/null || true)
  [ -n "$status" ] && break
  sleep 2
done
[ -n "${status:-}" ] || { echo "demo: gateway did not answer, see: docker compose --env-file $ENVF logs gateway" >&2; exit 1; }

if printf '%s' "$status" | grep -q '"needed":true'; then
  PASSWORD=${DEMO_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)}
  if [ "${DEMO_LANG:-ru}" = en ]; then locale='"language":"en","region":"US","tz":"America/New_York"'; else locale='"language":"ru","tz":"Europe/Moscow"'; fi
  body=$(printf '{"password":"%s",%s,"preset":"endometriosis"}' "$PASSWORD" "$locale")
  answer=$(curl -sS -X POST -H 'content-type: application/json' -d "$body" "${URL}/api/gateway/setup")
  printf '%s' "$answer" | grep -q '"ok":true' || { echo "demo: first-run setup refused: $(printf '%s' "$answer" | grep -o '"error":"[a-z_]*"' || echo 'no answer')" >&2; exit 1; }
  dc exec -T -u node gateway node src/tools/demoSeed.js
  echo
  echo "demo: ${URL}"
  [ -n "${DEMO_PASSWORD:-}" ] && echo "demo: password from DEMO_PASSWORD" || echo "demo: password ${PASSWORD}"
else
  echo "demo: already set up, open ${URL} (scripts/demo.sh reset starts over)"
fi
