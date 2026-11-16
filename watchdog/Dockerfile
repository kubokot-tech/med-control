# Independent watchdog: polls the gateway's deep health check and reports to Telegram
# (and optionally pings an external dead-man's-switch URL such as healthchecks.io).
FROM alpine:3.21
RUN apk add --no-cache --no-scripts curl jq tzdata && adduser -D -u 10002 watchdog
COPY watchdog.sh /watchdog.sh
USER watchdog
ENTRYPOINT ["sh", "/watchdog.sh"]
