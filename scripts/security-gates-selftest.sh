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

# The UUID plant is withdrawn before the next one is staged, and the reason is a
# mistake this script made the first time it grew a second plant: the check scans
# **every staged file**, so a second plant left beside the first is refused by the
# first plant's pattern, and the second check passes without its own pattern
# mattering at all. It looked like a control and was a re-run of the one above.
git -C "$WORKTREE" rm --quiet --force planted-privacy.md

# A second plant, for the camelCase id shape, which is a *separate* pattern — and
# the one whose failure mode is the quiet one. It requires the value to be
# quoted, so the cheapest way for it to be wrong is to be too narrow and match
# nothing, which is a green scan over the exact content it exists to refuse.
#
# The id is generated rather than written out so that the plant does not itself
# become a deny-list hit in this file: the scanner reads `projectId: "` followed
# by a literal `${…}`, which is not sixteen alphanumerics.
planted_task_id="$(
  python3 -c 'import secrets, string; a = string.ascii_letters + string.digits; print("".join(secrets.choice(a) for _ in range(16)))'
)"

{
  echo "# planted by security-gates-selftest.sh — never committed"
  echo "projectId: \"${planted_task_id}\""
} > "$WORKTREE/planted-camelcase.md"

git -C "$WORKTREE" add planted-camelcase.md

check "privacy deny-list (camelCase id)" env -C "$WORKTREE" ./scripts/privacy-scan.sh --staged

# --- 2. gitleaks ---------------------------------------------------------------
#
# A private-key block, and the choice of rule is the whole lesson of this
# section.
#
# The first version planted a high-entropy value under an
# `aws_secret_access_key =` assignment, aiming at gitleaks' `generic-api-key`
# rule. It passed locally and failed in CI — because that rule is *probabilistic*:
# it scores Shannon entropy and drops candidates containing stopwords, so whether
# it fires depends on which random string came out of the generator that run. A
# negative control that is right most of the time is not a control, it is noise
# that will eventually be muted.
#
# `private-key` matches a fixed header with no entropy threshold, so it fires
# every time or never — which is exactly the property a control needs.
#
# The header is assembled from a variable rather than written out, because a
# script containing the literal would be caught by the very scan it is testing
# on every `gitleaks detect` over this repository. That is not a workaround; it
# is the gate demonstrating that it works, in passing.

marker='PRIVATE KEY'
planted_key_body="$(
  python3 -c 'import base64, secrets; print(base64.b64encode(secrets.token_bytes(96)).decode())'
)"

{
  echo "# planted by security-gates-selftest.sh — never committed"
  echo "-----BEGIN RSA ${marker}-----"
  echo "${planted_key_body}"
  echo "-----END RSA ${marker}-----"
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

# `--ignore-unmatch`, because the UUID plant was already withdrawn above and a
# cleanup that fails on a file that is not there takes the whole script down with
# it — `set -e` — *after* the checks ran but *before* the summary that says how
# they went. That is how a control reports nothing while looking like it ran.
git -C "$WORKTREE" rm --quiet --force --ignore-unmatch planted-privacy.md planted-camelcase.md planted-secret.txt
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
