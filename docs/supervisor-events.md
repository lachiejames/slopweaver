# The supervisor stream

One append-only file that every long-running Slopweaver surface publishes its state changes onto, and one
verb a supervisor reads it with. It exists so the supervisor is TOLD rather than made to ask.

It exists because the supervisor session needs visibility into what the Slack socket is doing: its current state, and
confident knowledge of when something is wrong.

## The short version

```bash
slopweaver events tail --cursor supervisor                    # what has happened since I last looked
slopweaver events tail --cursor supervisor --min-severity warn # …only the parts worth acting on
slopweaver events tail --follow --min-severity alert          # wake me the moment the bot goes off the air
```

`tail` exits **3** when it printed an `alert` (or detected a gap) and **0** when the stream was quiet, so

```bash
slopweaver events tail --cursor supervisor --min-severity alert || surface-it-to-the-owner
```

is a whole supervision idiom in one line — a caller that reads nothing but the exit code still cannot miss a
death.

## What is on it

| source             | kind                 | severity | what it means                                                                                                                                     |
| ------------------ | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listener`         | `armed`              | info     | the listener registered itself and is holding the socket                                                                                          |
| `listener`         | `heartbeat-degraded` | warn     | starting, or off the socket and inside its backoff                                                                                                |
| `listener`         | `died`               | alert    | the bot is off the air; carries the dead arm's own log                                                                                            |
| `listener`         | `re-armed`           | warn     | a re-arm command was handed back to the visible session                                                                                           |
| `listener`         | `escalated`          | alert    | re-arming stopped; the bot is deliberately left DOWN                                                                                              |
| `listener`         | `disarmed`           | info     | somebody cleared the arm record on purpose                                                                                                        |
| `listener`         | `recovery-stalled`   | alert    | the recovery watermark has sat still ≥1h under a live listener                                                                                    |
| `github-merge`     | `main-gate-failed`   | alert    | a `github merge --admin` post-merge probe found the base still failing a docs budget right after landing                                          |
| `github-hold`      | `held`               | info     | one pull request now owns a repository's merge queue; every other one is refused at `github merge` and `github enqueue`                           |
| `github-hold`      | `released`           | info     | the hold was cleared, by hand or by the merge that landed the held pull request                                                                   |
| `github-hold`      | `stale`              | warn     | a hold has stood past its own threshold (default 30 min) and may have outlived its reason                                                         |
| `github-attach`    | `needs-owner-login`  | alert    | an upload was not delivered on a github.com sign-in or the org's SSO prompt; the fleet presses it with `browser sign-in` first                    |
| `github-attach`    | `login-captured`     | info     | `github attach status` found github.com sign-in cookies in the owner's Chrome — a local read, not proof the session or an org's SSO grant is live |
| `standing-session` | `stale`              | alert    | the loop is running code or prose the fleet has already replaced                                                                                  |
| `standing-session` | `current`            | info     | it is current with `origin/main`, or behind it in ways it does not run — the clearing half                                                        |
| `standing-session` | `respawned`          | info     | the loop's successor CONFIRMED its own arm live from its own tree                                                                                 |
| `refresh`          | `write-refused`      | alert    | one corpus source read fine and did NOT reach bronze, so its world model is frozen                                                                |
| `refresh`          | `committed`          | info     | that source wrote its rows — the clearing half, carrying the count                                                                                |
| `machine`          | `capacity-alert`     | alert    | a foreign process's memory footprint, or swap used, crossed its own threshold                                                                     |
| `machine`          | `capacity-hold`      | alert    | the compressor, the swapfile count or the 1-minute load crossed its HOLD threshold — spawn nothing                                                |

Severity is **derived** from `(source, kind)` by `severityOf`, never carried on the wire — a stream written
by an older build cannot disagree with the reader about what is urgent.

**`standing-session` is the source that answers a question no liveness gauge could.** A standing session on a
two-day-old worktree is `healthy` on every other signal here and silently applies none of the fixes that
landed — measured, when the Slack loop and the standing scheduler ran a
tree **74 commits behind** through a whole day of public failures, with nothing on any surface saying so. It
has no resident publisher either: `session standing` publishes `stale` and `current`, and a confirmed `session
respawn` publishes `respawned`. Publication is **edge-triggered** against the stream's own tail for the
same reason `heartbeat-degraded` is — `session standing` is called every few minutes, and a stream repeating
one alert forty times is a stream its reader learns to skip. An UNMEASURABLE session publishes nothing at
all, because neither `stale` nor `current` would be an honest claim; the verb that could not measure it says
so on its own output and exits 3.

**`refresh` is the source that answers "is the world model still moving?", and it exists because that
question once had no answer for five days.** Measured: `bronze/slack` grew a 5.9 GiB window file, the
bronze writer could not build its dedup index over it, and so — correctly — refused every Slack write for
five days. The refusal was printed, on stderr, mid-crawl, in a run nobody was watching. The bot kept answering
from the corpus it already had, every liveness gauge stayed green, and nothing said its Slack world model had
stopped. Like `standing-session`, this source has no resident publisher: `slopweaver refresh` publishes one
event per source at the end of its own run, and it publishes the healthy half too, or a briefing would show a
frozen corpus forever with nothing able to clear it.

**`github-hold` is the one source with no resident publisher, and its `stale` is the one event nothing emits
on a timer.** A hold crosses its threshold silently; the warning is published the first time any surface
READS the document past that point — `slopweaver github hold --status`, which the supervisor's sweep runs
every tick, or a `github merge` the hold refuses. Whichever reader gets there first marks the hold, so eight
sessions hitting their own merge step produce one warning rather than eight. With nobody looking at all,
nothing warns and the hold still stands: it is a nudge, never an expiry.

**`machine` is the one source that is not about the fleet's own sessions — it watches the machine they run
on.** Measured: `mds` (Spotlight's own indexer) sat at 19.7 GB memory footprint with 6.2 GB
swapped, from indexing ~130 worktrees, the bronze corpus and 350k+ leaked temp fixture dirs, and nobody in the
fleet had looked. `slopweaver machine capacity --json` reads `top`'s own `mem` stat — Activity Monitor's
Memory column, which counts compressed and swapped pages `ps`'s RSS does not (0.1 GB for that same 19.7 GB
process) — classifies every process fleet (this checkout's own `claude`/`node`/`cmux`) or foreign, and
publishes `capacity-alert` when a foreign process exceeds 8 GB or swap exceeds 4 GB, and `capacity-hold` —
the fill step spawns nothing while the newest one stands — when the VM compressor reaches 40% of its segments
limit, 12 swapfiles exist, or the 1-minute load average reaches 3x the core count while `top` reads under 20% idle
(`segmentsPct`/`swapfileCount`/`load1` ride on both kinds). The memory half of the hold exists because of a
kernel panic: the panic log read `100% of segments limit (BAD) with 49 swapfiles` while
`memory_pressure -Q` had read ~50% free — `skills/supervisor/reference/fleet-capacity.md` § "The gauge that
missed the panic".

**A `capacity-hold` says WHICH subject held, in `holdOn` and in its `where` column.** The verb grades two
subjects that fail independently — memory (footprints, swap, the compressor, swapfiles) and CPU (the load
average) — so a row whose `where` column always read `compressor` would misname a CPU hold exactly as a
verdict reading `ok` once misnamed an overloaded machine as healthy. `holdOn` is `memory`, `cpu` or
`memory and cpu`; a hold written before the field existed still renders `compressor`. Measured: the verdict read `ok` at load 34.84 while `yarn validate` refused four consecutive laps on four
different innocent files — `skills/supervisor/reference/machine-capacity.md` § "The subject an `ok` did not
name". It has no resident publisher either: whichever surface runs the read publishes, same as
`standing-session`/`refresh`. The
standing fix for the mds case itself: `system/com.apple.metadata.mds` disabled in launchd on the owner's Mac,
re-asserted after every macOS upgrade by the `com.slopweaver.mds-guard` LaunchDaemon
([spotlight-and-worktrees.md](spotlight-and-worktrees.md)), a periodic sweep of leaked `mkdtempSync` fixture dirs (`testing.md`'s own rule),
and `slopweaver worktree prune` for worktrees nothing is using.

**A hold also CAUSES work.** `slopweaver machine watch` samples the machine between supervisor ticks and seats a
visible investigation on four triggers — a capacity hold, one process at 3 cores or more for 120s, one
session tree of 40 or more non-hook processes, or `fseventsd` over 1 GB — unless an open investigation already covers it, its backoff
holds, or the spawn fails. Each finding is a row in the dispatch register (`slopweaver machine dispatches`), open until
`machine dispatches settle <id> --witness` closes it. `slopweaver supervisor tick-record` refuses a tick that read
a hold with neither a covering investigation nor a recorded reason (`src/supervisor/loadDispatchGate.ts`), short of
the escape hatch its refusal names.

**A `died` does not always have a `re-armed` or an `escalated` after it.** `slopweaver listen reconcile`
back-writes deaths nothing was alive to witness and then stops — it neither re-arms nor escalates, because a
verb any session may tick must not be able to leave the bot deliberately DOWN. So it publishes the `died`
alone, and a `died` whose journal entry carries `discovery: "reconciled"` is one of those: the outage is
real and already over by the time it appears. `listen supervise` still publishes both halves, in order.

## Why this is Slopweaver's own file, not a publication into cmux's stream

The alternative was real, and it was measured before it was rejected, on cmux 0.64.22, through
`src/cmux/socket.ts`'s own client rather than a raw `cmux` call:

- `system.capabilities` lists **303** v2 methods. **Not one of them publishes an arbitrary event onto
  `events.stream`.** The nearest neighbours are `feed.push` and the `notification.create*` family, which
  write into the owner's UI feed and notification centre — chrome the owner reads, not a machine transport.
  Routing a heartbeat through them would put a notification on the owner's screen every time a socket wobbled.
- cmux retains 4,096 events in memory and spills the rest; a cursor that ages out returns `resume.gap`. A
  listener death twenty minutes old can be evicted by ordinary fleet chatter, and that is exactly the event a
  supervisor most needs to still be able to read.
- The listener supervision loop runs whether or not cmux is up. An event that cannot be emitted while cmux is
  down is, again, precisely the event worth having.

So this is not a preference between two workable designs: publishing into cmux's stream has no method to do
it with. What cmux's stream keeps is its own job — agent hook firings — and a supervisor reads both
(`slopweaver cmux events` for one, `slopweaver events tail` for the other).

## The cursor is a byte offset

Every publisher appends concurrently — the listener's death-watch tick, a standing-session check, a `slopweaver
refresh` finishing its run, a machine reading, a merge hold. A monotonic sequence number would need one of them to
read another's last line before writing its own, and two ticks that read the same last line assign the same
number. A byte offset needs **no write-side coordination at all** — the file is append-only, so a line's
offset never moves.

Three properties follow, and each is load-bearing:

- **Only whole lines are consumed.** A reader stops at the last newline it can see and reports THAT offset,
  never the end of file, so a cursor can never land inside a record another process is still writing.
- **A shrunken file is a `gap`, said out loud.** If the stream is shorter than a reader's recorded offset it
  was truncated or replaced; the read restarts from zero and says so, rather than resuming at a byte that now
  means something else.
- **The cursor advances only past what was consumed.** A `--limit` drain resumes at the first event it did not
  reach — the same defect `cmux events` had to fix in its own drain, where a cursor advanced to the live edge
  and silently skipped ~1,800 events nobody had seen.

Each `--cursor <name>` is an independent position under `$SLOPWEAVER_HOME/live/events/cursors/`, so a sweep
and an ad-hoc drain never fight over one.

## The stream says "look now"; `listen status` says what it is NOW

There is deliberately **no `recovered` event**. A stream event is a moment, not a state, and a reader that
tried to hold current state by folding moments would go wrong the first time it missed one. A supervisor woken
by anything here re-reads `slopweaver listen status --json` for the live grade, which is one call and cannot
be stale.

That is also why `heartbeat-degraded` is **edge-triggered** against the stream's own tail: a reconnect takes
several fifteen-second ticks, and a stream that repeated the same warning every tick is a stream its reader
learns to skip — the same failure as not publishing at all. `recovery-stalled` is edge-triggered for the
same reason, against a five-minute cadence instead of a fifteen-second one: `listen recover --scheduled`
publishes it once when the durable watermark has sat still for an hour or more while the listener grades
`healthy` or `degraded`, and not again until some other listener event has been published since. A stale
watermark under a `down` or `unarmed` listener publishes nothing — the outage is already the alert, or
nobody is running the bot — and the event's own sentence carries how many coverage failures the latest
sweep reported, so the reader knows to open that sweep's `failures` rather than the listener.

## Two files, on purpose

The listener's arm journal (`live/listener/arms.jsonl`) and this stream are not the same thing wearing two
hats:

- **`arms.jsonl` is a DECISION INPUT.** `rearmDecision` counts its deaths and `escalationStanding` reads its
  tail; changing what is in it changes what the supervision loop does.
- **The stream is a NOTIFICATION.** Nothing here is ever read back to make a decision — the one read is the
  edge-trigger's check of what it last said — so a surface can publish onto it freely without that becoming a
  new input to the bounded-retry contract by accident.

## A publish never sinks the work it describes

Every emitter calls `publishSupervisorEvent`, which returns a failure sentence rather than throwing, and every
caller narrates it and carries on. A death-watch tick that refused to journal a death because a notification
file was unwritable would be strictly worse than one that carried on.

## Where it lives

- **`src/events/`** — the event model, the resumable cursor, and the append-only store.
  `event.ts` is pure: no filesystem, no clock.
- **`src/supervisor/session.ts`**, for this stream — the opaque identity of the visible host that owns a turn
  (`claude-code`, `codex`, or the operator-named `explicit` boundary with no model behind it). It proves a
  visible session exists; it is not a shareable deep link.

Slopweaver owns this file rather than publishing onto cmux's own stream, and that was measured before it was
chosen: of the 303 v2 methods cmux exposes, **not one publishes an arbitrary event onto `events.stream`**.
The nearest neighbours write into the owner's UI feed and notification centre — chrome the owner reads,
not a machine transport.
