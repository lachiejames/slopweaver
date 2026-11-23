#!/usr/bin/env bash
# Fast-forward the checkout this plugin is LOADED FROM, at session start, before anything reads it.
#
# Why this exists: the owner loads Slopweaver from a skills-dir symlink to their own main checkout, so the
# code every session runs is whatever that checkout happens to be sitting at. Nothing moved it. Measured
# on the real checkout, its reflog showed fast-forwards only at the moments a session happened to run one
# by hand, and for hours its upstream still named a remote the repository had already moved off, so every
# session booted in that window loaded code up to nine merges behind. "Always current" cannot depend on
# remembering a command: sessions must not run stale plugins.
#
# This is NOT the background sync daemon `docs/main-checkouts/cwd-safety-and-scope.md` rules out. It is one bounded
# fast-forward, in the foreground of a session's own boot, on the one checkout that session is about to
# load — and it refuses in every case `slopweaver checkout sync` refuses, for the same reasons.
#
# A marketplace/cache install is a plain directory with no `.git`, so every check below fails closed and
# this exits 0 having touched nothing. That path stays current a different way — see
# `docs/install-stays-current/routes-and-fixes.md`.
#
# ORDERING, which is the whole point: this is invoked from the TOP of `plugin-mirror-sync.sh` rather than
# registered as its own SessionStart hook, because hooks in one group are not ordered against each other.
# Called inline, the fast-forward provably completes before the mirror copies the tree, in the same
# process. The lock then extends that guarantee ACROSS concurrently booting sessions: no session can copy
# the tree while another session's `git merge` is rewriting it.
set -euo pipefail

# `GIT_DIR`/`GIT_WORK_TREE` OVERRIDE `-C`, so a hook inherited from a git hook's environment would point
# every command below at whatever repository invoked it instead of the plugin's own checkout. That is the
# same override that once created a branch and 35 fixture commits in this repository from a test's `cwd`
# (see `src/__tests__/tempGitRepo.ts`); it is cheaper to unset them here than to be sure no caller sets them.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR

# A session boot must not wait on a hung network — but this was 15s and that was measured too tight on the
# real repository within an hour of shipping. A no-op fetch there costs 6.1s
# (`for i in 1 2 3; do /usr/bin/time -p git fetch --quiet --no-tags origin main; done` in the main
# checkout), so a fetch that actually transfers had almost no room, and the first run against a checkout
# three merges behind updated the ref and then did nothing. 45s leaves a transferring fetch real headroom
# while staying inside the host's own 60s hook budget.
FETCH_TIMEOUT_SECONDS=45
LOCK_STALE_SECONDS=120     # a holder older than this died mid-run; its lock is not evidence of a live one

# Run a command with a wall-clock bound, portably (macOS ships no `timeout`).
#
# @param $1 seconds to allow
# @returns the command's own status, or 124 when it was killed for running over
run_bounded() {
  local seconds="$1"; shift
  "$@" &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$seconds" ]; then
      kill -TERM "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../hooks/lib/resolve-root.sh
source "$SELF_DIR/../hooks/lib/resolve-root.sh"
ROOT="$(resolve_plugin_root "$(cd "$SELF_DIR/.." && pwd)")"

# `--show-toplevel` resolves the symlink for us: a skills-dir install points at the real checkout.
TOP="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$TOP" ] || exit 0                                    # cache install — not a checkout, nothing to sync

# A linked worktree is somebody's branch in flight. Only the repository's own main worktree is ours to move.
COMMON="$(git -C "$TOP" rev-parse --git-common-dir 2>/dev/null || true)"
GITDIR="$(git -C "$TOP" rev-parse --git-dir 2>/dev/null || true)"
[ -n "$COMMON" ] && [ "$COMMON" = "$GITDIR" ] || exit 0

BRANCH="$(git -C "$TOP" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[ -n "$BRANCH" ] || exit 0                                 # detached HEAD — nothing to fast-forward onto
UPSTREAM="$(git -C "$TOP" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
[ -n "$UPSTREAM" ] || exit 0                               # tracks nothing

# Refuse a dirty tree exactly as `checkout sync` does: a fast-forward is only ever safe on a clean one.
[ -z "$(git -C "$TOP" status --porcelain 2>/dev/null)" ] || exit 0

LOCK="${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/slopweaver}}/checkout-sync.lock"
mkdir -p "$(dirname "$LOCK")"
if ! mkdir "$LOCK" 2>/dev/null; then
  # Somebody holds it. A live holder means another booting session is already doing this work and will
  # leave the tree current, so exiting is correct. Only break a lock old enough to prove its holder died.
  #
  # GNU first, and the answer checked for digits. `stat -f %m` is BSD's mtime and GNU's --file-system, where
  # `%m` is not a directive — so on Linux that form SUCCEEDS, prints a block opening `File: "..."`, and the
  # `||` chain never reaches its next arm; `$(( ))` then reads `File` as a variable and `set -u` aborts the
  # hook. MEASURED on the CI runner against the identical expression in
  # `plugin-mirror-sync.sh`: `line 88: File: unbound variable`, five of six runs, every darwin run green.
  lock_mtime="$(stat -c %Y "$LOCK" 2>/dev/null || stat -f %m "$LOCK" 2>/dev/null || true)"
  case "$lock_mtime" in
    "" | *[!0-9]*) exit 0 ;;                               # unreadable is not evidence of a dead holder
  esac
  [ "$(( $(date +%s) - lock_mtime ))" -gt "$LOCK_STALE_SECONDS" ] || exit 0
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || exit 0
fi
trap 'rm -rf "$LOCK"' EXIT

REMOTE="${UPSTREAM%%/*}"
# Booting anyway is right; doing it SILENTLY is not. A run that decided not to update looked exactly like a
# run that found nothing to do, which is how a fetch bounded out at the old 15s went unnoticed until a third
# invocation behaved differently. Doctrine rule 6, inside a hook: never stall silently.
if ! run_bounded "$FETCH_TIMEOUT_SECONDS" git -C "$TOP" fetch --quiet --no-tags "$REMOTE" "$BRANCH" 2>/dev/null; then
  echo "[slopweaver] could not fetch $REMOTE/$BRANCH within ${FETCH_TIMEOUT_SECONDS}s — $TOP may be behind" >&2
  exit 0
fi

BEFORE="$(git -C "$TOP" rev-parse HEAD)"

# `--ff-only` is the refusal: a diverged branch is left alone, never merged or reset. But a FAILED merge is
# re-measured before it is named, exactly as `checkout sync` does (`classifyFailedFastForward`,
# `src/checkouts/sync.ts`): git fails a still-clean fast-forward the same way when another process holds
# `.git/index.lock`, and every session boot and `checkout sync` touch this checkout at once. Only a branch
# both behind AND ahead has diverged; one still behind and not ahead is retried, three attempts in all.
ATTEMPT=1
while ! git -C "$TOP" merge --ff-only --quiet "$UPSTREAM" 2>/dev/null; do
  DRIFT="$(git -C "$TOP" rev-list --left-right --count "$UPSTREAM...HEAD" 2>/dev/null || true)"
  BEHIND="$(printf '%s' "$DRIFT" | awk '{ print $1 }')"
  AHEAD="$(printf '%s' "$DRIFT" | awk '{ print $2 }')"
  case "$BEHIND:$AHEAD" in
    :* | *: | *[!0-9:]*)
      echo "[slopweaver] could not fast-forward $TOP onto $UPSTREAM, nor read how far it is behind — whether it diverged is unknown" >&2
      exit 0
      ;;
  esac
  [ "$BEHIND" -gt 0 ] || break                             # HEAD already holds the upstream — nothing left to pull
  if [ "$AHEAD" -gt 0 ]; then
    echo "[slopweaver] $TOP is $BEHIND commit(s) behind $UPSTREAM and $AHEAD ahead, so it will not fast-forward — it has diverged" >&2
    exit 0
  fi
  if [ "$ATTEMPT" -ge 3 ]; then
    echo "[slopweaver] $TOP is $BEHIND commit(s) behind $UPSTREAM and still a clean fast-forward, but the merge failed 3 times — another git process may hold a lock; run \`slopweaver checkout sync\`" >&2
    exit 0
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 0.1
done
AFTER="$(git -C "$TOP" rev-parse HEAD)"

if [ "$BEFORE" != "$AFTER" ]; then
  echo "[slopweaver] fast-forwarded $TOP onto $UPSTREAM (${BEFORE:0:8} → ${AFTER:0:8})" >&2
fi
