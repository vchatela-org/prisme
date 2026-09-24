#!/bin/bash
# Stop the local harness. Leaves PostgreSQL alone — it is a daemon you started
# with `pnpm dev:db` and it outlives this stack on purpose.
set -uo pipefail

pkill -f 'harness/idp.mjs' 2>/dev/null || true
pkill -f 'apps/api/dist/main.js' 2>/dev/null || true
pkill -f 'next-server' 2>/dev/null || true
pkill -f 'next start' 2>/dev/null || true
sleep 1
echo 'stopped (postgres left running; `pnpm dev:db:down` removes it and its data)'
