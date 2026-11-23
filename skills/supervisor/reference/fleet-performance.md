# What `slopweaver perf` measures, and the one thing it refuses to claim

`slopweaver perf` is the HOOK half of the tick's machine reading ([sweep-contract.md](sweep-contract.md) step
8b). `machine capacity` grades the BOX and holds spawns; `perf` answers "which seat is slow, and why", and
hands back the command that ends it. They share every reading and `perf` borrows that verb's own stall line
rather than minting a second one — two gauges disagreeing about whether the fleet is stalled is worse than
one gauge nobody reads.

**Why it exists.** The owner kept noticing hook stalls and load before the chair did, and
steering it by hand. The measured case was the poll gate (a check inside `hooks/pretooluse.ts`): 27 minutes
on the chair and 5m to 2h19m across seven seats. A reading of `a PreToolUse hook stalled 27m` alone is true
and names nobody, so eleven ticks reported it and none could act.

## Progressive disclosure — three verbs, in the order you reach for them

```bash
slopweaver perf                       # one summary line, the fold, then a REACT line per act to take
slopweaver perf seat <ref>            # one seat in full; ref is a workspace id, session id, worktree or pid
slopweaver perf hook poll-gate        # one hook across every seat
```

Every verb takes `--window-minutes <n>` (default 60) and `--json`. The summary exits **3** when this tick owes
a REACT line — a hook over the line, a call nothing is running for, a live seat booted on a pre-envelope
`hooks.json`, or a docs dev server that outlived what started it (`slopweaver machine reap` is the
act) — so `slopweaver perf || …` fires on an act to take
and on nothing else. `perf seat` exits 3 when the reference matches no live seat; `perf hook`
exits 0 whatever it finds, because a hook that is not running right now is the ordinary answer rather than an
empty result.

## Five quantities, and they are never conflated

| What it says        | Where it comes from                              | What it is                                          |
| ------------------- | ------------------------------------------------ | --------------------------------------------------- |
| **stall**           | `ps` `etime` of the live hook process            | TRUE hook runtime, live, no history                 |
| **turnaround**      | gaps between a seat's consecutive tool calls     | hook time PLUS tool time PLUS model time            |
| **boots**           | every hook PROCESS live under the seat           | the per-tool-call boot cost, not a call count       |
| **stuck**           | an old in-flight frame with NO process behind it | a suspicion that nothing is doing this seat's work  |
| **blew the budget** | the transcript's per-call record or refusal text | an EXACT census of PreToolUse calls that died at it |

**None of them is "hook latency", and the verb never prints that phrase.** cmux's own `agent.hook.*` frames
pair `received` to `completed` at p50 and p95 of **1ms** over 1,383 pairs, because that pair times cmux's
relay and not the hook, and there is no `PostToolUse` frame to bound it with.

**Claude Code's transcript DOES carry a per-call duration.** 2.1.278 writes an `attachment` line per hook
call with `hookEvent`, `stderr`, `exitCode` and its own `durationMs`
(`grep -rh -m1 'killed after 15s' ~/.claude/projects/`). A `ps` sample cannot see a call that has already
ended: graded from `ps` alone, the summary printed `no hook over the line` while **34 `PreToolUse` calls went
past the 15 s budget across 18 seats in 3 h 27 m** (the window since the last hook fix landed). So the summary reads `no hook over the line NOW` whenever the census
saw one, and carries the count beside it.

**The census is exact; a percentile over the same records would not be.** Claude Code writes that
attachment only for a hook that EMITTED OUTPUT — 112 records against 3,979 `agent.hook.PreToolUse`
`received` frames over that window, about 3% coverage, biased toward failures by construction. An overrun
is always in the sample, because `hooks/lib/bounded-run.sh` prints to stderr before it returns; a silent
pass never is. So `src/transcripts/hookDuration.ts` publishes counts plus the `recorded` denominator and
**no p50**, and a reader who wants a latency distribution needs a different instrument.

**Only a `PreToolUse` call is graded against the 15 s budget**, because it is the only hook that owes a
verdict and the only one bounded there; every other entry runs under the envelope against its own declared
timeout. MEASURED: all three "overruns" an every-hook grade reported were 60 s `SessionStart`
mirror syncs that exited 0, and a fleet finding sent a seat to bound a PreToolUse step that never ran slow. A
spent budget fails CLOSED for door-gated tools, which Claude Code 2.1.289 records as the tool call's own error
result (`PreToolUse:Bash hook error: …killed after 15s without a verdict…`) with no attachment at all, so the
census reads that text too.

**What a blown budget COSTS is the reason it earns a react line.** A door-gated call (`Bash`, `Monitor`,
`Artifact`, `TaskOutput`, the browser) is refused and costs a retry; a tripwire-only one (`Edit`, `Write`,
`Agent`, `Task`) exits 0, is recorded as `hook_success`, and proceeds with no verdict at all. Measured unbiased hook latency, by
running the installed shim 40 times at load 11.3 on 15 cores: **p50 410 ms, p95 610 ms, p99
1,650 ms** — 4% of budget at p95. The hook is not slow; it has a tail, and the tail is where the gates go
off. Repro:
`echo '{"session_id":"t","tool_name":"Bash","tool_input":{"command":"echo hi"}}' | /usr/bin/time -p <install>/scripts/pretooluse.sh`.

**A call the HARNESS's own timeout ended is a separate defect, counted separately and READ rather than
inferred.** Our watchdog kills at 15 s and escalates TERM→KILL two seconds later, so our own ending lands at
~17.2–17.5 s and names itself in stderr. The harness's ending is a different attachment type, and it says so
exactly — `type: "hook_cancelled"`, `timedOut: true`, `timeoutMs`, plus **the command string verbatim**:

```bash
grep -h '"hook_cancelled"' ~/.claude/projects/*/<session>.jsonl
```

`unbounded` is that field, counted for EVERY event at ANY duration — a 10 s `handover-run` the harness ended
at 10,087 ms is the envelope failing exactly as much as a 20 s PreToolUse one — so the summary counts it and
the command it carries decides where it goes (`src/live/perf/harnessTimeouts.ts`). An absent stderr line is no
evidence either way: a call a PERSON cancelled has no `timedOut`, so it is `interrupted` and outside the
census, and a bounded call may discard its stderr (`hooks.json`'s `slopweaver init` entry ends
`>/dev/null 2>&1` on purpose, because a `SessionStart` hook's stdout is injected as session context).

**Every registered entry is wrapped, so a non-zero `unbounded` means one of two things.** One pass
found 3: one `SessionStart` running `scripts/plugin-mirror-sync.sh` to 60,158 ms
against its declared 60,000 — an entry with no shell in front of it to source a bound at all, and which was
ALSO genuinely over the wall: its per-root prune swept 864,565 entries in 72.22s to find 64 markers, since fixed
([docs/hooks/mirrors-and-failure-policy.md](../../../docs/hooks/mirrors-and-failure-policy.md) § One mirror per plugin root) — and two
`PreToolUse:Bash` at 20,043–20,163 ms, a shim that WAS bounded whose budget clock started behind a ten-fork
prologue. Both classes are closed by `scripts/hook.sh` and the `hook-bounded` gate
([docs/hooks/registered-and-bounded.md](../../../docs/hooks/registered-and-bounded.md) § the ladder). So a row today is told apart by its own `command`, which the
`hook_cancelled` record carries verbatim. **No `scripts/hook.sh` in it** is a seat still running a
`hooks.json` frozen before that landed — a seat reads its hook config ONCE, at boot. **`scripts/hook.sh` in
it** is the envelope arming and still losing the race to `T`: once that was 1,522 `handover-run`
calls against 438 the envelope ended itself, because the old ladder waited out a whole escalation second
after its TERM; the ladder now releases on the TERM and keeps two seconds of runway (`hooks/lib/bounded-run.sh`
has the census and its repro). A run of those after that landed is a starved machine or a regression to
record. It is never a seat to stop.

**So only one of the two is a REACT line.** An enveloped timeout is FOLDED, as `harness timeout, enveloped:`
naming its commands, and owes the tick nothing: as a REACT line with no seat and no command it carried pass to
pass, exiting 3 every tick. A no-envelope one on a LIVE seat (joined
on session id, never the worktree) is a REACT line naming that seat and `slopweaver cmux reseat <ws>`, which
relaunches the same session so it re-reads `hooks.json`. Plain, never `--force`: it refuses a busy seat until
its turn ends, and refuses your own workspace, so the chair's own match is reseated from another seat. Where
the stream never named the workspace, the line points at the worktree in `cmux list` instead. A seat no
longer running, or a record that named no command, is folded under `harness timeout, nothing to reseat:`.

**A hook that never RAN is a third shape, and `perf` does not grade it.** A `SessionStart` entry whose
command names nothing exits 127 in the shell, before `scripts/hook.sh` can bound or report anything — the
attachment is `hook_non_blocking_error`, `exitCode: 127`, `… No such file or directory`. It was once
most seats' profile and run brief, racing the mirror build in the same event
([docs/hooks/mirrors-and-failure-policy.md](../../../docs/hooks/mirrors-and-failure-policy.md) § The event that
builds the mirror cannot run from it). `slopweaver transcripts boot-hooks --since <instant>` is the probe:
exit 1 on any recorded missing command or `hook.sh` target, or an unreadable transcript or project directory, 3 over none walked. It reads failure
records, so 0 means none recorded, not that every hook delivered.

## `stuck` — the wedge `ps` cannot see, and why it is a suspicion

A stall is a hook process. One finding was the other shape: a tool call held 20 and 42 minutes
with NO hook process alive under either seat, which the stall reading reports as `no hook running` — true,
and the opposite of what a reader needs. A seat is **stuck** when its last tool call is a `Bash` older than
the same stall line, and nothing is running for it: zero hook processes AND zero tool shells.

**`Bash` is the load-bearing word.** It is the one tool whose execution leaves a process, so it is the one
tool where "no process" can mean "the call never started". A `Read`, an `Edit` or an `Agent` held the same
way is invisible to this reading, and that is stated rather than papered over.

**Two things satisfy it and are not a hold.** cmux emits one frame when a tool call BEGINS and none when it
ends, so the same age also covers the model thinking or streaming after a turn's last tool call, before its
`Stop` frame lands — and a dropped turn-boundary frame would leave an idle seat's age growing without bound.
So the REACT line says **look before acting**: `perf seat <ref>` first, `cmux stop` only if it really is held.

**The other half of the same finding is in the hook, not the gauge.** EVERY registered entry runs
through `scripts/hook.sh`, which kills what it launched at a ladder under `hooks.json`'s declared timeout
(`hooks/lib/bounded-run.sh`, [docs/hooks/registered-and-bounded.md](../../../docs/hooks/registered-and-bounded.md)). What IS measured is
what the harness does when that timeout fires: it RUNS the tool call. That handed it ~22
`PreToolUse:Bash` calls at 20s, so `PreToolUse` declares 30 with the door-gated row's envelope refusing.
A seat reads its hook config ONCE, at boot, so the 30 and the closed envelope reach a seat only when it
restarts; a `hook_cancelled` at `timeoutMs: 20000` after that is an old seat, at 30000 a starved machine.
One half does reach running seats: a frozen command names a PATH, and the mirror keeps rewriting what is at
it, so `scripts/pretooluse.sh`'s own budget fix lands on old seats even though the envelope in front of it
does not.

**Turnaround only counts gaps inside one uninterrupted run.** A gap spanning a `Stop`, `SubagentStop`,
`Notification`, `AskUserQuestion`, `UserPromptSubmit` or `SessionStart` frame is dropped, because otherwise a
seat idle overnight reports a p95 of eight hours and the line stops meaning anything.

## Acting on a REACT line

A `REACT —` line is acted on THIS tick rather than folded, and every one carries the command that ends it —
`cmux stop` for a stall or a held call, `machine reap` for a stray dev server, `cmux reseat` for a seat on a
pre-envelope `hooks.json`. A reading with no act belongs in the fold, never here. A stall names the seat,
which hook, for how long, against what line, how many hook boots are live under it, and carries both levers:

```text
REACT — seat a0000083-… has its poll-gate hook stalled 43m (line 5m), 6 hook boots live: stop it with
`slopweaver cmux stop workspace:15 --why "<what it is costing>"`, or dispatch an investigation seat with
`slopweaver cmux spawn`
```

**`cmux stop` does not wait.** It sends one interrupt and returns; a `--why` arrives as that seat's next line
through the same path `cmux send` uses, so it reports ACCEPTED or QUEUED exactly as that verb does. A chair
that blocked on a peer's interrupt would be doing the thing this whole reading exists to stop. It refuses the
pinned supervisor, like every other write into a session.

There is no `pause`, on purpose: cmux exposes no pause primitive, and a "pause" built out of an interrupt
plus a standing instruction would be state nothing can read back — a seat reporting itself paused while
running is exactly the failure `AGENTS.md` rule 6 exists to prevent.

## What a reading does NOT mean

- **`frames: 0` is an unreadable log, never a quiet fleet.** The stream half reads
  `~/.cmuxterm/events.jsonl` (and its rotation) directly rather than `cmux events`, because that verb
  advances its stored cursor and a performance read must not consume what a supervisor drains next.
- **Only the LONGEST live hook per seat is attributable to a script.** A shorter one running beside it is
  counted in that seat's `boots` total and named by no row, so `perf hook <name>` under-reports concurrency
  by construction.
- **A hook NAME is never validated**, so `perf hook pol-gate` reports the same "no seat had it running" a
  correctly spelled quiet hook does. Check the spelling against `hooks/hooks.json` before concluding a hook
  is idle.
- **A seat under ~60s old is booting, not stalled** — the same caveat the stuck-chat read carries.
- **`stuck` is not a proven harness defect.** It says nothing this machine can see is doing that seat's
  work, which is also true of a seat between its last tool call and its `Stop` frame.
- **`turnaround` needs history; `stall` does not.** A seat spawned inside the window has no turnaround at
  all, and that prints as absent rather than as zero.
