#!/usr/bin/env bash
# Publish a version of the working repository to the public repository as a single commit,
# then tag it and create the GitHub Release there. The public history only gets release commits,
# authored by "MedControl" with no co-author trailers. Step by step: docs/RELEASE.md.
#
# Usage: scripts/publish-public.sh X.Y.Z [--dry-run] [--notes FILE]
#   --dry-run   build and scan the public commit in a temporary clone, push nothing
#   --notes     release notes file (Markdown); by default they are built from CHANGELOG.md
# Environment:
#   PUBLIC_REPO        owner/name of the public repository (default kubokot-tech/med-control)
#   PUBLIC_URL         clone/push URL (default git@github.com:$PUBLIC_REPO.git)
#   PUBLISH_DENY_FILE  local list of words that must never be published, one extended regex per line,
#                      matched case-insensitively (default ~/.config/medcontrol/publish-deny.txt).
#                      Required: keep it outside the repository, chmod 600.
#
# State: the private tag public-vX.Y.Z marks the private commit whose tree is on public main for X.Y.Z;
# the public tag vX.Y.Z appears only after the public CI is green. If CI fails, fix the code in the
# working repository and run the script again with the same version: it adds one more commit.
set -euo pipefail

VERSION=""; DRY=0; NOTES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --notes) NOTES=${2:?--notes needs a file}; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) [ -z "$VERSION" ] && VERSION=$1 || { echo "unexpected argument: $1" >&2; exit 2; } ;;
  esac
  shift
done
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 X.Y.Z [--dry-run] [--notes FILE]" >&2; exit 2; }

REPO=${PUBLIC_REPO:-kubokot-tech/med-control}
URL=${PUBLIC_URL:-git@github.com:$REPO.git}
DENY=${PUBLISH_DENY_FILE:-$HOME/.config/medcontrol/publish-deny.txt}
NAME="MedControl"
EMAIL="265226858+kubokot-tech@users.noreply.github.com"
TAG="v$VERSION"
PTAG="public-v$VERSION"
TOP=$(git rev-parse --show-toplevel)
cd "$TOP"
export TZ=UTC

FAIL=0
problem() { echo "  ✗ $*" >&2; FAIL=1; }
ok() { echo "  ✓ $*"; }
# In a dry run, preconditions about the moment of release only warn.
soft() { if [ $DRY = 1 ]; then echo "  ! $* (dry run: continuing)"; else problem "$*"; fi; }
pgit() { git -C "$WORK/pub" -c user.name="$NAME" -c user.email="$EMAIL" -c commit.gpgsign=false -c tag.gpgsign=false "$@"; }

echo "Checks"
[ -z "$(git status --porcelain --untracked-files=no)" ] && ok "working tree is clean" || soft "working tree has uncommitted changes"
git fetch -q origin --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && ok "HEAD is origin/main" || soft "HEAD is not origin/main"
GV=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' gateway/package.json | head -1)
[ "$GV" = "$VERSION" ] && ok "gateway/package.json is $VERSION" || soft "gateway/package.json is $GV, not $VERSION"
grep -q "^## $VERSION" CHANGELOG.md && ok "CHANGELOG.md has a $VERSION section" || soft "CHANGELOG.md has no '## $VERSION' section"
[ -z "$NOTES" ] || [ -f "$NOTES" ] || problem "notes file not found: $NOTES"
command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && ok "gh is signed in" || problem "gh is missing or not signed in"
if [ -f "$DENY" ]; then
  [ -z "$(find "$DENY" \( -perm -040 -o -perm -004 \) -print 2>/dev/null)" ] || problem "$DENY is readable by others: chmod 600"
  NDENY=$(grep -cvE '^[[:space:]]*(#|$)' "$DENY" || true)
  [ "$NDENY" -gt 0 ] && ok "deny list: $NDENY patterns" || problem "deny list $DENY is empty"
else
  problem "deny list not found: $DENY (one regex per line: surnames, addresses, hosts, clinics)"
fi
if git ls-remote --exit-code --tags "$URL" "refs/tags/$TAG" >/dev/null 2>&1; then
  soft "$TAG is already released in $REPO"
fi
BASE=$(git tag -l 'public-v*' --sort=-v:refname | head -1)
[ -n "$BASE" ] && ok "last published: $BASE" || problem "no public-v* tag: tag the private commit that matches public main"
[ $FAIL = 0 ] || { echo "Stopped: fix the problems above." >&2; exit 1; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/medcontrol-publish.XXXXXX")
[ $DRY = 1 ] || trap 'rm -rf "$WORK"' EXIT

echo "Public repository"
git clone -q --depth 1 "$URL" "$WORK/pub"
PUB_TREE=$(git -C "$WORK/pub" rev-parse 'HEAD^{tree}')
if [ "$PUB_TREE" != "$(git rev-parse "$BASE^{tree}")" ]; then
  echo "  ✗ public main does not match $BASE: someone changed it directly. Port those changes into the" >&2
  echo "    working repository, publish, then move $BASE, or investigate. Differences:" >&2
  git -C "$WORK/pub" fetch -q --depth 1 "file://$TOP" "refs/tags/$BASE"
  git -C "$WORK/pub" diff --stat FETCH_HEAD HEAD >&2
  exit 1
fi
ok "public main matches $BASE"
REPAIR=0; [ "$BASE" = "$PTAG" ] && REPAIR=1

echo "Export"
git -C "$WORK/pub" rm -rqf --ignore-unmatch .
git archive HEAD | tar -x -C "$WORK/pub"
git -C "$WORK/pub" add -A
NEW_TREE=$(git -C "$WORK/pub" write-tree)
[ "$NEW_TREE" = "$(git rev-parse 'HEAD^{tree}')" ] || { echo "  ✗ exported tree differs from HEAD (export-ignore or eol?)" >&2; exit 1; }
ok "tree $(git rev-parse --short 'HEAD^{tree}') from $(git rev-parse --short HEAD)"

echo "Scan"
if pgit ls-files | grep -E '(^|/)(rclone\.conf|CRYPT-KEY\.txt)$' >/dev/null; then
  echo "Stopped: release tree contains local backup credentials." >&2
  exit 1
fi
# Generic secrets and personal traces. Test fixtures use short or obviously fake values that these do not match.
SECRETS='sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{30,}|sk-proj-[A-Za-z0-9_-]{30,}|sk-or-v1-[a-f0-9]{40,}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[abprs]-[0-9]+-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|[0-9]{8,10}:AA[A-Za-z0-9_-]{33}|-----BEGIN [A-Z ]*PRIVATE KEY-----|/Users/[a-z][a-z0-9._-]+/'
EMAILS_OK='@(example\.(com|org|net)|med-control\.app|users\.noreply\.github\.com|anthropic\.com)$|^git@github\.com$|@[0-9]x(-[0-9]+)?\.(png|jpg|webp)$'
HITS=$(pgit grep --cached -nIE -e "$SECRETS" -- . ':!scripts/publish-public.sh' | cut -d: -f1,2 || true)
[ -z "$HITS" ] && ok "no keys, tokens or home paths" || { echo "$HITS" | sed 's/^/  ✗ secret or home path: /' >&2; FAIL=1; }
HITS=$(pgit grep --cached -ohIE -e '[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[a-z]{2,}' \
  -- . ':!*package-lock.json' ':!*Cargo.lock' ':!THIRD-PARTY-NOTICES.md' | sort -u | grep -vE "$EMAILS_OK" || true)
[ -z "$HITS" ] && ok "no unexpected email addresses" || { echo "$HITS" | sed 's/^/  ✗ email: /' >&2; FAIL=1; }
n=0
while IFS= read -r pat; do
  case "$pat" in ''|'#'*) continue ;; esac
  n=$((n+1))
  # Matches are not printed: the patterns themselves are private.
  files=$( { pgit grep --cached -liIE -e "$pat" -- . || true; pgit ls-files | grep -iE -e "$pat" || true; } | sort -u)
  [ -z "$files" ] || { echo "$files" | sed "s/^/  ✗ deny pattern #$n in: /" >&2; FAIL=1; }
done < <(grep -vE '^[[:space:]]*$' "$DENY")
[ $FAIL = 0 ] && ok "deny list: nothing found" || { echo "Stopped: nothing was published." >&2; exit 1; }

echo "Commit"
CHANGED=1
if pgit diff --cached --quiet; then
  CHANGED=0; ok "public main already has this tree"
else
  { if [ $REPAIR = 1 ]; then echo "МедКонтроль $VERSION: исправление перед выпуском"; else echo "МедКонтроль $VERSION"; fi
    echo; echo "История версий: CHANGELOG.md."; } > "$WORK/msg"
  pgit commit -q -F "$WORK/msg"
  ok "$(pgit log -1 --format='%h %s')"
  pgit diff --stat HEAD~1 HEAD | tail -1 | sed 's/^/  /'
fi

if [ -z "$NOTES" ]; then
  NOTES="$WORK/notes.md"
  B="https://github.com/$REPO"
  {
    awk -v v="## $VERSION" 'index($0, v)==1 {on=1; next} on && /^## / {exit} on && /^Подробно:/ {exit} on {print}' CHANGELOG.md | sed '/./,$!d' \
      | sed -E "s#\]\(([^)#:]+)\)#](https://github.com/$REPO/blob/main/\1)#g"
    echo "Подробно: [CHANGELOG.md]($B/blob/main/CHANGELOG.md)."
    cat <<EOF

## Скачать для компьютера

| Компьютер | Файл |
|---|---|
| Mac с процессором Apple (M1 и новее) | \`MedControl-macOS-AppleSilicon.dmg\` |
| Mac с процессором Intel | \`MedControl-macOS-Intel.dmg\` |
| Windows 10 или 11, 64 бит | \`MedControl-Windows-Setup.exe\` |

Сборки пока без подписи разработчика: при первом запуске система предупредит, что не может проверить программу. Как запустить: [README]($B#скачать-для-компьютера). Установщики появятся ниже через несколько минут после выпуска: их собирает GitHub Actions.

Серверная версия собирается из исходников: \`docker compose up -d --build\`, см. [README]($B#как-попробовать-на-сервере).

---

## English

MedControl $VERSION. The list of changes is in Russian above and in [CHANGELOG.md]($B/blob/main/CHANGELOG.md). Desktop installers for macOS and Windows are attached below; how to start an unsigned build: [README]($B/blob/main/README.en.md#download-for-your-computer).

MedControl is not a medical device and does not replace a doctor: [DISCLAIMER.en.md]($B/blob/main/DISCLAIMER.en.md).
EOF
  } > "$NOTES"
fi

if [ $DRY = 1 ]; then
  echo "Dry run: nothing pushed. Clone and notes: $WORK (delete it when done)"
  echo "  notes: $NOTES"
  exit 0
fi

echo "Publish"
if [ $CHANGED = 1 ]; then
  pgit push -q origin HEAD:main
  ok "pushed $(pgit rev-parse --short HEAD) to $REPO main"
  git tag -f -a "$PTAG" -m "Published to $REPO main" HEAD >/dev/null
  git push -q -f origin "refs/tags/$PTAG"
  ok "private tag $PTAG -> $(git rev-parse --short HEAD)"
fi
SHA=$(pgit rev-parse HEAD)
RUN=""
for _ in $(seq 1 30); do
  RUN=$(gh run list --repo "$REPO" --workflow ci.yml --commit "$SHA" --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
  [ -n "$RUN" ] && break
  sleep 10
done
[ -n "$RUN" ] || { echo "  ✗ no CI run for $SHA after 5 minutes; tag not created. Run the script again later." >&2; exit 1; }
if gh run watch "$RUN" --repo "$REPO" --exit-status >/dev/null; then
  ok "public CI is green"
else
  echo "  ✗ public CI failed: https://github.com/$REPO/actions/runs/$RUN" >&2
  echo "    $TAG not created. Fix it in the working repository and run: $0 $VERSION" >&2
  exit 1
fi

pgit tag -a "$TAG" -m "МедКонтроль $VERSION" HEAD
pgit push -q origin "refs/tags/$TAG"
ok "tag $TAG pushed; the desktop workflow builds the installers"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release edit "$TAG" --repo "$REPO" --title "МедКонтроль $VERSION" --notes-file "$NOTES" >/dev/null
else
  # Not «latest» yet: README download links and installed apps follow releases/latest, so the desktop
  # workflow marks the release latest only once the installers and latest.json are attached.
  gh release create "$TAG" --repo "$REPO" --verify-tag --latest=false --title "МедКонтроль $VERSION" --notes-file "$NOTES" >/dev/null
fi
ok "release: https://github.com/$REPO/releases/tag/$TAG"
echo "Installers appear on the release in about 15 minutes, then it becomes the latest one:"
echo "  gh run list --repo $REPO --workflow desktop.yml"
