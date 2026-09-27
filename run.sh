#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Server Hub — one-command launcher.
#
#   ./run.sh            start the panel at http://localhost:4321
#   ./run.sh --build    rebuild first
#
# No database server, no configuration, no accounts. Everything runs locally.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

PORT="${SERVERHUB_PORT:-4321}"
export PORT
export HOSTNAME=127.0.0.1
export NODE_ENV=production
export SERVERHUB_APPDATA="${SERVERHUB_APPDATA:-$PWD/data}"
export SERVERHUB_DB="${SERVERHUB_DB:-$PWD/data/serverhub.db}"

if [ ! -f build/server/server.js ] || [ "${1:-}" = "--build" ]; then
  echo "==> Building the production server bundle"
  npm run build >/dev/null
  node scripts/prepare-standalone.mjs
fi

mkdir -p "$PWD/data"
echo "==> Server Hub starting on http://localhost:${PORT}"
echo "==> Database: ${SERVERHUB_DB}"
echo
echo "    Press Ctrl+C to stop."
echo

node build/server/start.mjs
