#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Server Hub — build a distributable desktop app.
#
#   ./scripts/build-desktop.sh           package for the current OS
#   ./scripts/build-desktop.sh --dev     build then launch Electron from source
#
# Produces installers in ./dist (NSIS .exe on Windows, .dmg on macOS,
# AppImage on Linux) plus a runnable .app/.exe in dist/mac-universal, etc.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/3  Building the Next.js production bundle"
npm run build

echo "==> 2/3  Assembling the standalone server"
node scripts/prepare-standalone.mjs

if [ "${1:-}" = "--dev" ]; then
  echo "==> 3/3  Launching the desktop shell from source"
  npx electron . --no-sandbox 2>/dev/null || npx electron .
  exit 0
fi

echo "==> 3/3  Packaging the desktop app (electron-builder)"
npx electron-builder --config electron-builder.yml

echo
echo "Done. Installers are in ./dist:"
ls -1 dist 2>/dev/null | sed 's/^/    /' || echo "    (nothing produced)"
echo
echo "Tip: run './scripts/build-desktop.sh --dev' to preview without packaging."
