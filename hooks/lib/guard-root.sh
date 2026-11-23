#!/usr/bin/env bash
# Sourced by every PreToolUse guard shim: which tree a guard's TypeScript runs FROM.
#
# A guard is fleet policy, so it runs from the INSTALLED plugin — the one `installed_plugins.json` names right
# now — and never from whichever checkout the session happened to boot out of. `resolve_plugin_root` answers
# the latter: a dogfood session boots `claude --plugin-dir <its own worktree>` (src/cmux/pluginDir.ts), so it
# obeyed the guards its own branch carried and never a gate that merged after that branch was cut. MEASURED:
# 148 Python calls RAN after the Python gate landed, every one of them from a session
# whose base predated it, and none through the hatch. Read per call, so a running session gets a new guard
# the moment the install updates.
#
# The install is a plain copy with no node_modules, and a guard run from it without deps dies on its first
# package import with exit 1 — which Claude Code treats as a non-blocking error, so a fail-CLOSED guard failed
# OPEN. MEASURED: the admit shim with CLAUDE_PLUGIN_ROOT at the cache install exited 1 on
# `Cannot find package 'zod'`. So this links a data dir's deps into the install, exactly as `bin/slopweaver`
# does for a cache install, and only when that dir's package.json AND yarn.lock match the install's.
#
# Falls back to the given root when there is no install record, the install lacks this guard's entry (a
# guard new on the session's own branch), or no matching deps exist — but ONLY when that fallback carries
# the entry, which is the check this file spent a fleet without. The trade, accepted with this route: a
# branch that changes a guard is covered by its tests, not tried live by its own session before it merges.
#
# WHY THE FALLBACK IS ENTRY-CHECKED. The fallback is `resolve_plugin_root`'s answer — the seat's own
# `$PLUGIN_ROOT`, a directory this file tested for EXISTENCE and never for CONTENT. A seat booted before
# `hooks/pretooluse-*.ts` were folded into `hooks/pretooluse.ts` has a root that exists and does not carry
# the entry, so every one of the four fallback returns below handed `tsx` a file that is not there. MEASURED:
# nine of ten live seats printed
# `node:internal/modules/esm/resolve:272 … ERR_MODULE_NOT_FOUND` on EVERY Bash call and exited 1 — which
# Claude Code does not treat as a block, so the main-checkout, admit, browser-door, poll-gate and depth
# guards were all off for the rest of those seats' lives. Worse than the noise: `scripts/pretooluse.sh`'s
# `give_up` exits 2 for a browser payload so the door fails CLOSED, and tsx dying first meant that ending
# was never reached, inverting it to an allow. Repro, from any checkout that carries the folded entry:
#
#   CLAUDE_CONFIG_DIR=$(mktemp -d) PLUGIN_DATA=~/.claude/plugins/data/slopweaver-inline \
#   PLUGIN_ROOT=<a worktree with no hooks/pretooluse.ts> CLAUDE_PLUGIN_ROOT=$PLUGIN_ROOT \
#     bash -c 'echo "{\"session_id\":\"t\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"python3 -c 1\"}}" \
#       | $PLUGIN_DATA/mirror/current/scripts/pretooluse-admit.sh'
#
# Answering EMPTY rather than a root that cannot run is what lets the caller choose its own ending —
# `scripts/pretooluse.sh` takes the shim's own mirrored tree next, and gives up on its own terms after
# that. A root returned unchecked gave it nothing to branch on.

# @param $1 a node_modules path, resolved through any symlink
# @returns the directory that OWNS that tree — where its package.json and yarn.lock sit — or empty
deps_owner_dir() {
  local tree="$1" physical
  [ -x "$tree/.bin/tsx" ] || return 0
  # `cd "$tree/.."` would resolve `..` against the LINK's own directory, naming the install itself rather
  # than the tree it points at. Resolve the link first, then take the parent of the physical path.
  physical="$( (cd "$tree" 2>/dev/null && pwd -P) || true)"
  [ -n "$physical" ] || return 0
  printf '%s\n' "${physical%/*}"
}

# @param $1 the install root, whose manifests are the contract
# @param $2 the directory owning a dependency tree
# @returns 0 when that tree's manifests are byte-identical to the install's, non-zero otherwise
deps_match_install() {
  local install="$1"
  local owner="$2"
  [ -n "$owner" ] || return 1
  [ -x "$owner/node_modules/.bin/tsx" ] || return 1
  diff -q "$install/package.json" "$owner/package.json" >/dev/null 2>&1 || return 1
  diff -q "$install/yarn.lock" "$owner/yarn.lock" >/dev/null 2>&1 || return 1
  return 0
}

# The fallback root, but only when it can actually serve — the one ending this file used to take on trust.
#
# @param $1 the fallback root, normally `resolve_plugin_root`'s answer
# @param $2 the guard's entry point relative to a plugin root
# @returns that root on stdout when it carries the entry, and nothing at all when it does not
fallback_guard_root() {
  [ -f "$1/$2" ] || return 0
  printf '%s\n' "$1"
}

# @param $1 the fallback root, normally `resolve_plugin_root`'s answer
# @param $2 the guard's entry point relative to a plugin root, e.g. hooks/pretooluse.ts
# @returns the root to run the guard from, on stdout, or NOTHING when no root here carries the entry
resolve_guard_root() {
  local fallback="$1"
  local entry="$2"
  local config="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}"
  local record="$config/plugins/installed_plugins.json"
  if [ ! -f "$record" ]; then
    fallback_guard_root "$fallback" "$entry"
    return 0
  fi

  # The record is Claude Code's own pretty-printed JSON: the plugin key, then its first installPath.
  local key_line path_line marketplace install
  key_line="$(grep -m1 -E '"slopweaver@[^"]+"[[:space:]]*:' "$record" 2>/dev/null || true)"
  path_line="$(awk '/"slopweaver@[^"]+"[[:space:]]*:/ { found = 1 } found && /"installPath"[[:space:]]*:/ { print; exit }' "$record" 2>/dev/null || true)"
  marketplace="$(printf '%s' "$key_line" | sed -n 's/.*"slopweaver@\([^"]*\)".*/\1/p')"
  install="$(printf '%s' "$path_line" | sed -n 's/.*"installPath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ -z "$install" ] || [ ! -f "$install/$entry" ]; then
    fallback_guard_root "$fallback" "$entry"
    return 0
  fi

  # Whatever tree the install's node_modules RESOLVES to is checked on every call, never only when this
  # linked it. Deps already sitting there (an older `bin/slopweaver` linked some, say) can describe a
  # different dependency tree by now, and a guard that reaches a missing package exits 1 — which Claude Code
  # does not treat as a block, so trusting an unverified tree turns a fail-CLOSED guard into an allow. The
  # tree is judged by the manifests BESIDE it, the same pair `bin/slopweaver` compares.
  local candidate
  candidate="$(deps_owner_dir "$install/node_modules")"
  if ! deps_match_install "$install" "$candidate"; then
    local data deps
    candidate=""
    for data in "$config/plugins/data/slopweaver-$marketplace" "${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-}}"; do
      deps="$data/cli-deps"
      if [ -n "$data" ] && deps_match_install "$install" "$deps"; then
        candidate="$deps"
        break
      fi
    done
    if [ -z "$candidate" ]; then
      fallback_guard_root "$fallback" "$entry"
      return 0
    fi
    # Only ever replace a LINK: a real directory there is somebody's tree, not ours to remove.
    if [ -L "$install/node_modules" ]; then
      rm -f "$install/node_modules" 2>/dev/null || true
    fi
    ln -s "$candidate/node_modules" "$install/node_modules" 2>/dev/null || true
  fi
  if [ ! -x "$install/node_modules/.bin/tsx" ]; then
    fallback_guard_root "$fallback" "$entry"
    return 0
  fi
  printf '%s\n' "$install"
}
