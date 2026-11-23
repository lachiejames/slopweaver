# What a kill looks like in the journal

Part of [Listener supervision](../listener-supervision.md).

`$SLOPWEAVER_HOME/live/listener/arms.jsonl`, append-only and fsync'd per line, so a kill that takes the whole
process tree cannot take the last entry with it:

```jsonl
{"armId":"<arm-id-1>","atIso":"2001-01-01T00:00:12.938Z","kind":"armed","pid":46292}
{"armId":"<arm-id-1>","atIso":"2001-01-01T00:00:32.406Z","kind":"died","pid":46292,"reason":"process-dead"}
{"armId":"<arm-id-2>","atIso":"2001-01-01T00:00:32.468Z","kind":"armed","pid":48307}
{"armId":"<arm-id-2>","atIso":"2001-01-01T00:01:29.972Z","kind":"died","pid":48307,"reason":"process-dead"}
{"armId":"<arm-id-3>","atIso":"2001-01-01T00:01:30.046Z","kind":"armed","pid":52772}
{"armId":"<arm-id-3>","atIso":"2001-01-01T00:01:41.132Z","kind":"died","pid":52772,"reason":"process-dead"}
{"armId":"<arm-id-3>","atIso":"2001-01-01T00:01:41.132Z","kind":"escalated","why":"the Slack listener died 3 times inside 15 minutes; …"}
```

That is a real run with its ids and dates replaced, not an illustration: three `kill -9` sent to the process group of an armed listener in an
isolated home, each detected and re-armed within 62 milliseconds, and the third stopping rather than arming
a fourth. `status` afterwards reads `unarmed` — the bot is deliberately left down.

Read it as: three deaths, two re-arms, and a stop. The gap between a `died` and the next `armed` is the
outage — bounded by the poll interval rather than by whoever happened to notice.

`reason` is the verdict that decided it, so the journal distinguishes "the process was killed" from "the
socket died under a healthy process". A process-table monitor cannot tell those apart, because it sees
neither.

## The journal is a history, not a liveness oracle

`arms.jsonl` records what the SUPERVISOR observed, not what the process did. Nothing writes to it from inside
a dying listener, so several ordinary endings leave no trace at all:

- an operator stopping the process with a plain `kill`, rather than through `listen disarm` — the trapped
  signal closes the socket and writes a final `disconnected` beat, but it still journals nothing here;
- a `SIGKILL`, which by definition runs nothing on the way out;
- the session exiting and taking its child with it, which is the normal shutdown.

Measured: a retired loop stopped its listener with a plain `kill`, and `arms.jsonl` still held
exactly one line — the `armed` entry — with no stop event after it.

**So an `armed` line with no matching stop never means "still running".** It means nobody journalled a stop,
which is the common case. Liveness comes from the pidfile plus the heartbeat, every time — `listen status`
read `down / process-dead` correctly for that same listener, from the process table, while the journal still
showed only an arm. Reading the journal as state is the same class of mistake as the `pgrep` monitor: a
signal that cannot say "no".

**`listen reconcile` does not make the journal a liveness signal.** What it fixes is the ACCOUNTING: an
`armed` line followed by another arm's `armed` line, with nothing terminal in between, is back-written as a
`died` with reason `superseded` the next time anything reconciles. The journal cannot tell you whether the bot
is up right now; it never tells you a day held zero deaths when it held three.

## A watchdog that dies with its ward

[The supervision above](runtime-and-watching.md) assumes something is ALIVE to observe a death. In one day
that assumption broke three times, and the arm journal ended the day holding eight `armed` lines and zero
deaths.

## Measured

The Claude Code harness stopped the loop session's background tasks three times in one day. Each event took the listener task and the death-watch task on it **7–10 ms apart** —
they were sibling background tasks of one session, so whatever reaped one reaped the other. Each is a
harness `task-notification` carrying `<status>killed</status>` and an output file reading `[killed]` with no
exit code.

That signature is distinguishable from an operator stopping a listener on purpose, which is what the day's
two OTHER arm changes were (ordered re-arms onto a newer commit): those end
`[exited with code 143]` — SIGTERM, from the loop session's own `kill`. **Both discriminators live in the
harness's task bookkeeping, which this program cannot read**, so the fix does not depend on them.

## Ruled out, with evidence

- **Not a harness restart.** Zero `__orphan_summary__` entries in the session transcript, which is
  continuous across all three events.
- **Not machine sleep.** `pmset -g log` shows one unbroken 66-hour `PreventUserIdleSystemSleep` assertion
  covering the whole period.
- **Not anything the loop session or Slopweaver did.** No `TaskStop` call in the transcript, and no owner
  input in any session in either reap minute.
- **Not specific to this session.** Across all sessions on this machine the reap fires in cross-session
  bursts — one burst stopped tasks in four different worktrees within 2.5 seconds.

## Why the answer is not a better watchdog

`AGENTS.md` rule 2 permits Slopweaver to start a process only as a child of a visible session. So **every
process this repository may legally start is in the class the reaper reaps**, and a watcher placed beside
the listener will always be able to die with it. Chasing the reaper further was stopped deliberately: the
mitigation is the deliverable, and it holds whatever the reaper turns out to be.

## So a death is DERIVED, not witnessed

Everything needed is already durable and written from inside the listener's own process: it self-registers
`armed` in `arms.jsonl` and rewrites `heartbeat.json` on its own interval. `slopweaver listen reconcile`
reads those afterwards — from any session, at any later time — and back-writes what a live watcher would
have seen:

- an arm on record that is DOWN with no terminal event gets a `died` stamped at **its last heartbeat**, not
  at discovery time, so the fifteen-minute escalation window is measured against when it actually died;
- an arm that a later arm replaced with no terminal event in between gets a `died` with reason
  **`superseded`** — which claims the arm ENDED and deliberately claims nothing about how.

Both carry `discovery: "reconciled"`, so a reader can always tell a witnessed death from a reconstructed
one. The pass is idempotent — a terminal event already on record closes that arm — so ticking it costs one
file read when nothing is wrong, and it is safe to run from any number of sessions at once.

**It never escalates and never re-arms.** A verb any session may tick must not be able to leave the bot
deliberately DOWN; that stays `listen supervise`'s decision, in the session that owns the listener.
`supervise` reconciles before it decides, so the loop's own next tick counts the deaths it slept
through: three cross-arm deaths inside the window escalate exactly as three witnessed ones always did.

## Where it runs, and the one ambiguity it leaves

The **supervisor sweep** ticks it — step 6b of
[sweep-contract.md](../../skills/supervisor/reference/sweep-contract.md), a visible pass that shares no fate
with the loop session's own tasks. It prints only when it recorded a death, per MONITORS-ALERT-ONLY.

The trade is stated rather than buried: the probe runs once per supervisor pass, and with no pass running
nothing checks — the same "nothing stands by" property `AGENTS.md` rule 2 states.

The ambiguity: from `arms.jsonl` alone a deliberate operator stop looks exactly like a reap. That is fixed
at the SOURCE rather than guessed at — **stop a listener with `slopweaver listen disarm` first**, which
journals `disarmed`, and a reconciling pass then leaves that arm alone. An operator who skips it gets one
arm recorded as `superseded`, which is the honest reading of what the journal knows.
