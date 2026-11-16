#!/bin/sh
# Volumes created by older versions belong to root; hand /data to the unprivileged user once, then drop root.
set -e
if [ "$(id -u)" = "0" ]; then
  if [ -d /data ] && [ "$(stat -c %u /data)" != "$(id -u node)" ]; then chown -R node:node /data; fi
  exec su-exec node "$@"
fi
exec "$@"
