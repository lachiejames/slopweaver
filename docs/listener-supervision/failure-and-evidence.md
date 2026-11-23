# What went wrong, and what is actually proven

Part of [Listener supervision](../listener-supervision.md).

## Measured, and not in dispute

- Two kills, about ten minutes apart in the small hours. Both reported background-task status `killed` with an
  empty body and no stderr. The last lines in each log were ordinary "ignored a message event" narration —
  the listener was healthy right up to the kill.
- The whole three-process tree went at once each time. That is the signature of a **process-group signal**,
  not of a per-process kernel kill.
- Arm #1 survived 3h29m; arm #2 survived about five minutes. No single "it runs out after N" story fits both.

## Ruled out, with evidence

**The macOS kernel did not kill it.** `/Library/Logs/DiagnosticReports/` holds exactly one `JetsamEvent`
report, dated a week earlier — none on the night of the kills. Over the whole hour around them,

```
log show --predicate 'process == "kernel" AND eventMessage CONTAINS "memorystatus: killing"'
```

returns only `killing_idle_process … (idle-exit …)` lines for idle system daemons. Not one names `node`, and
not one is a non-idle kill. Jetsam reports each victim individually and files a report; neither happened.

## Real, and still only correlation

System memory pressure was severe and its minutes bracket both kills. Counting the kernel's own idle-exit
sweeps per minute:

| minute      | idle-exit kills      |
| ----------- | -------------------- |
| 02:11–02:13 | 34 / 59 / 7          |
| 02:24–02:28 | 5 / 59 / 36 / 4 / 52 |
| 02:40–02:42 | 20 / 59 / 21         |

Kill #1 lands just after the first burst; kill #2 lands inside the second. At the time, an on-device vector
embed build was at ~9.1 GB RSS and 611% CPU, with 596 MB of 1,024 MB swap used. **That is a correlation with
the pressure, not a demonstration that pressure did the killing** — the kernel's own response to it was
reaping idle daemons, which is a different thing from killing a listener.

## The best surviving hypothesis, named as a hypothesis

The terminal multiplexer hosting the sessions documents an "agent hibernation" feature, and its settings pane
says: _"During critical memory pressure, cmux may still hibernate safe idle background agents"_ — a path
independent of the scheduled on/off toggle. That fits the evidence better than anything else: an idle
background agent terminal, during a critical-memory-pressure minute, killed by something in userspace rather
than by the kernel.

It is **not proven**, and two checks say so:

- The scheduled toggle was never on. `defaults read com.cmuxterm.app` shows the only persisted key as
  `terminal.agentHibernation.enabled = 0`, and the config template documents the app default as `false` too.
  So the _scheduled_ path is ruled out; only the critical-pressure path remains.
- Its event stream cannot witness it. The full event-name vocabulary over a 20,000-event slice contains no
  hibernation event of any kind, and the stream's retained buffer no longer reaches back to the kill window.

**So the reaper is not named.** What is settled is that it was not the kernel, and that it reached the
listener through a process group the listener had no business sharing.

## Why the fix did not wait for the name

Naming the reaper changes the diagnosis, not the design. What the listener needed was not immortality — it is
supposed to die with its session — but for its death to be **noticed**, which is a different problem and the
one a `pgrep` monitor comprehensively fails at.

## Process lifetime, measured

A process started inside a tool call survives the call returning; the process group is not cleaned up.
Measured directly, three ways:

- A plain `nohup … &` and a real `setsid` fork both survived, reparented to launchd, across many later tool
  calls.
- So did a **bare `&` with no detachment at all** — the shape this design actually uses. The listener started
  as pid 2925 (PPID 2822, PGID 2686, the tool call's own group) was still running and still beating after the
  call that started it returned.

So a tool call returning does not group-kill what it started.

**And the foreground/background question has a structural answer.** A long-lived FOREGROUND Bash call is no
alternative to `run_in_background`, because the harness converts one into the other: a foreground call that exceeds its timeout is **moved to the
background as a harness-tracked task** rather than killed. Observed three times in one session while running
`yarn lint` and `yarn typecheck` (task ids `bn53anm96`, `bo5mwvw30`, `biyyi9x0z`, each reported "Command
timed out … and was moved to the background"). The foreground ceiling is 600s, so any listener meant to run
for hours becomes a background task within ten minutes no matter how it started. Foreground is not a
different shape; it is the same shape reached more slowly.

That is why the answer is a death-watch rather than a better hosting trick.
