#!/usr/bin/env bash
# Prepare or verify the encrypted cloud backup remote. See docs/OPERATIONS.md.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
if [ -z "${RCLONE_DIR:-}" ] && [ -f ./rclone/rclone.conf ]; then RCLONE_DIR=./rclone; fi
: "${RCLONE_DIR:=../medcontrol-rclone}"
mkdir -p "$RCLONE_DIR"
config_dir=$(cd "$RCLONE_DIR" && pwd)
mkdir "$config_dir/.setup-lock" || { echo "Another setup may be running; inspect $config_dir/.setup-lock" >&2; exit 1; }
temp=$(mktemp -d "$config_dir/.setup.XXXXXX")
trap 'rm -rf "$temp"; rmdir "$config_dir/.setup-lock"' EXIT
rclone_run() { docker compose run --rm --no-deps -T -v "$config_dir:/cloud-setup:ro" --entrypoint rclone backup "$@"; }
verify() {
  local config="/cloud-setup/$1"
  rclone_run --config "$config" listremotes --long | awk '$1 == "yc-crypt:" && $2 == "crypt" {ok=1} END {exit !ok}'
  rclone_run --config "$config" lsf --max-depth 1 yc-crypt: > /dev/null
}
if [ -e "$config_dir/rclone.conf" ]; then
  verify rclone.conf
  echo "Existing yc-crypt configuration verified."
else
  : "${YC_ACCESS_KEY:?set YC_ACCESS_KEY}" "${YC_SECRET_KEY:?set YC_SECRET_KEY}" "${YC_BUCKET:?set YC_BUCKET}"
  : "${YC_ENDPOINT:=storage.yandexcloud.net}" "${YC_REGION:=ru-central1}"
  keys="$config_dir/CRYPT-KEY.txt"
  if [ -f "$keys" ]; then
    key=$(sed -n 's/^password=//p' "$keys"); salt=$(sed -n 's/^salt=//p' "$keys")
    [ -n "$key" ] && [ -n "$salt" ] || { echo "Invalid saved crypt key" >&2; exit 1; }
  else
    key=$(openssl rand -base64 33); salt=$(openssl rand -base64 24)
    printf 'password=%s\nsalt=%s\n' "$key" "$salt" > "$temp/key"
    mv "$temp/key" "$keys"
  fi
  obscured_key=$(printf '%s' "$key" | rclone_run obscure -)
  obscured_salt=$(printf '%s' "$salt" | rclone_run obscure -)
  cat > "$temp/rclone.conf" <<CONF
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
password = $obscured_key
password2 = $obscured_salt
CONF
  verify "$(basename "$temp")/rclone.conf"
  mv "$temp/rclone.conf" "$config_dir/rclone.conf"
fi
if [ -z "${CLOUD_REMOTE:-}" ]; then printf '\nCLOUD_REMOTE=yc-crypt:\n' >> .env; fi
if ! grep -q '^RCLONE_DIR=.' .env; then printf '\nRCLONE_DIR=%q\n' "$RCLONE_DIR" >> .env; fi
echo "Cloud backup configuration verified. Store the crypt key and salt in your password manager."
