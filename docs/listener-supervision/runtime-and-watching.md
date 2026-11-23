# How the listener runs

Part of [Listener supervision](../listener-supervision.md).

`slopweaver listen arm` prints one line, and the session runs it:

```
mkdir -p …/live/listener/logs && …/bin/slopweaver listen --follow --heartbeat <armId> \
  --queue …/live/listener/queue.jsonl --home … \
  >> …/logs/<armId>.jsonl  2> …/logs/<armId>.err  &
```

Every part of that is load-bearing:

- **a bare `&`, and nothing else.** No `nohup`, no `setsid`, no `disown` — not because they would detach it
  (it is already detached; see below) but because each buys nothing and makes the next reader believe in a
  protection that is not there. Measured on darwin two tool calls apart, a bare `&` job had
  ppid 11578 — its tool-call shell — and **ppid 1** by the next call, with the shell gone.
  [Process lifetime](failure-and-evidence.md#process-lifetime-measured) measures that all three shapes SURVIVE;
  the parentage is the same for all three too, which is why the answer is the death-watch, not an operator choice.
  `src/cli/commands/turn/tickerOwner.ts` carries the same finding for the turn-watch ticker.
- **a fresh log file per arm.** Not tidiness. Measured on the night: a re-armed listener appended to its
  predecessor's log, so `tail` showed "connected to Slack over Socket Mode" from a process that no longer
  existed, and the surface looked live while the bot was deaf. Never judge liveness from a tail of a shared
  append log.
- **redirected rather than inherited**, so the listener's JSONL is not interleaved with whatever else the
  session's shell is printing.
- **`mkdir -p` in the line itself**, so `arm` writes nothing at all and a command saved from an earlier tick
  still works.

`arm` refuses when a live arm already exists. Slack load-balances a tag across two Socket Mode connections
for the same app, and only one of them would be the one being watched.

## Two streams, never merged

The line redirects stdout and stderr to **separate** files, and nothing downstream may put them back
together. Stdout is pure JSONL — one admitted mention per line, and that line is what the loop wakes on.
Stderr carries the frame-level narration: every Socket Mode frame the listener sees, including the ones it
discards (pings, reconnect frames, anything that is not an `events_api` frame).

**Stdout has ONE source.** Every line on it is an admitted mention the socket just delivered; a follow-up tag
is judged rather than parked (owner ruling), so the listener tails no inbox.

Merging them with `2>&1` before handing the result to a background watcher (a `Monitor`-style tool, a
`tail -f`) defeats that on purpose. Slack's socket produces protocol chatter far more often than the bot is
actually addressed, so a watcher armed on every line of the merged stream wakes on that chatter — measured,
not hypothetical: a whole turn burned every few seconds to narrate "not an admitted mention" about a raw
protocol frame it was never meant to see. So `armCommandLine` never emits `2>&1`.

"Watch the durable `--queue` copy instead" is not the escape it looks like: AGENTS.md rule 2 makes that copy
explicitly NOT a trigger path.

## The listener registers itself

Nothing external records the pid, because on one of the launcher's two paths nothing external _can_. The
launcher (`bin/slopweaver`) `exec`s `node` on the built `dist-cli/cli/index.js` when a build exists, and
otherwise `exec`s `tsx` on the source — and **`tsx` then forks** the process that opens the socket (measured). The one exception is a launch marked `SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER=1`, which only the courier's
in-place re-exec sets: it is already tsx's child, so the source starts as that child with no new fork. On that source path a pid captured by whoever ran the command is the launcher's, not the listener's —
so a supervisor watching it would see a live launcher over a dead listener, or signal the launcher and leave
the real listener holding the socket.

So the listener writes `arm.json` from inside its own process, with its own `process.pid`, and journals
`armed`. The recorded pid, the beating pid and the pid holding the socket are then the same number by
construction. Proven: arm record `pid 2925`, heartbeat `pid 2925`.

## A stop CLOSES the socket, and the app's connection budget is shown before another is opened

Slack caps a Socket Mode app at **ten** simultaneous connections, and a closed socket keeps counting against
that cap for tens of minutes after its process is gone. That is a RATE limit on restarts rather than a leak:
a session that restacked repeatedly hit `REFUSED: Slack reports 10 connections for this app` with ZERO
`slopweaver listen` processes anywhere on the machine, was down for twenty-four minutes, and then connected
cleanly on its own with no intervention and no token rotation. Two things follow.

**The listener traps `SIGINT` and `SIGTERM`** (`src/cli/commands/listen/stopSignal.ts`). The signal aborts
the loop's own stop signal, which the reconnect loop already answers by calling `SocketConnection.cancel` —
the websocket close handshake, bounded by `wire.ts`'s `CLOSE_TIMEOUT_MS` — and the process then exits 130 or
143, the shell's own 128 + signal convention. A second signal exits immediately, and a ceiling
(`WORK_ARM_GRACE_MS`) backs the first, so Ctrl-C can never become a no-op. Two consequences worth stating: a
socket closed by the handshake stops counting against the cap far sooner than one torn down by an untrapped
kill, and `exitCodeOfLoop`'s `finally` runs on a signal, so the final `disconnected` beat is
written instead of the last beat saying `connected` forever. **`listen disarm` still sends no signal** — the
process belongs to the session, which stops it the way it stops anything else, and an unjournalled stop is
still counted as a death.

**`listen arm` prints what Slack last said about the count, before it prints the command.** The number is
observable in exactly one place — the `hello` frame's `num_connections`, which `live/listen/connections.ts`
reads — and it is written whole to `$SLOPWEAVER_HOME/live/listener/connections.json` with the instant it was observed, and `listen arm` renders
it with its AGE, on stderr, above every other line it prints.

What it is NOT is a live gauge, and every line says so. **Nothing local can compute this count**: the arm
journal recorded THREE arms across the nine hours before that refusal, while Slack reported TEN — every
reconnect inside one long-lived `--follow` arm opens a fresh socket, another home or machine on the same app
token spends the same app-wide cap, and the retention is Slack-side. So the reading is a FLOOR of stated age,
`listen arm` REPORTS it and never refuses on it, and the enforcement point stays where it already was: the
permit at the `hello` frame, on the authoritative number. `live/listen/supervise/socketBudget.ts` carries the
reasoning; `--json` carries the reading as `socketConnections`, `null` when none has been taken, beside
`socketConnectionsProblem` — the read failure, named, because a record that could not be READ and one that
was never written are different facts and both answer `null` on the first field. The narration goes to
stderr on both shapes.

**A refused `hello` is retried for two minutes before it ends the listener.** The retention cuts both ways: a
socket this listener has just LOST is still counted, so the reconnect after a socket error can be told `2` by
its own ghost. That killed one arm with no other listener on the host and the
supervisor's re-arm told `1` about 25 seconds later. Every over-one `hello` is still refused and its
connection cancelled before anything buffered on it is handled; what changed is the PROCESS, which retries on
the ordinary backoff, outside the consecutive-failure budget, until a `hello` is permitted or
`MULTIPLE_CONNECTIONS_GRACE_MS` (`live/listen/connections.ts`) has passed since the first refusal — measured
as the longer of the wall clock and the backoff already waited, so a clock moved backward cannot stretch it. A permitted
`hello` also resets that budget, so failures from hours earlier in a long-lived arm no longer count as
consecutive. `cli/commands/listen/connectionStep.ts` carries the decision.

## This is not a daemon, and not the resident executor rule 2 forbids

Nothing here starts, execs, forks or schedules `claude` or any other model runner — nothing here starts
_anything_. What the session runs is `listen --follow --queue`, the shape rule 2 names as explicitly allowed:
it records addressed messages as durable JSONL and never invokes a model or posts an answer. A tag arriving
while no visible session is draining that queue gets no **answer**, by design; what it gets is the capture
and the acknowledgement — which is what a listener is for, and what a dead listener silently is not doing.

## How it is watched

## A check that can fail

A `pgrep -f "src/cli/index.ts listen --follow"` monitor is not one: that string is part of the monitor's own
command line, so `pgrep` matches the monitor's shell whether or not a listener exists. It reported
"alive" on two checks fifty minutes apart and would have reported it identically with the bot dead. The obvious
`[i]ndex.ts` fix does not help: any command-line pattern the monitor embeds self-matches.

**Before trusting a liveness check, ask whether it would emit if the thing were dead right now.**

## Two signals, not one

| signal                   | what it proves                                        | what it cannot see                      |
| ------------------------ | ----------------------------------------------------- | --------------------------------------- |
| pidfile + `kill(pid, 0)` | the process is in the process table                   | a live process whose socket died        |
| `heartbeat.json`         | the socket's state, as the listener itself reports it | a process that was killed between beats |

The listener rewrites `heartbeat.json` **whole** every 15 seconds, stamped with its own arm id, pid, socket
state and the instant Slack last delivered any frame — `ping` included, because the question is "is Slack
still talking to this socket", not "did a tag arrive". A beat that appended would repeat the shared-log
failure exactly; a whole-file rewrite carrying the writing arm's id cannot.

## The verdicts

`slopweaver listen status` produces exactly one of these:

| verdict             | meaning                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| `unarmed`           | nothing is being supervised. A tag arriving now is a no-op BY DESIGN.                   |
| `starting`          | armed within the last 90s and not beating yet — a handshake, not a death                |
| `process-dead`      | the pid is gone. **Both kills in the first incident took this shape.**                  |
| `heartbeat-missing` | alive, past the grace window, never beat                                                |
| `heartbeat-foreign` | the newest beat belongs to a different arm — a beat from a dead process                 |
| `heartbeat-stale`   | this arm's beat stopped, four intervals ago or more                                     |
| `socket-down`       | alive and beating, socket not connected — **the failure a pidfile check can never see** |
| `healthy`           | alive, beating, connected                                                               |

Process death outranks everything, then a foreign beat, then a missing or stale one, then the socket's own
state. That order is the contract: a beat can outlive its writer by up to its own tolerance, so a fresher
signal must never be allowed to mask a deader one. `status` exits non-zero on any DOWN verdict.

**`reconnecting` exists because a reconnect is normal.** `reconnect.ts` backs off to 30 seconds between
attempts, so an instant reading of "socketState is not connected" catches a perfectly healthy listener
mid-backoff. The beat therefore carries `socketStateSinceIso` — when the socket ENTERED that state, not when
the beat was written — and only 90 seconds of continuous non-connection is called `socket-down`. Without
that distinction the supervisor would kill and re-arm a listener that was about to reconnect on its own, and
three of those in fifteen minutes would escalate to the owner about nothing at all.
