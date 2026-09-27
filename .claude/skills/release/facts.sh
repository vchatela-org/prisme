#!/usr/bin/env bash
#
# The facts a release is decided from: what a ref gained since the version before it, and which
# version field that moves. Read-only — it tags nothing and publishes nothing.
#
#   facts.sh             origin/main against the newest version tag
#   facts.sh v0.7.0      an existing tag against the version before it (a Release written late)
#
# The range is git's when the older tag is an ancestor of the newer ref. When it is not — a tag cut
# before a history rewrite points into history `main` no longer contains — git's range would list
# the whole rewritten line, so the pull requests are selected by merge time instead, and the output
# says which method it used.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

target="${1:-origin/main}"
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
to_sha="$(git rev-parse "$target^{commit}")"

# The version before `target`, by version order rather than reachability: a deleted version leaves
# no tag, and the one before it is the right base.
if git show-ref --quiet --verify "refs/tags/$target"; then
  mode=existing
  from="$(git tag --list 'v[0-9]*' --sort=-version:refname | awk -v t="$target" 'f { print; exit } $0 == t { f = 1 }')"
else
  mode=next
  from="$(git tag --list 'v[0-9]*' --sort=-version:refname | head -1)"
fi
[[ -n "$from" ]] || { echo "facts: no version tag before $target" >&2; exit 2; }
from_sha="$(git rev-parse "$from^{commit}")"

# ── Pull requests: number <TAB> head branch <TAB> title ──────────────────────────────────────────
if git merge-base --is-ancestor "$from_sha" "$to_sha"; then
  method="git range $from..$(git rev-parse --short "$to_sha")"
  # A merge commit's subject names the PR and its branch, and its body is the PR's title. A squash
  # merge's subject is the title with ` (#N)` appended, and names no branch.
  prs="$(git log --first-parent --reverse --pretty='%s%x1f%b%x1e' "$from_sha..$to_sha" |
    awk 'BEGIN { RS = "\x1e"; FS = "\x1f" }
         { sub(/^\n+/, "", $1) }
         match($1, /^Merge pull request #[0-9]+ from [^ \n]+/) {
           split(substr($1, RSTART, RLENGTH), w, " ")
           n = substr(w[4], 2); b = w[6]; sub(/^[^\/]+\//, "", b)
           t = $2; sub(/^[\n ]+/, "", t); sub(/\n.*/, "", t)
           printf "%s\t%s\t%s\n", n, b, t; next
         }
         match($1, / \(#[0-9]+\)$/) {
           n = substr($1, RSTART + 3, RLENGTH - 4); t = substr($1, 1, RSTART - 1)
           printf "%s\t-\t%s\n", n, t
         }')"
  subjects="$(git log --no-merges --pretty=%s "$from_sha..$to_sha")"
  bodies="$(git log --no-merges --pretty=%b "$from_sha..$to_sha")"
else
  # GitHub's mergedAt runs a second or so behind the merge commit's own date, so the window is
  # widened at both ends, and a pull request whose merge commit the older tag already contains —
  # the one it was cut on — is dropped by ancestry rather than by the clock.
  from_at="$(date -u -d "$(git log -1 --format=%cI "$from_sha")" +%Y-%m-%dT%H:%M:%SZ)"
  to_at="$(date -u -d "$(git log -1 --format=%cI "$to_sha") + 5 seconds" +%Y-%m-%dT%H:%M:%SZ)"
  method="merge time $from_at..$to_at ($from is not an ancestor of $target: a rewrite lies between)"
  prs="$(gh pr list --repo "$repo" --state merged --base main --limit 300 \
    --search "merged:$from_at..$to_at" --json number,headRefName,title,mergeCommit \
    --jq 'sort_by(.number)[] | "\(.mergeCommit.oid)\t\(.number)\t\(.headRefName)\t\(.title)"' |
    while IFS=$'\t' read -r oid rest; do
      git merge-base --is-ancestor "$oid" "$from_sha" 2>/dev/null || printf '%s\n' "$rest"
    done)"
  subjects="$(cut -f3 <<<"$prs")"
  bodies=""
fi

# ── What the trees say, independent of how history got there ─────────────────────────────────────
added() { git diff --diff-filter=A --name-only "$from_sha" "$to_sha" -- "$@"; }
adrs="$(added 'docs/20-decisions/[0-9][0-9][0-9][0-9]-*.md')"
migrations="$(added 'packages/db/migrations/*.sql')"
variables="$(git diff "$from_sha" "$to_sha" -- packages/config/src/schema.ts |
  sed -nE 's/^([+-])  ([A-Z][A-Z0-9_]+): \{.*/\1 \2/p' |
  awk '{ s[$2] = s[$2] $1 } END { for (v in s) print (s[v] == "+" ? "added   " : s[v] == "-" ? "removed " : "changed ") v }' | sort)"
# What an image is built from. Documentation, the journal, skills, the harness and CI other than
# the publishing workflow change nothing that runs.
releasable="$(git diff --name-only "$from_sha" "$to_sha" -- apps packages package.json \
  pnpm-lock.yaml pnpm-workspace.yaml 'tsconfig*.json' .github/workflows/publish.yml | wc -l)"

feat="$(grep -cE '^feat(\([^)]*\))?!?:' <<<"$subjects" || true)"
fix="$(grep -cE '^fix(\([^)]*\))?!?:' <<<"$subjects" || true)"
breaking="$( (grep -E '^[a-z]+(\([^)]*\))?!:' <<<"$subjects"; grep -E '^BREAKING[ -]CHANGE' <<<"$bodies") | grep -c . || true)"
deps="$(cut -f2 <<<"$prs" | grep -c '^dependabot/' || true)"

# ── The field ────────────────────────────────────────────────────────────────────────────────────
reasons=()
[[ -n "$adrs" ]]       && reasons+=("$(grep -c . <<<"$adrs") new ADR(s)")
(( feat > 0 ))         && reasons+=("$feat feat commit(s)")
[[ -n "$migrations" ]] && reasons+=("$(grep -c . <<<"$migrations") new migration(s) — a rollback across a schema change is not a drop-in")
(( breaking > 0 ))     && reasons+=("$breaking breaking change(s) — a minor while the major is 0, and said first in the notes")

IFS=. read -r major minor patch <<<"${from#v}"
if (( ${#reasons[@]} > 0 )); then
  field=minor; next="v$major.$((minor + 1)).0"
elif (( releasable > 0 )); then
  field=patch; next="v$major.$minor.$((patch + 1))"; reasons=("$releasable releasable file(s) changed, no minor signal")
else
  field=none; next="—"; reasons=("nothing an image is built from changed")
fi

# ── Report ───────────────────────────────────────────────────────────────────────────────────────
echo "range      $method"
echo "from       $from ($(git rev-parse --short "$from_sha"))"
echo "to         $target ($(git rev-parse --short "$to_sha"))"
if [[ $mode == next ]]; then
  echo "field      $field → $next"
  echo "why        $(IFS=';'; echo "${reasons[*]}" | sed 's/;/; /g')"
  if [[ $next != "—" ]]; then
    exists="$( (git tag -l "$next"; git ls-remote --tags origin "refs/tags/$next") | grep -c . || true)"
    echo "free       $([[ $exists == 0 ]] && echo "yes, $next exists nowhere" || echo "NO — $next already exists; a version is never reused")"
  fi
  checks="$(gh api "repos/$repo/commits/$to_sha/check-runs" --paginate \
    --jq '.check_runs[] | "\(.status)/\(.conclusion // "-")"' | sort | uniq -c | tr -s ' ' | paste -sd, -)"
  echo "checks     ${checks:-none reported} (on the commit a tag would point at)"
else
  echo "field      the tag exists; its field was decided when it was cut ($field by today's rule)"
fi
echo
echo "pull requests (number, branch, title)"
if [[ -n "$prs" ]]; then sed 's/^/  #/' <<<"$prs"; else echo "  none"; fi
echo
echo "commits    feat $feat · fix $fix · breaking $breaking · dependency merges $deps"
echo
echo "ADRs added"
if [[ -n "$adrs" ]]; then
  while read -r f; do echo "  $f — $(git show "$to_sha:$f" | sed -n 's/^# //p' | head -1)"; done <<<"$adrs"
else echo "  none"; fi
echo "migrations added"
if [[ -n "$migrations" ]]; then sed 's/^/  /' <<<"$migrations"; else echo "  none"; fi
echo "configuration variables"
if [[ -n "$variables" ]]; then sed 's/^/  /' <<<"$variables"; else echo "  none"; fi
