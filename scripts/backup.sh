#!/bin/sh
# Create a restorable database + uploads backup of the active Compose project.
set -eu
umask 077
cd "$(dirname "$0")/.."
. ./backup/rotation.sh
if [ -f .env ]; then set -a; . ./.env; set +a; fi
root=${BACKUP_DIR:-../medcontrol-backups}
keep=${BACKUP_KEEP:-14}
stamp=$(date +%F_%H%M%S)
if [ "$#" -gt 0 ]; then
  [ "$#" = 2 ] && [ "$1" = --predeploy ] || exit 2
  case "$2" in ''|.*|*[!A-Za-z0-9_.-]*) echo "Invalid deployment tag" >&2; exit 2 ;; esac
  root=backups/predeploy; stamp=$2; keep=5
fi
mkdir -p "$root"
dest="$root/$stamp"
lock="$root/.lock-$stamp"
mkdir "$lock" || { echo "Backup already running for $stamp" >&2; exit 1; }
trap 'rmdir "$lock"' EXIT
[ ! -e "$dest" ] || { echo "Backup already exists: $dest" >&2; exit 1; }
stage=$(mktemp -d "$root/.partial.XXXXXX")
trap 'rm -rf "$stage"; rmdir "$lock"' EXIT
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-dtc}" -d "${POSTGRES_DB:-dtc}" -Fc > "$stage/db.dump"
# Run inside the active gateway: /data is its actual mount, including bind mounts.
docker compose exec -T gateway tar czf - --exclude=./jwt.secret --exclude=./setup-code.txt --exclude=./.medcontrol-restore -C /data . > "$stage/uploads.tar.gz"
[ -s "$stage/db.dump" ] && [ -s "$stage/uploads.tar.gz" ] || exit 1
docker compose exec -T postgres pg_restore --list < "$stage/db.dump" >/dev/null
tar tzf "$stage/uploads.tar.gz" >/dev/null
printf '%s\n' "$stamp" > "$stage/.medcontrol-complete"
mv "$stage" "$dest"
rotate_copies "$root" "$keep"
echo "backup: done ($dest)"
