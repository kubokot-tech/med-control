# Run in a subshell so the caller keeps its working directory. Only a successful
# writer creates .medcontrol-complete. Legacy and unrelated directories are preserved.
rotate_copies() (
  cd "$1" || exit 1
  case "$2" in ''|*[!0-9]*) echo "Invalid backup retention" >&2; exit 1 ;; esac
  [ "$2" -gt 0 ] || exit 1
  count=0
  ls -1dt ./*/ 2>/dev/null | while IFS= read -r dir; do
    dir=${dir%/}
    [ ! -L "$dir" ] && [ -f "$dir/.medcontrol-complete" ] &&
      [ -s "$dir/db.dump" ] && [ -s "$dir/uploads.tar.gz" ] || continue
    [ "$(cat "$dir/.medcontrol-complete")" = "${dir##*/}" ] || continue
    count=$((count + 1))
    if [ "$count" -gt "$2" ]; then rm -rf "$dir" || exit 1; fi
  done
)
