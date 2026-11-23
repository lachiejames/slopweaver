#!/usr/bin/env bash
# THE hook entry point. Every command in `hooks/hooks.json` is this script, and `hook-bounded` in
# `yarn lint` is what keeps that true of the next entry somebody adds.
#
#   [SLOPWEAVER_HOOK_GIVE_UP=0|2] scripts/hook.sh <declared-timeout-seconds> <label> <target> [args...]
#
# WHY IT EXISTS. `hooks/lib/bounded-run.sh` bounds a STEP a shim chose to bound, so a hook was covered only
# where somebody remembered to cover it — and `slopweaver perf` found the two
# shapes that leaves. Read straight off the `hook_cancelled` records the transcripts carry:
#
#   grep -h '"hook_cancelled"' ~/.claude/projects/*/<session>.jsonl
#
#   * `scripts/plugin-mirror-sync.sh` ended at 60158/60238/60079 ms against its declared 60000, with no
#     `stderr` at all — a `SessionStart` entry is a bare command with no shell in front of it, so nothing
#     ever sourced a bound. The same was true of `hooks/handover-run.sh`, `hooks/profile-context.sh`,
#     `scripts/plugin-install-deps.sh` and `bin/slopweaver memory hook`, which `docs/hooks/registered-and-bounded.md` had knowingly
#     written off as "uncovered" on a cost argument — one `bash` fork against the ~280 ms `tsx` boot it was
#     protecting, which is not the trade that paragraph described.
#   * `scripts/pretooluse.sh` ended at 20043–20163 ms against its declared 20000 — a shim that IS bounded
#     and still lost the race, because its budget clock started after a ten-fork prologue. That half is
#     fixed in the shim itself, and reaches seats booted before this landed: their `hooks.json` freezes the
#     PATH they call, while the mirror keeps rewriting what is AT it.
#
# The ladder this sits in, and why the envelope runs the target as a sibling rather than arming a watchdog
# over its own tree (bash 3.2 has no `$BASHPID`), is at the foot of `hooks/lib/bounded-run.sh`.
#
# IT NEVER RENDERS A VERDICT. A kill cannot read a payload, so the payload-aware fail-CLOSED ending stays
# with `scripts/pretooluse.sh`'s inner bound — which is the whole reason that layer survives rather than
# being folded in here. What it CAN do is end the call the way its REGISTRATION says: `hooks.json` prefixes
# both `PreToolUse` rows with `SLOPWEAVER_HOOK_GIVE_UP=2`, so a call the envelope ends there is refused
# rather than released, and every other entry releases as before.
#
# ITS OWN PROLOGUE IS TWO STATEMENTS, and that is the point of the file: a parameter expansion for the
# directory (no fork — `$(cd … && pwd)` is one, and the bound would be behind it) and one `source`. That is
# the irreducible amount of work that cannot be inside the thing it arms.
set -uo pipefail

case "${BASH_SOURCE[0]}" in
  */*) SELF_DIR="${BASH_SOURCE[0]%/*}" ;;
  *) SELF_DIR="." ;;
esac
# shellcheck source=../hooks/lib/bounded-run.sh
source "$SELF_DIR/../hooks/lib/bounded-run.sh"

USAGE="hook.sh: usage: [SLOPWEAVER_HOOK_GIVE_UP=0|2] hook.sh <declared-timeout-seconds> <label> <target> [args...]"

# The envelope's ending is an ENVIRONMENT PREFIX on the row rather than an argument, because both halves of
# a rollout must keep running every check. A seat reads `hooks.json` once at boot while the mirror rewrites
# this file under it, so either side can be the older one: an old row (`hook.sh 20 pretooluse …`) reaches
# this file with nothing set and releases as it always did, and a new row reaching an OLD copy of this file
# has its prefix ignored and still runs the dispatcher. An argument would have been read there as the label,
# with `pretooluse` taken for a missing target — every gate gone, one stderr line per call. MEASURED
# against main with the argument spelling: exit 0 after 1s, "has no executable at
# pretooluse". Unset once read, so nothing the target spawns inherits a policy meant for this one row.
#
# A misspelt policy is a usage error that releases rather than a guess, because a wrong guess here makes every
# call through the entry blocking.
ENVELOPE_GIVE_UP="${SLOPWEAVER_HOOK_GIVE_UP:-0}"
unset SLOPWEAVER_HOOK_GIVE_UP
case "$ENVELOPE_GIVE_UP" in
  0 | 2) ;;
  *)
    echo "hook.sh: SLOPWEAVER_HOOK_GIVE_UP=$ENVELOPE_GIVE_UP is not a policy this entry point knows (0 releases, 2 refuses) — this hook ran no check at all" >&2
    echo "$USAGE" >&2
    exit 0
    ;;
esac

if [ "$#" -lt 3 ]; then
  echo "$USAGE" >&2
  exit 0
fi

DECLARED="$1"
LABEL="$2"
shift 2

# A target that is not there fails OPEN and says so, rather than letting the shell's own 127 reach the
# harness as a hook error with no explanation — 127 is the exact code a past mirror outage produced
# fleet-wide with no symptom on any seat (`docs/hooks/mirrors-and-failure-policy.md` § One mirror per plugin root). Inside the envelope
# rather than before it: a `[ -x ]` against a stale network path is itself a hang site, and a bound that
# starts after the first thing that can hang is the defect this file closes.
#
# It releases ON A REFUSING ROW TOO, and that is the same split `scripts/pretooluse.sh`'s `give_up_code`
# makes: a spent budget is transient and refuses, a target that is not there is PERSISTENT, and refusing it
# would block every Bash call on the seat until the mirror is repaired by a session that cannot run a command.
# Except for a context holding no CURRENT delivery of the owner's profile, which the `profile-held` check the missing
# target never ran would have held: a refusing row reads the payload, and the bash recovery lane
# (`hooks/lib/profile-delivered.sh`) holds that context and hands it the owner's profile from the copy on disk, marking
# it behind the delivery so the retry goes through; with the lane's own file missing it refuses outright (a
# session does nothing rather than act misaligned for the owner) — a tree `scripts/plugin-mirror-sync.sh`
# never makes current (`HOOK_ENTRY_FILES`), so only a hand deleting the file reaches it. The by-hand reload is let through as node's
# hold lets it through, so a seat with no copy on disk can still write one. A releasing row reads nothing.
run_target() {
  if [ -x "$1" ]; then
    "$@"
    return $?
  fi
  echo "hook.sh: $LABEL has no executable at $1 — this hook ran no check at all" >&2
  [ "$ENVELOPE_GIVE_UP" = 2 ] || return 0
  local payload
  payload="$(cat)"
  if [ ! -f "$SELF_DIR/../hooks/lib/profile-delivered.sh" ]; then
    echo "hook.sh: and no profile delivery reader sits beside it, so the call is refused rather than run by a context that may lack the owner's profile" >&2
    return 2
  fi
  # shellcheck source=../hooks/lib/profile-delivered.sh
  source "$SELF_DIR/../hooks/lib/profile-delivered.sh"
  profile_home_export
  # A machine never configured has no profile to lose, so it is not held here either.
  if profile_delivery_current "$payload" || profile_is_reload "$payload" || profile_first_boot_admit "$payload"; then
    return 0
  fi
  echo "hook.sh: and this context holds no current delivery of the owner's profile, so the call is held rather than run without it" >&2
  profile_hold_with_copy "$payload"
}

HOOK_ENVELOPE_KILLED=0
run_hook_enveloped "$DECLARED" "$ENVELOPE_GIVE_UP" "$LABEL" run_target "$@"
STATUS=$?

# A refusing row's KILL still delivers the owner's profile (a machine loaded enough to end every
# dispatcher would otherwise refuse a context lacking it forever, never handing it over). The envelope never read the
# payload, so it cannot name the context or mark it: it prints the copy into the refusal, and the next call a gate
# can judge is held, delivered and marked as usual. Every killed call carries it — the cost of a load that deep.
# Builtins only, started only with a whole second left before the declared timeout, and stopped at that second and at a
# byte cap under a pipe buffer (`profile_print_copy`): a harness timeout RUNS the call, so a delivery that outlived the
# runway would turn this refusal into the release it exists to prevent.
if [ "$HOOK_ENVELOPE_KILLED" = 1 ] && [ "$ENVELOPE_GIVE_UP" = 2 ] && [ "$SECONDS" -lt "$((DECLARED - 1))" ] &&
  [ -f "$SELF_DIR/../hooks/lib/profile-delivered.sh" ]; then
  # shellcheck source=../hooks/lib/profile-delivered.sh
  source "$SELF_DIR/../hooks/lib/profile-delivered.sh"
  profile_home_export
  profile_print_copy "$((DECLARED - 1))" >&2 || true
fi
exit "$STATUS"
