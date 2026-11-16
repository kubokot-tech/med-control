#!/usr/bin/env bash
# Restore Postgres and the uploads folder of THIS compose project from a directory created by the backup service.
# Usage: scripts/restore.sh <backup-dir> --yes [--project NAME]
#   --project: the compose project (as in `docker compose -p NAME`); default: COMPOSE_PROJECT_NAME, else `medcontrol`
#   (the `name:` in docker-compose.yml, whatever the folder is called).
# DESTRUCTIVE: replaces the current database contents and all uploads of that project.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  echo "usage: $0 <backup-dir> --yes [--project NAME]" >&2
  echo "  <backup-dir> must contain db.dump and uploads.tar.gz (e.g. ../medcontrol-backups/2026-09-02_0300)" >&2
  echo "  --yes confirms overwriting the current database and uploads" >&2
  exit 1
}

DIR=""; YES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --project) shift; [ $# -gt 0 ] || usage; export COMPOSE_PROJECT_NAME="$1" ;;
    -*) usage ;;
    *) [ -z "$DIR" ] || usage; DIR=$1 ;;
  esac
  shift
done
[ -n "$DIR" ] && [ -n "$YES" ] || usage
[ -d "$DIR" ] || { echo "restore: '$DIR' is not a directory" >&2; usage; }
[ -f "$DIR/db.dump" ] || { echo "restore: '$DIR/db.dump' not found" >&2; usage; }
[ -f "$DIR/uploads.tar.gz" ] || { echo "restore: '$DIR/uploads.tar.gz' not found" >&2; usage; }

# .env is optional (the first-run wizard works without it); compose and the defaults below fill the rest
if [ -f ./.env ]; then set -a; . ./.env; set +a; fi
POSTGRES_USER=${POSTGRES_USER:-dtc}
POSTGRES_DB=${POSTGRES_DB:-dtc}

# The uploads folder is the one mounted at /data in THIS project's gateway container (a named volume or a host folder
# from DATA_DIR). Never guess by label: several installations (the demo, a test stack) may live on one machine.
GW=$(docker compose ps -a -q gateway)
if [ -z "$GW" ]; then
  # a fresh machine (RESTORE.md, Б and В): create the containers without starting them, so the mounts exist
  echo "restore: creating the containers of this project (not starting them)"
  docker compose up --no-start gateway
  GW=$(docker compose ps -a -q gateway)
fi
[ -n "$GW" ] || { echo "restore: no gateway container in project '${COMPOSE_PROJECT_NAME:-medcontrol}'" >&2; exit 1; }
SRC=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' "$GW")
[ -n "$SRC" ] || { echo "restore: the gateway container has no /data mount" >&2; exit 1; }

echo "restore: project: ${COMPOSE_PROJECT_NAME:-medcontrol}"
echo "restore: database: $POSTGRES_DB (postgres of this project)"
echo "restore: uploads:  $SRC"

# Postgres must be up to restore into (on a fresh machine nothing is running yet)
docker compose up -d postgres
for _ in $(seq 1 30); do
  docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1 && break
  sleep 2
done

echo "restore: stopping gateway, frontend"
docker compose stop gateway frontend 2>/dev/null || true

psql() { docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
# The dump goes into a new database first and replaces the current one only when it restored completely: a copy made
# by an older version restores as it is (the gateway then brings the schema up to date), and a broken dump leaves the
# current data untouched.
TMP_DB="${POSTGRES_DB}_restore"
echo "restore: restoring $DIR/db.dump into a new database"
psql -c "DROP DATABASE IF EXISTS \"$TMP_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$TMP_DB\" OWNER \"$POSTGRES_USER\""
if ! docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$TMP_DB" --no-owner --exit-on-error < "$DIR/db.dump"; then
  psql -c "DROP DATABASE IF EXISTS \"$TMP_DB\" WITH (FORCE)" || true
  echo "restore: the dump did not restore; the current database is unchanged. Starting the services again." >&2
  docker compose up -d
  exit 1
fi
echo "restore: replacing database $POSTGRES_DB"
psql -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" -c "ALTER DATABASE \"$TMP_DB\" RENAME TO \"$POSTGRES_DB\""

echo "restore: restoring uploads into $SRC from $DIR/uploads.tar.gz"
docker run --rm -v "$SRC:/data" -v "$(cd "$DIR" && pwd):/backup:ro" alpine \
  sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/uploads.tar.gz -C /data'

# `up`, not `start`: on a fresh machine some containers do not exist yet
echo "restore: starting the services"
docker compose up -d

echo "restore: done"
