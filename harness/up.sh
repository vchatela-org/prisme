#!/bin/bash
# Bring up the whole local stack, seeded: the fake provider, the API, the web tier.
#
#   ./harness/up.sh            # build first if the artefacts are missing
#   ./harness/up.sh --no-seed  # keep whatever is in the database
#
# Leave it running and use the screens, or run `node harness/drive.mjs` against
# it to check the login flow end to end. Tear it down with ./harness/down.sh.
#
# ## The stale-port trap, which is why the first four lines exist
#
# A harness from an earlier session still holds 9099, so the new provider dies of
# `EADDRINUSE` while every request is answered by the old one — and the old one
# has a different keypair, so every token it signed is refused. That presents as
# "my change broke login": the login route 404s or the callback answers 401, and
# the fix is to kill something that is not in any of the logs you are reading.
# Killing first is not tidiness, it is the difference between a real failure and
# a phantom one.
#
# ## Why the database is not started here
#
# `docker compose up -d postgres` is a separate command (`pnpm dev:db`) because
# it is a daemon that outlives this script. This script assumes it is already up
# and fails with that command named if it is not.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

seed=yes
for arg in "$@"; do
  case "$arg" in
    --no-seed) seed=no ;;
    *) echo "usage: harness/up.sh [--no-seed]" >&2; exit 2 ;;
  esac
done

logs=harness/logs
mkdir -p "$logs"

echo 'stopping anything left over from an earlier session'
pkill -f 'harness/idp.mjs' 2>/dev/null || true
pkill -f 'apps/api/dist/main.js' 2>/dev/null || true
pkill -f 'next-server' 2>/dev/null || true
pkill -f 'next start' 2>/dev/null || true
sleep 2

if ! docker compose ps --status running 2>/dev/null | grep -q postgres; then
  echo 'postgres is not running. Start it with: pnpm dev:db' >&2
  exit 1
fi

if [ ! -f apps/api/dist/main.js ] || [ ! -d apps/web/.next ]; then
  echo 'building first — this takes a few minutes on a small machine'
  pnpm build
fi

# shellcheck disable=SC1091
set -a; . harness/env.sh; set +a

echo 'starting the fake provider'
setsid nohup node harness/idp.mjs > "$logs/idp.log" 2>&1 < /dev/null &
sleep 2

if [ "$seed" = yes ]; then
  echo 'seeding the fixture set'
  node harness/seed.mjs
fi

echo 'starting the API'
PORT=3200 setsid nohup node apps/api/dist/main.js > "$logs/api.log" 2>&1 < /dev/null &
(cd apps/web && PORT=3001 setsid nohup npx next start -p 3001 > "../../$logs/web.log" 2>&1 < /dev/null &)
sleep 10

echo
echo 'listening:'
ss -ltn | grep -E ':3001|:3200|:9099' || echo '  (none of the three ports are bound — read the logs below)'
echo
curl -s -o /dev/null -w '  provider  /jwks      %{http_code}\n' http://127.0.0.1:9099/jwks
curl -s -o /dev/null -w '  API       /readyz    %{http_code}\n' http://127.0.0.1:3200/readyz
curl -s -o /dev/null -w '  web       /healthz   %{http_code}\n' http://127.0.0.1:3001/healthz
# 303 to /auth/login is the *correct* answer here: it says the gate is on and
# the stack is wired. 200 would mean a session was already held, and 500 means
# the configuration never loaded.
#
# The `accept` header is required, and it is not decoration. A request without a
# browser's `text/html` is an XHR as far as the gate is concerned, and an XHR
# with no credential is answered **401** — deliberately, because a redirect to a
# login page is not a useful answer to `fetch`. Without this header the check
# reports 401 and reads like a broken stack.
curl -s -o /dev/null -w '  web       / (303?)   %{http_code}\n' \
  -H 'accept: text/html,application/xhtml+xml' http://127.0.0.1:3001/
echo
echo "logs: $logs/{idp,api,web}.log"
echo 'drive the login flow with: node harness/drive.mjs'
