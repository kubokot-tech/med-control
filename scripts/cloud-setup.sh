#!/usr/bin/env bash
# One-time cloud backup setup on the server (run from the app directory with the stack up; needs .env, an empty one will do):
#   YC_ACCESS_KEY=... YC_SECRET_KEY=... YC_BUCKET=medcontrol-backup bash scripts/cloud-setup.sh
# An example for one S3-compatible provider: the endpoint and region default to Yandex Object Storage, set YC_ENDPOINT
# and YC_REGION for another. The backup service itself takes any rclone remote named in CLOUD_REMOTE (docs/OPERATIONS.md).
# Writes $RCLONE_DIR/rclone.conf with an S3 remote and a crypt remote on top of it,
# generates the encryption key, prints it ONCE and stores a copy in $RCLONE_DIR/CRYPT-KEY.txt (move it to a password manager).
# Nothing is typed into this script by the assistant: keys come from your shell environment.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${YC_ACCESS_KEY:?set YC_ACCESS_KEY}" "${YC_SECRET_KEY:?set YC_SECRET_KEY}" "${YC_BUCKET:?set YC_BUCKET}"
: "${YC_ENDPOINT:=storage.yandexcloud.net}" "${YC_REGION:=ru-central1}" "${RCLONE_DIR:=./rclone}"
mkdir -p "$RCLONE_DIR"
obscure() { docker compose run --rm -T --entrypoint rclone backup obscure "$1"; }
if [ -f "$RCLONE_DIR/CRYPT-KEY.txt" ]; then
  KEY=$(sed -n 's/^password=//p' "$RCLONE_DIR/CRYPT-KEY.txt"); SALT=$(sed -n 's/^salt=//p' "$RCLONE_DIR/CRYPT-KEY.txt")
  echo "cloud-setup: reusing existing crypt key from $RCLONE_DIR/CRYPT-KEY.txt"
else
  KEY=$(openssl rand -base64 33 | tr -d '\n'); SALT=$(openssl rand -base64 24 | tr -d '\n')
  printf 'password=%s\nsalt=%s\n' "$KEY" "$SALT" > "$RCLONE_DIR/CRYPT-KEY.txt"; chmod 600 "$RCLONE_DIR/CRYPT-KEY.txt"
fi
cat > "$RCLONE_DIR/rclone.conf" <<CONF
[yc]
type = s3
provider = Other
endpoint = $YC_ENDPOINT
region = $YC_REGION
access_key_id = $YC_ACCESS_KEY
secret_access_key = $YC_SECRET_KEY
acl = private
no_check_bucket = false

[yc-crypt]
type = crypt
remote = yc:$YC_BUCKET
filename_encryption = standard
directory_name_encryption = true
password = $(obscure "$KEY")
password2 = $(obscure "$SALT")
CONF
chmod 600 "$RCLONE_DIR/rclone.conf"
echo "cloud-setup: checking access to bucket $YC_BUCKET ..."
docker compose run --rm -T --entrypoint rclone backup lsd yc: >/dev/null && echo "cloud-setup: bucket reachable"
grep -q '^CLOUD_REMOTE=' .env || echo 'CLOUD_REMOTE=yc-crypt:' >> .env
grep -q '^RCLONE_DIR=' .env || echo "RCLONE_DIR=$RCLONE_DIR" >> .env
cat <<MSG

Готово. Ключ шифрования (без него облачная копия бесполезна) сохранён в $RCLONE_DIR/CRYPT-KEY.txt.
Скопируйте обе строки из этого файла в менеджер паролей, затем можно удалить файл: rm $RCLONE_DIR/CRYPT-KEY.txt
Первая выгрузка: docker compose up -d backup && docker compose exec backup bash /backup-loop.sh once
MSG
