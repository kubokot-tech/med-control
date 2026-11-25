#!/bin/sh
set -eu
subnet=${STACK_SUBNET:-172.31.250.0/24}
case "$subnet" in *[!0-9./]*|'') echo "egress: invalid STACK_SUBNET" >&2; exit 1 ;; esac
sed "s|__STACK_SUBNET__|$subnet|" /etc/tinyproxy/tinyproxy.conf > /tmp/tinyproxy.conf
exec tinyproxy -d -c /tmp/tinyproxy.conf
