#!/usr/bin/env bash
# Backup sidecar. Once a day at BACKUP_AT (container TZ):
#   1. dump the DB, archive /data, copy .env  -> /backups/<date_time>/   (keep BACKUP_KEEP)
#      /data goes without jwt.secret (the key that signs sessions) and setup-code.txt (the first-run code): a copy of
#      the backup must not be enough to forge a session of the running install; a restored install makes a new secret
#   2. mirror /backups and /dicom to the second disk at /mirror            (if mounted)
#   3. rclone sync /backups and /dicom to CLOUD_REMOTE (an rclone crypt remote from /config/rclone.conf);
#      a remote of another type still gets the copy, with a loud warning: it lies there unencrypted
#   4. on RESTORE_TEST_DOW (default Sun) restore the fresh dump into a scratch DB and compare row counts
# Every step writes its result into /backups/status.json for the gateway (Telegram morning line, alerts).
# `bash /backup-loop.sh once` runs one cycle now and exits (used for tests and first cloud upload).
set -uo pipefail
umask 077   # backups hold medical data and .env: owner-only
: "${BACKUP_AT:=03:30}" "${BACKUP_KEEP:=14}" "${MIRROR_KEEP:=30}" "${RESTORE_TEST_DOW:=Sun}" "${CLOUD_REMOTE:=}"
STATUS=/backups/status.json
export RCLONE_CONFIG=/config/rclone.conf

j() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n'; }
now_iso() { date -Iseconds; }

dump_ok=false dump_bytes=0 uploads_bytes=0 dest="" err_dump=""
mirror_state=skipped mirror_err="" cloud_state=skipped cloud_err="" cloud_crypt=null test_state=skipped test_detail=""
# Never in the archive of /data: see step 1 above.
DATA_EXCLUDE=(--exclude=./jwt.secret --exclude=./setup-code.txt)

write_status() {
  cat > "$STATUS.tmp" <<JSON
{"ran_at":"$(now_iso)","backup_at":"$BACKUP_AT","dir":"$(j "$dest")","dump_ok":$dump_ok,"dump_bytes":$dump_bytes,"uploads_bytes":$uploads_bytes,"dump_error":"$(j "$err_dump")",
 "mirror":{"state":"$mirror_state","error":"$(j "$mirror_err")","enabled":$(mirror_on && echo true || echo false)},
 "cloud":{"state":"$cloud_state","error":"$(j "$cloud_err")","remote":"$(j "$CLOUD_REMOTE")","enabled":$(cloud_on && echo true || echo false),"crypt":$cloud_crypt},
 "restore_test":{"state":"$test_state","detail":"$(j "$test_detail")"}}
JSON
  mv "$STATUS.tmp" "$STATUS"; chmod 644 "$STATUS"; chmod 711 /backups   # gateway (non-root) reads only status.json; dumps stay 600/700   # readable by the unprivileged gateway
}

step_dump() {
  dest="/backups/$(date +%F_%H%M)"
  mkdir -p "$dest"
  if err_dump=$( { pg_dump -Fc > "$dest/db.dump" && tar czf "$dest/uploads.tar.gz" "${DATA_EXCLUDE[@]}" -C /data . ; } 2>&1 ); then
    [ -f /env/.env ] && cp /env/.env "$dest/env" && chmod 600 "$dest/env"
    dump_ok=true; dump_bytes=$(stat -c %s "$dest/db.dump"); uploads_bytes=$(stat -c %s "$dest/uploads.tar.gz")
    echo "backup: ok $dest (dump ${dump_bytes}B, uploads ${uploads_bytes}B)"
    ls -1dt /backups/*/ 2>/dev/null | grep -v migrate-from | tail -n +$((BACKUP_KEEP + 1)) | xargs -r rm -rf
  else
    dump_ok=false; echo "backup: FAILED: $err_dump" >&2; rm -rf "$dest"
  fi
}

# The mirror is a second disk only when MIRROR_DIR is set; without it /mirror is a Docker volume on the same disk.
mirror_on() { [ -d /mirror ] && [ "${MIRROR_CONFIGURED:-}" = yes ]; }

step_mirror() {
  mirror_on || { mirror_state=skipped; return; }
  if out=$( { rsync -a --delete --exclude status.json /backups/ /mirror/backups/ && { [ -d /dicom ] && rsync -a /dicom/ /mirror/dicom/ || true; } ; } 2>&1 ); then
    mirror_state=ok; echo "mirror: ok ($(du -sh /mirror 2>/dev/null | cut -f1))"
  else mirror_state=failed; mirror_err="$out"; echo "mirror: FAILED: $out" >&2; fi
}

cloud_on() { [ -n "$CLOUD_REMOTE" ] && [ -f "$RCLONE_CONFIG" ]; }

# The type of the remote CLOUD_REMOTE names, as rclone sees it («crypt», «s3», …); empty for a local path or an unknown name.
cloud_type() {
  case "$CLOUD_REMOTE" in *:*) ;; *) return 0 ;; esac
  rclone listremotes --long 2>/dev/null | awk -v n="${CLOUD_REMOTE%%:*}:" '$1 == n { print $2; exit }'
}

# The copies hold the whole medical history and .env. Sent to anything but an rclone crypt remote they lie readable at
# the provider. The copy is still made (existing setups must keep working), but nobody should miss this: it goes to the
# log and, through status.json, to the morning Telegram report and the Settings page.
cloud_check() {
  cloud_on || { cloud_crypt=null; return; }
  local type; type=$(cloud_type)
  if [ "$type" = crypt ]; then cloud_crypt=true; return; fi
  cloud_crypt=false
  {
    echo "cloud: ============================== WARNING =============================="
    echo "cloud: CLOUD_REMOTE=$CLOUD_REMOTE is not an rclone crypt remote (type: ${type:-unknown})."
    echo "cloud: The backups (the medical history and .env) are uploaded UNENCRYPTED."
    echo "cloud: Make a crypt remote over it and put its name into CLOUD_REMOTE: scripts/cloud-setup.sh, docs/RESTORE.md"
    echo "cloud: ======================================================================"
  } >&2
}

step_cloud() {
  cloud_check
  cloud_on || { cloud_state=skipped; return; }
  local out
  if out=$( { rclone sync /backups "$CLOUD_REMOTE/backups" --exclude status.json --transfers 4 --checkers 8 --stats 0 2>&1 && { [ -d /dicom ] && rclone sync /dicom "$CLOUD_REMOTE/dicom" --transfers 2 --checkers 4 --stats 0 2>&1 || true; }; } ); then
    cloud_state=ok; echo "cloud: ok ($CLOUD_REMOTE)"
  else cloud_state=failed; cloud_err="$out"; echo "cloud: FAILED: $out" >&2; fi
}

step_restore_test() {
  [ "$dump_ok" = true ] || { test_state=skipped; return; }
  local db="${PGDATABASE}_restore_test" out
  if out=$( {
      dropdb --if-exists "$db" 2>/dev/null && createdb "$db" && pg_restore --no-owner -d "$db" "$dest/db.dump" 2>/dev/null
      live=$(psql -Atc "select (select count(*) from lab_results)||'/'||(select count(*) from milestones)||'/'||(select count(*) from administrations)||'/'||(select count(*) from ai_comments)")
      rest=$(psql -Atc "select (select count(*) from lab_results)||'/'||(select count(*) from milestones)||'/'||(select count(*) from administrations)||'/'||(select count(*) from ai_comments)" -d "$db")
      dropdb "$db"
      echo "lab_results/milestones/administrations/ai_comments live $live restored $rest"
      [ "$live" = "$rest" ]
    } 2>&1 ); then
    test_state=ok; test_detail="$out"; echo "restore-test: ok ($out)"
  else test_state=failed; test_detail="$out"; echo "restore-test: FAILED: $out" >&2; fi
}

cycle() {
  local force_test="${1:-}"
  step_dump; write_status
  step_mirror; write_status
  step_cloud; write_status
  if [ "$force_test" = force ] || [ "$(date +%a)" = "$RESTORE_TEST_DOW" ]; then step_restore_test; write_status; fi
}

if [ "${1:-}" = once ]; then cycle force; exit 0; fi
echo "backup-loop: daily at $BACKUP_AT, keep $BACKUP_KEEP; mirror $(mirror_on && echo on || echo off); cloud ${CLOUD_REMOTE:-off}; restore test on $RESTORE_TEST_DOW"
cloud_check   # the warning about an unencrypted remote is in the log from the start, not only after the first night
last=""
# Catch up: if the container started after BACKUP_AT and no backup exists for today, run one now.
if [[ "$(date +%H:%M)" > "$BACKUP_AT" ]] && ! ls -d /backups/$(date +%F)_* >/dev/null 2>&1; then echo "backup-loop: catching up today's backup"; cycle; last="$(date +%F)"; fi
while true; do
  now=$(date +%H:%M); today=$(date +%F)
  if [[ "$now" == "$BACKUP_AT" && "$last" != "$today" ]]; then last="$today"; cycle; fi
  sleep 30
done
