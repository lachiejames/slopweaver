# The machine gauge — what `machine capacity` reads, and the two readings that sized it

Detail behind [fleet-capacity.md](fleet-capacity.md)'s hold thresholds. Read it before raising any of them,
or before grading memory or CPU from anything other than this gauge.

## The subject an `ok` did not name

**MEASURED.** `slopweaver machine capacity` printed, verbatim:

```
machine capacity: ok — top foreign hog 'com.apple.Virtualization.VirtualMachine' at 1.8 GB · swap 0.8/2 GB · compressor 12% of segments limit · 2 swapfiles
```

At that moment the 1-minute load average was **34.84** and `yarn validate` had refused four consecutive laps,
each on a DIFFERENT innocent test file (`sessionStart/githubRead`, `cli/commands/turn/run`,
`canon/staleReferences`, `cli/commands/automation/scheduler`), every one a 5000 ms timeout, every one passing in
isolation immediately after, at 19,800 to 19,810 of ~19,811 passing. The CPU came from four `node` processes at
108%, 84.7%, 122% and 132% of a core. Memory, swap and the compressor were all genuinely healthy: **the gauge
was not wrong about what it measures — it was blind to the only thing that was wrong**, and a session told to
consult it before deciding the machine was usable burned ~9 minutes per refused lap.

**Two properties close it, and neither works without the other.**

1. **Load is in the verdict AND the hold.** The 1-minute load LEADS the verdict's summary beside `top`'s idle
   (Activity Monitor's figure), holding at `floor(3 x hw.ncpu)` — 45 here, derived — only while idle reads under
   20%, a judgement; unread idle leaves load alone (`src/live/machine/cpuLoadHold.ts`).
2. **Every verdict names the subject it graded.** `ok` meaning `ok on memory` is exactly what misled here, so
   there is no bare `ok`: it reads `ok on memory and cpu`, or `ok on memory · cpu UNGRADED` when `top`
   printed no load header, or `graded nothing` when nothing at all was readable. A HOLD and an ALERT name
   their own subjects too — `HOLD on cpu (1-min load 34.84, hold at 22)` — and the `capacity-hold` stream
   event carries the same word in `holdOn`, so the stream's `where` column never says `compressor` for a CPU
   hold.

**What load does NOT do.** A foreign hog is a briefing line and never by itself a hold, and load bounds
concurrent GATE LAPS rather than sessions
([fleet-capacity.md](fleet-capacity.md) § "What the machine actually holds"), so a fleet full of
investigations sits far below it. `slopweaver machine capacity --json` carries `load`, `loadHold`, `graded`,
`ungraded` and `holdSubjects` beside the memory readings.

**The class this belongs to**, and why it is worth naming rather than fixing quietly: a verdict whose real
subject is invisible in its own output. Two other members: a non-fast-forward push rejection arriving
buried, and the merge guard's base-relative findings. A grade a reader cannot attach
to a subject is not a shorter answer, it is a different one.

## The hog the process table cannot see — a process hidden from `top`

**MEASURED**: the verdict named the Docker VM as the top foreign hog while the owner's
Activity Monitor showed `com.example.endpoint.Agent` at 285.7% CPU and 6.58 GB. The sensor's tamper
protection refuses task stats: `top` leaves every Falcon process out of its table, `ps` lists them at `rss 0`,
and `powermetrics`/`footprint(1)` need root. The JumpCloud systemextension beside it reports normally, so this
is a property of the sensor, not of system extensions.

So the verdict carries `hidden from top: '<name>' +N more, X cores of cpu unattributed` directly behind
the top foreign hog, and `--json` carries `hiddenCpu`. A process is HIDDEN only when `ps` lists it live at
`rss 0` AND the final `top` sample's table lacks its pid — `rss 0` alone also matches a paged-out stopped
process, which `top` still lists. X is `top`'s busy header less its per-process rows on that final sample
(1.0 to 3.2 cores across six samples) and it carries whatever exited between samples too (8.7 cores
during a `validate:local` lap at load 25), so it is UNATTRIBUTED, never "the sensor's CPU", and it prints only
beside a hidden process. A damaged or one-sample report, or a final table whose row count disagrees with its
own `Processes: N total` (the two matched on every capture), prints no number. A hidden process's memory has no
unprivileged source; nothing estimates it.

**What it does NOT do.** No alert and no hold fire on it — load already grades the CPU the sensor
burns. Reproduce: `ps -ax -o pid=,rss=,stat=,comm= | awk '$2==0 && $3 !~ /Z/'` and
`top -l 2 -s 1 -stats pid,cpu`. The pure half and its measurements: `src/live/machine/hiddenCpu.ts`.

## The hold that named nobody — fleet attribution, orphans and the hook stall

**MEASURED**: the machine sat at load 100-146 against a hold of 22 for over two
hours while eleven consecutive sweep ticks published `HOLD on cpu (1-min load 146, hold at 22)` — true, and
naming nobody. The cause was 64 orphaned `zsh` shells and one worker running nineteen tool calls in parallel,
each stuck 43 minutes on its PreToolUse hooks. The verdict names a CULPRIT and offers the kill, and
`slopweaver machine reap` takes the orphans every tick: **[fleet-attribution.md](fleet-attribution.md)** has
the attribution, both thresholds and why a sub-agent count never holds.

## The hold nobody consumed — the reading became a dispatch

**MEASURED**: this gauge published a `capacity-hold` naming a stalled
hook and NOTHING acted on it; the owner found load 45.9, a `bfs` at three cores and five stale `nx`
daemons by hand. A louder verdict would have changed nothing, so the reading causes work by itself:
`slopweaver machine watch` writes a finding row and seats a visible investigation, `supervisor tick-record`
REFUSES a tick that saw a hold with neither a SEATED dispatch nor a `hold-rationale` on the `machine`
subject, and `--json` carries `dispatch: { open, covering, subject, backoffSeconds }` off that register —
`covering` is the subset that seated a session, and a failed or backed-off seat answers nothing. The whole
mechanism, its four triggers and why the backoff gates the SEAT and never the ROW:
**[load-dispatch.md](load-dispatch.md)**.
The five nx daemons are closed at the source: worktree seats boot with `NX_DAEMON=false`, and both close verbs
SIGTERM an orphaned node process working in an unheld closed worktree (`src/live/machine/worktreeResidue.ts`).

## The gauge that missed the panic — compressor segments and swapfiles

**The machine once kernel-panicked under the fleet**
(`/Library/Logs/DiagnosticReports/panic-full-<date>-<time>.0002.panic`, the owner's crash report). The
watchdog fired because WindowServer had made no check-in for 153 s, and the panic log's own memory line is the
whole story:

```
Compressor Info: 39% of compressed pages limit (OK) and 100% of segments limit (BAD) with 49 swapfiles and OK swap space
```

The stackshot's three largest footprints were a fleet-spawned `Python` at **47.1 GiB** (single-threaded, 9.8 s of
CPU — a process that read something enormous into memory in seconds; `~/.slopweaver/corpus/.cache/vectors.jsonl`
is 8.3 GiB and `bronze/slack/compact.jsonl` 6.4 GiB, either of which decoded whole in Python reaches that),
`fseventsd` at **27.7 GiB** and `mds` at **20.2 GiB** — on a 48 GiB machine, with 25 Claude Code sessions and 85
`node` processes beside them. That shift's fill step had read `memory_pressure -Q` at ~50% free and called the
~21 GB of swap "stale allocation, not a hold". Both readings were true and neither measured the thing that
failed.

**What the segments limit is.** The compressor stores compressed pages in 64 KiB segments, in memory or swapped
out, and caps the segment count at `vm.compressor.segment.limit` (`vm.compressor_pool_size /
vm.compressor_segment_alloc_size` = 101166841856 / 81920 = **1,234,946** here — about 75 GiB of compressed data
wherever it sits). `vm.compressor.segment.total` is the count in use. At 100% the compressor cannot take
another page, every allocation stalls behind it, and a process that cannot check in gets the machine rebooted
under it. `memory_pressure`'s free percentage cannot see this: at the panic the kernel still reported
`memoryPressure: false` with 911 free pages.

**The gauge, and the two MEMORY holds.** `slopweaver machine capacity` reads
`sysctl vm.compressor.segment.total vm.compressor.segment.limit` and counts the swapfiles under
`vm.swapfileprefix`'s directory, prints both (the ranked process table is one count line unless `--full`),
carries them in `--json` (`segmentsPct`, `segmentsUsed`,
`segmentsLimit`, `compressedPagesPct`, `swapfileCount`), and reports **`hold: true`** — publishing a
`capacity-hold` onto the supervisor stream — when either crosses its threshold:

| Reading                                                     | Healthy (21 sessions, 5 h 46 m up) | Hold at | Panic |
| ----------------------------------------------------------- | ---------------------------------- | ------- | ----- |
| `segment.total / segment.limit`                             | 182761 / 1234946 = 15%             | 40%     | 100%  |
| swapfiles under `$(dirname $(sysctl -n vm.swapfileprefix))` | 3                                  | 12      | 49    |

Why those two numbers, so the next reader ratchets instead of re-arguing: the ~21 GB-swap reading that was
called fine already meant 21 GiB / 64 KiB = 344k segments **swapped out alone** — 28% before counting the
in-memory compressor, which held 24.4 GiB (1,599,208 pages) at the panic — so 40% sits at or under the state
that was misjudged, and 12 swapfiles is 3× the swap alert and well under the 21 that reading implied. Raise
either only with a tick observed stable above it, recorded here with the reading.

**What the gauge cannot do, said plainly:** a 47 GiB balloon in ten seconds outruns any per-tick read.
The same is true of the load reading — a 1-minute average is by construction a minute behind a machine that
has just been buried, so it holds the NEXT spawn rather than rescuing the lap already running. The hold
stops the fleet from ADDING to a compressor that is already filling; it does not stop one session's tool call
from eating the machine. That is the standing rule about never decoding a multi-GiB corpus file whole, not a
gauge.

## A session's child is fleet, and the gauge names the session

**MEASURED.** A bot turn's `python3 -` heredoc read the multi-gigabyte Slack `compact.jsonl` whole
and reached a footprint of **tens of GB** with the machine at its **12-swapfile hold**. `ps` printed its argv as
`Python -`, so the gauge called it `top foreign hog 'Python' at <tens of> GB`, and the chair found its session by hand through a
`ppid` chain and `lsof`. The `whole-file-json` lint gate reads TypeScript and cannot see a heredoc, so this
gauge is the class's only runtime witness.

So a process whose parent chain reaches a session in Claude Code's own registry (`~/.claude/sessions/<pid>.json`,
joined by exact pid) is `fleet`, and every such row carries that session — `· session <id> in <worktree>`
in text, `session` in `--json`. Every such child — not the session's own `claude` — over the same 8 GB as a
foreign hog ALERTS with its own clause naming its session; the largest is `topFleetChild`, and the
`capacity-alert` stream event carries its `fleetChildLabel`/`fleetChildSessionId`. Still never a hold by itself. Residue: a session
whose registry file is unreadable owns nothing, so its child reads foreign. The rule that prevents
the balloon, rather than reporting it, lives in `skills/loop-bot/reference/dynamic-planning.md` § 3.

## Why fseventsd churns, and the fix

The panic stackshot names the consumer, not just the producer. `fseventsd` (pid 531) sat at 27.7 GiB with its
`com.apple.fseventsd.notify` thread at **30.8 h of CPU** across the 12.8-day uptime, and the only clients it
had dedicated threads for were **cmux (pid 3085) and Finder (pid 3102)** — with two fseventsd threads
`turnstile blocked on task pid 3085`, i.e. blocked sending events to cmux. fseventsd's memory is queued events
for clients that have not drained them; a slow consumer is what turns event volume into resident gigabytes.
Since the reboot it is still at ~15% of a core (`ps -o cputime= -p "$(pgrep -x fseventsd)"` against `uptime`).

The producer side, measured with a 20-second recursive `fs.watch` sample:

| Tree                                          | Events / 20 s | What                                                                                          |
| --------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `$TMPDIR`                                     | 7,293         | vitest fixture scratch dirs — `slopweaver-heapguard-*`, `merge-facts-*`, `probe-sweep-repo-*` |
| `~/dev/personal/slopweaver/.claude/worktrees` | 314           | one worktree's gate run                                                                       |
| `~/.slopweaver`                               | 5             | the listener                                                                                  |

Every Claude Code session is an FSEvents client too — `log show --last 30m --predicate 'eventMessage CONTAINS
"fsevent_add_client"'` shows `claude` and `node` registering, 25 clients in 20 minutes — so each event under a
watched worktree fans out per session. The two suspects in the ask are NOT the churn: the ~760k stale
`slopweaver-*` temp dirs cost `mds` and anything that enumerates the directory, but a directory that merely
exists emits no events (and the count had already been swept to ~3.5k by this reading); the 127 worktrees with
`node_modules` cost `mds` and make each watched tree larger, but the events come from gate runs, not from
worktrees sitting still.

**The fix, in order of leverage:**

1. **Stop cmux consuming the firehose.** `~/.config/cmux/cmux.json` carries `watchGitStatus` (default `true`,
   currently commented out): set it `false`. cmux is the client fseventsd was blocked on, and git status for 25
   worktrees under continuous gate runs is the one subscription that spans every producing tree. Owner's
   machine config — proposed here, not applied.
2. **Keep test scratch out of the fan-out and off the disk.** Every vitest lane points `TMPDIR` at a per-file
   root nested in one per-run parent that a `globalSetup` teardown removes (`src/__tests__/setup-temp-root.ts`,
   `global-temp-root.ts`, [testing.md](../../../.claude/rules/testing.md)), so every `tmpdir()` caller is caught.
3. **Prune worktrees nothing is using** (`slopweaver worktree prune`) — smaller watched trees for every
   client. `mds` itself is already handled by the `<repo>/.claude/worktrees.noindex/` layout both checkouts
   carry and every `git worktree add` re-asserts — [docs/spotlight-and-worktrees.md](../../../docs/spotlight-and-worktrees.md).

**Waiting out a hold is a flag, never a script.** `machine capacity --wait` re-reads until no hold but disk stands, and
`cmux spawn <slug> --model <m> --wait` holds that ONE spawn until it clears, so a list is a `for` loop over
`cmux spawn … --wait` rather than a `spawnN-M.sh` re-reading capacity between each. Both exit 4 when
`--timeout-seconds` (default 540) passes with the hold still on, having opened nothing. **Recent boots hold too**: 6 sessions started in 180 s is `HOLD on boots` (`src/live/machine/recentBoots.ts`). Boots alone seat no investigation, publish no `capacity-hold`. **The disk floor holds too**: `df`-available under room for a 5.6 GB seat tree each for the 6-seat boots burst, the next and one spare (44.8 GB) is `HOLD on disk`, which a `--wait` settles past and `worktree prune --apply` clears ([disk-floor.md](disk-floor.md)). **Every spawn, waited or not, goes through the fleet-wide spawn backoff**: a held reading closes the door fleet-wide for an exponential window, and recovery admits one spawn at a time ([spawn-backoff.md](spawn-backoff.md)).
