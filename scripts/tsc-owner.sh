#!/usr/bin/env bash
# tsc-owner.sh — run ONE compiler command as an owned process group: bounded in time and in whole-tree resident
# memory, cancellable, and reaped to the last member whatever the compiler itself does with a signal.
#
#   bash scripts/tsc-owner.sh --timeout-seconds <n> --grace-seconds <n> --rss-ceiling-mib <n> \
#     [--lock-timeout-seconds <n>] -- <program> <arg>...
#
# Why it exists. TypeScript 7's compiler is a native binary, so a V8 `--max-old-space-size` bounds nothing it
# spends, and it ignores SIGINT and SIGTERM and can exit 0 when interrupted (a known upstream TypeScript issue). A bound
# therefore has to be enforced from OUTSIDE the compiler, on its whole process group, and the verdict has to be
# latched by the owner rather than read off the compiler's exit status.
#
# Why Bash. `no-headless` (NH001/NH002) bans the async `node:child_process` API repository-wide, and a blocking
# `execFileSync` cannot sample memory or run a TERM/grace/KILL sequence while it waits. The process-group mechanism
# is the one `src/worktree/shell.ts`'s SUPERVISOR_SCRIPT already proves on macOS and Linux: `set -m` gives the
# background job a process group of its own, with its leader's pid as the group id.
#
# Contract. Exactly one `TSC_OWNER_LOCK` line (once the compile lease is held), one `TSC_OWNER_START` line (once the
# job is forked) and exactly one `TSC_OWNER_RESULT` line go to stderr; the compiler's own stdout and stderr pass
# through untouched, and nothing bash itself writes while forking the job reaches them (see the comment at the fork).
# An outcome reached before the lease is held (a refusal, a cancellation or a lock timeout) writes RESULT alone.
#
#   TSC_OWNER_LOCK mode=<acquired|inherited> waitedSeconds=<n> holderPid=<n>
#   TSC_OWNER_START pid=<n> pgid=<n> startHex=<hex|none>
#   TSC_OWNER_RESULT outcome=<outcome> commandExit=<n|none> peakRssKiB=<n> pid=<n|none> pgid=<n|none> startHex=<hex|none>
#
#   outcome         exit   meaning
#   exited          its own  the command ended by itself; its status is passed through
#   lock-timed-out  75       the machine's compile lease stayed held past --lock-timeout-seconds; nothing ran
#   timed-out       124      --timeout-seconds elapsed first
#   owner-error     125      bad options, an unreadable `ps`, a descendant that left the group, a group that
#                            survived SIGKILL, or a compile lease it cannot trust — never a measurement the owner
#                            can vouch for
#   rss-ceiling     126      the group's summed resident memory went past --rss-ceiling-mib
#   cancelled-hup   129      the owner was sent HUP
#   cancelled-int   130      the owner was sent INT
#   cancelled-term  143      the owner was sent TERM
#
# One compile at a time. A whole-repo type pass peaks near 7.1 GB (src/devLint/namedObjectParamsHeap.ts). MEASURED on a
# 16 GB Mac: Claude Code reaped three seats' jobs for low memory while one seat ran this owner
# at its 10240 MiB ceiling during a lap, and `slopweaver machine capacity --full` read 11.7 of 16 GB used, swap 2.9 of
# 4. So before it forks anything, the owner takes the machine's one TypeScript compile LEASE, and holds it until it
# exits. A lap takes the same lease for its whole run, after its lap lock (src/cli/commands/github/lapCompileLease.ts),
# so a seat's compile waits out a lap and a lap waits out a seat's compile. A lease held by an ANCESTOR of this owner
# is inherited rather than waited on (`mode=inherited`): a lap's own compiles are its descendants, its steps run one
# at a time, and waiting on one's own ancestor is a deadlock. An inherited lease is never touched.
#
# The lease is the repository's operation lock (src/admit/operationLock.ts) under this user's machine-wide lock
# directory (src/stateRuntime.ts `userRuntimeLockDir`): `/tmp/slopweaver-<uid>/user-locks/<hash>.lock`, never stale
# while its holder lives. Fixed under /tmp, never HOME or TMPDIR: a lap hands its lanes a throwaway HOME and
# SLOPWEAVER_HOME, and a sandbox sets its own TMPDIR. SLOPWEAVER_RUNTIME_ROOT replaces /tmp, and only the test lanes'
# setup sets it. The protocol is the operation lock's, spoken here byte for byte: a candidate directory holding one
# token file of `{"acquiredAtIso":…,"pid":…,"start":…}` is RENAMED into place, which succeeds only onto an absent or
# empty directory, so the lock never stands holding someone else's record; a holder whose pid is gone, a zombie, or
# whose `/bin/ps lstart` (UTC, C locale) no longer matches is stale, and is cleared by unlinking ITS token and then
# `rmdir`, which the kernel refuses once a fresh holder has renamed in. Bash has no rename(2) of a directory onto an
# empty one — macOS `mv` moves the candidate INSIDE it — so that one syscall is `node -e`'s `renameSync`. Release
# unlinks only this owner's own token, on every exit. A record that does not parse is owner-error, never stale: an
# unidentified holder is not removed. A GitHub-hosted runner gives each job its own machine, so in CI the lease is
# never waited on.
#
# The wait is bounded by --lock-timeout-seconds, 1200 when not given: one whole root compile at its 1140 s timeout plus
# its 10 s worst reap after TERM, with room over. A lap holds the lease far longer than that, so a seat's compile
# started during a lap ends lock-timed-out (75) rather than run beside it. The bound counts from the first round that
# cannot take the lease and has to go round again, never from the owner's start, so the bound cannot run out on an
# owner's first round, and an owner reports a wait of 0 when it never waited. A holder that arrives after an
# absent or in-flux read can still be unread when the bound runs out. The wait says once, on stderr, who holds the
# lease, and TERM, INT and HUP cancel it with their usual outcomes. Residue, stated: the wait is a poll, not a queue,
# so two owners waiting on one holder are served in no particular order; the lease is per OS user, not per machine;
# `ps lstart` resolves to the second, so a pid handed out again within one second of its holder's death reads live;
# an inherited lease is the ancestor's, which must hold it until its descendants exit — a lap does, and an owner whose
# ancestor's record goes mid-compile stops that compile within one 100 ms sample rather than run on beside the next
# holder, so the two can overlap for that sample and the reap; a stale record is unlinked only while its bytes still
# read as judged, which leaves the window between that read and the unlink, the same window the operation lock has;
# and `kill -0` cannot tell "not permitted" from "gone", which only a holder of another uid could hit, and the 0700
# root admits no other uid. Witnessed, with the operation lock's own race, by
# src/__tests__/subprocess/worktree/tscOwnerLease.test.ts.
#
# Every outcome but `exited` is latched BEFORE the group is signalled, so the compiler's later exit status can
# never overwrite it. Termination is TERM to the whole group, up to --grace-seconds for it to empty, then KILL,
# then a bounded wait until no member is left.
#
# The command runs with GOMEMLIMIT set to 70% of the ceiling, whatever the caller's environment says, computed in the
# launch line itself so no variable a caller's BASH_ENV could pre-set stands between the ceiling and the limit.
# The compiler is a Go program, and Go's collector by default lets the heap grow to twice what survived the last
# collection, so much of what the ceiling sees is garbage not yet collected rather than memory the compile needs.
# GOMEMLIMIT is the runtime's own soft target: it collects harder as the heap nears it, and exceeds it rather than
# stall when the live heap is larger, so it bounds nothing — the ceiling above it stays the hard bound — and it
# costs CPU, never a result. MEASURED with a cold cache, one run each, `yarn build`'s command at a 10240 ceiling:
# with no limit it was killed at peakRssKiB=10542288 over TypeScript's own `Memory used: 6452427K` (the live heap
# after a final collection), and at 7GiB it exited 0 at peakRssKiB=8090720, 17.7s against 13.9s. The value is
# pinned rather than inherited so a lap and CI measure the same compile. Reproduce the two, macOS `time -l`
# reporting the unlimited run's maximum resident size, since this owner always sets the limit:
#   GOMEMLIMIT=off /usr/bin/time -l node_modules/.bin/tsc -p tsconfig.build.json --tsBuildInfoFile <fresh path>
#   bash scripts/tsc-owner.sh --timeout-seconds 1140 --grace-seconds 5 --rss-ceiling-mib 10240 -- \
#     node_modules/.bin/tsc -p tsconfig.build.json --extendedDiagnostics --tsBuildInfoFile <fresh path>
#
# Memory is SAMPLED: one `ps -ax -o pid=,ppid=,pgid=,rss=` snapshot every 100 ms, summing `rss` (KiB on both BSD
# `ps` and procps) over every member of the owned group. A sampled peak, not the kernel's high-water mark: an
# allocation that rises and falls inside 100 ms is not seen. A descendant of the job (by parent-pid closure) that
# is no longer in the owned group is `owner-error`, because neither the measurement nor the reaping would cover it.
#
# Residue, stated. Bash reaps the job's leader as soon as it exits, so the leader cannot be held as a zombie to
# pin its pid; signals go to the group id, which the kernel does not hand out again while any member of the group
# is alive. An external SIGKILL of this owner cannot be trapped by any user-space program: callers cancel with
# TERM, INT or HUP. A member in an uninterruptible kernel wait outlives SIGKILL until that wait ends, and every
# wait here is bounded, so such a member can outlive the owner too. The owner never hides one: it exits
# owner-error (125) once five seconds pass with the group still listed, rather than report a clean end. A member
# that is merely still exiting is waited out inside those five seconds, not reported (see settle()). Once the owner exits, nothing above it can
# see the compiler's group, because a supervisor tracks only the owner's own. The command is trusted not to signal
# its owner: a stopped owner is woken with SIGCONT beside the TERM, but a command that keeps stopping or killing
# the program meant to stop it defeats any user-space owner. So does a hostile environment: `ps`, `awk` and `sleep`
# resolve through the caller's PATH, so a forged one can fake a listing or stretch a wait. A forged listing is still
# caught while the signal check sees the member; a stretched wait is not, and neither is a `sleep` that resets
# Bash's SECONDS, which settle()'s deadline reads. The caller's PATH is trusted. Witnessed by
# src/__tests__/subprocess/worktree/tscOwner.test.ts.

set -u
set -o pipefail

pid=none
pgid=none
start_hex=none
peak_kib=0
outcome=""
command_exit=none

report() {
  echo "TSC_OWNER_RESULT outcome=$outcome commandExit=$command_exit peakRssKiB=$peak_kib pid=$pid pgid=$pgid startHex=$start_hex" >&2
}

owner_error() {
  echo "tsc-owner: $1" >&2
  outcome=owner-error
  report
  exit 125
}

# Report the outcome and exit with the status the header's table maps it to.
finish() {
  report
  case "$outcome" in
  exited) exit "$command_exit" ;;
  lock-timed-out) exit 75 ;;
  timed-out) exit 124 ;;
  owner-error) exit 125 ;;
  rss-ceiling) exit 126 ;;
  cancelled-hup) exit 129 ;;
  cancelled-int) exit 130 ;;
  cancelled-term) exit 143 ;;
  esac
  exit 125
}

positive_integer() {
  case "$1" in
  '' | *[!0-9]* | 0*) return 1 ;;
  *) return 0 ;;
  esac
}

timeout_s=""
grace_s=""
ceiling_mib=""
lock_wait_s=""
while [ "$#" -gt 0 ]; do
  case "$1" in
  --timeout-seconds | --grace-seconds | --rss-ceiling-mib | --lock-timeout-seconds)
    [ "$#" -ge 2 ] || owner_error "$1 needs a value"
    positive_integer "$2" || owner_error "$1 must be a positive whole number, not '$2'"
    # Past Bash's integer range a comparison errors rather than firing, which would leave the bound inert; nine
    # digits keeps every value, and the ceiling's KiB product, far inside it.
    [ "${#2}" -le 9 ] || owner_error "$1 is at most nine digits, not '$2', so the owner's arithmetic can compare it"
    case "$1" in
    --timeout-seconds)
      [ -z "$timeout_s" ] || owner_error "--timeout-seconds is given twice"
      timeout_s=$2
      ;;
    --grace-seconds)
      [ -z "$grace_s" ] || owner_error "--grace-seconds is given twice"
      grace_s=$2
      ;;
    --rss-ceiling-mib)
      [ -z "$ceiling_mib" ] || owner_error "--rss-ceiling-mib is given twice"
      ceiling_mib=$2
      ;;
    --lock-timeout-seconds)
      [ -z "$lock_wait_s" ] || owner_error "--lock-timeout-seconds is given twice"
      lock_wait_s=$2
      ;;
    esac
    shift 2
    ;;
  --)
    shift
    break
    ;;
  *) owner_error "unknown argument '$1' (the command goes after --)" ;;
  esac
done
[ -n "$timeout_s" ] || owner_error "--timeout-seconds is required"
[ -n "$grace_s" ] || owner_error "--grace-seconds is required"
# A supervisor above this owner SIGKILLs it a fixed time after TERM (SUPERVISOR_GRACE_SECONDS, 15, in
# src/worktree/shell.ts). The owner's worst case after TERM is this grace plus the five-second settle, so a grace
# past five could be cut off before the compiler's group is reaped. Refused rather than trusted to every caller.
[ "$grace_s" -le 5 ] || owner_error "--grace-seconds is at most 5, not $grace_s, so a supervisor's grace still outlasts the owner"
[ -n "$ceiling_mib" ] || owner_error "--rss-ceiling-mib is required"
[ "$#" -gt 0 ] || owner_error "no command after --"
ceiling_kib=$((ceiling_mib * 1024))
# The one optional bound, its default stated in the header's "One compile at a time".
[ -n "$lock_wait_s" ] || lock_wait_s=1200

# A cancellation only LATCHES here; the loop below acts on it between samples. Installed before the fork, so a
# signal landing at any point after it still finds the job's group.
cancel=""
trap 'cancel=${cancel:-cancelled-term}' TERM
trap 'cancel=${cancel:-cancelled-int}' INT
trap 'cancel=${cancel:-cancelled-hup}' HUP

# ---- The compile lease: the header's "One compile at a time". ----

# The lease's key, the one src/cli/commands/github/lapCompileLease.ts takes it under. Its directory's name is derived
# from it exactly as the operation lock derives one (the first 32 hex of its SHA-256, src/admit/operationLockPath.ts),
# so the two can only meet at one lease. A unit test holds the key and the derivation equal to the lap's, so a change
# to either reddens rather than splitting one lease into two.
LEASE_KEY=typescript-compile
LEASE_DIGEST='process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1], "utf8").digest("hex").slice(0, 32))'

# One token file's whole body, exactly as JSON.stringify writes the operation lock's `{acquiredAtIso, pid, start}`.
LEASE_RECORD='^\{"acquiredAtIso":"([^"\\]*)","pid":([1-9][0-9]{0,9}),"start":"([^"\\]+)"\}$'

# rename(2), printing what it did: `installed`, `occupied` (a populated directory or a plain file is there) or
# `failed <errno>`. The one syscall Bash cannot make: see the header.
LEASE_RENAME='const fs = require("node:fs");
try {
  fs.renameSync(process.argv[1], process.argv[2]);
  process.stdout.write("installed");
} catch (error) {
  const code = error && error.code;
  process.stdout.write(code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOTDIR" ? "occupied" : "failed " + String(code));
}'

lease=""
lease_token=""
lease_candidate=""
own_start=""
occupant_kind=""
occupant_why=""
occupant_token=""
occupant_pid=none
occupant_start=""
occupant_since=""
occupant_body=""
ps_state=""
ps_start=""
inherited_record=""

# On every exit: remove a candidate that never became the lease, and release a lease this owner installed — its own
# token only, and the directory only once that left it empty, so a later holder's record is never touched.
release_lease() {
  if [ -n "$lease_candidate" ]; then rm -rf -- "$lease_candidate" 2>/dev/null; fi
  if [ -n "$lease_token" ] && rm -- "$lease/$lease_token" 2>/dev/null; then rmdir -- "$lease" 2>/dev/null; fi
  return 0
}
trap release_lease EXIT

# One `ps` field for a pid, read the way the operation lock reads it: /bin/ps by path, UTC, the C locale and nothing
# else inherited, so one instant is one text whoever asks (src/talk/relayLease.ts `psRow`).
ps_field() {
  env -i LANG=C LC_ALL=C TZ=UTC /bin/ps -o "$1" -p "$2" 2>/dev/null
}

# A pid's `stat` and `lstart`, split exactly as src/talk/relayLease.ts `processStartFromPs` splits them, into
# `ps_state` and `ps_start`: the row trimmed, the state up to its first gap, the stamp everything after it trimmed —
# its INNER spacing kept. `lstart` pads a single-digit day (`Fri Nov  7`), so a `read` into two words, which
# collapses that run, would write a stamp the operation lock reads as a recycled pid, and read its stamps the same.
ps_row() {
  local row
  row=$(ps_field stat=,lstart= "$1")
  row="${row#"${row%%[![:space:]]*}"}"
  row="${row%"${row##*[![:space:]]}"}"
  ps_state=${row%%[[:space:]]*}
  ps_start=${row#"$ps_state"}
  ps_start="${ps_start#"${ps_start%%[![:space:]]*}"}"
}

# Whether a lease's holder is still the process that wrote it (src/talk/relayLease.ts `holderRunning`): it answers
# signal 0, is not a zombie, and the start stamp `ps` gives now, when it gives one, is the one it recorded.
holder_running() {
  kill -0 "$1" 2>/dev/null || return 1
  ps_row "$1"
  case "$ps_state" in Z*) return 1 ;; esac
  [ -z "$ps_start" ] || [ "$ps_start" = "$2" ]
}

# Whether a pid is an ancestor of this owner, walked by parent pid and bounded, so a listing that loops cannot hang it.
is_ancestor() {
  local at=$$ hops=0
  while [ "$hops" -lt 64 ]; do
    at=$(ps_field ppid= "$at" | tr -d ' ')
    case "$at" in '' | *[!0-9]*) return 1 ;; esac
    [ "$at" -gt 1 ] || return 1
    [ "$at" != "$1" ] || return 0
    hops=$((hops + 1))
  done
  return 1
}

# This user's machine-wide lock directory, made as src/stateRuntime.ts makes it and refused as it refuses: a link, a
# non-directory, another user's, or one open to anyone else is not trusted with the lease.
lease_directory() {
  local uid root mode
  uid=$(id -u) || owner_error "id could not read this user's id, which keys the compile lease"
  root="${SLOPWEAVER_RUNTIME_ROOT:-/tmp}/slopweaver-$uid"
  mkdir -p -m 700 -- "$root" 2>/dev/null
  if [ -L "$root" ] || [ ! -d "$root" ]; then owner_error "$root is not a directory, so the compile lease cannot live in it"; fi
  [ -O "$root" ] || owner_error "$root is not this user's own, so the compile lease is not trusted in it"
  mode=$(ls -ld -- "$root") || owner_error "ls could not read the mode of $root"
  case "${mode:0:10}" in
  d???------) ;;
  *) owner_error "$root is open to other users (${mode:0:10}), so the compile lease is not trusted in it" ;;
  esac
  mkdir -p -- "$root/user-locks" 2>/dev/null
  if [ -L "$root/user-locks" ] || [ ! -d "$root/user-locks" ]; then
    owner_error "$root/user-locks is not a directory, so the compile lease cannot live in it"
  fi
  local name
  name=$(node -e "$LEASE_DIGEST" "$LEASE_KEY" 2>/dev/null)
  [[ "$name" =~ ^[0-9a-f]{32}$ ]] ||
    owner_error "could not derive the compile lease's name from its key: ${name:-node printed nothing}"
  lease="$root/user-locks/$name.lock"
}

# What stands at the lease path, read as src/admit/operationLockState.ts reads it: `absent`, `in-flux` (a directory
# with no record: a takeover between its unlink and its rmdir), `held` with the holder's token, pid, start and
# instant, or `malformed` with why — which is never judged stale, since an unidentified holder is not removed.
read_occupant() {
  local names body
  occupant_kind=malformed
  if [ -L "$lease" ]; then
    occupant_why="it is a link"
    return
  fi
  if [ ! -e "$lease" ]; then
    occupant_kind=absent
    return
  fi
  if [ ! -d "$lease" ]; then
    occupant_why="it is not a directory"
    return
  fi
  if ! names=$(ls -A -- "$lease" 2>/dev/null); then
    if [ -e "$lease" ]; then occupant_why="it could not be listed"; else occupant_kind=absent; fi
    return
  fi
  if [ -z "$names" ]; then
    occupant_kind=in-flux
    return
  fi
  case "$names" in *$'\n'*)
    occupant_why="it holds more than one record"
    return
    ;;
  esac
  if ! body=$(cat -- "$lease/$names" 2>/dev/null); then
    if [ -e "$lease/$names" ]; then occupant_why="its record could not be read"; else occupant_kind=in-flux; fi
    return
  fi
  if [[ ! $body =~ $LEASE_RECORD ]]; then
    occupant_why="its record is not one the compile lease writes"
    return
  fi
  occupant_kind=held
  occupant_body=$body
  occupant_token=$names
  occupant_since=${BASH_REMATCH[1]}
  occupant_pid=${BASH_REMATCH[2]}
  occupant_start=${BASH_REMATCH[3]}
}

# Take the lease, inherit an ancestor's, or end the owner: cancelled, lock-timed-out, or owner-error. Every round is
# one install attempt; a stale holder cleared, or a path in motion, goes round again at once. The wait clock starts
# on the first round that has to go round again, never before: SECONDS counts whole wall-clock seconds, so a clock
# started ahead of this owner's own setup (two `node -e` starts and its `ps` reads) would count a second boundary
# crossed during that setup as a second waited, and under a one-second bound give up before reading who holds it.
acquire_lease() {
  local waiting_since="" waited=0 announced="" token placed holder
  lease_directory
  ps_row "$$"
  own_start=$ps_start
  case "$own_start" in '' | *'"'* | *'\'* | *$'\n'*)
    owner_error "/bin/ps did not give this owner's own start stamp, so it cannot hold a lease that is never stale while its holder lives"
    ;;
  esac
  token="$$-1-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  [[ $token =~ ^[0-9]+-1-[0-9a-f]{32}$ ]] || owner_error "could not draw a random token for the compile lease"
  while :; do
    if [ -n "$cancel" ]; then
      outcome=$cancel
      finish
    fi
    if [ -n "$waiting_since" ] && [ $((SECONDS - waiting_since)) -ge "$lock_wait_s" ]; then
      echo "tsc-owner: the machine's TypeScript compile lease at $lease was still held by pid $occupant_pid after ${lock_wait_s}s, so nothing ran" >&2
      outcome=lock-timed-out
      finish
    fi
    if [ -z "$lease_candidate" ]; then
      lease_candidate=$(mktemp -d "$lease.candidate-XXXXXX") || owner_error "mktemp could not stage a compile-lease candidate beside $lease"
    fi
    # Rewritten every round, so the instant a holder records is when it took the lease, not when it began waiting.
    printf '{"acquiredAtIso":"%s","pid":%s,"start":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$$" "$own_start" \
      >"$lease_candidate/$token" || owner_error "could not write this owner's compile-lease record"
    placed=$(node -e "$LEASE_RENAME" "$lease_candidate" "$lease" 2>/dev/null)
    case "$placed" in
    installed)
      # The candidate's pathname is no longer this owner's: another may mint the freed name.
      lease_candidate=""
      [ -e "$lease/$token" ] || owner_error "the compile lease at $lease was installed without this owner's record in it"
      lease_token=$token
      [ -z "$waiting_since" ] || waited=$((SECONDS - waiting_since))
      echo "TSC_OWNER_LOCK mode=acquired waitedSeconds=$waited holderPid=$$" >&2
      return
      ;;
    occupied) ;;
    *) owner_error "could not install the compile lease at $lease: ${placed:-node printed nothing}" ;;
    esac
    read_occupant
    case "$occupant_kind" in
    absent | in-flux)
      [ -n "$waiting_since" ] || waiting_since=$SECONDS
      sleep 0.05
      continue
      ;;
    malformed) owner_error "the compile lease at $lease cannot be judged ($occupant_why), so it is not taken over" ;;
    esac
    if ! holder_running "$occupant_pid" "$occupant_start"; then
      # Unlinked only while its bytes are still the record judged: a fresh holder whose token NAME repeats the stale
      # one's (its pid reused, its random half drawn again) writes another start stamp, so it is left standing.
      if [ "$(cat -- "$lease/$occupant_token" 2>/dev/null)" = "$occupant_body" ]; then
        rm -f -- "$lease/$occupant_token" 2>/dev/null
      fi
      rmdir -- "$lease" 2>/dev/null
      # The clock starts here too, so a stream of stale records cannot keep this loop going past its bound.
      [ -n "$waiting_since" ] || waiting_since=$SECONDS
      continue
    fi
    if is_ancestor "$occupant_pid"; then
      rm -rf -- "$lease_candidate"
      lease_candidate=""
      inherited_record="$lease/$occupant_token"
      [ -z "$waiting_since" ] || waited=$((SECONDS - waiting_since))
      echo "TSC_OWNER_LOCK mode=inherited waitedSeconds=$waited holderPid=$occupant_pid" >&2
      return
    fi
    [ -n "$waiting_since" ] || waiting_since=$SECONDS
    if [ -z "$announced" ]; then
      announced=1
      holder=$(ps_field args= "$occupant_pid" | cut -c1-200)
      echo "tsc-owner: waiting for the machine's TypeScript compile lease at $lease, held by pid $occupant_pid since $occupant_since (${holder:-its command unreadable}) — one compile at a time; giving up after ${lock_wait_s}s" >&2
    fi
    sleep 1
  done
}

acquire_lease

own_group=$(ps -o pgid= -p "$$" | tr -d ' ') || owner_error "ps could not read this owner's own process group"

# The fork runs with the owner's stderr on /dev/null and the caller's parked on fd 3, which the job's own `2>&3 3>&-`
# hands back: under `set -m` the shell and the child both call setpgid, and when the child's call loses that race
# macOS bash 3.2 writes `child setpgid (N to N): Operation not permitted` to the child's fd 2 BEFORE the job's
# redirections apply, so unbracketed it lands in the compiler's stderr. The identical mechanism, and its measurement,
# is SUPERVISOR_SCRIPT's in src/worktree/shell.ts. A caller whose fd 2 is closed has nothing to park, so the fallback
# parks /dev/null and the command still runs, its stderr and these records discarded.
exec 3>&2 2>/dev/null || exec 3>/dev/null 2>/dev/null
set -m
GOMEMLIMIT="$((ceiling_mib * 70 / 100))MiB" "$@" 2>&3 3>&- &
pid=$!
exec 2>&3 3>&-
set +m
# A closed stderr must not kill the owner before it reaps. A caller that bounds it the way Node's execFileSync
# does closes the pipes the moment its timeout fires, and the owner's next write would raise SIGPIPE and leave
# the compiler group orphaned. Ignored only AFTER the fork, because an ignored signal is inherited across exec
# and the compiler keeps its own disposition.
trap '' PIPE
pgid=$pid
[ "$pgid" != "$own_group" ] || owner_error "the job did not get a process group of its own"
start_hex=$(LC_ALL=C LANG=C TZ=UTC ps -o lstart= -p "$pid" 2>/dev/null | od -An -tx1 | tr -d ' \n')
[ -n "$start_hex" ] || start_hex=none
echo "TSC_OWNER_START pid=$pid pgid=$pgid startHex=$start_hex" >&2

# One snapshot: the owned group's summed RSS, and whether any descendant of the leader has left the group.
# Prints `<sumKiB> <escaped 0|1> <rows read>`.
sample() {
  ps -ax -o pid=,ppid=,pgid=,rss= | awk -v leader="$pid" -v group="$pgid" '
    { p[NR] = $1; pp[NR] = $2; g[NR] = $3; r[NR] = $4; n = NR }
    END {
      tree[leader] = 1
      changed = 1
      while (changed) {
        changed = 0
        for (i = 1; i <= n; i++) if (!(p[i] in tree) && (pp[i] in tree)) { tree[p[i]] = 1; changed = 1 }
      }
      sum = 0; escaped = 0
      for (i = 1; i <= n; i++) {
        if (g[i] == group) sum += r[i]
        if ((p[i] in tree) && g[i] != group) escaped = 1
      }
      printf "%d %d %d\n", sum, escaped, n
    }'
}

# The fast check the waiting loops poll. It cannot tell "no such group" from "not permitted", so a member that has
# changed its user id reads as gone here; group_listed is the verdict.
group_alive() {
  kill -0 -- "-$pgid" 2>/dev/null
}

# The verdict: whether the signal check or the process listing still sees any member of the group, whoever owns it.
# Either one seeing a member is enough, so neither alone can declare the group empty. A listing that cannot be read
# counts as a member, so the owner reports owner-error rather than a clean end it cannot see.
group_listed() {
  local rows
  if group_alive; then return 0; fi
  rows=$(ps -ax -o pgid= 2>/dev/null) || return 0
  [ -n "$rows" ] || return 0
  awk -v group="$pgid" '$1 == group { found = 1 } END { exit found ? 0 : 1 }' <<<"$rows"
}

# Latch the outcome, then TERM the group, give it the grace, KILL what is left, reap the leader, and wait until no
# member remains. A group that outlives SIGKILL turns the outcome into owner-error.
terminate() {
  outcome=$1
  kill -TERM -- "-$pgid" 2>/dev/null
  # A stopped member holds TERM pending until it runs again, so wake the group to receive it.
  kill -CONT -- "-$pgid" 2>/dev/null
  ticks=0
  while group_alive && [ "$ticks" -lt $((grace_s * 10)) ]; do
    sleep 0.1
    ticks=$((ticks + 1))
  done
  if group_alive; then kill -KILL -- "-$pgid" 2>/dev/null; fi
  wait "$pid" 2>/dev/null
  settle
}

# SIGKILL is delivered asynchronously, so wait, bounded, until no member of the group is left. One that is still
# there after the bound turns the outcome into owner-error, so the owner never reports a clean end over a live member.
# The wait polls the verdict itself, never the signal check alone: on macOS a member that is still exiting (a large
# address space torn down under swap pressure) already answers the group signal with ESRCH while `ps` lists it, so a
# wait on the signal check stopped at once and the verdict then caught the member mid-exit and reported a clean
# rss-ceiling as owner-error. The bound is five seconds of wall clock, checked before each poll, so a `ps` that slows
# under load cannot stretch it the way a fixed count of ticks would; a single command already running is not cut off.
# MEASURED on macOS at a 1-minute load of 18 to 38, the rss-ceiling case's command interleaved against both owners:
# owner-error 2 of 40 polling the signal check, 0 of 40 polling the verdict (repro: the rss-ceiling case in
# src/__tests__/subprocess/worktree/tscOwner.test.ts, run alone while a lap loads the machine).
settle() {
  local deadline=$((SECONDS + 5))
  while [ "$SECONDS" -lt "$deadline" ] && group_listed; do
    sleep 0.01
  done
  if group_listed; then
    echo "tsc-owner: process group $pgid survived SIGKILL" >&2
    outcome=owner-error
  fi
}

started=$SECONDS
while kill -0 "$pid" 2>/dev/null; do
  if [ -n "$cancel" ]; then
    terminate "$cancel"
    break
  fi
  if [ $((SECONDS - started)) -ge "$timeout_s" ]; then
    terminate timed-out
    break
  fi
  # An inherited lease is the ancestor's to release, and it must hold it until this owner exits: a lap does, its steps
  # running to their end one at a time. One released early would let another owner's compile start beside this one,
  # so this compile is stopped within a sample of the record going.
  if [ -n "$inherited_record" ] && [ ! -e "$inherited_record" ]; then
    echo "tsc-owner: the compile lease this owner inherited at $lease was released while its compile ran" >&2
    terminate owner-error
    break
  fi
  if ! reading=$(sample); then
    echo "tsc-owner: ps could not be read" >&2
    terminate owner-error
    break
  fi
  read -r sum escaped rows <<<"$reading"
  if [ "$rows" -eq 0 ]; then
    echo "tsc-owner: ps returned no processes" >&2
    terminate owner-error
    break
  fi
  if [ "$sum" -gt "$peak_kib" ]; then peak_kib=$sum; fi
  if [ "$escaped" -ne 0 ]; then
    echo "tsc-owner: a descendant of pid $pid left process group $pgid" >&2
    terminate owner-error
    break
  fi
  if [ "$sum" -gt "$ceiling_kib" ]; then
    terminate rss-ceiling
    break
  fi
  sleep 0.1
done

if [ -z "$outcome" ]; then
  wait "$pid"
  command_exit=$?
  outcome=exited
  # A cancellation that landed after the last sample still decides the outcome: the caller asked to stop.
  if [ -n "$cancel" ]; then outcome=$cancel; fi
  # The command ended by itself; nothing it started may outlive it either. A survivor outranks both outcomes above.
  if group_listed; then
    kill -KILL -- "-$pgid" 2>/dev/null
    settle
  fi
fi

finish
