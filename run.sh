#!/usr/bin/env bash
# One-command launcher for Article B-roll Generator (macOS / Linux).
# Installs dependencies on first run, then starts the app.
set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (LTS), then re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run)…"
  npm install
fi

# Running as root on Linux requires Electron's sandbox to be disabled.
EXTRA=""
if [ "$(id -u)" = "0" ] && [ "$(uname)" = "Linux" ]; then
  EXTRA="-- --no-sandbox"
fi

echo "Launching Article B-roll Generator…"
# shellcheck disable=SC2086
npm start $EXTRA
