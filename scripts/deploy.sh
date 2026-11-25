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
gateway_id=$(docker compose ps -q gateway)
[ -n "$gateway_id" ] || { echo "deploy: start the installed gateway before backing it up" >&2; exit 1; }
project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$gateway_id")
[ -n "$project" ] || { echo "deploy: could not identify the running project" >&2; exit 1; }
namespace="mc.$project."
TAG=${1:-$namespace${DEPLOY_REVISION:+$DEPLOY_REVISION-}$(date +%Y%m%d-%H%M%S)}
obsolete=$(cat .deploy/previous 2>/dev/null || true)
CURRENT=$(envval IMAGE_TAG); CURRENT=${CURRENT:-dev}
mkdir -p .deploy backups/predeploy

echo "deploy: current tag $CURRENT -> new tag $TAG"
echo "deploy: backing up database and uploads before the switch"
sh scripts/backup.sh --predeploy "$TAG"

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
  if docker compose exec -T gateway wget -Y off -qO- http://127.0.0.1:3000/health 2>/dev/null | grep -q '"ok":true'; then echo " ok"; break; fi
  echo -n "."; sleep 3
  if [ "$i" = 40 ]; then echo; echo "deploy: gateway is not healthy, check: docker compose logs gateway; roll back with scripts/rollback.sh" >&2; exit 2; fi
done
docker compose exec -T gateway wget -Y off -qO- 'http://127.0.0.1:3000/health?deep=1' || true; echo
# Only the retired tag generated for this installation is eligible. Old unscoped
# tags may be rollback targets of another project on the same daemon.
case "$obsolete" in
  "$namespace"*)
    if [ "$obsolete" != "$TAG" ] && [ "$obsolete" != "$CURRENT" ]; then
      IMAGE_TAG="$obsolete" docker compose config --images | while IFS= read -r image; do
        case "$image" in
          dtc/*:"$obsolete")
            owner=$(docker image inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$image" 2>/dev/null || true)
            if [ "$owner" = "$project" ]; then docker image rm "$image" || echo "deploy: retained $image"; fi ;;
        esac
      done
    fi ;;
esac
echo "deploy: done, tag $TAG (previous $CURRENT)"
