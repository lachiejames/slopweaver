#!/usr/bin/env bash
# Sourced by `scripts/hook.sh` — the ONE entry point every `hooks/hooks.json` command runs through — and by
# the shims it wraps: the budget a hook holds a tool call for, enforced by US.
#
# `hooks/hooks.json` gives every PostToolUse entry `"timeout": 20` and the PreToolUse pair 30. That number is the
# HARNESS's promise, and it has never been measured for this shape — see the wedge finding,
# where the two seats read as evidence that Claude Code ignores it had in fact never loaded it: a seat runs
# `claude --plugin-dir <its own worktree>` and reads `hooks/hooks.json` ONCE, at boot, so timeouts that
# landed after a seat booted are not in force on it, however early the worktree it booted from wrote them. Repro: `ps -p <pid> -o lstart=,args=` for the seat's `--plugin-dir`, then that worktree's
# reflog. What IS measured is our own side: hook processes alive at 27m, 50m and 2h19m
# (`skills/supervisor/reference/fleet-performance.md`), and two hang sites that produce exactly that —
# `src/lib/readStdin.ts`'s `for await (const chunk of process.stdin)`, which never returns if the writer
# never closes the pipe, and a starved `tsx` boot under a 1-minute load of 146.
#
# So the bound below is deliberately OURS rather than a second copy of the harness's: it kills what the shim
# launched, at a budget under the declared timeout, and lets the shim choose its own give-up code.
#
# WHAT IT CANNOT DO, stated here because the finding turns on it: a call held with NO hook process alive is
# held by something we never launched, and there is nothing for this to kill. That wedge is reported rather
# than released — `slopweaver perf`'s `stuck` grade (`src/live/perf/report.ts`) is its whole remedy. What is
# NO LONGER in that sentence is a hook nobody wrapped: every registered entry is armed by the envelope at the
# foot of this file, and `hook-bounded` in `yarn lint` is what keeps that true of the next entry added.

# How long a hook may run before we kill it, in seconds. Under every tool-call timeout `hooks/hooks.json`
# declares (20, and 30 for PreToolUse), so our line is reached first and the shim gets to choose its exit code
# instead of the harness choosing for it.
HOOK_BUDGET_SECONDS_DEFAULT=15

# @returns the budget in seconds — `SLOPWEAVER_HOOK_BUDGET_SECONDS` when it is a positive integer no larger
#   than the default, else the default. A shim resolves this ONCE and spends it across its phases, so the total
#   stays under the declared timeout however many bounded steps it runs.
#
# The variable NARROWS and never widens (101 `PreToolUse:Bash` calls were measured spending the whole 15s, and
# the budget is never widened with an environment hatch). A slow hook is fixed where it
# is slow; a wider budget only holds every tool call longer before the same non-answer. Tests narrow it to
# spend a budget quickly, which is the one use it keeps.
hook_budget_seconds() {
  local budget="${SLOPWEAVER_HOOK_BUDGET_SECONDS:-}"
  case "$budget" in
    '' | *[!0-9]*) budget="$HOOK_BUDGET_SECONDS_DEFAULT" ;;
  esac
  [ "$budget" -gt 0 ] || budget="$HOOK_BUDGET_SECONDS_DEFAULT"
  [ "$budget" -le "$HOOK_BUDGET_SECONDS_DEFAULT" ] || budget="$HOOK_BUDGET_SECONDS_DEFAULT"
  printf '%s\n' "$budget"
}

# @param $1 the pid whose whole tree gets the signal
# @param $2 the signal name, e.g. TERM
# Signals descendants first: `tsx` spawns a loader child that inherits this hook's stdout, and a surviving
# grandchild holding that pipe is a call still held after its parent is gone (fleetLoad.ts's header has the
# two-process shape measured).
kill_hook_tree() {
  local pid="$1" signal="$2" kid
  for kid in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_hook_tree "$kid" "$signal"
  done
  kill -"$signal" "$pid" 2>/dev/null || true
}

# @param $1 the root of the tree
# @returns every pid in that tree, one per line, root first
# Read the tree ONCE, BEFORE anything is signalled. A descendant is re-parented to init the moment its own
# parent is reaped, and `pgrep -P` then finds nothing — so an escalation that re-walks the tree can only
# ever reach a process that is already gone. MEASURED against a grandchild that ignores TERM:
# `wait` returned as soon as the direct child died, the watchdog was torn down before its KILL, and the
# grandchild was still alive holding the hook's stdout.
hook_tree_pids() {
  local pid="$1" kid
  printf '%s\n' "$pid"
  for kid in $(pgrep -P "$pid" 2>/dev/null || true); do
    hook_tree_pids "$kid"
  done
}

# @param $1 the signal name
# @param $2.. the pids, as captured by hook_tree_pids
signal_pids() {
  local signal="$1" pid
  shift
  for pid in "$@"; do
    kill -"$signal" "$pid" 2>/dev/null || true
  done
}

# The inner bound's TERM→KILL gap, in seconds. Assigned while sourcing, so no environment can widen it; a test
# that needs the early release to beat a gap no load can cross reassigns it after the `source`.
HOOK_BOUNDED_ESCALATION_SECONDS=2

# How often a watchdog asks whether the pids it sent TERM are gone. `/bin/sleep` takes a fraction and bash
# 3.2's `read -t` does not, so each poll is one small fork — paid only on a call already being ended.
HOOK_TREE_POLL_SECONDS=0.1

# @param $1 the escalation in seconds: how long a pid may outlive its TERM before it is sent KILL
# @param $2.. the pids, as captured by hook_tree_pids BEFORE anything was signalled
# TERM every pid, then return the moment none is alive, sending KILL only to those still alive when the
# escalation runs out. Both watchdogs end a hook through this, run from a subshell whose fd 1 and fd 2 are
# already silenced — the timer's reaped `sleep` is reported there, and must never reach a hook's stderr.
#
# WHY IT RETURNS EARLY. MEASURED: a watchdog that slept its whole escalation after a TERM that had
# already ended every pid released each call a second later than it had to, and the envelope lost about three
# races in four to the harness (the ladder at the foot of this file has the census). `kill -0` is a builtin, so
# a poll that finds every pid gone costs nothing. A pid that died but is not reaped yet still answers it: the
# direct child is reaped by the main shell's own `wait`, and a re-parented descendant by init, so a zombie
# costs at most another poll and never the whole escalation.
#
# THE FOREGROUND WAITS ON THE TIMER, AND THE TIMER SENDS THE KILL. A loop that polled and sent the KILL itself
# learned the deadline passed only after its current poll's `sleep` ended: a review measured a KILL at 1.099s
# against a 1s escalation, and a release late by the same poll. A count of polls would be worse still,
# stretching the KILL by every poll's overshoot under load together. So the poller runs BESIDE the timer and
# only ever decides the early release, by ending the timer's tree; whichever ends the timer, this returns on
# that instant. The timer is forked BEFORE the TERM, so scheduling it is never added to the escalation.
# Both close fd 3 and fd 4 because the envelope's fd 4 is the hook's real stderr, and a child
# outliving its watchdog would hold that pipe open.
escalate_hook_pids() {
  local escalation="$1" timer poller
  shift
  (
    sleep "$escalation"
    signal_pids KILL "$@"
  ) 3<&- 4>&- &
  timer=$!
  signal_pids TERM "$@"
  (
    while any_pid_alive "$@"; do
      sleep "$HOOK_TREE_POLL_SECONDS"
    done
    kill_hook_tree "$timer" TERM
  ) 3<&- 4>&- &
  poller=$!
  wait "$timer" 2>/dev/null || true
  kill_hook_tree "$poller" TERM
  wait "$poller" 2>/dev/null || true
}

# @param $1.. the pids to ask about
# @returns 0 while any of them still answers `kill -0`, 1 once none does
any_pid_alive() {
  local pid
  for pid in "$@"; do
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

# Run part of a hook with a budget, and release the tool call when that budget is spent.
#
# @param $1 the budget in seconds, from hook_budget_seconds or what is left of it
# @param $2 the exit code to return when the budget is spent
# @param $3 the label the stderr line names, e.g. pretooluse
# @param $4.. the command and its arguments
# @returns the command's own exit status, or the give-up code when the budget was spent
#
# The child is run with an EXPLICIT stdin redirection because bash sends an asynchronous command's stdin to
# /dev/null "in the absence of any explicit redirections" when job control is off — which is every hook run.
# Without the `<&3` the hook would read an empty payload instead of the tool call.
#
# The watchdog is SILENCED on both channels because it writes nothing of its own, and bash would otherwise
# report the `sleep` it reaped after the teardown signalled it — see the envelope's own note at the foot of
# this file for the measurement and the repro.
#
# A spent budget is read off the exit status and the wall clock together: `wait` reports 128+N for a child a
# signal ended, and only the watchdog sends one, but a hook that took its own signal earlier would report the
# same thing — so both conditions have to hold. The alternative, a marker file, is one file create and unlink
# per hook per tool call, which is the per-call cost `src/live/perf/hookStream.ts` refuses a ledger over.
run_hook_bounded() {
  local budget="$1" give_up="$2" label="$3"
  shift 3

  local started=$SECONDS
  exec 3<&0
  "$@" <&3 &
  local child=$!

  (
    sleep "$budget"
    kill -0 "$child" 2>/dev/null || exit 0
    local_tree="$(hook_tree_pids "$child")"
    # Word-splitting the captured list is the point — it is a list of pids, one per line.
    # shellcheck disable=SC2086
    escalate_hook_pids "$HOOK_BOUNDED_ESCALATION_SECONDS" $local_tree
  ) >/dev/null 2>&1 &
  local watchdog=$!

  local status=0
  wait "$child" 2>/dev/null || status=$?
  local elapsed=$((SECONDS - started))

  if [ "$status" -ge 128 ] && [ "$elapsed" -ge "$budget" ]; then
    # Let the watchdog finish its escalation rather than tearing it down here: `wait` returns the instant
    # the DIRECT child dies, and a descendant that ignored TERM is still holding this hook's stdout, so the
    # tool call is not actually released until that pipe closes. Bounded by the watchdog's own two seconds,
    # and over the moment the last pid it signalled is gone.
    wait "$watchdog" 2>/dev/null || true
    # The line says what the give-up code DOES: 0 releases the call, 2 refuses it, and anything else is a
    # status the caller reads and decides on itself (the payload read's 1).
    case "$give_up" in
      0) printf '%s\n' "$label: killed after ${budget}s without a verdict, so the tool call is no longer held — this hook reached no decision" >&2 ;;
      2) printf '%s\n' "$label: killed after ${budget}s without a verdict, so the tool call is refused rather than run past its gates — this hook reached no decision; run it again" >&2 ;;
      *) printf '%s\n' "$label: killed after ${budget}s without a verdict — this step reached no decision" >&2 ;;
    esac
    return "$give_up"
  fi
  kill_hook_tree "$watchdog" TERM
  wait "$watchdog" 2>/dev/null || true
  return "$status"
}

# Read a hook payload off stdin under a budget, so a writer that never closes the pipe cannot hold the call.
#
# @param $1 the budget in seconds
# @param $2 the label the stderr line names
# @returns the bytes that arrived, on stdout; status 0 if stdin reached end-of-file, 1 if it did not
#
# This is the FIRST hang site, and the one `hooks.json`'s timeout was the only thing standing between us and:
# `scripts/pretooluse.sh` reads the payload itself, before it decides anything, so a `$(cat)` that never
# returns wedges the shim with no hook process to kill. Whatever `cat` copied before it was killed is still
# on this function's stdout, so a caller that only needs to know WHICH TOOL was called — which is exactly
# what the fail-open/fail-closed split needs — can still answer from a truncated read.
read_payload_bounded() {
  run_hook_bounded "$1" 1 "$2 (payload read)" cat
}

# ── The envelope: the layer that cannot be opted out of ───────────────────────────────────────────────
#
# Everything above bounds a STEP a shim chose to bound. The envelope finding is about the calls no shim
# bounded at all, and it has two shapes, both read straight off the `hook_cancelled` records the transcripts
# carry (`grep -h '"hook_cancelled"' ~/.claude/projects/*/<session>.jsonl`):
#
#   * an entry with no shell in front of it — `scripts/plugin-mirror-sync.sh` ended at 60158/60238/60079 ms
#     against its declared 60000, with no `stderr` at all, because nothing ever sourced this file;
#   * a shim that IS bounded and still lost the race — `scripts/pretooluse.sh` ended at 20043–20163 ms
#     against its declared 20000, because its budget clock started AFTER a ten-fork prologue.
#
# So the envelope wraps every registered entry, in `scripts/hook.sh`, against the timeout `hooks/hooks.json`
# declares for it. The ladder, for a declared T, every layer catching the one above it and every layer
# printing:
#
#   inner verdict bound   15    a shim's own `run_hook_bounded`, which is what picks the give-up CODE —
#                               released on its TERM, +2 only for a pid that ignores it
#   envelope TERM         T-3   here — and the call is released the moment every pid it signalled is gone
#   envelope KILL         T-2   here, only for a pid that outlived its TERM, so the hook's stdout is closed
#                               and the call ended by the registration's give-up code (2 on the door-gated
#                               PreToolUse row, else 0)
#   runway                2s    what the release has left to reach the harness: the lag between the
#                               harness's clock starting and this shell's, the tree walk, process exit
#   harness timeout       T     `hooks.json` — reached when the machine starved every layer of ours past T,
#                               and the ONE ending nothing here can make fail closed: the tool call runs
#
# `PreToolUse` declares T=30, so its inner verdict lands at 17 with ten seconds of runway before the
# envelope; every other entry declares 20. MEASURED: at T=20 a load episode handed ~22
# `PreToolUse:Bash` calls to the harness (`hook_cancelled`, 20004–20823 ms) and every one of them RAN. The
# inner 15 is not widened by that — it is the decision budget, and a slow step is fixed where it is slow.
#
# WHY THE RUNWAY IS TWO SECONDS AND THE RELEASE DOES NOT WAIT OUT THE ESCALATION. MEASURED over
# every transcript on this machine: the harness ended 1,522 `handover-run` calls (T=10), 495 `plugin-mirror-sync`
# (T=60) and 254 `profile-context` (T=10) whose command WAS this envelope, while the envelope ended only 438,
# 102 and 16 itself — and those it did end released at 8.3–10.5 s against a TERM at 8, piled against T. The
# old ladder (TERM T-2, KILL T-1) always slept the whole escalation second, even when every pid had died on
# its TERM, so the release had one second left for everything after it and lost about three races in four.
# An idle machine released a `sleep` target at 9.12 s through `hook.sh 10`. Repro, both halves:
#
#   grep -rhoE --include='*.jsonl' 'hook\.sh\\" [0-9]+ [a-z-]+ [^,]*","durationMs":[0-9]+,"timedOut":true' ~/.claude/projects/ | grep -oE 'hook\.sh\\" [0-9]+ [a-z-]+' | sort | uniq -c
#   grep -rhoE --include='*.jsonl' '"stderr":"[a-z-]+: killed after [0-9]+s without finishing' ~/.claude/projects/ | sort | uniq -c
#
# The envelope's escalation is ONE second rather than the two `run_hook_bounded` spends, because the runway
# after it is fixed and the hook's own time is what pays for a longer one. A kill cannot look at a payload,
# so the payload-aware ending stays with the inner layer — which is the whole reason the inner layer
# survives — and the envelope's own ending is chosen by its registration instead.
#
# IT RUNS THE TARGET AS A BACKGROUND CHILD and watches THAT pid, rather than arming a watchdog over the
# shim's own tree. MEASURED, and the reason is the platform: macOS ships **bash 3.2.57**, where
# `$BASHPID` does not exist. A watchdog inside the shim's own tree has to exclude itself from the pids it
# signals, `$BASHPID` is the only way to learn that pid, and under `set -u` reading it aborted the watchdog
# before it ever signalled anything — a bound that looked right in the diff and fired never. Repro:
# `bash -c 'echo ${BASHPID:-UNSET}'`. A sibling watchdog needs no self-exclusion, so the question does not
# arise. Arrays are avoided here for the same reason: `"${a[@]}"` on an empty array is an unbound-variable
# error under `set -u` on 3.2, which is why the pid list is a word-split string exactly as above.

# The envelope's own TERM→KILL gap, in seconds. See the ladder above for why it is not the inner two.
HOOK_ENVELOPE_ESCALATION_SECONDS=1

# The seconds left between the envelope's KILL and the harness's own timeout. See the ladder above for the
# measurement that set it.
HOOK_ENVELOPE_RUNWAY_SECONDS=2

# The shortest declared timeout the ladder fits inside: at least a second of the hook's own, the escalation
# and the runway.
HOOK_ENVELOPE_MIN_DECLARED_SECONDS=4

# @param $1 the timeout `hooks/hooks.json` declares for this entry, in seconds
# @returns the second the envelope sends TERM, on stdout — or nothing when the declared timeout is absent,
#   not a positive integer, or too short for the ladder to fit, each of which `hook-bounded` in `yarn lint`
#   refuses at registration so this can never be the silent answer in production
hook_envelope_term_at() {
  declared="$1"
  case "$declared" in
    '' | *[!0-9]*) return 0 ;;
  esac
  [ "$declared" -ge "$HOOK_ENVELOPE_MIN_DECLARED_SECONDS" ] || return 0
  printf '%s\n' "$((declared - HOOK_ENVELOPE_RUNWAY_SECONDS - HOOK_ENVELOPE_ESCALATION_SECONDS))"
}

# Run a whole hook under the envelope, and end the tool call when the declared timeout is nearly spent.
#
# @param $1 the declared timeout in seconds, straight off the `hooks.json` entry
# @param $2 the exit code to return when the envelope ended the target: 0 releases the call, 2 refuses it.
#   The REGISTRATION picks it (`SLOPWEAVER_HOOK_GIVE_UP=2 scripts/hook.sh …`), never the payload — a kill cannot
#   read one — so both `PreToolUse` rows refuse, and every other entry keeps 0. A kill sets
#   `HOOK_ENVELOPE_KILLED=1` in the caller's shell, so `scripts/hook.sh` can tell its own kill from a target
#   that exited 2 itself, and deliver the owner's profile only with the first
# @param $3 the label the stderr line names, e.g. pretooluse
# @param $4.. the target and its arguments
# @returns the target's own exit status, or the give-up code when the envelope ended it
#
# WHY A DOOR-GATED CALL REFUSES HERE TOO. MEASURED: after the inner bound learned to fail closed,
# a load episode still let ~22 `PreToolUse:Bash` calls run past every gate — the harness
# cancelled the hook at 20004–20823 ms and the tool ran, with neither the inner verdict (then 15+2) nor this
# envelope (then 18/19) landing inside 20 under that starvation. The declared timeout rose to 30 for that reason,
# and an envelope that fires in the new runway must not hand back the release the inner layer just stopped
# giving. Repro: `grep -rh '"hook_cancelled"' ~/.claude/projects/ | grep PreToolUse`.
#
# The watchdog PRINTS BEFORE IT SIGNALS, because after the KILL there may be nothing left to say it — and
# that silence is exactly what the harness's own timeout leaves behind, which is the whole shape this ends.
# Its stdout goes to /dev/null: a hook's stdout is the channel the harness reads a verdict on, and a
# watchdog holding that pipe would hold the tool call it was armed to release.
#
# IT PRINTS ON FD 4 AND RUNS WITH FD 2 SILENCED, which looks like ceremony and is a measured defect. bash
# reports a foreground child it reaped after a signal — "line 95: <pid> Terminated: 15  sleep" — on the
# stderr of the shell that owned it, and the teardown on the NORMAL path kills the watchdog's own `sleep`.
# Claude Code renders any hook stderr as a hook ERROR, so that line reaches a seat as a failure banner
# carrying no information. MEASURED: 2 of 15 runs of the shim, with and without the envelope
# alike, so it is `run_hook_bounded`'s own race and predates this file's envelope. Reproduce:
#
#   P='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
#   for i in $(seq 1 15); do echo "$P" | ./scripts/hook.sh 20 pretooluse ./scripts/pretooluse.sh >/dev/null; done
#
# `run_hook_bounded`'s watchdog writes nothing of its own, so it takes `>/dev/null 2>&1` outright; this one
# has a line to print, so fd 4 carries the real stderr and fd 2 is the channel bash's report goes down.
#
# The `<&3` is the same redirection `run_hook_bounded` explains: bash sends an asynchronous command's stdin
# to /dev/null when job control is off, which is every hook run, so without it the target would read an
# empty payload instead of the tool call.
run_hook_enveloped() {
  local declared="$1" give_up="$2" label="$3" term_at outcome
  term_at="$(hook_envelope_term_at "$declared")"
  shift 3
  case "$give_up" in
    2) outcome="so the tool call is refused rather than run past its gates — this hook reached no decision; run it again" ;;
    *) outcome="so the tool call is no longer held — this hook reached no decision" ;;
  esac

  # No usable declared timeout means no ladder to enforce; run the target rather than refusing to run a
  # hook at all, and let `hook-bounded` be what catches the registration.
  if [ -z "$term_at" ]; then
    "$@"
    return $?
  fi

  exec 3<&0
  "$@" <&3 &
  local child=$!

  (
    exec 2>/dev/null
    sleep "$term_at"
    kill -0 "$child" 2>/dev/null || exit 0
    printf '%s\n' "$label: killed after ${term_at}s without finishing, $outcome, and hooks.json declares ${declared}s for this entry" >&4
    envelope_tree="$(hook_tree_pids "$child")"
    # Word-splitting the captured list is the point — it is a list of pids, one per line.
    # shellcheck disable=SC2086
    escalate_hook_pids "$HOOK_ENVELOPE_ESCALATION_SECONDS" $envelope_tree
  ) 4>&2 >/dev/null &
  local watchdog=$!

  local status=0
  wait "$child" 2>/dev/null || status=$?

  if [ "$status" -ge 128 ] && [ "$SECONDS" -ge "$term_at" ]; then
    # Wait out the escalation for the reason `run_hook_bounded` gives: `wait` returns the instant the DIRECT
    # child dies, and a descendant that ignored TERM is still holding this hook's stdout.
    wait "$watchdog" 2>/dev/null || true
    # Set in THIS shell, so the entry point can tell its own kill from a target that exited with the same code.
    # shellcheck disable=SC2034 # read by scripts/hook.sh, the shell that sourced this
    HOOK_ENVELOPE_KILLED=1
    return "$give_up"
  fi
  kill_hook_tree "$watchdog" TERM
  wait "$watchdog" 2>/dev/null || true
  return "$status"
}
