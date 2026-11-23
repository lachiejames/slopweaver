#!/usr/bin/env bash
# Shared by every hook shim that needs "the plugin root", existence-checked rather than merely defined.
#
# Codex snapshots a hook's PLUGIN_ROOT/CLAUDE_PLUGIN_ROOT once at session start. If the plugin's versioned
# cache dir is later replaced and the old version pruned, an already-open session keeps injecting that SAME
# stale value into every subsequent hook invocation for the rest of its life — the variable is technically
# still "set", so a plain `${PLUGIN_ROOT:-fallback}` substitution never reaches `fallback`, even though the
# directory it names is gone. Testing existence, not just definedness, is what makes the fallback reachable.

# @param $1 the self-relative fallback (usually "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)")
# @returns the resolved root on stdout: PLUGIN_ROOT or CLAUDE_PLUGIN_ROOT if either still names a real
#   directory, else the fallback
resolve_plugin_root() {
  local fallback="$1"
  local candidate
  for candidate in "${PLUGIN_ROOT:-}" "${CLAUDE_PLUGIN_ROOT:-}"; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  printf '%s\n' "$fallback"
}
