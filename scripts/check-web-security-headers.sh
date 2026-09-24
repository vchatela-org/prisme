#!/usr/bin/env bash
#
#   ./scripts/check-web-security-headers.sh <base-url>
#
# **Does the web tier still send its policy?** One request, every header read
# back from the response.
#
# This exists because of a failure this repository has already had once. W14
# shipped `middleware.ts` at the path the brief named, `next build` stayed
# green, and the middleware manifest was empty — so **every security header was
# absent** and nothing said so. A policy that is not sent is worse than no
# policy: the build passes either way, and a browser with no `style-src` is a
# browser that will happily run an injected `<style>`.
#
# The headers below are not decoration and each one is asserted rather than
# counted: a check that only looks for "some CSP" passes on a policy that has
# been widened to `unsafe-inline`, which is the change this repository is least
# willing to make by accident.
#
# The request is a plain navigation with no session, so the answer is the
# login redirect (303) — and a redirect is still a document a browser renders,
# which is exactly why the middleware puts the headers on it too. The path is
# `/`, which the matcher covers; `/healthz` is deliberately excluded from it and
# would prove nothing.
#
# Run against the built container in CI (`images`) and against a local
# `next start` while working on the file.

set -euo pipefail

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
  echo "usage: $0 <base-url>   e.g. $0 http://127.0.0.1:3001" >&2
  exit 2
fi

HEADERS=$(mktemp)
trap 'rm -f "$HEADERS"' EXIT

STATUS=$(curl -sS -D "$HEADERS" -o /dev/null -w '%{http_code}' \
  -H 'Accept: text/html' "$BASE_URL/")

echo "GET $BASE_URL/ -> $STATUS"

fail=0

# header_value <name> — the value of a header, case-insensitively, without the
# trailing CR. Written out rather than grepped so a header present with an empty
# value is not mistaken for a header that is there.
header_value() {
  awk -v want="$(echo "$1" | tr 'A-Z' 'a-z')" '
    BEGIN { FS = ": " }
    { name = tolower($1) }
    name == want { sub(/\r$/, "", $0); sub(/^[^:]*: /, "", $0); print; found = 1 }
    END { exit found ? 0 : 1 }
  ' "$HEADERS"
}

require() {
  local name="$1"
  local expected="$2"
  local value
  if ! value=$(header_value "$name"); then
    echo "FAIL: $name is missing from the response" >&2
    fail=1
    return
  fi
  if [ -n "$expected" ] && [ "$value" != "$expected" ]; then
    echo "FAIL: $name is '$value', expected '$expected'" >&2
    fail=1
    return
  fi
  echo "  ok  $name: $value"
}

require 'content-security-policy' ''
require 'strict-transport-security' 'max-age=63072000; includeSubDomains; preload'
require 'x-content-type-options' 'nosniff'
require 'x-frame-options' 'DENY'
require 'referrer-policy' 'no-referrer'
require 'cross-origin-opener-policy' 'same-origin'
require 'cross-origin-resource-policy' 'same-origin'
require 'permissions-policy' ''

# The policy's *shape*, not just its presence. Each of these is a directive the
# threat model depends on, and each has a specific way of being quietly
# weakened — `unsafe-inline` for the first two, `*` for the third.
CSP=$(header_value 'content-security-policy' || true)
case "$CSP" in
  *"default-src 'self'"*) echo "  ok  csp default-src 'self'" ;;
  *) echo "FAIL: the CSP has no default-src 'self'" >&2; fail=1 ;;
esac
case "$CSP" in
  *"style-src 'self' 'nonce-"*) echo "  ok  csp style-src is nonce-based" ;;
  *) echo "FAIL: the CSP's style-src is not 'self' + a nonce" >&2; fail=1 ;;
esac
case "$CSP" in
  *"script-src 'self' 'nonce-"*) echo "  ok  csp script-src is nonce-based" ;;
  *) echo "FAIL: the CSP's script-src is not 'self' + a nonce" >&2; fail=1 ;;
esac
case "$CSP" in
  *unsafe-inline* | *unsafe-hashes* | *unsafe-eval*)
    echo "FAIL: the CSP has been widened with an unsafe keyword:" >&2
    echo "      $CSP" >&2
    fail=1
    ;;
  *) echo "  ok  csp carries no unsafe keyword" ;;
esac
case "$CSP" in
  *"frame-ancestors 'none'"*) echo "  ok  csp frame-ancestors 'none'" ;;
  *) echo "FAIL: the CSP has no frame-ancestors 'none'" >&2; fail=1 ;;
esac
case "$CSP" in
  *"object-src 'none'"*) echo "  ok  csp object-src 'none'" ;;
  *) echo "FAIL: the CSP has no object-src 'none'" >&2; fail=1 ;;
esac

# The status, checked **after** the headers: when the middleware is not loaded
# the response is whatever the route renders — a `200` with no policy on it, or
# a `500` — and the diagnostic a reader needs is "every header is missing",
# which is what the lines above have already printed.
#
# A navigation without a session is *redirected*, not refused — that is the
# gate's design (`apps/web/src/lib/auth-gate.ts`) and it is also the cheapest
# way to reach the middleware from outside.
if [ "$STATUS" != "303" ]; then
  echo "FAIL: expected 303 to the login flow, got $STATUS" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "--- the response, as received ---" >&2
  sed -n '1,20p' "$HEADERS" >&2
  echo "FAIL: the web tier is not sending the policy it is supposed to send." >&2
  echo "      The middleware is loaded from beside the app root —" >&2
  echo "      apps/web/src/proxy.ts — and a rename the framework does not load" >&2
  echo "      leaves every header absent while the build stays green (W14)." >&2
  exit 1
fi

echo "PASS: every security header is present, and the policy is unwidened"
