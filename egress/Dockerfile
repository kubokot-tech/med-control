# Outbound HTTP proxy with its own LAN address (macvlan), so the router can send
# only this container's traffic through a VPN. Reachable only from the compose network.
FROM alpine:3.21
RUN apk add --no-cache --no-scripts tinyproxy netcat-openbsd
COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY entrypoint.sh /usr/local/bin/egress-entrypoint
COPY filter /etc/tinyproxy/filter
EXPOSE 8888
HEALTHCHECK --interval=60s --timeout=5s CMD nc -z -w 3 127.0.0.1 8888
ENTRYPOINT ["sh", "/usr/local/bin/egress-entrypoint"]
