#!/usr/bin/env bash
# SessionStart hook — install the CLI's RUNTIME Node dependencies (`dependencies`, never `devDependencies`)
# into the persistent plugin-data dir. Agent hosts do not install them for a plugin and we don't ship
# node_modules, so this is how deps arrive. It's a fast no-op once installed (guarded on package.json and
# yarn.lock both being unchanged).
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/resolve-root.sh
source "$SELF_DIR/../hooks/lib/resolve-root.sh"

ROOT="$(resolve_plugin_root "$(cd "$SELF_DIR/.." && pwd)")"
DATA="${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/slopweaver}}/cli-deps"

# Already installed and BOTH package.json and yarn.lock unchanged → nothing to do.
#
# The lockfile is in the comparison because leaving it out was a real, silent staleness hole: every direct
# dependency here is exact-pinned, so a transitive resolution bump changes yarn.lock and NOT package.json —
# and the mirror then kept serving an older tree that no lockfile on disk described. That is the same shape
# as a past main-checkout failure (a hoisted transitive at a version the lockfile had moved off,
# throwing before the network while CI stayed green), just in the second dependency tree.
if [ -x "$DATA/node_modules/.bin/tsx" ] \
  && diff -q "$ROOT/package.json" "$DATA/package.json" >/dev/null 2>&1 \
  && diff -q "$ROOT/yarn.lock" "$DATA/yarn.lock" >/dev/null 2>&1; then
  exit 0
fi

mkdir -p "$DATA"
cp "$ROOT/package.json" "$DATA/package.json"
cp "$ROOT/yarn.lock" "$DATA/yarn.lock" 2>/dev/null || true
cp "$ROOT/.yarnrc.yml" "$DATA/.yarnrc.yml" 2>/dev/null || true
rm -rf "$DATA/stubs"; cp -R "$ROOT/stubs" "$DATA/stubs" 2>/dev/null || true  # sharp-stub resolution target

# RUNTIME DEPENDENCIES ONLY. A plugin user runs the CLI and never lints, tests or type-checks it, so the
# devDependency tree (vitest, promptfoo, knip, oxlint, prettier…) is weight they download and never execute.
# `workspaces focus --production` installs `dependencies` alone and PRUNES anything a previous full install
# left behind, while leaving the copied yarn.lock byte-identical — which the match guard above and
# `deps_match` in bin/slopweaver both depend on. A package the CLI reaches at run time therefore belongs in
# `dependencies`, never `devDependencies`: tsx (the launcher execs it), typescript (imported from the CLI's
# own source), drizzle-kit (`store push` spawns it) and supabase (`yarn store:start` runs it) all are.
# MEASURED, the same manifests into an empty dir with an empty yarn global folder each time:
#   yarn install                         122 s, 2.6 GB downloaded, 2.8 GB node_modules
#   yarn workspaces focus --production    67 s, 927 MB downloaded, 1.0 GB node_modules
# and the same command over an existing full tree pruned it to 1.0 GB, yarn.lock byte-identical. Repro, in a
# dir holding copies of package.json, yarn.lock, .yarnrc.yml and stubs/:
#   export YARN_GLOBAL_FOLDER=$(mktemp -d); yarn workspaces focus --production && du -sh node_modules "$YARN_GLOBAL_FOLDER/cache"
#
# A tree is reported ready only while BOTH copied manifests still match the plugin's own byte for byte. Yarn
# 4.18 leaves them untouched, but a focus that rewrote the lockfile would install a tree no lockfile here
# describes and then fail `deps_match` on every call, so it is refused here, loudly, at install time.
echo "[slopweaver] installing CLI runtime dependencies (one-time, ~a minute)…" >&2
if (cd "$DATA" && (corepack enable >/dev/null 2>&1 || true) && yarn workspaces focus --production >/dev/null 2>&1); then
  if diff -q "$ROOT/package.json" "$DATA/package.json" >/dev/null 2>&1 \
    && diff -q "$ROOT/yarn.lock" "$DATA/yarn.lock" >/dev/null 2>&1; then
    echo "[slopweaver] dependencies ready." >&2
    exit 0
  fi
  rm -f "$DATA/package.json" "$DATA/yarn.lock"  # clear both markers so the next session retries
  echo "[slopweaver] dependency install rewrote package.json or yarn.lock — the installed tree matches no manifest this plugin ships. Will retry next session." >&2
  exit 1
fi
rm -f "$DATA/package.json" "$DATA/yarn.lock"  # clear both markers so the next session retries
echo "[slopweaver] dependency install failed — will retry next session. Ensure Node + Corepack (or Yarn) are on PATH." >&2
exit 1
