#!/usr/bin/env bash
# From a workstation: ship a git ref to the server over SSH and run scripts/deploy.sh there.
# Usage: scripts/release.sh [ref]   (default origin/main)
# Environment: DEPLOY_HOST (required, e.g. user@server), DEPLOY_DIR (default /srv/dtc/app),
#              DEPLOY_KEY (optional SSH private key; otherwise ssh-agent / ~/.ssh/config).
set -euo pipefail
REF=${1:-origin/main}
HOST=${DEPLOY_HOST:?set DEPLOY_HOST, e.g. user@server}
DIR=${DEPLOY_DIR:-/srv/dtc/app}
SSH=(ssh)
[ -n "${DEPLOY_KEY:-}" ] && SSH=(ssh -i "$DEPLOY_KEY" -o IdentitiesOnly=yes)
TOP=$(git rev-parse --show-toplevel)
git -C "$TOP" fetch -q origin
echo "release: $REF ($(git -C "$TOP" rev-parse --short "$REF")) -> $HOST:$DIR"
git -C "$TOP" archive --format=tar "$REF" | "${SSH[@]}" "$HOST" "mkdir -p $DIR && cd $DIR && (tar -x --warning=no-timestamp 2>/dev/null || tar -x)"
"${SSH[@]}" "$HOST" "cd $DIR && DEPLOY_REVISION=$(git -C "$TOP" rev-parse --short "$REF") sh scripts/deploy.sh" 2>&1 | tee -a "$TOP/.release.log"
