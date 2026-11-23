#!/usr/bin/env bash
# Public hygiene gate: scan every git-tracked file for generic leak classes (see src/hygiene/scan.ts).
# Prints every hit; exits non-zero on a refused one (see isRefusedHit) or a file it could not read. Wired into
# CI and the `hygiene` package script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TSX="$ROOT/node_modules/.bin/tsx"
if [ ! -x "$TSX" ]; then
  echo "check-hygiene: tsx not found — run install first" >&2
  exit 1
fi
exec "$TSX" "$ROOT/src/hygiene/scan.entry.ts"
