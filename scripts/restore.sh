#!/usr/bin/env bash
# Restore Postgres and the uploads folder of THIS compose project from a directory created by the backup service.
# Usage: scripts/restore.sh <backup-dir> --yes [--project NAME] [--image-tag TAG]
#   --project: the compose project (as in `docker compose -p NAME`); default: COMPOSE_PROJECT_NAME, else `medcontrol`
#   (the `name:` in docker-compose.yml, whatever the folder is called).
# DESTRUCTIVE: replaces the current database contents and all uploads of that project.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  echo "usage: $0 <backup-dir> --yes [--project NAME] [--image-tag TAG]" >&2
  echo "  <backup-dir> must contain db.dump and uploads.tar.gz (e.g. ../medcontrol-backups/2026-09-02_0300)" >&2
  echo "  --yes confirms overwriting the current database and uploads" >&2
  exit 1
}

DIR=""; YES=""; requested_project=""; requested_tag=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --image-tag) shift; [ $# -gt 0 ] || usage; requested_tag=$1; [ -n "$1" ] || usage ;;
    --project) shift; [ $# -gt 0 ] || usage; requested_project=$1; [ -n "$1" ] || usage ;;
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
dc() {
  if [ -n "$requested_project" ]; then docker compose -p "$requested_project" "$@"; else docker compose "$@"; fi
}
start_target() {
  if [ -n "$requested_tag" ]; then IMAGE_TAG="$requested_tag" dc up -d "$@"; else dc up -d "$@"; fi
}
POSTGRES_USER=${POSTGRES_USER:-dtc}
POSTGRES_DB=${POSTGRES_DB:-dtc}

# The uploads folder is the one mounted at /data in THIS project's gateway container (a named volume or a host folder
# from DATA_DIR). Never guess by label: several installations (the demo, a test stack) may live on one machine.
GW=$(dc ps -a -q gateway)
if [ -z "$GW" ]; then
  # a fresh machine (RESTORE.md, Б and В): create the containers without starting them, so the mounts exist
  echo "restore: creating the containers of this project (not starting them)"
  dc up --no-start gateway
  GW=$(dc ps -a -q gateway)
fi
[ -n "$GW" ] || { echo "restore: no gateway container in project '${requested_project:-${COMPOSE_PROJECT_NAME:-medcontrol}}'" >&2; exit 1; }
SRC=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' "$GW")
[ -n "$SRC" ] || { echo "restore: the gateway container has no /data mount" >&2; exit 1; }

echo "restore: project: ${requested_project:-${COMPOSE_PROJECT_NAME:-medcontrol}}"
echo "restore: database: $POSTGRES_DB (postgres of this project)"
echo "restore: uploads:  $SRC"

# Postgres must be up to restore into (on a fresh machine nothing is running yet)
dc up -d postgres
for _ in $(seq 1 30); do
  dc exec -T postgres pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1 && break
  sleep 2
done

# Only the archive and the new DB are touched during validation. Both previous
# datasets remain available until the restored gateway has passed its health check.
backup_dir=$(cd "$DIR" && pwd)
files() { docker run --rm -v "$SRC:/data" -v "$backup_dir:/backup:ro" alpine sh -eu -c "$1"; }
files 'mkdir /data/.medcontrol-restore' || { echo "Could not reserve /data/.medcontrol-restore for this recovery; inspect any earlier restore." >&2; exit 1; }
admin_db=postgres
[ "$POSTGRES_DB" != postgres ] || admin_db=template1
fresh="mc_restore_${EPOCHSECONDS:-$(date +%s)}_$$"
old="${fresh}_previous"
echo "restore: staging database $fresh; previous database during switch: $old"
psql() { dc exec -T postgres psql -Xq -U "$POSTGRES_USER" -d "$admin_db" -v ON_ERROR_STOP=1 "$@"; }
swap_db() {
  psql -v target="$POSTGRES_DB" -v replacement="$1" -v previous="$2" <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN (:'target', :'replacement') AND pid <> pg_backend_pid();
BEGIN;
ALTER DATABASE :"target" RENAME TO :"previous";
ALTER DATABASE :"replacement" RENAME TO :"target";
COMMIT;
SQL
}
drop_db() { dc exec -T postgres dropdb --maintenance-db="$admin_db" --if-exists -U "$POSTGRES_USER" "$1"; }
file_tools='
stage=/data/.medcontrol-restore
move_entries() {
  from=$1; to=$2
  for item in "$from"/* "$from"/.[!.]* "$from"/..?*; do
    [ -e "$item" ] || [ -L "$item" ] || continue
    [ "$item" != "$stage" ] || continue
    mv "$item" "$to/"
  done
}
'
stopped=0; staged_db=0; switched=0; complete=0
cleanup() {
  result=$?
  trap - EXIT INT TERM
  set +e
  if [ "$complete" = 0 ]; then
    if [ "$stopped" = 1 ]; then
      dc stop gateway frontend backup || { echo "Restore rollback requires manual assistance; saved data retained." >&2; exit 1; }
    fi
    if [ "$switched" = 1 ]; then
      swap_db "$old" "$fresh" || { echo "Database rollback failed; previous database $old and saved files retained." >&2; exit 1; }
    fi
    files "$file_tools"'
      if [ -e "$stage/installing" ]; then move_entries /data "$stage/new"; fi
      if [ -d "$stage/old" ]; then move_entries "$stage/old" /data; fi
    ' || { echo "File rollback failed; previous files retained in /data/.medcontrol-restore." >&2; exit 1; }
    if [ "$staged_db" = 1 ]; then drop_db "$fresh" || result=1; fi
  fi
  files 'rm -rf /data/.medcontrol-restore' || result=1
  if [ "$complete" = 0 ] && [ "$stopped" = 1 ]; then dc up -d || result=1; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
files '
  cd /data/.medcontrol-restore
  mkdir new old
  tar xzf /backup/uploads.tar.gz -C new
  [ ! -e new/.medcontrol-restore ] && [ ! -L new/.medcontrol-restore ]
'
dc exec -T postgres createdb --maintenance-db="$admin_db" -U "$POSTGRES_USER" "$fresh"
staged_db=1
dc exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$fresh" --no-owner --exit-on-error < "$DIR/db.dump"
stopped=1
dc stop gateway frontend backup
files "$file_tools"'
  move_entries /data "$stage/old"
  touch "$stage/installing"
  move_entries "$stage/new" /data
'
swap_db "$fresh" "$old"
switched=1
start_target gateway frontend
for _ in $(seq 1 60); do
  if dc exec -T gateway wget -Y off -qO- http://127.0.0.1:3000/health | grep -q '"ok":true'; then complete=1; break; fi
  sleep 2
done
[ "$complete" = 1 ] || { echo "Restored gateway failed its health check; rolling back." >&2; exit 1; }
# Remove old files before starting the backup sidecar, to avoid archiving staging data.
files 'rm -rf /data/.medcontrol-restore/old'
drop_db "$old"
start_target
echo "restore: done"
