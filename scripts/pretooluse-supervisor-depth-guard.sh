#!/usr/bin/env bash
# COMPATIBILITY SHIM — delegates to scripts/pretooluse-session-depth-warning.sh.
#
# The supervisor depth guard was replaced by the fleet-wide depth advisory (see
# docs/hooks/session-guards.md § The session depth advisory), and its shim was renamed with it. This file exists because a
# rename alone would have broken every session that was ALREADY OPEN:
#
#   scripts/plugin-mirror-sync.sh freezes a session's registered hook command at session start, then
#   replaces the mirrored `scripts` directory and flips `mirror/current` underneath it. A long-lived session
#   whose frozen path named the old shim would therefore invoke a pathname this change deleted, and exit 127
#   on EVERY Bash call for the rest of its life.
#
# So the old name keeps working and forwards. Delete it once no session predating the change is still
# running — the fleet cycles daily, so a week is comfortable.
# Both hops fail OPEN. The frozen root a stale session resolves may predate the advisory entirely, so the
# successor shim is only executed when it is actually there; anything else exits 0 and the tool call proceeds
# unadvised, which is the correct outcome for a hook that can only ever ADD context.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUCCESSOR="$SELF_DIR/pretooluse-session-depth-warning.sh"
if [ ! -x "$SUCCESSOR" ]; then
  exit 0
fi

"$SUCCESSOR" "$@" || exit 0
exit 0
