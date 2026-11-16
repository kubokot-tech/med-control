#!/usr/bin/env bash
# Backup Postgres (pg_dump -Fc) and the uploads volume (dtcdata) into $BACKUP_DIR/<stamp>/ (as the backup service:
# ../medcontrol-backups by default, next to the code folder).
# Keeps the 14 newest backups. Requires Docker (compose stack running); ./.env is optional.
# Like the backup service, the archive leaves out jwt.secret (the key that signs sessions) and setup-code.txt: a copy
# of the backup must not be enough to forge a session; a restored install makes a new secret.
set -euo pipefail
cd "$(dirname "$0")/.."

# .env is optional (a default install has none); the defaults below are the ones docker-compose.yml uses
if [ -f ./.env ]; then set -a; . ./.env; set +a; fi
POSTGRES_USER=${POSTGRES_USER:-dtc}
POSTGRES_DB=${POSTGRES_DB:-dtc}

STAMP=$(date +%F_%H%M)
ROOT=${BACKUP_DIR:-../medcontrol-backups}
DEST=$ROOT/$STAMP
mkdir -p "$DEST"

echo "backup: dumping database $POSTGRES_DB -> $DEST/db.dump"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DEST/db.dump"

# this project's volume only: the demo and test stacks have a dtcdata volume too
VOL=$(docker volume ls -q --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME:-medcontrol}" --filter "label=com.docker.compose.volume=dtcdata" | head -n1)
if [ -z "$VOL" ]; then
  echo "backup: docker volume for 'dtcdata' not found (is the compose stack created?)" >&2
  exit 1
fi
echo "backup: archiving uploads volume $VOL -> $DEST/uploads.tar.gz"
docker run --rm -v "$VOL:/data:ro" -v "$(cd "$DEST" && pwd):/backup" alpine tar czf /backup/uploads.tar.gz --exclude=./jwt.secret --exclude=./setup-code.txt -C /data .

# Retention: keep the 14 newest backup dirs.
ls -1dt "$ROOT"/*/ | tail -n +15 | xargs -r rm -rf

echo "backup: done ($DEST)"
ls -lh "$DEST/db.dump" "$DEST/uploads.tar.gz"
