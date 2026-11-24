#!/usr/bin/env bash
# THE `PreToolUse` hook shim — one process for the event, where there were ten.
#
# It resolves the guard root exactly as the ten shims it replaces did (fleet policy runs from the INSTALLED
# plugin, never the session's own branch — hooks/lib/guard-root.sh), takes its OWN mirrored tree when no
# root that resolver knows about carries the entry, then runs `hooks/pretooluse.ts`'s logic by the cheapest
# route available:
#
#   1. the root's CURRENT GENERATION under $ROOT/.hook-build/, on plain `node`, when its launcher proves every
#      file the build read is unchanged — any root, dogfood checkout or install
#   2. a versioned install's unsplit bundle at $ROOT/.hook-build/pretooluse.mjs, on plain `node`
#   3. failing both, `tsx` over the TypeScript, exactly as before
#
# MEASURED at a load of 6–9, median of seven — this is the whole reason the generation exists:
#
#   tsx hooks/pretooluse.ts                    569–712 ms
#   node over the code-split generation        220–290 ms
#   node over the unsplit install bundle       2,317 ms (it inlines every dynamic import: 9.2 MB to parse)
#   a stale generation's miss, before tsx      50–75 ms
#
# Repro: `src/admit/hookBundleBuild.ts`'s header. THE INCIDENT IT ENDS: a supervising seat lost ten Bash
# calls in a row to "killed after 13s/14s/15s without a verdict" while a local lap held the machine at
# load 20 with swap filling. No seat runs a marketplace install, so every seat ran route 3 on every call — two
# node processes and some thousand module loads through tsx's loader thread — and that boot is what starved.
#
# FRESHNESS is exact, not inferred from a path: the launcher compares each input's stat to the stamp taken at
# build time (`src/admit/hookBundleManifest.ts`), one stat per file, 17 ms for the whole set. A dogfood seat
# that edits a guard therefore runs `tsx` over the edit on its next call and the generation the miss rebuilt
# on the call after — it never answers with code its tree no longer carries. A miss never waits for a build;
# see `launch_generation_build` below.
#
# RESOLUTION: `--packages=external` leaves every bare import (zod, neverthrow, the Slack SDK) resolving at
# RUNTIME, and node resolves those from the importing FILE's own directory upward — not from the cwd. Inside
# the root, $ROOT/node_modules is a few levels up, and guard-root.sh has already made sure it is
# there and matches the install's manifests. A bundle anywhere else would resolve against whatever happened
# to sit above IT, which is how you get a guard silently running a different tree's zod.
#
# BOUNDED BY US, not only by `hooks.json`'s timeout — `hooks/lib/bounded-run.sh` carries why the harness's
# own 20 is not enough on its own. A spent budget ends the call with `give_up_code spent`, below.
#
# THE BUDGET IS THE WHOLE SHIM'S WALL CLOCK, and it is `$SECONDS` rather than a marker set somewhere in the
# file, because bash zeroes `$SECONDS` at shell start: there is no line to misplace and no prologue outside
# it. MEASURED — the seven `PreToolUse:Bash` calls the acme-admin seat lost to the harness
# (`hook_cancelled`, `timedOut: true`, `timeoutMs: 20000`, 20043–20163 ms) were exactly this. The clock used
# to start at the `PAYLOAD=` line, so the root resolution above it — three sourced libraries and
# `resolve_guard_root`'s ten forks of `grep`/`awk`/`sed`/`diff` — was charged to nobody. Worst case after
# that line was 15 + a floored 1 + 2 of escalation = 18, so any prologue past two seconds handed the ending
# to the harness and our line never printed. Repro the prologue's cost on any checkout:
#
#   /usr/bin/time -p bash -c 'source hooks/lib/resolve-root.sh; source hooks/lib/guard-root.sh;
#     resolve_guard_root "$(resolve_plugin_root "$PWD")" hooks/pretooluse.ts' >/dev/null
#
# 0.17–0.55 s at a 1-minute load of 24.6; the incident window ran at 146.
#
# THE FLOOR IS GONE with it. A step with nothing left now gives up rather than starting one more bounded
# step past the ceiling — which is what this file's own "a spent budget is not a verdict" already said.
#
# WHEN IT CANNOT DECIDE, the ending turns on why, and `give_up_code` below is the whole rule. A SPENT BUDGET
# fails CLOSED (exit 2) for every guarded tool; a shim that can run nothing at all — no runtime, no tree
# carrying the entry — fails OPEN for all but a browser call and a context holding no current delivery of the owner's
# profile, because that failure is persistent and closing on it would refuse every command for the seat's
# life; the bash recovery lane holds that context and delivers the owner's profile itself, so it recovers too. The
# browser has always failed closed: `scripts/pretooluse-browser-door-guard.sh` was the one shim of the ten
# that did, its matcher browser-only so the whole cost is that browser calls stop.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../hooks/lib/resolve-root.sh
source "$SELF_DIR/../hooks/lib/resolve-root.sh"
# shellcheck source=../hooks/lib/guard-root.sh
source "$SELF_DIR/../hooks/lib/guard-root.sh"
# shellcheck source=../hooks/lib/bounded-run.sh
source "$SELF_DIR/../hooks/lib/bounded-run.sh"
# shellcheck source=../hooks/lib/profile-delivered.sh
source "$SELF_DIR/../hooks/lib/profile-delivered.sh"

# The launcher's home, before anything reads one: this shim starts node WITHOUT `bin/slopweaver`, so a home named only
# in `~/.config/slopweaver/env` would otherwise put every gate below in `~/.slopweaver` while the launcher's verbs
# write the configured one — the `profile-held` hold reading a marker its own reload never wrote.
profile_home_export

# The read-side row (`./pretooluse-protected-paths.sh`) runs ONE tripwire over `Read`, `Grep`, `Glob` and
# `NotebookEdit`, and asks every undecided ending to RELEASE: no door covers those tools and the profile hold never
# sees them, so refusing one on a loaded machine would stop a session to protect against nothing a gate judged.
# Unset once read, so nothing the dispatcher spawns inherits it.
READ_ROW="${SLOPWEAVER_PRETOOLUSE_READ_ROW:-0}"
unset SLOPWEAVER_PRETOOLUSE_READ_ROW

ENTRY="hooks/pretooluse.ts"
# The shim's OWN tree, held in a name because it is used twice: as `resolve_plugin_root`'s fallback, and
# as the last rung below. It always carries the entry, because the entry was copied into the mirror beside
# this very file.
SELF_ROOT="$(cd "$SELF_DIR/.." && pwd)"
ROOT="$(resolve_guard_root "$(resolve_plugin_root "$SELF_ROOT")" "$ENTRY")"
# `${HOME:-}`, never a bare `$HOME`: under `set -u` an unset one ended the dispatcher with 1 before any check ran.
DATA="${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-${HOME:-}/.claude/plugins/data/slopweaver}}"

# THE LAST RUNG, and it fires for exactly one shape: a seat whose `$PLUGIN_ROOT` still names a real
# directory that does not carry the folded entry — a seat booted before the ten `hooks/pretooluse-*.ts`
# became one. `resolve_guard_root` now answers empty there rather than a root it never checked, and the
# tree this shim was copied into is a better answer than nothing: it is the mirror a live seat is already
# reaching, which is either that seat's own content (a keyed mirror) or a fresher root's (the legacy
# unkeyed link). It never displaces an INSTALL — the install was already rejected before this line — so
# the fleet-policy order `hooks/lib/guard-root.sh` exists to enforce is untouched.
if [ -z "$ROOT" ] && [ -f "$SELF_ROOT/$ENTRY" ]; then
  ROOT="$SELF_ROOT"
fi

# ONE budget, spent across every step INCLUDING the prologue above, so the total (15, plus a final step's
# two-second escalation) stays well under `hooks.json`'s declared 30 however many of them run. The gap to 30
# is runway for a starved machine, never more budget: `hooks/lib/bounded-run.sh`'s ladder says why.
BUDGET="$(hook_budget_seconds)"

# @returns what is left of the budget, in seconds, or 0 when it is spent — `$SECONDS` is this shell's own
#   wall clock, so the answer covers the resolution above as well as the steps below
budget_left() {
  local left=$((BUDGET - SECONDS))
  [ "$left" -gt 0 ] || left=0
  printf '%s\n' "$left"
}

# The payload is read ONCE here and replayed on stdin to whatever runs, because deciding the fail policy
# below needs to look at it and a pipe cannot be read twice. Bounded, because this read is the shim's own
# hang site: a harness that writes the payload and never closes the pipe held the whole call here, with no
# hook process for anything to kill.
PAYLOAD_BUDGET="$(budget_left)"
PAYLOAD=""
PAYLOAD_STATUS=0
if [ "$PAYLOAD_BUDGET" -gt 0 ]; then
  PAYLOAD="$(read_payload_bounded "$PAYLOAD_BUDGET" pretooluse)"
  PAYLOAD_STATUS=$?
else
  PAYLOAD_STATUS=1
fi

# The tool this call names, read from the payload's own `"tool_name"` field with bash's regex match — no
# fork, and never a substring anywhere in the bytes: a `Bash` command that merely MENTIONS a browser tool is a
# `Bash` call. The harness writes `tool_name` before `tool_input`, so the leftmost match is the real field,
# and a JSON-escaped copy inside a command (`\"tool_name\"`) cannot match at all. A truncated read still
# answers: `cat` copies as it reads, so the bytes that arrived before it was killed are in $PAYLOAD.
TOOL_NAME=""
if [[ "$PAYLOAD" =~ \"tool_name\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]]; then
  TOOL_NAME="${BASH_REMATCH[1]}"
fi

# What this shim exits when it cannot reach a verdict, which turns on WHY it could not.
#
# A SPENT BUDGET is transient — the machine was too loaded to decide this one call — so it fails CLOSED for
# every tool a door gate covers: `Bash`, `Monitor` and `Artifact` (the admit door, the poll gate, the script
# gate) and `TaskOutput` (the poll gate), plus the browser. Releasing those is exactly the defect this split
# ends: MEASURED, `slopweaver perf` read 101 `PreToolUse:Bash` calls over one window that spent the
# whole 15s and ran with NO verdict from any gate, the chair worst with 26. A refused call costs one retry and
# says why; a released one ran past the one-door rule in silence. `Edit`, `Write`, `Agent` and `Task` are
# refused too, since the `profile-held` hold the budget never reached covers them, and a check cheap enough to
# run here cannot tell a current delivery from one a compaction outdated (a session does nothing rather than
# act misaligned for the owner). A read that delivered no tool name at all is judged
# closed too. The cost of each is one retry, which a node gate then judges.
#
# A PERSISTENT failure — no tree carries the entry, no runtime resolved — would refuse every call for the
# seat's whole life if it failed closed, so it stays OPEN for everything but the browser, whose matcher is
# browser-only and whose door has always failed closed — and for a context holding no CURRENT delivery of the owner's
# profile, which the bash recovery lane (`hooks/lib/profile-delivered.sh`) holds and hands that profile from the
# copy on disk, marking it behind the delivery, so the retry goes through with nobody's hand on it.
#
# @param $1 `spent` for a spent budget, `persistent` for a shim that cannot run the gate at all
give_up_code() {
  if [ "$READ_ROW" = 1 ]; then
    printf '0\n'
    return
  fi
  if [ "$1" = spent ]; then
    printf '2\n'
    return
  fi
  case "$TOOL_NAME" in
    mcp__claude-in-chrome__*) printf '2\n' ;;
    *) printf '0\n' ;;
  esac
}

# @param $1 `spent` or `persistent`, as give_up_code takes it
# @param $2 what went wrong, named in the refusal
give_up() {
  local code
  code="$(give_up_code "$1")"
  if [ "$READ_ROW" = 1 ]; then
    echo "pretooluse: the protected-path guard could not judge this ${TOOL_NAME:-unnamed} call ($2) — released, as the read-side row always is" >&2
    exit 0
  fi
  if [ "$code" = 0 ]; then
    profile_delivery_current "$PAYLOAD" && exit 0
    # The by-hand reload goes through as node's hold lets it, so a seat with no copy on disk can still write one.
    profile_is_reload "$PAYLOAD" && exit 0
    # A machine never configured has no profile to lose, so it is not held here either.
    profile_first_boot_admit "$PAYLOAD" && exit 0
    echo "pretooluse: no gate can run on this ${TOOL_NAME:-unnamed} call ($2), and this context holds no current delivery of the owner's profile — holding it" >&2
    profile_hold_with_copy "$PAYLOAD"
    exit 2
  fi
  # On a refusing ending too: a spent budget with no copy on disk would otherwise hold the one command that writes it,
  # every time. Exact, so nothing chained to it rides along.
  profile_is_reload "$PAYLOAD" && exit 0
  case "$TOOL_NAME" in
    mcp__claude-in-chrome__*)
      echo "pretooluse: cannot run the browser-door guard ($2) — refusing the browser call rather than skipping the gate" >&2
      ;;
    *)
      echo "pretooluse: no gate reached a verdict on this ${TOOL_NAME:-unnamed} call ($2) — refusing it rather than running it past the one-door, poll, script and profile gates; run it again" >&2
      ;;
  esac
  # Every hold delivers, the browser's included: a load that spends every retry's budget, or a browser call on a seat
  # that can run no gate, would otherwise refuse a context lacking the owner's profile forever without ever handing it over.
  # A first boot has no profile to deliver or to wait for, so its refusal says only why it
  # was refused, never that a profile load is what it waits on.
  profile_delivery_current "$PAYLOAD" || profile_first_boot || profile_hold_with_copy "$PAYLOAD"
  exit "$code"
}

if [ "$PAYLOAD_STATUS" != 0 ]; then
  if [ "$PAYLOAD_BUDGET" -gt 0 ]; then
    give_up spent "stdin never closed inside the ${BUDGET}s budget"
  else
    give_up spent "the ${BUDGET}s budget was spent resolving a root before the payload could be read"
  fi
fi

# NO ROOT HERE CARRIES THE ENTRY — the install was rejected, `$PLUGIN_ROOT` does not have it, and neither
# does this shim's own tree. Give up on this shim's own terms, which is the whole point of the check: run
# `tsx` on a path that is not there and node exits 1, non-blocking, taking every guard in the session with
# it AND skipping the fail-CLOSED browser ending below. Measured in hooks/lib/guard-root.sh.
[ -n "$ROOT" ] || give_up persistent "no tree here carries $ENTRY"

TSX="$ROOT/node_modules/.bin/tsx"
[ -x "$TSX" ] || TSX="$DATA/cli-deps/node_modules/.bin/tsx"

# THE CURRENT GENERATION, for EVERY root, dogfood checkout and install alike: a code-split build of this very
# entry under `$ROOT/.hook-build/`, whose launcher stats every file the build read and runs the gate only on an
# exact match (`src/admit/hookBundleManifest.ts`). Only a VERDICT is returned as is: 0 or 2, the only codes the
# gate exits by its own hand (every check, every `onUnhandledError`, the dispatcher and the entry's fail-closed
# handler — `src/admit/preToolUseDispatch.ts`), and the 2 the bounded runner gives a spent budget. Anything else
# falls through to the routes below, which re-feed the same `$PAYLOAD` from the variable: the launcher's 75 ("this
# generation is stale"), and the 1 or 128+ of a process that died before any gate decided — a launcher chunk gone,
# a kill that was not the budget's — either of which, returned, Claude Code would read as no block. `current` is read with
# the `read` builtin and must name a `generation-*` directory holding a launcher, so a torn or foreign line is a
# miss, never a path handed to node.
HOOK_BUILD="$ROOT/.hook-build"
GENERATION=""
if [ -f "$HOOK_BUILD/current" ]; then
  IFS= read -r GENERATION <"$HOOK_BUILD/current" 2>/dev/null || true
fi
if ! [[ "$GENERATION" =~ ^generation-[0-9]+-[0-9a-f]+$ ]] || [ ! -f "$HOOK_BUILD/$GENERATION/launch.mjs" ]; then
  GENERATION=""
fi

if [ -n "$GENERATION" ] && command -v node >/dev/null 2>&1; then
  GENERATION_BUDGET="$(budget_left)"
  [ "$GENERATION_BUDGET" -gt 0 ] || give_up spent "the ${BUDGET}s budget was spent before the gate could run"
  # `pipefail` off around the dispatch for the reason the final dispatch below gives.
  set +o pipefail
  printf '%s' "$PAYLOAD" | run_hook_bounded "$GENERATION_BUDGET" "$(give_up_code spent)" pretooluse \
    node "$HOOK_BUILD/$GENERATION/launch.mjs" "$@"
  GENERATION_STATUS="${PIPESTATUS[1]}"
  set -o pipefail
  case "$GENERATION_STATUS" in
    0 | 2) exit "$GENERATION_STATUS" ;;
  esac
fi

# A MISS NEVER WAITS FOR A BUILD. This call runs on the routes below exactly as it always did, and ONE builder
# (`hooks/pretooluseBuild.ts`) is launched beside it: niced, double-forked out of this shim's process tree so the
# bounded runner's tree kill never reaches it, every stream on `/dev/null` so it holds no pipe the harness reads.
# A build therefore never spends a verdict's budget, however loaded the machine. Two cheap gates keep a burst of
# misses from starting a burst of builders: a build lock younger than two minutes means one is running, and a
# failure marker younger than two minutes means the last build of this tree failed — a broken tree is rebuilt
# at most once in that window, never on every call. A tree without the builder (an install predating it), or
# one it cannot write, never launches one.
#
# @returns 0 always; a launch that cannot start costs this call nothing
launch_generation_build() {
  [ -f "$ROOT/hooks/pretooluseBuild.ts" ] && [ -x "$TSX" ] || return 0
  # A tree it could never write to (a read-only install) would fail every launch before it could leave a marker.
  if [ -e "$HOOK_BUILD" ]; then
    [ -d "$HOOK_BUILD" ] && [ -w "$HOOK_BUILD" ] || return 0
  else
    [ -w "$ROOT" ] || return 0
  fi
  local recent
  for recent in "$HOOK_BUILD/build.lock" "$HOOK_BUILD/build.failed"; do
    [ -e "$recent" ] || continue
    [ -z "$(find "$recent" -maxdepth 0 -mmin -2 2>/dev/null)" ] || return 0
  done
  (nice -n 10 "$TSX" "$ROOT/hooks/pretooluseBuild.ts" "$ROOT" </dev/null >/dev/null 2>&1 &)
  return 0
}
launch_generation_build

# A versioned install, and nothing else, gets the unsplit bundle when no generation answered. `pwd -P` on BOTH sides, so neither a symlinked
# install nor a config dir reached through a link (darwin's `/var` is `/private/var`) is mistaken for a
# dogfood checkout — a mismatch there skipped the bundle, and with it every check below, in silence.
ROOT_REAL="$( (cd "$ROOT" 2>/dev/null && pwd -P) || true)"
CONFIG="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}"
CONFIG_REAL="$( (cd "$CONFIG" 2>/dev/null && pwd -P) || true)"
[ -n "$CONFIG_REAL" ] || CONFIG_REAL="$CONFIG"
BUNDLE=""
case "$ROOT_REAL" in
  "$CONFIG_REAL/plugins/cache/"*) BUNDLE="$ROOT_REAL/.hook-build/pretooluse.mjs" ;;
esac

ESBUILD="$ROOT/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || ESBUILD="$DATA/cli-deps/node_modules/.bin/esbuild"

# A bundle `node` can run for a verdict: a REGULAR file, and a non-empty one. `node` over a zero-byte file
# exits 0 with no verdict, and `-s` alone is true of a directory, which `node` refuses with
# exit 1 — both are misses, never a gate to run.
#
# @param $1 the bundle's path
# @returns 0 when it is one
bundle_ready() {
  [ -f "$1" ] && [ -s "$1" ]
}

# Build a tree's entry, and say whether it built. esbuild walks every import the entry reaches, so a build
# that succeeds is the one cheap proof that the tree carries its whole relative import closure. With no
# esbuild there is no proof either way, so the install is never JUDGED without one: it runs on `tsx` exactly
# as it always did (`guard-root.sh` checks only that `tsx` is there, and a whole install must not lose its
# verdict to a missing optimiser).
#
# Written to a temp file and `mv`d into place — concurrent seats all miss the same key at once after an
# update, and a half-written bundle is the `mirror/current` defect in a smaller box.
#
# @param $1 the tree whose `$ENTRY` is built
# @param $2 where the bundle lands, or empty to prove the tree builds and keep nothing
# @returns 0 when it built
build_entry() {
  local source="$1" out="$2" tmp
  [ -x "$ESBUILD" ] || return 1
  if [ -z "$out" ]; then
    "$ESBUILD" "$source/$ENTRY" --bundle --platform=node --format=esm --target=node24 \
      --packages=external --log-level=silent >/dev/null 2>&1
    return
  fi
  # Something that is not a file at the bundle's path is never replaced: `mv` would drop the build INSIDE a
  # directory there, one more file per call, and the caller proves the tree with a stdout build instead.
  [ ! -e "$out" ] || [ -f "$out" ] || return 1
  mkdir -p "$(dirname "$out")" 2>/dev/null || true
  tmp="$out.$$.tmp"
  if "$ESBUILD" "$source/$ENTRY" --bundle --platform=node --format=esm --target=node24 \
    --packages=external --log-level=silent --outfile="$tmp" >/dev/null 2>&1; then
    mv -f "$tmp" "$out" 2>/dev/null || rm -f "$tmp" 2>/dev/null || true
    bundle_ready "$out"
    return
  fi
  rm -f "$tmp" 2>/dev/null || true
  return 1
}

# The marketplace clone an install was copied FROM, but only while that clone still sits on the install's
# own commit: a marketplace install's directory is named for the first characters of the commit it holds,
# so the clone's HEAD has to begin with that name. A clone that has moved on is newer policy than the
# install, and one under a semver-named install never matches at all.
#
# @returns the clone's path on stdout, or nothing
install_source_clone() {
  local rest marketplace version clone head
  rest="${ROOT_REAL#"$CONFIG_REAL/plugins/cache/"}"
  marketplace="${rest%%/*}"
  version="${ROOT_REAL##*/}"
  clone="$CONFIG_REAL/plugins/marketplaces/$marketplace"
  [ -n "$marketplace" ] && [ -f "$clone/$ENTRY" ] || return 0
  head="$(git -C "$clone" rev-parse HEAD 2>/dev/null || true)"
  [ -n "$head" ] && [ "${head:0:${#version}}" = "$version" ] || return 0
  # A clean worktree too: a HEAD names a commit, and only clean files ARE that commit's policy.
  [ -z "$(git -C "$clone" status --porcelain 2>/dev/null || printf 'unreadable')" ] || return 0
  printf '%s\n' "$clone"
}

# Build on a miss: esbuild does this in ~20ms, so the first call after a plugin update pays it once and
# every call after it is a single `bundle_ready` — a non-empty regular file, not merely something present.
#
# A FAILED BUILD IS A VERDICT ON THE INSTALL, not only a missed optimisation: `tsx` over the same tree dies
# the same way, exit 1, which Claude Code does not treat as a block — every guard in the session off.
# MEASURED: Claude Code's own auto-update left a cache install under `cache/slopweaver-dev/slopweaver/`
# with 61 of `src/`'s 106 entries, `src/lib` among those missing, and every seat booted after it printed
# `node:internal/modules/esm/resolve:272 … Cannot find module '…/src/lib/errorMessage.js'` on every Bash and
# Write call. `guard-root.sh` had checked the entry FILE was there, which it was.
#
# So the install's bundle is built from the marketplace clone instead, when that clone is on the install's
# commit — the same policy from a tree the copy did not touch, cached exactly where the install's own bundle
# would sit, so its bare imports still resolve from the install's verified deps and every later call is the
# usual `bundle_ready`. Failing that, a tree is taken only if it BUILDS: the session's own root, then this shim's
# tree, never the broken install again. Proving each one matters because neither is independent of the
# install by construction — a seat whose plugin root IS the install has its mirror copied from that same
# partial tree. Repro: src/__tests__/subprocess/admit/guardRoot.test.ts § "an install that cannot build".
#
# A bundle that could not be WRITTEN is not an install that cannot BUILD — an unwritable install directory
# fails the first `build_entry` while its source is whole — so the install is judged by a second build to
# stdout, and one that passes runs on `tsx` exactly as on main.
if [ -n "$BUNDLE" ] && ! bundle_ready "$BUNDLE" && [ -x "$ESBUILD" ] && ! build_entry "$ROOT" "$BUNDLE" &&
  ! build_entry "$ROOT" ""; then
  CLONE="$(install_source_clone)"
  if [ -z "$CLONE" ] || ! build_entry "$CLONE" "$BUNDLE"; then
    BROKEN="$ROOT_REAL"
    ROOT=""
    BUNDLE=""
    for CANDIDATE in "$(resolve_plugin_root "$SELF_ROOT")" "$SELF_ROOT"; do
      [ -f "$CANDIDATE/$ENTRY" ] || continue
      [ "$( (cd "$CANDIDATE" 2>/dev/null && pwd -P) || true)" != "$BROKEN" ] || continue
      # Its OWN deps, as `guard-root.sh` asks of an install: the build proof leaves bare packages external,
      # and `tsx` resolves them from the tree it runs, never from wherever the `tsx` binary sits.
      [ -x "$CANDIDATE/node_modules/.bin/tsx" ] || continue
      build_entry "$CANDIDATE" "" || continue
      ROOT="$CANDIDATE"
      break
    done
    [ -n "$ROOT" ] || give_up persistent "the install at $BROKEN cannot build $ENTRY and no other tree here builds it"
    TSX="$ROOT/node_modules/.bin/tsx"
  fi
fi

# What is left after the payload read and the bundle build. NOT floored: a shim that has spent its whole
# budget gives up here rather than starting one more bounded step, whose own escalation would then carry
# the total past the declared timeout and hand the ending to the harness.
BUDGET_LEFT="$(budget_left)"
[ "$BUDGET_LEFT" -gt 0 ] || give_up spent "the ${BUDGET}s budget was spent before the gate could run"

# `pipefail` is OFF for the dispatch, and `PIPESTATUS` read instead: the gate's verdict is the only status
# that may reach the harness, and a hook that exits 0 before `printf` finishes leaves printf on SIGPIPE at
# 141 — which pipefail would hand up as the hook's answer.
set +o pipefail

# "$@" is FORWARDED, and it is the whole of what `--only <id>` needs to work: the ten compatibility shims
# in `scripts/pretooluse-<id>.sh` are this script with one argument. Dropping it was silent — every shim ran
# the entire registry and every verdict still looked right, while a second poll-gate pass over one tool call
# refused the call the first pass had recorded.
if [ -n "$BUNDLE" ] && bundle_ready "$BUNDLE" && command -v node >/dev/null 2>&1; then
  printf '%s' "$PAYLOAD" | run_hook_bounded "$BUDGET_LEFT" "$(give_up_code spent)" pretooluse node "$BUNDLE" "$@"
  exit "${PIPESTATUS[1]}"
fi

if [ -x "$TSX" ]; then
  printf '%s' "$PAYLOAD" | run_hook_bounded "$BUDGET_LEFT" "$(give_up_code spent)" pretooluse "$TSX" "$ROOT/$ENTRY" "$@"
  exit "${PIPESTATUS[1]}"
fi

give_up persistent "no runtime resolved"
