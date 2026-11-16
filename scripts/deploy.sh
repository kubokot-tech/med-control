#!/bin/sh
# POSIX sh: many NAS systems have no bash.
# Deploy on the server: pre-deploy DB dump -> build images with a fresh tag -> switch -> health wait.
# Usage (on the server, in the app directory after the new tree is extracted):  scripts/deploy.sh [tag]
# Rollback: scripts/rollback.sh  (previous tag is kept in .deploy/previous).
set -eu
umask 077  # dumps and logs hold medical data
(set -o pipefail) 2>/dev/null && set -o pipefail
cd "$(dirname "$0")/.."
# A default install has no .env; the active image tag is recorded there, so start an empty one.
[ -f .env ] || { echo "deploy: no .env here, creating an empty one to record the image tag"; : > .env; }
# Read only what we need from .env: exporting it wholesale would leave the OLD IMAGE_TAG in the
# shell environment, and a shell variable beats the .env file for docker compose.
# A missing line is not an error: grep finds nothing, the caller falls back to the default.
envval() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }
POSTGRES_USER=$(envval POSTGRES_USER); POSTGRES_DB=$(envval POSTGRES_DB)
TAG=${1:-$(date +%Y%m%d-%H%M%S)}
CURRENT=$(envval IMAGE_TAG); CURRENT=${CURRENT:-dev}
mkdir -p .deploy backups/predeploy

echo "deploy: current tag $CURRENT -> new tag $TAG"
echo "deploy: database dump before the switch"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-dtc}" -Fc "${POSTGRES_DB:-dtc}" > "backups/predeploy/$TAG.dump"
ls -t backups/predeploy/*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f

echo "deploy: building images"
IMAGE_TAG=$TAG docker compose build

# Record tags: .env carries the active one (compose reads it), .deploy/previous the one to roll back to.
if grep -qE '^IMAGE_TAG=' .env; then sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" .env && rm -f .env.bak; else printf '\nIMAGE_TAG=%s\n' "$TAG" >> .env; fi
echo "$CURRENT" > .deploy/previous
echo "$TAG" > .deploy/current

echo "deploy: switching containers"
IMAGE_TAG=$TAG docker compose up -d --remove-orphans
# the Caddyfile is a bind-mounted single file: a new extract changes its inode, so recreate edge to pick it up
IMAGE_TAG=$TAG docker compose up -d --force-recreate --no-deps edge

echo -n "deploy: waiting for gateway"
for i in $(seq 1 40); do
  if docker compose exec -T gateway wget -qO- http://127.0.0.1:3000/health 2>/dev/null | grep -q '"ok":true'; then echo " ok"; break; fi
  echo -n "."; sleep 3
  if [ "$i" = 40 ]; then echo; echo "deploy: gateway is not healthy, check: docker compose logs gateway; roll back with scripts/rollback.sh" >&2; exit 2; fi
done
docker compose exec -T gateway wget -qO- 'http://127.0.0.1:3000/health?deep=1' || true; echo
# Keep only the images for the current and previous tags (rollback needs the previous one).
docker images 'dtc/*' --format '{{.Repository}}:{{.Tag}}' | grep -vE ":($TAG|$CURRENT)$" | xargs -r docker rmi >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
echo "deploy: done, tag $TAG (previous $CURRENT)"
