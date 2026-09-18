#!/usr/bin/env bash
#
# Negative controls for the two secret-scanning gates (W14 item 9).
#
# W14's definition of done: "CI fails on a deliberately committed fake secret
# and on a deliberate deny-list hit. **Test both**; a gate nobody has seen fail
# is a gate nobody knows is wired up."
#
# W00 watched both fail by hand, once, and wrote it down. That was the right
# thing to do and it does not survive: a `paths:` filter, a renamed file, a
# scanner that starts exiting 0 on a parse error, a deny-list emptied by a bad
# merge — every one of those turns a gate into decoration, and every one of them
# looks exactly like a passing build. So the negative control is a *job*, and it
# runs on every pull request beside the gates it is checking.
#
# Nothing here is committed to the repository. The offending content is
# generated at run time, in a throwaway worktree, and that worktree is removed
# whatever happens. The point is to prove the scanners refuse it, not to find
# out whether anybody notices it sitting in the tree.
#
#   ./scripts/security-gates-selftest.sh
#
# Exits non-zero if either gate FAILS TO FIRE, which is the failure this script
# is looking for. A scanner that rejects the planted content is the pass.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

WORKTREE="$(mktemp -d)"
cleanup() {
  git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || rm -rf "$WORKTREE"
}
trap cleanup EXIT

# A detached worktree of the current commit: the same deny-list, the same
# gitleaks configuration, and a working tree nothing else is using.
git worktree add --detach --quiet "$WORKTREE" HEAD

failures=0

check() {   # check <name> <expected-to-fail-command...>
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "✗ ${name}: the gate did NOT fire on content it must refuse"
    failures=$((failures + 1))
  else
    echo "✓ ${name}: refused the planted content, as it must"
  fi
}

# --- 1. the privacy deny-list ------------------------------------------------
#
# A UUID. It is the first pattern in .github/privacy-denylist.txt, because a
# workspace identifier is exactly that shape — and generating one here means
# this script does not itself contain a deny-list hit.

planted_uuid="$(
  python3 -c 'import uuid; print(uuid.uuid4())'
)"

{
  echo "# planted by security-gates-selftest.sh — never committed"
  echo "external page: ${planted_uuid}"
} > "$WORKTREE/planted-privacy.md"

git -C "$WORKTREE" add planted-privacy.md

check "privacy deny-list" env -C "$WORKTREE" ./scripts/privacy-scan.sh --staged

# --- 2. gitleaks -------------------------------------------------------------
#
# A high-entropy assignment under a credential-shaped name, which is what
# gitleaks' generic rule is for. Generated, for the same reason as above.

planted_secret="$(
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
)"

{
  echo "# planted by security-gates-selftest.sh — never committed"
  echo "aws_secret_access_key = \"${planted_secret}\""
} > "$WORKTREE/planted-secret.txt"

git -C "$WORKTREE" add planted-secret.txt

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "✗ gitleaks: not installed, so this control proved nothing"
  failures=$((failures + 1))
else
  check "gitleaks" gitleaks protect --staged --source "$WORKTREE" --redact --no-banner --exit-code 1
fi

# --- 3. the control that checks the controls ---------------------------------
#
# A clean tree must still pass. Without this, a scanner that refuses everything
# — a corrupt deny-list compiling to a pattern that matches any line, say —
# would look like two healthy gates.

git -C "$WORKTREE" rm --quiet --force planted-privacy.md planted-secret.txt
echo "a file with nothing interesting in it" > "$WORKTREE/harmless.txt"
git -C "$WORKTREE" add harmless.txt

if env -C "$WORKTREE" ./scripts/privacy-scan.sh --staged >/dev/null 2>&1; then
  echo "✓ clean tree: accepted, so the deny-list is discriminating rather than deaf"
else
  echo "✗ clean tree: the deny-list refused harmless content, so its matches mean nothing"
  failures=$((failures + 1))
fi

echo
if [[ "$failures" -gt 0 ]]; then
  echo "security-gates-selftest: FAILED — ${failures} control(s) did not behave as required."
  echo
  echo "This does not mean a secret leaked. It means one of the gates that would"
  echo "have caught one is no longer doing its job, which is worse: the build is"
  echo "green either way. Fix the gate, never this script."
  exit 1
fi

echo "security-gates-selftest: both gates were watched fail, and a clean tree still passes."
