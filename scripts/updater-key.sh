#!/usr/bin/env bash
# Creates the signing key for desktop updates (docs/RELEASE.md, «Один раз: ключ обновлений») with no typing:
# a random password goes to the macOS Keychain, the key to ~/.tauri, both to the public repo's secrets.
# Nothing secret is printed. An existing key is kept next to it as .old-<date>.
# Usage: scripts/updater-key.sh [owner/repo]   (macOS, needs gh and the desktop npm dependencies)
set -euo pipefail

REPO="${1:-kubokot-tech/med-control}"
KEY="$HOME/.tauri/medcontrol-updater.key"
SERVICE="MedControl updater key"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI="$ROOT/desktop/node_modules/.bin/tauri"

[ "$(uname)" = Darwin ] || { echo "macOS only (the password is kept in the Keychain)" >&2; exit 2; }
[ -x "$TAURI" ] || { echo "no Tauri CLI: run npm ci in $ROOT/desktop" >&2; exit 2; }
gh auth status >/dev/null 2>&1 || { echo "gh is not signed in: gh auth login" >&2; exit 2; }

mkdir -p "$HOME/.tauri"
if [ -f "$KEY" ]; then
  OLD="${KEY}.old-$(date +%Y%m%d-%H%M%S)"
  mv -f "$KEY" "$OLD"
  if [ -f "${KEY}.pub" ]; then mv -f "${KEY}.pub" "${OLD}.pub"; fi
  echo "old key kept as ${OLD}"
fi

P="$(openssl rand -base64 32 | tr -d '\n')"
security add-generic-password -U -s "$SERVICE" -a medcontrol -l "$SERVICE" -w "$P"
echo "password saved in Keychain: \"${SERVICE}\""

"$TAURI" signer generate --ci -p "$P" -w "$KEY" >/dev/null
chmod 600 "$KEY"
echo "key written: $KEY"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo test > "$TMP/check.txt"
"$TAURI" signer sign -f "$KEY" -p "$P" "$TMP/check.txt" >/dev/null 2>&1 \
  || { echo "self-check failed: the new key does not sign with its password" >&2; exit 1; }
echo "self-check: the key signs with the saved password"

gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" < "$KEY"
printf %s "$P" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$REPO"
unset P
echo "secrets updated in $REPO"
echo "public key: $KEY.pub (goes to plugins.updater.pubkey in desktop/src-tauri/tauri.conf.json)"
