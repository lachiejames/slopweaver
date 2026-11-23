#!/usr/bin/env bash
# Regression proof for the plugin-hook cache-survival fix (codex-claude-capability-parity.md, "Owner-directed
# scope addition" item 1). Loads a fake "version A" plugin root, mirrors it, prunes version A entirely
# (simulating a cache-version replacement an already-open session never re-reads), and proves the
# mirror-resolved hook commands still run (exit 0, never 127) with version A gone. Also runs the mirrored
# `bin/slopweaver init` against a clean scratch home and proves it seeds every marker/seed file (a regression
# proof for the missing-`templates/`-in-the-mirror defect, code-quality-round-2.md item 0). Then simulates a
# fresh session's SessionStart against a fake "version B" and proves the mirror atomically switches to it.
#
# This exercises real files on real disk (mkdir/cp/symlink/exec) — it is deliberately NOT a vitest unit test
# (that lane is pure-function/zero-I/O by convention) nor an integration test (that lane is specifically the
# Polly-cassette GitHub/Slack/Linear provider lane). Run directly: bash scripts/prove-hook-mirror-survives-cache-replacement.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# A hooks-relevant subset is enough — mirror-sync only ever touches these entries.
#
# node_modules is LINKED in beside them, exactly as `plugin-mirror-sync.sh` now links `cli-deps/node_modules`
# into every slot it builds — never COPIED, by either. This fixture links the repo's own tree because it
# seeds a plugin version rather than a mirror; a real install gets its from `plugin-install-deps.sh`.
# Without it this fixture reproduces a failure that is about the fixture rather than about the mirror:
# `hooks/pretooluse.ts` reaches `neverthrow` through a bare import, tsx resolves a bare import from the
# importing FILE's own directory upward, and a seeded version with no node_modules
# above it dies at `node:internal/modules/esm/resolve` — the exact stack this script exists to distinguish
# from a 127. Repro: remove the ln below and run this script.
seed_version() {
  local dest="$1"
  mkdir -p "$dest"
  for entry in bin src hooks scripts stubs templates package.json yarn.lock .yarnrc.yml; do
    [ -e "$REPO_ROOT/$entry" ] || continue
    cp -R "$REPO_ROOT/$entry" "$dest/$entry"
  done
  [ -d "$REPO_ROOT/node_modules" ] && ln -sfn "$REPO_ROOT/node_modules" "$dest/node_modules"
  return 0
}

echo "== seeding version A =="
VERSION_A="$SANDBOX/version-A"
seed_version "$VERSION_A"

DATA_ROOT="$SANDBOX/plugin-data"
SLOPWEAVER_HOME="$SANDBOX/slopweaver-home"  # no runs/ dir → handover-run.sh's own guard exits 0 fast, no CLI needed
mkdir -p "$SLOPWEAVER_HOME"

echo "== SessionStart on version A: mirror-sync =="
PLUGIN_ROOT="$VERSION_A" PLUGIN_DATA="$DATA_ROOT" "$VERSION_A/scripts/plugin-mirror-sync.sh"

CURRENT_LINK="$DATA_ROOT/mirror/current"
[ -L "$CURRENT_LINK" ] || fail "no mirror/current symlink after first sync"
SLOT_AFTER_A="$(readlink "$CURRENT_LINK")"
MIRRORED_HANDOVER="$DATA_ROOT/mirror/current/hooks/handover-run.sh"
[ -x "$MIRRORED_HANDOVER" ] || fail "mirrored handover-run.sh missing or not executable"

echo "== hook fires normally, version A still present =="
SLOPWEAVER_HOME="$SLOPWEAVER_HOME" PLUGIN_ROOT="$VERSION_A" "$MIRRORED_HANDOVER"
[ "$?" -eq 0 ] || fail "handover-run.sh (via mirror) failed with version A still present"

echo "== mirrored bin/slopweaver init seeds a clean scratch home fully (templates/ must ride along) =="
INIT_HOME="$SANDBOX/init-home"
mkdir -p "$INIT_HOME"
set +e
SLOPWEAVER_HOME="$INIT_HOME" "$DATA_ROOT/mirror/current/bin/slopweaver" init >/dev/null 2>"$SANDBOX/init.stderr"
INIT_STATUS=$?
set -e
[ "$INIT_STATUS" -eq 0 ] || fail "mirrored init exited $INIT_STATUS (expected 0): $(cat "$SANDBOX/init.stderr")"
[ -f "$INIT_HOME/.home-version.json" ] || fail "mirrored init did not seed .home-version.json"
[ -f "$INIT_HOME/identity.json" ] || fail "mirrored init did not seed identity.json (templates/ missing from the mirror)"
[ -f "$INIT_HOME/profile.json" ] || fail "mirrored init did not seed profile.json (templates/ missing from the mirror)"
[ -f "$INIT_HOME/hygiene-denylist.txt" ] || fail "mirrored init did not seed hygiene-denylist.txt"
echo "   -> mirrored init exited 0 and seeded all four files"

echo "== hook fires against pretooluse.sh, version A still present =="
BENIGN_CALL='{"session_id":"mirror-proof","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
MIRRORED_ADMIT="$DATA_ROOT/mirror/current/scripts/pretooluse.sh"
[ -x "$MIRRORED_ADMIT" ] || fail "mirrored pretooluse.sh missing or not executable"
echo "$BENIGN_CALL" | PLUGIN_ROOT="$VERSION_A" "$MIRRORED_ADMIT"
[ "$?" -eq 0 ] || fail "pretooluse.sh (via mirror) failed with version A still present"

echo "== pruning version A (simulating a replaced-and-pruned plugin cache) =="
rm -rf "$VERSION_A"
[ ! -d "$VERSION_A" ] || fail "version A still on disk after rm -rf"

echo "== invoking the SAME frozen mirror path, PLUGIN_ROOT still naming the now-deleted version A =="
set +e
SLOPWEAVER_HOME="$SLOPWEAVER_HOME" PLUGIN_ROOT="$VERSION_A" "$MIRRORED_HANDOVER"
STATUS=$?
set -e
[ "$STATUS" -ne 127 ] || fail "handover-run.sh exited 127 after version A was pruned — the exact regression this fix closes"
[ "$STATUS" -eq 0 ] || fail "handover-run.sh exited $STATUS (expected 0) after version A was pruned"
echo "   -> exit $STATUS (not 127) — hook survived the cache-version prune with no restart"

set +e
echo "$BENIGN_CALL" | PLUGIN_ROOT="$VERSION_A" "$MIRRORED_ADMIT"
STATUS=$?
set -e
[ "$STATUS" -ne 127 ] || fail "pretooluse.sh exited 127 after version A was pruned"
[ "$STATUS" -eq 0 ] || fail "pretooluse.sh exited $STATUS (expected 0) after version A was pruned"
echo "   -> exit $STATUS (not 127) — PreToolUse hook survived the cache-version prune with no restart"

echo "== \"restart\": a fresh SessionStart on version B, same stable PLUGIN_DATA =="
VERSION_B="$SANDBOX/version-B"
seed_version "$VERSION_B"
echo "# version B marker $(date +%s 2>/dev/null || echo static)" >> "$VERSION_B/hooks/handover-run.sh"
PLUGIN_ROOT="$VERSION_B" PLUGIN_DATA="$DATA_ROOT" "$VERSION_B/scripts/plugin-mirror-sync.sh"

SLOT_AFTER_B="$(readlink "$CURRENT_LINK")"
[ "$SLOT_AFTER_B" != "$SLOT_AFTER_A" ] || fail "the unkeyed mirror link did not move to version B's own mirror"
grep -q "version B marker" "$MIRRORED_HANDOVER" || fail "mirror/current does not reflect version B's content after the fresh SessionStart"
echo "   -> link moved ($SLOT_AFTER_A -> $SLOT_AFTER_B), mirror/current now resolves version B's content"

# Version B booting must not have reached into version A's mirror. Before the per-root key there
# was only one tree and this could not have been asked — the version-B sync WAS the overwrite. A pruned
# version A is the sharper case, because that mirror is all a session still running on it has left.
echo "== version B's boot left version A's own mirror alone =="
A_HANDOVER="$DATA_ROOT/mirror/by-root$VERSION_A/current/hooks/handover-run.sh"
[ -x "$A_HANDOVER" ] || fail "version A's own mirror is gone after version B booted"
! grep -q "version B marker" "$A_HANDOVER" || fail "version B's content reached version A's mirror"
echo "   -> version A's mirror still carries version A's content, with version A itself pruned"

echo
echo "ALL PROOFS PASSED"
