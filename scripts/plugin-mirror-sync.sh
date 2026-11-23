#!/usr/bin/env bash
# SessionStart hook — mirror the hook-executable surface (bin/, src/, hooks/, scripts/, stubs/, templates/,
# package manifests) into a stable location OUTSIDE the versioned plugin cache, then atomically flip a
# `current` symlink onto it.
#
# Why: every OTHER hook this plugin registers (PostCompact, PostToolUse, PreToolUse, Stop) can fire
# repeatedly for the entire life of a long-lived session — but Codex resolves and freezes each hook's
# command path (and its PLUGIN_ROOT) once, at session start. If the plugin's cache version is later
# replaced and the OLD version's directory pruned, that already-open session's frozen command keeps naming
# a file that no longer exists, and every affected hook exits 127 for the rest of the session — measured
# live, against PostCompact, compact-source SessionStart and trusted PreToolUse. PLUGIN_DATA is
# a separate, host-provided directory that sits OUTSIDE the versioned/prunable cache specifically so state
# can survive a version bump — the same guarantee `plugin-install-deps.sh` already leans on for
# node_modules. A hook command resolved against it stays valid no matter how many cache versions come and
# go afterward.
#
# Mirrored atomically: build into whichever of two alternating slots the `current` symlink does NOT already
# point at, then flip the symlink in one `ln -sfn`, so a hook firing mid-sync never observes a half-written
# tree, and disk use stays bounded to 2x rather than growing every session.
#
# ONE SYNCER AT A TIME, which that alternation silently assumed and never enforced. Every concurrent run
# reads the same `current` and therefore derives the SAME target slot, so all of them build into one
# directory: `rm -rf` walks a tree, unlinks it, then `rmdir`s it, and a sibling's `rsync` recreating a file
# between the walk and the `rmdir` makes that `rmdir` fail ENOTEMPTY. Measured on the owner's
# machine, when a cmux restart resumed six seats at once and their screens carried
# `rm: .../mirror/a/templates: Directory not empty`; reproduced, where 11 of 18 concurrent runs
# exited 1 AND left `current` pointing at a slot holding 199 of 400 files — the incomplete mirror is the
# real damage, since a frozen hook command naming a file that never got copied is the exact 127 this whole
# script exists to prevent. The fix is a lock, not a better `rm`: no per-entry change can make the flip
# mean anything while two processes mutate one slot. Repro:
#   PLUGIN_ROOT=<fixture> PLUGIN_DATA=<scratch> BIN_DIR=<scratch>/bin \
#     bash -c 'for s in 1 2 3 4 5 6; do bash scripts/plugin-mirror-sync.sh & done; wait'
set -euo pipefail

# Captured before anything else, because the lock wait below is bounded by what is LEFT of the host's hook
# budget rather than by a constant: `plugin-checkout-sync.sh` may already have spent 45s of it on a fetch.
STARTED_AT="$(date +%s)"
HOOK_BUDGET_SECONDS=55     # inside the host's own 60s, so a wait cannot be what gets this hook killed
LOCK_STALE_SECONDS=120     # a holder older than this died mid-run; its lock is not evidence of a live one
                           # (`LOCK_STALE_MS` in src/worktree/pluginMirrors.ts is this number; keep them equal)
                           # measured: a full build of the real tree is 3.59s, ~33x under this —
                           # PLUGIN_ROOT=$PWD PLUGIN_DATA=$(mktemp -d) BIN_DIR=$(mktemp -d) \
                           #   /usr/bin/time -p bash scripts/plugin-mirror-sync.sh

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/resolve-root.sh
source "$SELF_DIR/../hooks/lib/resolve-root.sh"

ROOT="$(resolve_plugin_root "$(cd "$SELF_DIR/.." && pwd)")"
DATA_ROOT="${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/slopweaver}}"

# Bring the source current BEFORE reading it, in this same process. Hooks inside one SessionStart group are
# not ordered against one another, so a sibling hook could not guarantee it ran first; called from here it
# provably does, and the lock it takes is what stops a CONCURRENT session copying a tree mid-rewrite. A
# cache install has no checkout and this is a no-op. Never allowed to fail a session boot.
"$SELF_DIR/plugin-checkout-sync.sh" || true

# ONE MIRROR PER PLUGIN ROOT, because `$DATA_ROOT/mirror` was ONE tree shared by every seat on the machine
# and every SessionStart rewrote it from whichever worktree booted last. MEASURED: a boot from a branch that had folded ten PreToolUse
# scripts into one rewrote the shared mirror with that layout, and the seven seats running `main` — whose
# own `hooks.json` still named the ten — lost EVERY PreToolUse guard at once. A missing hook command exits
# 127, which the host does not treat as a block, so the fleet's door tripwires were off with no symptom on
# any seat. The blast radius is every hook of every other seat, and it needs no bad code to fire: two
# checkouts with different hook layouts is the ordinary state of this fleet.
#
# So the mirror is keyed by the plugin root that built it. Each seat reads its OWN checkout's `hooks.json`,
# and that file now names a path carrying the same key, so what a seat runs always comes from the tree that
# declared it. No seat can reach another's.
#
# THE KEY IS THE RAW ENVIRONMENT VALUE, never `resolve_plugin_root`'s answer, and the difference is the
# whole correctness of it: `hooks.json` is static text that can only substitute a variable, while
# `resolve_plugin_root` deliberately FALLS BACK when that variable names a directory that no longer exists
# (its own header says why). Key on the resolved root and a stale-variable session would build its mirror
# under one name and look for it under another — an empty directory, which is the 127 again. The expression
# below is spelled character for character in `hooks/hooks.json`; changing one without the other is the
# defect, and `unit/context/hookMirrorKey.test.ts` compares them.
MIRROR_KEY="${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-/_unkeyed}}"
MIRROR_ROOT="$DATA_ROOT/mirror/by-root$MIRROR_KEY"
CURRENT_LINK="$MIRROR_ROOT/current"

# The unkeyed path, which stays and is re-pointed at whatever booted last. It is a symlink TO the newest
# root's own `current`, so it costs no second copy and behaves exactly as it always did. Two callers want
# precisely that, and neither is a hook surface:
#
#   * `plugin-path-shim.sh`'s `~/.local/bin/slopweaver` and `memory hook --install`'s baked launcher path
#     want A slopweaver CLI, deliberately the INSTALLED one rather than whichever worktree is current — the
#     same fleet-policy reasoning `hooks/lib/guard-root.sh` already applies. Shared is the right answer for
#     a binary; it is the wrong answer for a set of script paths a seat's own `hooks.json` declares, and
#     conflating the two is what the shared mirror was.
#   * every session that booted BEFORE this change froze commands naming it, and those have to keep
#     resolving for the rest of those sessions' lives — the same reason the mirror exists at all.
LEGACY_CURRENT_LINK="$DATA_ROOT/mirror/current"

# A per-root mirror that no seat has booted against in this long is not one a live session is using: every
# SessionStart re-touches its own. Seven days is far past any session's life and far short of letting one
# worktree per branch accumulate — each root costs two slots, MEASURED at 74 MiB a slot
# (`du -sh ~/.claude/plugins/data/slopweaver-inline/mirror/*/`), which is what makes pruning part of the
# change rather than a follow-up.
MIRROR_KEEP_SECONDS=604800

mkdir -p "$MIRROR_ROOT"

# Dot-prefixed so no key can ever collide with one: a plugin root is an absolute path, and no path component
# is named `.slot-a`. The earlier names were `a` and `b`, which a root at `/a` would have sat on top of.
SLOT_A=".slot-a"
SLOT_B=".slot-b"
# The basename separately, because `prune_stale_root_mirrors` skips it by NAME: spelling it twice is how the
# sweep's skip list drifts from what actually makes the lock.
LOCK_NAME=".sync.lock"
LOCK="$MIRROR_ROOT/$LOCK_NAME"

# What a slot is built from, spelled once: the copy loop and the source probe below both read it, and a probe
# that looked at fewer entries than the copy takes is a skip that serves an edit it never saw.
MIRRORED_ENTRIES=(bin src hooks scripts stubs templates package.json yarn.lock .yarnrc.yml .nvmrc)

# The commit a slot was built from, written INSIDE the slot so it can only ever describe that slot's bytes.
STAMP_NAME=".source-commit"

# `scripts/hook.sh` — every registered hook command — and what it sources before it can bound or judge anything. A
# slot short of files is otherwise flipped and left unstamped for the next boot to rebuild, but one short of THESE
# is a seat whose hooks cannot run: the entry gone or its envelope gone (`bounded-run.sh`) exits 127 and the host
# runs the tool past every gate, and its profile hold gone (`profile-delivered.sh`) refuses every guarded call with
# no profile and no reload. So such a slot is never made current, and a `current` that is itself short of them is
# re-seeded to the root; the tree a seat reaches carries its entry point by construction, the
# way the A/B slots already guarantee no half-written one. The PreToolUse target and the libraries it sources are here
# too: a MISSING one lands in a recovery lane (`run_target`, `give_up persistent`), but an EMPTY executable
# `pretooluse.sh` exits 0 before any check, and the host runs the tool. So is node's entry,
# `hooks/pretooluse.ts`: `tsx` runs an empty one as an empty program, exit 0. Past it, an emptied module
# breaks its importer's named imports, which throws into the dispatcher's persistent give-up, never a silent 0.
HOOK_ENTRY_FILES=(
  scripts/hook.sh hooks/lib/bounded-run.sh hooks/lib/profile-delivered.sh
  scripts/pretooluse.sh hooks/lib/resolve-root.sh hooks/lib/guard-root.sh hooks/pretooluse.ts
  scripts/pretooluse-protected-paths.sh
)

# Whether a tree carries every hook entry file the source does, byte for byte. Presence is not enough: a copy that
# reported success over a zero-byte `scripts/hook.sh` is an entry that exits 0 before any gate, so the host runs the
# tool. Nor are the bytes: `hooks.json` EXECUTES `scripts/hook.sh`, so a copy that dropped its
# executable bit fails with 126, which the host treats as it does 127. Relative to the source, so a root that
# predates one of them builds exactly as it did. A `current` from an older commit whose entry differs fails this too,
# and is re-seeded to the root, which matches by construction; that only happens when the build just made failed as well.
#
# @param $1 the tree to check — the slot just built, or the one `current` names
# @returns 0 when every entry file the source carries is present, identical and as executable in it, 1 otherwise
tree_runs_its_hooks() {
  local file
  for file in "${HOOK_ENTRY_FILES[@]}"; do
    [ ! -f "$ROOT/$file" ] || cmp -s "$ROOT/$file" "$1/$file" || return 1
    [ ! -x "$ROOT/$file" ] || [ -x "$1/$file" ] || return 1
  done
}

# ONE COPY PER DATA ROOT AT A TIME, across every plugin root. The per-root lock above stops two boots of ONE
# root building into one slot; it does nothing about seven DIFFERENT roots each copying 8.4k files at once.
# MEASURED: seven of this
# script's rsyncs overlapped, fseventsd and mds took the load from 5 to 52 on a 22-core machine, with no gate
# lap running. It sits at `mirror/`, above `by-root`, so the prune walk never reaches it. Per DATA root rather
# than per machine because a path outside PLUGIN_DATA is one a test cannot sandbox; every seat on this machine
# boots from `slopweaver-inline`, so in practice the two are the same.
COPY_LOCK="$DATA_ROOT/mirror/.copy.lock"
# How much of HOOK_BUDGET_SECONDS a copy needs left before it is worth starting. The idle build is 3.59s (the
# repro above); whole runs on a loaded machine were 18-30s (§ prune below), so 20 keeps a started copy inside
# the host's kill. Read from the environment only so the give-up path is testable without a 35s wait.
COPY_RESERVE_SECONDS="${SLOPWEAVER_MIRROR_COPY_RESERVE_SECONDS:-20}"
case "$COPY_RESERVE_SECONDS" in
  "" | *[!0-9]*) COPY_RESERVE_SECONDS=20 ;;
esac

# Whether the mirror a session would use RIGHT NOW is usable — the question that decides what a contender
# does, so it is asked rather than assumed. `-d` follows the symlink, so this is false for a dangling
# `current` as well as for an absent one.
#
# @returns 0 when `current` resolves to a directory, 1 otherwise
mirror_is_usable() {
  [ -d "$CURRENT_LINK" ]
}

# Point the stable `slopweaver` command at the mirror. Called on BOTH endings that leave a usable mirror
# behind — the build's own, and a contender's skip. A skipper that left this undone would be a seat with a
# perfectly good mirror and no command resolving against it, and after a restart every seat but one skips.
# Never allowed to fail a session boot.
#
# @returns nothing
point_path_shim() {
  "$SELF_DIR/plugin-path-shim.sh" "$CURRENT_LINK" || true
}

# A path's mtime as epoch seconds, on both stats this runs on, or empty when neither could say.
#
# GNU first, and the digit guard is not belt-and-braces. `stat -f %m` is BSD's mtime and GNU's
# --file-system, where `%m` is not a directive at all — so on Linux that form SUCCEEDS, prints a
# human-readable block opening `File: "..."`, and an `||` chain never reaches its next arm. Feeding that to
# `$(( ))` makes bash read `File` as a variable and `set -u` aborts the hook. MEASURED on the CI runner:
# `plugin-mirror-sync.sh: line 88: File: unbound variable`, five of six concurrent runs, while
# every local darwin run was green. So the ORDER matters and a non-numeric answer has to be rejected on
# its value rather than on an exit status.
#
# @param $1 the path to stat — the lock directory, or a per-root mirror's .last-sync marker
# @returns the mtime on stdout, or nothing at all when it is unreadable or not a number
mtime_seconds() {
  local raw
  raw="$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || true)"
  case "$raw" in
    "" | *[!0-9]*) return 0 ;;
    *) printf '%s\n' "$raw" ;;
  esac
}

# Whether a lock directory is old enough to prove its holder died rather than being slow.
#
# @param $1 the lock directory — this root's own, the data root's copy lock, or a root the prune is judging
# @returns 0 when the lock's mtime is more than LOCK_STALE_SECONDS ago, 1 otherwise
lock_is_stale() {
  local mtime
  mtime="$(mtime_seconds "$1")"
  # No readable mtime is not evidence of a dead holder, so never break the lock on one.
  [ -n "$mtime" ] || return 1
  [ "$(( $(date +%s) - mtime ))" -gt "$LOCK_STALE_SECONDS" ]
}

# Free the disk held by per-root mirrors nothing has booted against for MIRROR_KEEP_SECONDS.
#
# Keying the mirror per root is what makes pruning necessary: one shared tree was bounded at 2 slots
# forever, and one tree per checkout grows with the branch list. The marker is `.last-sync`, written by
# every successful build, so "in use" means a SessionStart touched it rather than anything derived — a
# session cannot be older than the last boot that started it. A WORKTREE root is freed sooner, by evidence
# rather than age: `slopweaver worktree mirror-prune`, run hourly inside `worktree prune --apply`.
#
# Deliberately NOT keyed on whether the root still exists. The whole reason this mirror is outside the
# versioned cache is that a root can be pruned out from under a session that is still running (the header
# above), so an absent root proves nothing about a live seat, while an untouched marker does.
#
# THE WALK IS BOUNDED BY THE SLOT NAMES, and nothing else will do. A marker only ever sits at a mirror
# root's own top level, but the search still has to DESCEND PAST one, because mirror roots NEST: the key is
# the plugin root path appended whole, and this fleet's worktrees live at
# `<checkout>/.claude/worktrees.noindex/<branch>`, so 63 of the 64 roots on the owner's machine sit inside
# the `<checkout>` root's own mirror directory. That kills both of the obvious bounds — there is no single
# `-maxdepth` that reaches a worktree root without a constant nobody can defend, and pruning at the first
# marker found would make the sweep blind to every nested root and silently turn this whole function off.
#
# What IS safe to SKIP is every directory THIS SCRIPT creates inside a mirror root, which is exactly the
# three below: the two slots and the lock. The only other entries there are `current`, a symlink `find`
# does not follow, and the marker itself. `node_modules` is not in the list on purpose — it exists only
# INSIDE a slot (the `ln -sfn` below), so the slot skip already covers it, while skipping it by name would
# also skip a by-root PATH COMPONENT named `node_modules` and hide that root from this sweep forever.
#
# The same nesting governs what a stale root's REMOVAL may touch: what the booting script itself created,
# never the directory. The body below says why, and why the lock is the one thing left standing.
#
# MEASURED on the owner's 8.1 GB mirror: the unbounded walk visited 864,565 entries in 72.22s
# real / 36.73s sys to find 64 markers, over this hook's declared 60s budget — so every boot was killed
# here, taking `point_path_shim` with it. Bounded, the same tree is 200 entries. End to end, this whole
# script went 79.83s -> 18.33s and 30.06s on two later samples; the spread is the machine's disk, and both
# are inside the budget the old one could not meet at all. Repro the walk, and the script:
#   B=~/.claude/plugins/data/slopweaver-inline/mirror/by-root
#   /usr/bin/time -p find "$B" -name .last-sync -type f
#   find "$B" \( -name .slot-a -o -name .slot-b -o -name .sync.lock \) -prune -o -print | wc -l
#   PLUGIN_ROOT=$PWD PLUGIN_DATA=~/.claude/plugins/data/slopweaver-inline BIN_DIR=$(mktemp -d) \
#     /usr/bin/time -p bash scripts/plugin-mirror-sync.sh
#
# Every operator is POSIX, because this file has been bitten once already by a BSD/GNU divergence
# (`mtime_seconds` above): no `-maxdepth`, no `-path`, nothing GNU-only.
#
# A failure here is never allowed to matter: the worst case is disk that stays used, which is strictly
# better than a boot that dies trying to free it. Every removal is `|| true` — and `pipefail` still lets a
# failing `find` abort the caller, which is exactly why this is now the LAST thing the script does.
#
# @returns nothing
prune_stale_root_mirrors() {
  local by_root marker dir age now
  by_root="$DATA_ROOT/mirror/by-root"
  [ -d "$by_root" ] || return 0
  now="$(date +%s)"
  find "$by_root" \( -name "$SLOT_A" -o -name "$SLOT_B" -o -name "$LOCK_NAME" \) -prune \
    -o -name .last-sync -type f -print 2>/dev/null | while IFS= read -r marker; do
    dir="$(dirname "$marker")"
    # `[ … ] && continue` is what this cannot be: `set -e` is on, so a list whose last command answers 1
    # aborts the whole `while` subshell, and the FIRST root that is not this one would end the sweep.
    # A root whose LOCK is fresh is building right now, however old its last finished build: its marker is only
    # rewritten at the flip, and waiting on the copy lock can hold that flip back by most of a minute. Taking
    # its slots mid-copy is how a partial tree gets flipped (a review finding). A STALE lock is not
    # a build — `lock_is_stale`'s own threshold, the one a contender breaks it at — and it cannot wait for that
    # root's next boot to break it, because a superseded cache version or a removed worktree never boots again.
    # MEASURED: 16 abandoned locks, each pinning its slots for good. Repro:
    #   find ~/.claude/plugins/data/*/mirror/by-root \( -name .slot-a -o -name .slot-b \) -prune \
    #     -o -name .sync.lock -type d -exec stat -f '%Sm %N' {} +
    if [ "$dir" != "$MIRROR_ROOT" ] && { [ ! -d "$dir/$LOCK_NAME" ] || lock_is_stale "$dir/$LOCK_NAME"; }; then
      age="$(mtime_seconds "$marker")"
      if [ -n "$age" ] && [ "$(( now - age ))" -gt "$MIRROR_KEEP_SECONDS" ]; then
        # WHAT THE ROOT OWNS, never the directory, for the same reason the walk is bounded by name: roots
        # NEST, so `rm -rf "$dir"` on a stale `<checkout>` root would take every LIVE worktree root's
        # mirror standing inside it — a live seat left with no mirror, which is the 127 this whole script
        # exists to prevent. The slots are all the disk there is (74 MiB each against a few empty
        # directories), so keeping the skeleton costs nothing and the root reuses it if it ever boots again.
        #
        # The LOCK is deliberately left alone, even a stale one: removing it is the one act here that could race
        # a contender breaking and retaking it, which is how two builds end up in one slot — the ENOTEMPTY
        # defect the lock exists to prevent. It is an empty directory, so it holds no disk, and `lock_is_stale`
        # breaks it if that root ever boots again.
        rm -rf "$dir/$SLOT_A" "$dir/$SLOT_B" 2>/dev/null || true
        rm -f "$dir/current" "$marker" 2>/dev/null || true
      fi
    fi
  done
  return 0
}

# Take the mirror lock, or decide not to build at all.
#
# The critical section has to OPEN here, before the slot is picked, because reading `current` is the step
# that makes two processes collide — a lock taken around only the copy would reproduce the whole defect.
#
# The two contention cases get deliberately different answers:
#
#   * A live holder and a usable mirror — exit 0 at once. The mirror is valid now, the holder will leave it
#     valid and one sync fresher, and waiting buys this session nothing it does not already have while
#     spending a budget `plugin-checkout-sync.sh` may have nearly exhausted. This is the shape six seats
#     resuming after a restart are all in, so it is the path that must cost zero. Same reasoning
#     `plugin-checkout-sync.sh` applies to its own contender. The accepted residue: this session can run on
#     a mirror one fast-forward behind its own source for its whole life, because the holder may have
#     snapshotted the tree before our `plugin-checkout-sync.sh` moved it. Seconds wide, and the next
#     session start closes it.
#   * A live holder and NO usable mirror — wait, because a session with no mirror has no `slopweaver` shim
#     to point and every mirrored hook command is unresolvable, which is worse than a slow boot. Bounded by
#     what is left of HOOK_BUDGET_SECONDS, never by a constant.
#
# @returns 0 holding the lock, or exits 0 without it
take_lock_or_exit() {
  local elapsed
  while ! mkdir "$LOCK" 2>/dev/null; do
    if lock_is_stale "$LOCK"; then
      rm -rf "$LOCK"
      continue
    fi
    if mirror_is_usable; then
      echo "[slopweaver] another session is syncing the plugin mirror — using the current one" >&2
      point_path_shim
      exit 0
    fi
    elapsed="$(( $(date +%s) - STARTED_AT ))"
    if [ "$(( HOOK_BUDGET_SECONDS - elapsed ))" -le 0 ]; then
      # The elapsed time, not the budget: this hook shares that budget with the fast-forward above, so a run
      # whose fetch had already spent it gives up having waited barely any of it, and a line claiming
      # otherwise would send the next reader looking for a 55s hang that never happened.
      echo "[slopweaver] gave up on the plugin mirror lock after ${elapsed}s of a ${HOOK_BUDGET_SECONDS}s budget — no mirror yet" >&2
      exit 0
    fi
    sleep 1
  done
  # The copy lock too, once `take_copy_lock_or_seed` has it: the host's kill is a TERM from
  # `hooks/lib/bounded-run.sh`, and bash runs an EXIT trap on one, so a killed copy frees every other root at
  # once rather than holding them all to the 120s staleness.
  trap 'rm -rf "$LOCK"; [ -z "$COPY_LOCK_HELD" ] || rm -rf "$COPY_LOCK"' EXIT
}
COPY_LOCK_HELD=""

# `GIT_DIR`/`GIT_WORK_TREE` override `-C`, so an inherited one would stamp the mirror with some OTHER
# repository's commit — the same reason `plugin-checkout-sync.sh` unsets them.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR

# HEAD's sha when the plugin root IS a git checkout's own top level, or nothing. A cache install is a plain
# directory, and a root nested inside some other repository is not described by that repository's HEAD.
#
# @returns the sha on stdout, or nothing at all
root_checkout_head() {
  local real top
  real="$(cd "$ROOT" 2>/dev/null && pwd -P)" || return 0
  top="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -z "$top" ] || [ "$top" != "$real" ]; then
    return 0
  fi
  git -C "$ROOT" rev-parse --verify --quiet HEAD 2>/dev/null || true
}

# The commit the mirrored surface provably IS, or nothing when that cannot be said.
#
# Only a STRICTLY clean surface has one: no tracked edit, no untracked file and no ignored file under any
# mirrored entry, because the copy takes all three and HEAD describes none of them. Anything else answers
# nothing, and nothing means build exactly as before this existed — the conservative side of the one risk
# here, a skip serving a stale tree. `GIT_OPTIONAL_LOCKS=0` so the probe never takes the index lock out from
# under the seat's own git. MEASURED on this repository: 0.16-0.21s, against a copy of 8.4k files:
#   /usr/bin/time -p git status --porcelain --untracked-files=all --ignored -- bin src hooks scripts
#
# @returns the sha on stdout, or nothing at all
source_stamp() {
  local head dirty
  head="$(root_checkout_head)"
  [ -n "$head" ] || return 0
  dirty="$(GIT_OPTIONAL_LOCKS=0 git -C "$ROOT" status --porcelain --untracked-files=all --ignored \
    -- "${MIRRORED_ENTRIES[@]}" 2>/dev/null)" || return 0
  [ -z "$dirty" ] || return 0
  printf '%s\n' "$head"
}

# Whether `current` is a built slot carrying exactly this stamp. The seed (`current -> $ROOT`) is never a
# match, so a seeded root always goes on to build.
#
# @param $1 the source stamp, possibly empty — an empty one never matches
# @returns 0 on a match, 1 otherwise
mirror_matches_stamp() {
  local slot recorded
  [ -n "$1" ] || return 1
  slot="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
  case "$slot" in
    "$SLOT_A" | "$SLOT_B") : ;;
    *) return 1 ;;
  esac
  recorded="$(cat "$CURRENT_LINK/$STAMP_NAME" 2>/dev/null || true)"
  [ "$recorded" = "$1" ]
}

# Whether the slot just built holds exactly the source, entry by entry — what the stamp is about to promise.
#
# A clean source before and after the copy says nothing about what LANDED: something deleting inside the slot
# mid-copy leaves a partial tree behind a stamp, and every later boot skips onto it until HEAD moves, where
# before stamps the next boot rebuilt. Found by review, with a reproduction: another root's prune
# `rm -rf`d this root's slots while it waited on the copy lock and then copied, and `current/bin/slopweaver`
# stayed missing on every boot after. A dry run is a stat walk of both trees, so it costs a build about 1.3s on
# the real tree and a skip nothing. No `rsync` means nothing to verify with, and so no stamp.
#
# @returns 0 when a dry run finds nothing to transfer or delete for any mirrored entry, 1 otherwise
slot_matches_source() {
  local entry drift
  command -v rsync >/dev/null 2>&1 || return 1
  for entry in "${MIRRORED_ENTRIES[@]}"; do
    [ -e "$ROOT/$entry" ] || continue
    drift="$(rsync -a --delete --dry-run --itemize-changes "$ROOT/$entry" "$TARGET/" 2>/dev/null)" || return 1
    [ -z "$drift" ] || return 1
  done
  return 0
}

# Take the data root's copy lock, or leave this root on a tree that needs no copy.
#
# Waits only while a copy started now would still finish inside the budget. Past that, a checkout root is
# pointed at itself — the seed below, complete and current by construction — rather than left on a slot built
# from an OLDER commit, because that slot can lack a file this root's own `hooks.json` now names: the 127 the
# mirror exists to prevent. A cache install keeps what it has, since its key is a versioned path whose slot is
# the same bytes, and the seed there would be the prunable path the mirror exists to avoid. Either way the next
# boot builds.
#
# @returns 0 holding the copy lock, or exits 0 without it
take_copy_lock_or_seed() {
  local elapsed announced=""
  while ! mkdir "$COPY_LOCK" 2>/dev/null; do
    if lock_is_stale "$COPY_LOCK"; then
      rm -rf "$COPY_LOCK"
      continue
    fi
    elapsed="$(( $(date +%s) - STARTED_AT ))"
    if [ "$(( HOOK_BUDGET_SECONDS - elapsed ))" -le "$COPY_RESERVE_SECONDS" ]; then
      if [ -n "$(root_checkout_head)" ]; then
        ln -sfn "$ROOT" "$CURRENT_LINK" || true
      fi
      echo "[slopweaver] another root held the plugin mirror copy lock for ${elapsed}s — no copy this boot, the next one builds" >&2
      exit 0
    fi
    if [ -z "$announced" ]; then
      echo "[slopweaver] waiting for another root's plugin mirror copy to finish" >&2
      announced=1
    fi
    sleep 1
  done
  COPY_LOCK_HELD=1
}

# THE COMMON BOOT COPIES NOTHING. A resume, a compaction, a second session on
# an unchanged worktree: each used to `rm -rf` and re-copy 8.4k files into the other slot although the slot
# `current` names was built from that very commit. A subagent of a seat on the same commit should
# never copy.
#
# BEFORE the lock, because it is read-only: the flip is one atomic `ln -sfn`, so a concurrent holder can only
# ever move `current` onto another COMPLETE slot, and one that carries its own stamp. The common case then waits
# on nothing at all.
#
# `.last-sync` is touched because it is the prune's only evidence a root is live: a root that only ever skips
# would otherwise look abandoned after seven days and lose its slots under a running seat.
STAMP="$(source_stamp)"
if mirror_matches_stamp "$STAMP"; then
  : > "$MIRROR_ROOT/.last-sync" || true
  ln -sfn "by-root$MIRROR_KEY/current" "$LEGACY_CURRENT_LINK" || true
  point_path_shim
  echo "[slopweaver] plugin mirror already matches ${STAMP:0:12} — no copy" >&2
  exit 0
fi

take_lock_or_exit

# THE ROOT RESOLVES BEFORE THE BUILD DOES, because the build is the part that gets killed.
#
# This whole script is one SessionStart hook with `"timeout": 60` on it, and everything a seat's
# `hooks.json` names after SessionStart sits behind the `current` it flips at the END. So a run the host kills
# mid-build leaves a freshly spawned root with no `current` at all, and every later hook in that seat —
# PreToolUse, PostToolUse, PostCompact, Stop — resolves a path with no file at it and exits 127 for the rest
# of that session. (SessionStart's own siblings run from the plugin root, because they start in parallel with
# this script and so could never wait for it — docs/hooks/mirrors-and-failure-policy.md.) 127 is
# non-blocking, so the seat shows a banner and keeps going with every door tripwire and every guard silently off, which is the same blast radius as a shared mirror arriving by a different route.
#
# MEASURED on the owner's machine, read off the transcripts:
#   grep -h '"hook_cancelled"' ~/.claude/projects/*worktrees-noindex*/*.jsonl
# five runs ended at 60053/60061/60070/60117/60128 ms against a declared 60000. Two of those roots
# carried no `current` and no `.last-sync` afterwards and their seats logged `exitCode 127 … current/scripts/hook.sh:
# No such file or directory` on SessionStart, PreToolUse and Stop; the three that survived were killed AFTER
# the flip, since the flip and `.last-sync` both precede `prune_stale_root_mirrors`. A first boot into a new
# worktree is where this lands, because it runs beside `plugin-install-deps.sh` — 112026 ms in that same
# SessionStart group, "installing CLI dependencies" — on a disk-bound machine with several seats resuming,
# against a build the header above measures at 3.59s when nothing else is competing for the disk.
#
# So point `current` at the live plugin root the moment there is nothing usable there. `$ROOT` already
# carries `scripts/hook.sh`, `hooks/` and `bin/slopweaver`, and it is COMPLETE by construction — which is
# why the seed is a link to it rather than a copy, and why the first build still goes into a slot instead of
# straight into `current`: a partially written tree reachable through `current` is the 199-of-400 damage the
# header calls the real harm, and it would be reintroduced by either shortcut.
#
# AFTER THE LOCK, NEVER BEFORE. Above it, the seed would make `mirror_is_usable` true for a contender that
# `take_lock_or_exit` deliberately makes WAIT, rewriting that function's two different answers from the
# outside. Below it only the holder seeds, and a contender that then stands down does so onto a `current`
# that resolves — better than the wait it replaces, rather than a change to when it happens.
#
# `|| true` for the same reason as the `node_modules` link below: `set -e` is on and the flip is beneath
# this, so a failing seed must never cost the build that supersedes it.
#
# The residue, which is a designed state rather than corruption: a root whose build is killed on every boot
# keeps `current` pointing outside the mirror indefinitely. That is exactly the behaviour this machine had
# before the mirror existed, so a cache install pruned mid-session dangles as it did then — strictly better
# than 127, and named in `docs/hooks/mirrors-and-failure-policy.md` so a reader who finds it knows which of the two it is.
# NO `point_path_shim` HERE, and its absence is a fact about the shim rather than an omission.
# `plugin-path-shim.sh` resolves what it is handed with `pwd -P` and REFUSES a `current` that lands outside
# the real plugin-data root — the backstop it grew after a scratch reproduction re-pointed
# the operator's own `~/.local/bin/slopweaver`. A seed resolves to the plugin root, which is outside that
# tree by definition, so the call would exit 0 having done nothing: dead code reading as if it worked.
# The shim is pointed by the flip below, and by the contender path, exactly as before.
if ! mirror_is_usable; then
  ln -sfn "$ROOT" "$CURRENT_LINK" || true
fi

target_slot="$SLOT_A"
if [ -L "$CURRENT_LINK" ] && [ "$(readlink "$CURRENT_LINK")" = "$SLOT_A" ]; then
  target_slot="$SLOT_B"
fi
TARGET="$MIRROR_ROOT/$target_slot"

take_copy_lock_or_seed

mkdir -p "$TARGET"
# Gone BEFORE the copy: a build killed part-way must leave a slot that claims no commit at all.
rm -f "$TARGET/$STAMP_NAME"

for entry in "${MIRRORED_ENTRIES[@]}"; do
  [ -e "$ROOT/$entry" ] || continue
  rm -rf "${TARGET:?}/$entry"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "$ROOT/$entry" "$TARGET/" >/dev/null 2>&1
  else
    cp -R "$ROOT/$entry" "$TARGET/"
  fi
done

# A MIRRORED TREE HAS TO BE ABLE TO RUN WHAT IT CARRIES. The entries above are source, and none of them is
# `node_modules`, so `hooks/pretooluse.ts` copied into a slot resolves `zod` against whatever sits above the
# slot — nothing — and dies on its first bare import. `bin/slopweaver` already mints exactly this link, but
# lazily, the first time it happens to run from THIS slot, which is an ordering nobody controls: a seat
# reaching the mirrored PreToolUse shim first gets a tree it cannot run. Minting it here removes the race.
#
# Safe against everything this script does to a slot: the loop above `rm -rf`s only the entries it names and
# `node_modules` is not one, `ln -sfn` re-points rather than stacks, and `prune_stale_root_mirrors`' `rm -rf`
# does not follow a symlink, so pruning a mirror can never reach `cli-deps`. A DANGLING link — `cli-deps` not
# installed yet, since `plugin-install-deps.sh` is an unordered sibling SessionStart hook — resolves exactly
# as today's absence does, so the worst case is the status quo.
#
# Only ever replace a LINK, the same rule `hooks/lib/guard-root.sh` applies to an install: a real directory
# there is somebody's tree, and `ln -sfn` would quietly put the link INSIDE it.
#
# NEVER FATAL, the same rule every other auxiliary step here follows. `set -e` is on and the flip is two
# lines below, so a failing `ln` would abort with a freshly built slot that `current` never points at and
# no `.last-sync` written — leaving a live root looking prunable. The link's absence is only the status
# quo; losing the flip is worse than anything the link buys.
if [ ! -d "$TARGET/node_modules" ] || [ -L "$TARGET/node_modules" ]; then
  ln -sfn "$DATA_ROOT/cli-deps/node_modules" "$TARGET/node_modules" || true
fi

# Stamped only when the source was the SAME clean commit before and after the copy, AND the slot provably holds
# it. A tree edited while it was being copied yields a snapshot HEAD does not describe, and a slot something
# deleted from mid-copy is short of files; stamped, either would be served by every skip until HEAD moved.
# Unstamped, the next boot simply builds again.
if [ -n "$STAMP" ] && [ "$(source_stamp)" = "$STAMP" ] && slot_matches_source; then
  printf '%s\n' "$STAMP" > "$TARGET/$STAMP_NAME" || true
fi

if tree_runs_its_hooks "$TARGET"; then
  ln -sfn "$target_slot" "$CURRENT_LINK"
elif tree_runs_its_hooks "$CURRENT_LINK"; then
  echo "plugin-mirror-sync: $target_slot is missing or differs from the source in scripts/hook.sh, scripts/pretooluse.sh or a library they source, so current stays on the tree it names and the next boot builds again" >&2
else
  # The tree `current` names is short of them too — a slot an older commit built, before one was required. The root
  # carries all of them by construction, so it is the seed again until a build completes. Said only once the link
  # provably names a runnable tree: a replacement that failed leaves the short one, and claiming recovery over it
  # would hide that every hook in the seat still exits 127.
  if ln -sfn "$ROOT" "$CURRENT_LINK" 2>/dev/null && tree_runs_its_hooks "$CURRENT_LINK"; then
    echo "plugin-mirror-sync: $target_slot and the tree current names both miss or differ from the source in scripts/hook.sh, scripts/pretooluse.sh or a library they source, so current is re-seeded to the plugin root" >&2
  else
    echo "plugin-mirror-sync: $target_slot and the tree current names both miss or differ from the source in scripts/hook.sh, scripts/pretooluse.sh or a library they source, and current could not be re-seeded to the plugin root — every hook in this seat stays unrunnable until a boot can write $CURRENT_LINK" >&2
  fi
fi
: > "$MIRROR_ROOT/.last-sync"

# The flip is what other roots were waiting on; everything below touches only this root.
rm -rf "$COPY_LOCK"
COPY_LOCK_HELD=""

# The earlier unkeyed path, re-pointed at what this root just built. See LEGACY_CURRENT_LINK above: it is a
# symlink to a symlink, so it costs nothing and it is last-boot-wins exactly as it always was. A seat whose
# frozen commands name it is no worse off than before this change, and a seat whose `hooks.json` is keyed
# never reads it.
ln -sfn "by-root$MIRROR_KEY/current" "$LEGACY_CURRENT_LINK"

# After the flip, never before: the link has to name a tree that already exists.
point_path_shim

# LAST, because everything above it is what a session actually needs and this is only disk. The hook is
# killed at the declared 60s (`hooks/hooks.json`, through `scripts/hook.sh`), and a kill takes every step
# AFTER the one it lands in — so while the prune sat here in the middle, a slow sweep cost the boot its
# path shim as well as its disk. MEASURED: `plugin-mirror-sync.sh` ending at 60158/60238/60079
# ms in live `hook_cancelled` records (`src/devLint/hookBounded.ts`'s header). Bounding the walk is what
# fixed the 72s; putting the prune last is what keeps a future slow step — 63 stale roots at 154 MiB each
# is a real `rm -rf` — from ever being able to reach the shim again.
prune_stale_root_mirrors
