#!/bin/sh
# POSIX sh: many NAS systems have no bash.
# Roll back to the previous image tag (or a given one) without rebuilding.
# Usage (on the server, in the app directory): scripts/rollback.sh [tag]
# Migrations are not reverted: they are forward-only and old code runs on the newer schema. If the deploy
# broke the data, restore backups/predeploy/<tag>.dump with docs/RESTORE.md.
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "rollback: no .env here: nothing was deployed with scripts/deploy.sh, so there is no tag to return to" >&2; exit 1; }
TARGET=${1:-$(cat .deploy/previous 2>/dev/null || true)}
[ -n "$TARGET" ] || { echo "rollback: no previous tag recorded; available:"; docker images 'dtc/gateway' --format '{{.Tag}}  {{.CreatedAt}}'; exit 1; }
docker image inspect "dtc/gateway:$TARGET" >/dev/null 2>&1 || { echo "rollback: image dtc/gateway:$TARGET not found; available:"; docker images 'dtc/gateway' --format '{{.Tag}}  {{.CreatedAt}}'; exit 1; }
CURRENT=$(grep -E '^IMAGE_TAG=' .env | tail -n1 | cut -d= -f2- || true); CURRENT=${CURRENT:-dev}
echo "rollback: $CURRENT -> $TARGET"
if grep -qE '^IMAGE_TAG=' .env; then sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=$TARGET/" .env && rm -f .env.bak; else printf '\nIMAGE_TAG=%s\n' "$TARGET" >> .env; fi
mkdir -p .deploy; echo "$CURRENT" > .deploy/previous; echo "$TARGET" > .deploy/current
IMAGE_TAG=$TARGET docker compose up -d --remove-orphans
echo -n "rollback: waiting for gateway"
for i in $(seq 1 40); do
  if docker compose exec -T gateway wget -qO- http://127.0.0.1:3000/health 2>/dev/null | grep -q '"ok":true'; then echo " ok"; exit 0; fi
  echo -n "."; sleep 3
done
echo; echo "rollback: gateway is not healthy: docker compose logs gateway" >&2; exit 2
