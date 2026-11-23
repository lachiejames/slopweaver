#!/usr/bin/env bash
# The run-hook entry point for SessionStart, PostCompact and Stop.
#
# FAILS OPEN, always. Every path exits 0: for a Stop hook a non-zero exit is itself a way to block, so a
# missing checkout, a broken install or a crash must never be able to refuse. The verb it calls also always
# exits 0 and expresses a refusal in its JSON instead — the exit code carries exactly one meaning here.
#
# INERT BY DEFAULT MEANS FREE BY DEFAULT. `Stop` fires on every stop, clear, resume and compact, and starting
# the CLI costs ~2.5s measured — a quarter of this hook's own deadline, spent to discover there is nothing to
# say. So the common case is answered here in shell: no runs directory, or no journal inside it, and this exits
# without launching Node at all. That is also what keeps the deadline comfortable when there IS work to do.
set -u

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/resolve-root.sh
source "$SELF_DIR/lib/resolve-root.sh"

HOME_DIR="${SLOPWEAVER_HOME:-$HOME/.slopweaver}"
RUNS_DIR="$HOME_DIR/runs"

# No run has ever been started on this machine, so there is nothing this hook could report.
[ -d "$RUNS_DIR" ] || exit 0

# The directory exists but holds no journal. `compgen -G` is a glob test that spawns nothing and does not
# depend on `nullglob` being set.
compgen -G "$RUNS_DIR"/*.jsonl >/dev/null 2>&1 || exit 0

PLUGIN_DIR="$(resolve_plugin_root "$(cd "$SELF_DIR/.." && pwd)")"
BIN="$PLUGIN_DIR/bin/slopweaver"
[ -x "$BIN" ] || exit 0
"$BIN" handover hook 2>/dev/null || true
exit 0
