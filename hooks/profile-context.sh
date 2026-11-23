#!/usr/bin/env bash
# The SessionStart entry point for the always-loaded context — startup, resume, clear AND compact, since Claude Code
# re-runs SessionStart with `source: "compact"` after a compaction and reads no context from PostCompact at all
# (`reachesContext` in `src/context/loadLedger.ts`; 0 PostCompact hook records across 1581 transcripts).
#
# What is known about the owner is GLOBAL rather than per Claude project, and loading it is enforced
# mechanically rather than left to memory. The plugin loads into every project, so this hook
# runs in acme-admin exactly as it runs here, and a session receives the owner's own context without anybody
# having remembered to fetch it.
#
# THE HOOK EXITS 0, ALWAYS; THE SESSION IS HELD INSTEAD. A session start that a profile read can break is a session
# start somebody turns off, so every path here exits 0 — and what stops a session acting without the owner's profile is the
# delivery marker, not this exit code (a session does nothing rather than act misaligned for the owner).
# The marker is CLEARED FIRST, before the root is resolved or node starts, and only the verb writes it back, after it
# printed the owner's profile. MEASURED: all seven sessions `profile-unloaded` named were this hook killed by
# `scripts/hook.sh` at 7s while node booted under load; with the marker cleared first, such a kill leaves the session
# held by the PreToolUse and UserPromptSubmit checks until its own next action reloads the profile
# (`src/context/profileDelivery.ts`).
#
# IT DOES NOT INHERIT THE HANDOVER HOOK'S FAST PATH, deliberately. `handover-run.sh` exits in shell when
# there is no runs directory, because a machine that has never started a run has nothing to report. That
# reasoning does not carry here: a session in a repository that has never run a handover still needs the owner's
# profile, and an early exit on an unrelated directory would make the common case the silent one.
set -u

# A parameter expansion rather than `$(cd … && pwd)`: no fork ahead of the clear.
case "${BASH_SOURCE[0]}" in
  */*) SELF_DIR="${BASH_SOURCE[0]%/*}" ;;
  *) SELF_DIR="." ;;
esac
# shellcheck source=lib/profile-delivered.sh
source "$SELF_DIR/lib/profile-delivered.sh"

PAYLOAD=""
IFS= read -r -d '' PAYLOAD || true
profile_delivery_clear "$PAYLOAD"

# shellcheck source=lib/resolve-root.sh
source "$SELF_DIR/lib/resolve-root.sh"

PLUGIN_DIR="$(resolve_plugin_root "$(cd "$SELF_DIR/.." && pwd)")"
BIN="$PLUGIN_DIR/bin/slopweaver"
[ -x "$BIN" ] || exit 0
printf '%s' "$PAYLOAD" | "$BIN" profile hook 2>/dev/null || true
exit 0
