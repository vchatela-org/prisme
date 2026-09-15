#!/usr/bin/env bash
#
# Privacy deny-list scan.
#
# This repository is public: it documents a product, never its owner.
# See docs/17-privacy.md.
#
#   ./scripts/privacy-scan.sh            scan tracked files in the working tree
#   ./scripts/privacy-scan.sh --history  scan every blob in the entire git history
#   ./scripts/privacy-scan.sh --staged   scan staged content (used by the pre-commit hook)
#
# Exits non-zero on any match.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

DENYLIST=".github/privacy-denylist.txt"
LOCAL_DENYLIST=".github/privacy-denylist.local.txt"   # gitignored; personal patterns
IGNOREFILE=".privacyignore"
MODE="${1:---worktree}"

[[ -f "$DENYLIST" ]] || { echo "privacy-scan: missing $DENYLIST" >&2; exit 2; }

# Build the pattern list: public deny-list, plus the local supplement when present.
PATTERNS="$(mktemp)"; trap 'rm -f "$PATTERNS" "${FILES:-}"' EXIT
grep -vE '^\s*(#|$)' "$DENYLIST" > "$PATTERNS"
if [[ -f "$LOCAL_DENYLIST" ]]; then
  grep -vE '^\s*(#|$)' "$LOCAL_DENYLIST" >> "$PATTERNS"
  echo "privacy-scan: including local supplement ($(wc -l < "$LOCAL_DENYLIST") lines)"
fi
echo "privacy-scan: $(wc -l < "$PATTERNS") patterns, mode ${MODE#--}"

ignored() {
  [[ -f "$IGNOREFILE" ]] || return 1
  while IFS= read -r entry; do
    [[ -z "$entry" || "$entry" == \#* ]] && continue
    [[ "$1" == "$entry"* || "$1" == *"/$entry"* ]] && return 0
  done < "$IGNOREFILE"
  return 1
}

hits=0

scan_stream() {   # scan_stream <label> ; content on stdin
  local label="$1" out
  if out="$(grep -nEi -f "$PATTERNS" 2>/dev/null)"; then
    # Show at most 3 matches per file, and truncate each line: the whole point
    # is to avoid reprinting the sensitive content we just found.
    echo "  ✗ $label"
    echo "$out" | head -3 | cut -c1-120 | sed 's/^/      /'
    hits=$((hits + 1))
  fi
}

case "$MODE" in
  --worktree)
    while IFS= read -r f; do
      ignored "$f" && continue
      [[ -f "$f" ]] || continue
      scan_stream "$f" < "$f"
    done < <(git ls-files)
    ;;

  --staged)
    while IFS= read -r f; do
      ignored "$f" && continue
      scan_stream "$f (staged)" < <(git show ":$f" 2>/dev/null || true)
    done < <(git diff --cached --name-only --diff-filter=ACM)
    ;;

  --history)
    # Every blob ever committed. Public history is permanent, so this is the
    # check that actually matters before the repository is made public.
    echo "privacy-scan: walking full history, this may take a moment"
    while read -r _ sha path; do
      [[ -z "${path:-}" ]] && continue
      ignored "$path" && continue
      scan_stream "$path @ ${sha:0:8}" < <(git cat-file -p "$sha" 2>/dev/null || true)
    done < <(git rev-list --objects --all \
             | git cat-file --batch-check='%(objecttype) %(objectname) %(rest)' \
             | awk '$1 == "blob" && $3 != ""')
    ;;

  *)
    echo "privacy-scan: unknown mode '$MODE'" >&2; exit 2 ;;
esac

if (( hits > 0 )); then
  cat >&2 <<EOF

privacy-scan: FAILED — $hits file(s) matched the deny-list.

This repository is public. Do not "just delete the file and commit": if it was
already pushed, the content stays in history and in every clone. See
docs/17-privacy.md §3 for what to do instead.

If a match is a false positive, narrow the pattern in $DENYLIST
or add a specific path to $IGNOREFILE — every ignore entry is a hole
in the control, so keep it minimal.
EOF
  exit 1
fi

echo "privacy-scan: clean"
