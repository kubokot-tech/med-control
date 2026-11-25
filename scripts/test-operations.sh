#!/usr/bin/env bash
# An opt-in integration test. Uses synthetic data and a unique disposable Compose project.
set -euo pipefail
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES
root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
project="mc-ops-test-${temp##*.}"; project=$(printf %s "$project" | tr '[:upper:]' '[:lower:]')
cp -R "$root/scripts" "$root/backup" "$temp/"
cd "$temp"
compose() { docker compose -p "$project" "$@"; }
cleanup() {
  compose down -v >/dev/null 2>&1
  # Containers can create root-owned directories inside the disposable bind mount.
  if [ -d "$temp/actual-data" ]; then
    docker run --rm -v "$temp/actual-data:/fixture" alpine sh -c 'find /fixture -mindepth 1 -delete'
  fi
  rm -rf "$temp"
}
trap cleanup EXIT
cat > compose.yaml <<'YAML'
services:
  postgres:
    image: postgres:16.13
    environment:
      POSTGRES_USER: dtc
      POSTGRES_DB: dtc
      POSTGRES_HOST_AUTH_METHOD: trust
  gateway:
    image: caddy:2.11.4-alpine
    entrypoint: []
    environment: {XDG_DATA_HOME: /tmp/caddy-data, XDG_CONFIG_HOME: /tmp/caddy-config}
    volumes: ["./actual-data:/data"]
    command: ["sh", "-ec", "mkdir -p /www; echo '{\"ok\":true}' >/www/health; exec caddy file-server --listen :3000 --root /www"]
  backup:
    image: alpine:latest
    stop_grace_period: 1s
    command: ["sleep", "3600"]
  frontend:
    image: alpine:latest
    stop_grace_period: 1s
    command: ["sleep", "3600"]
YAML
mkdir actual-data
printf 'COMPOSE_PROJECT_NAME=%s\nBACKUP_DIR=%s\n' "$project" "$temp/copies" > .env
compose up -d
for _ in $(seq 1 30); do
  compose exec -T postgres pg_isready -h localhost -U dtc -d dtc >/dev/null && break
  sleep 1
done
sql() { compose exec -T postgres psql -XAt -U dtc -d dtc -v ON_ERROR_STOP=1 -c "$1"; }
sql "create table fixture (value int); insert into fixture values (42)"
echo original > actual-data/fixture
sh scripts/backup.sh --predeploy tested
backup="$temp/backups/predeploy/tested"
tar tzf "$backup/uploads.tar.gz" | grep -qx './fixture'
# An explicit target must win over the project named in .env.
printf 'COMPOSE_PROJECT_NAME=%s-wrong\n' "$project" > .env
echo changed > actual-data/fixture
sql "update fixture set value=128"
mkdir broken
cp "$backup/db.dump" broken/db.dump
printf 'bad archive' > broken/uploads.tar.gz
if bash scripts/restore.sh "$temp/broken" --yes --project "$project"; then exit 1; fi
test "$(sql 'select value from fixture')" = 128
test "$(cat actual-data/fixture)" = changed
# Inject a one-time start failure after both replacements to exercise real rollback.
real_docker=$(command -v docker)
export real_docker
mkdir shim
cat > shim/docker <<'MOCK'
#!/bin/sh
case " $* " in
  *" up -d gateway frontend ") exit 71 ;;
esac
exec "$real_docker" "$@"
MOCK
chmod +x shim/docker
if PATH="$temp/shim:$PATH" bash scripts/restore.sh "$backup" --yes --project "$project"; then exit 1; fi
test "$(sql 'select value from fixture')" = 128
test "$(cat actual-data/fixture)" = changed
bash scripts/restore.sh "$backup" --yes --project "$project"
test "$(sql 'select value from fixture')" = 42
test "$(cat actual-data/fixture)" = original
test ! -e actual-data/.medcontrol-restore
echo "Operational backup/restore checks passed."

# Existing encrypted configurations survive a setup retry after the recovery text
# file has been moved. Replace only the container transport with a local stub.
mkdir cloud-shim local-rclone
printf '%s\n' '[yc-crypt]' 'type = crypt' > local-rclone/rclone.conf
cp local-rclone/rclone.conf saved-config
printf 'RCLONE_DIR=%s\n' "$temp/local-rclone" > .env
cat > cloud-shim/docker <<'MOCK'
#!/bin/sh
case " $* " in
  *" listremotes --long "*) printf '%s\n' 'yc-crypt: crypt' ;;
  *" lsf --max-depth 1 yc-crypt: "*) test "${FAIL_LIST:-0}" = 0 ;;
  *) exit 80 ;;
esac
MOCK
chmod +x cloud-shim/docker
PATH="$temp/cloud-shim:$PATH" bash scripts/cloud-setup.sh
cmp saved-config local-rclone/rclone.conf
test ! -e local-rclone/CRYPT-KEY.txt
if FAIL_LIST=1 PATH="$temp/cloud-shim:$PATH" bash scripts/cloud-setup.sh; then exit 1; fi
cmp saved-config local-rclone/rclone.conf
echo "Cloud backup retry checks passed."

# Inspect the command selected by the cleanup logic without deleting Docker images.
mkdir -p deploy-fixture/scripts deploy-fixture/.deploy deploy-shim
cp scripts/deploy.sh deploy-fixture/scripts/
printf '#!/bin/sh\nexit 0\n' > deploy-fixture/scripts/backup.sh
printf 'IMAGE_TAG=mc.fixture.current\n' > deploy-fixture/.env
printf 'mc.fixture.retired\n' > deploy-fixture/.deploy/previous
export removed="$temp/removed-images"
cat > deploy-shim/docker <<'MOCK'
#!/bin/sh
case "$1 $2" in
  "compose ps") echo fixture-id ;;
  "inspect -f") echo fixture ;;
  "compose exec") echo '{"ok":true}' ;;
  "compose config") printf '%s\n' dtc/gateway:mc.fixture.retired dtc/backup:mc.fixture.retired dtc/frontend:mc.other.previous ;;
  "image inspect")
    case "$*" in *dtc/gateway:mc.fixture.retired) echo fixture ;; *) echo other ;; esac ;;
  "image rm") printf '%s\n' "$3" >> "$removed" ;;
  "compose up"|"compose build") ;;
  *) exit 70 ;;
esac
MOCK
chmod +x deploy-shim/docker
PATH="$temp/deploy-shim:$PATH" sh deploy-fixture/scripts/deploy.sh
test "$(cat "$removed")" = dtc/gateway:mc.fixture.retired
echo "Project-scoped image rotation checks passed."

# Verify sidecar status and exit codes with controlled failures and no network.
docker run --rm -i --network none --entrypoint bash -v "$root/backup:/tested:ro" postgres:16.13 -se <<'CHECK'
mkdir -p /mock /data /backups /dicom /mirror /config
touch /config/rclone.conf
cat > /mock/tool <<'MOCK'
#!/bin/sh
case "${0##*/}" in
  pg_dump) test "${FAIL_DUMP:-0}" = 0 && echo dump ;;
  pg_restore) test "${FAIL_RESTORE:-0}" = 0 ;;
  psql) echo '1/1/1/1' ;;
  rclone|rsync)
    if [ "$1" = listremotes ]; then echo 'fixture: crypt'; exit 0; fi
    if [ "${FAIL_DICOM:-0}" = 1 ]; then
      for arg do case "$arg" in /dicom|/dicom/) exit 1 ;; esac; done
    fi ;;
  *) exit 0 ;;
esac
MOCK
chmod +x /mock/tool
for name in pg_dump pg_restore psql createdb dropdb rclone rsync; do ln -s tool "/mock/$name"; done
export PATH="/mock:$PATH" MIRROR_CONFIGURED=yes CLOUD_REMOTE=fixture: PGDATABASE=fixture BACKUP_KEEP=1
mkdir /backups/unrelated
touch /backups/unrelated/important
bash /tested/backup-loop.sh once
if FAIL_DUMP=1 bash /tested/backup-loop.sh once; then exit 1; fi
grep -q '"dump_ok":false' /backups/status.json
if FAIL_RESTORE=1 bash /tested/backup-loop.sh once; then exit 1; fi
grep -q '"restore_test":{"state":"failed"' /backups/status.json
if FAIL_DICOM=1 bash /tested/backup-loop.sh once; then exit 1; fi
grep -q '"mirror":{"state":"failed"' /backups/status.json
grep -q '"cloud":{"state":"failed"' /backups/status.json
test -f /backups/unrelated/important
test "$(find /backups -name .medcontrol-complete | wc -l)" -eq 1
CHECK
echo "Sidecar failure and rotation checks passed."
