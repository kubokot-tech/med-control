# Outbound HTTP proxy with its own LAN address (macvlan), so the router can send
# only this container's traffic through a VPN. Reachable only from the compose network.
FROM alpine:3.21
RUN apk add --no-cache --no-scripts tinyproxy
COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY filter /etc/tinyproxy/filter
EXPOSE 8888
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- -T 3 http://127.0.0.1:8888/ >/dev/null 2>&1 || exit 0
CMD ["tinyproxy", "-d", "-c", "/etc/tinyproxy/tinyproxy.conf"]
