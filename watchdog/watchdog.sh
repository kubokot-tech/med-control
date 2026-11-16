#!/bin/sh
# Every INTERVAL seconds: GET CHECK_URL. Two failures in a row -> Telegram alarm (once), recovery -> one message.
# A `degraded` list that changed (or is 24h old) -> one notice. Success also pings HEALTHCHECKS_URL if set.
# The watchdog has no access to the user's settings: WATCHDOG_LANG=en switches its messages to English.
CHECK_URL=${CHECK_URL:-http://gateway:3000/health?deep=1}
INTERVAL=${INTERVAL:-300}
[ "$EGRESS_PROXY" = "direct" ] && EGRESS_PROXY=""
STATE=/tmp/watchdog.state
fails=0; state=ok; last_degraded=""; last_degraded_at=0
if [ "$WATCHDOG_LANG" = "en" ]; then
  stamp() { date '+%b %d %H:%M'; }
  say_up() { echo "✅ MedControl is responding again ($(stamp))"; }
  say_degraded() { echo "⚠️ MedControl is running, but there are problems: $1"; }
  say_down() { echo "🚨 MedControl is not responding (HTTP ${1:-no response}) $(stamp). $2"; }
else
  stamp() { date '+%d.%m %H:%M'; }
  say_up() { echo "✅ МедКонтроль снова отвечает ($(stamp))"; }
  say_degraded() { echo "⚠️ МедКонтроль работает, но есть проблемы: $1"; }
  say_down() { echo "🚨 МедКонтроль не отвечает (HTTP ${1:-нет ответа}) $(stamp). $2"; }
fi
# Telegram through the egress proxy first, then directly: the proxy depends on the router's VPN, and an alarm
# about the VPN being down must not travel through the VPN.
tg() {
  [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ] || { echo "tg (not configured): $1"; return 0; }
  url="https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"
  if [ -n "$EGRESS_PROXY" ] && curl -sS -m 15 -x "$EGRESS_PROXY" -X POST "$url" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=$1" -o /dev/null 2>/dev/null; then return 0; fi
  curl -sS -m 15 -X POST "$url" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=$1" -o /dev/null || echo "telegram send failed (proxy and direct)"
}
sleep 30
while :; do
  body=$(curl -sS -m 40 -w '\n%{http_code}' "$CHECK_URL" 2>/dev/null)
  code=$(printf '%s' "$body" | tail -n1); json=$(printf '%s' "$body" | sed '$d')
  ok=$(printf '%s' "$json" | jq -r '.ok // false' 2>/dev/null)
  if [ "$code" = "200" ] && [ "$ok" = "true" ]; then
    fails=0
    if [ "$state" = "fail" ]; then tg "$(say_up)"; state=ok; fi
    degraded=$(printf '%s' "$json" | jq -r '.degraded | join("; ")' 2>/dev/null)
    now=$(date +%s)
    if [ -n "$degraded" ] && { [ "$degraded" != "$last_degraded" ] || [ $((now - last_degraded_at)) -gt 86400 ]; }; then
      tg "$(say_degraded "$degraded")"; last_degraded="$degraded"; last_degraded_at=$now
    fi
    [ -z "$degraded" ] && last_degraded=""
    [ -n "$HEALTHCHECKS_URL" ] && curl -sS -m 10 -o /dev/null "$HEALTHCHECKS_URL" || true
    echo "$(date '+%F %T') ok${degraded:+ (degraded: $degraded)}"
  else
    fails=$((fails + 1))
    echo "$(date '+%F %T') FAIL #$fails http=$code $(printf '%s' "$json" | head -c 200)"
    if [ "$fails" -ge 2 ] && [ "$state" != "fail" ]; then
      tg "$(say_down "$code" "$(printf '%s' "$json" | jq -r '.degraded | join("; ")' 2>/dev/null | head -c 300)")"
      state=fail
    fi
  fi
  echo "$state $fails" > "$STATE"
  sleep "$INTERVAL"
done
