# Fleet capacity — a reading taken every tick, not a number kept in a file

Detail behind [SKILL.md § 7a](../SKILL.md#7a-fill-to-measured-capacity--the-last-step-of-every-tick). Read it before
reporting the fleet at capacity, before ratcheting the figure, or before arguing that a quiet tick was fine.
The machine gauge's own thresholds and the panic that sized them are one hop further out,
[machine-capacity.md](machine-capacity.md).

## The measurement that started this

The fleet sat at 8 workspaces on load 3 with 8+ ready docs queued. Overnight throughput held
steady and the daytime drop was a REDIRECTION to live team-facing work, which the owner called right — so the defect,
and § 7a's scope, is narrower: quiet fleet, ready queue, nobody spawning. The landing counts, the merges by
time of day and their reproduction commands: [fleet-capacity-origin.md](fleet-capacity-origin.md).

## What the machine actually holds

Hardware, this device: **15 cores, 48 GiB RAM** — `sysctl -n hw.ncpu hw.memsize`. Swap is not a fixed size: macOS
adds 1 GiB swapfiles on demand (`ls "$(dirname "$(sysctl -n vm.swapfileprefix)")"`), 3 on a healthy day and 49
at the panic below, so `vm.swapusage`'s `total` is a reading, never a budget.

Per live session, measured with 14 live workspaces: **545 MiB mean RSS, 1.16% of one core** —
all 14 together drew 16.3% of a single core. It is a point reading — re-run minutes later it gave 22.5%
and 550 MiB, which is the same conclusion and not the same digits.

```bash
ps -Ao pcpu=,rss=,comm= | awk '$3 ~ /claude$/ {c+=$1; r+=$2; n++} \
  END {printf "%d sessions · %.1f%% of one core total · %d MiB mean RSS\n", n, c, r/n/1024}'
```

**Load average does not measure session count.**
Over the 90 `(live, load)` observations the state doc has recorded, least squares gives
`load = 7.0 + 0.57 × live` — which predicts 15 at the 14 live sessions measured above, where the machine
actually read **4.48**. The correlation is real but the causation is not: busy periods carry both more
sessions AND more `yarn validate` runs, and one validate fans vitest out across every core. At the moment of
that 4.48 reading, two `node` processes were drawing 89% and 80% of a core each while all 14 claude sessions
together drew 16%.

So the two constraints are separate, and only one of them is about how many sessions are open:

- **Memory bounds the session count.** 48 GiB, less ~13 GiB of foreign footprint (`slopweaver machine
capacity` names the hogs — a VM, `mds`, `mdm-agent`, Slack, Chrome) and ~8 GiB of OS headroom, leaves
  roughly 27 GiB for the fleet. At 545 MiB each that is **~49 sessions** — but 545 MiB is the earlier figure against **~0.3 GB** per `claude` on a later reading, so re-read the gauge, never the arithmetic.
- **DISK bounds it TIGHTER than memory, and is the one bound that does not recover when a seat closes.**
  ~**37 more live seats** on one reading, below memory's ~49. The derivation:
  [fleet-ceiling.md](fleet-ceiling.md).
- **Load bounds concurrent GATE RUNS, not sessions.** A spawn adds ~1% of a core; a `yarn validate` adds
  most of a machine. Hold a spawn on load because the gates are already queueing, never because sessions are.
- **A BOOT is load the gauge cannot see yet**: recent boots hold, [machine-capacity.md](machine-capacity.md).

**Both constraints live in one verdict, each named.** `machine capacity` grades those two subjects — memory and CPU — and says which one an `ok`, an `ALERT` or a `HOLD` is about, precisely because they fail independently and a grade that does not name its subject gets read as covering both.

**A THIRD thing bounds it, and it is not a session count at all: what the fleet has left behind.** Once the load sat at 100-146 for two hours on 64 orphaned `zsh` shells and one worker wedged on its own hooks, while eleven ticks reported `HOLD on cpu` naming none of it. The verdict names a CULPRIT, and `slopweaver machine reap` takes the orphans every tick ([fleet-attribution.md](fleet-attribution.md)): run it before concluding the fleet itself is the load.

**A push is a SMALL gate run — not a free one.** The `pre-push` hook runs `yarn validate:local`: the five
gates CI cannot see the subject of and nothing else; every other gate, typecheck and both
test lanes are CI's ([toolchain/rebaseline-and-lanes.md](../../../docs/toolchain/rebaseline-and-lanes.md#two-lanes-the-local-one-is-a-secrets-scan-and-a-working-tree-check-and-everything-else-is-cis) § Two lanes). One lap measures
**43.5 s wall / 41.4 s CPU** (`/usr/bin/time -p yarn validate:local`), against **1,219 s peaking
at 3,617 MiB** measured for a hook running the whole lap. No vitest runs in the hook.

**A blown hook budget is a cost of scale that is not load, it is on the gauge, and it does NOT scale with seat count in the measured range** — chase an overrun on the seat that owns it, never hold a spawn for one. The measurement: [fleet-ceiling.md](fleet-ceiling.md); the census and its claim boundary: [fleet-performance.md](fleet-performance.md) § Five quantities.

**Keep counting `validate:local` as gate load, and re-measure its memory before you size on it.** The wall
figure above is ONE lap in isolation and no peak-RSS was taken for it. Re-read the gauge; never extrapolate a
fleet total from the rows below, which were taken when every push ran the whole lap.

## The two ceilings — and the cap is a READ of them, never a constant

A shift once reported "at cap 24" with fewer than ten workspaces actually moving, when it could probably have been
about 20; maxing capacity matters because the backlog of work is essentially limitless. A number written in a file
cannot answer that. **Two ceilings bound the fleet,
they are measured in different units, and neither of them is "how many workspaces are open".**

**Ceiling A — Claude model throughput, across the owner's plans.** This is what actually limits how much work the
fleet does. `claude gauge` reads each plan's windows (`nextAllModels: null` means no plan can take a spawn) —
on the Ultra plan the week and the Fable week only, since it has no five-hour window
([plan-routing.md](plan-routing.md) § The two windows) — and
it also announces itself inside a session, read from what sessions REPORT — a screen read, or a `session watch` row that went `silent`
mid-turn on every session at once. Two consequences: an unpinned spawn inheriting Fable spends this ceiling
about twenty times over (§ 0, [model-tiering.md](model-tiering.md)), and when it is hit the answer is to
**stop spawning and say so in the tick**, never to keep filling into refusals. Measured:
Fable-everywhere plus foreground polling exhausted three accounts in 18 hours.

**Ceiling B — machine load, from concurrent `yarn validate` laps.** Per the section above this bounds GATE
RUNS, not sessions. **Investigations cost no local CPU** — a session reading code, a browser leg, a Slack
draft, a Datadog query all sit at ~1% of a core. Only a local gate lap costs a machine, and under the native
merge queue a green mergeable pull request needs none at all
([merge-queue.md](../../github/reference/merge-queue.md)). So the load reading is a statement about how many
sessions are running `yarn validate` right now, and a fleet full of investigations can run many seats with
load in single digits. **Both, and Codex beside them, are ONE reading: `machine capacity --json`'s `ceilings`**, the `lowest` of which the fill stops at ([ceilings.md](ceilings.md)).

## The read, every tick, in two commands

```bash
slopweaver cmux list --json                    # live workspaces — the denominator, never a remembered number
slopweaver machine capacity --json             # hold, holdSubjects, load/loadHold, segmentsPct, swapfileCount, foreign footprints, hiddenCpu, dispatch, ceilings
```

**The load reading is INSIDE the second command, and its verdict names the subject it graded** — a separate
reading is one a session can skip: measured once, a memory-only `ok` stood while load was 34.84
and `yarn validate` refused four consecutive laps ([machine-capacity.md](machine-capacity.md) § "The subject
an `ok` did not name"). So a verdict reads `ok on memory and cpu`, `ok on memory · cpu UNGRADED`, or
`HOLD on cpu (…)`, never a bare `ok`, and `hold: true` fires on load as well as on the two memory gauges. Read
the verdict line, not the word.

**Capacity this tick is the smaller of what those two say**, and the tick states the reading it used:

- **Memory** admits ~49 sessions (the arithmetic above). It is never the binding constraint in practice.
- **Load** holds a SPAWN at or above **45** — `3 × 15 cores`, doubled once since, which `machine capacity`
  DERIVES from `hw.ncpu` and reports as `loadHold` — and only while `top` reads under 20% idle (a busy box with
  idle to spare is healthy); it holds nothing else. It is a hold on adding gate laps, so a
  tick that reads high load with no lap running has misread its own gauge — check `pgrep -fl
"vitest|yarn validate"` before believing it. A `pre-push` runs no vitest, so that `pgrep` finds vitest only
  under a deliberate `yarn validate`; a hook lap shows as `node`/`tsc` and still counts.
- **`hold: true`** from `machine capacity` holds every FILL spawn this tick — **never a live bot tag's worker, which outranks every capacity line, `cpu` included** (the chair's ruling; a loop reading this bullet as covering tags held a live one ~11 minutes): `turn dispatch` opens that worker through `src/cmux/spawn.ts`, which reads no spawn backoff, so [the loop](../../loop/SKILL.md) dispatches through any hold — and goes in react-now with its verdict
  line: the compressor at or past 40% of its segments limit, 12 or more swapfiles, or the 1-minute load at or
  past `loadHold` with idle under its floor. Every `cmux spawn` re-reads those same holds itself through the
  fleet-wide spawn backoff, so a spawn the tick did not hold still waits out a hold that arrived after it
  ([machine-capacity.md](machine-capacity.md)). **It is ONE field over BOTH halves, and that is the point** — the sweep must never grade
  the fleet on CPU or memory alone, because either half alone can read healthy on a machine the other half
  has already ruined (checking only one or the other misses things and makes a mistake more likely). **`holdSubjects` says which fired** — `memory`,
  `cpu` or both — and the verdict line says it in words, so never report a hold without the subject that
  fired it. Its `alert` — a foreign hog or a session's spawned child (`topFleetChild`, session named) over 8 GB, or swap over 4 GB — is a briefing line and **never by itself a hold**. **Never grade memory from `memory_pressure -Q`'s free percentage**: it read ~50% free on the shift that ended in a kernel panic. Why each threshold, and the two readings that sized them: [machine-capacity.md](machine-capacity.md).
- **A hold is more than a spawn brake.** With `dispatch.covering` at 0 it OBLIGES `slopweaver machine watch --once`, and `tick-record` refuses the tick without either that seat or a `{"kind":"machine"}` `hold-rationale`. `open` counts rows nobody settled; `covering` only those that SEATED a session, so a failed spawn covers nothing ([load-dispatch.md](load-dispatch.md)).

## The fill target is N, measured; the workspace figure is a machine bound, and what "at cap" may not mean

**The fill target is N working seats, the number `fleet ceiling` measures the plans carry**,
never a figure a session ratchets. The 32 live workspaces stands only as the MACHINE's bound on open seats:
past it, `machine capacity`'s `hold` is what refuses a spawn, whatever N says. Its history, each step's
reading, and how N is computed: **[fleet-ceiling.md](fleet-ceiling.md)**.

**A workspace that is open is not a workspace that is moving**: before reporting capacity, close every `finished` run's
workspace that tick ([stuck-chats.md](stuck-chats.md)), name every idle row, and `handover park` every seat waiting on
the owner's steer so a steered ready row takes its slot ([parking-a-seat.md](../../handover/reference/parking-a-seat.md)).

## A tick under capacity with a ready queue SAYS WHY

Silence is the defect, not the pause. The legitimate reasons, each stated with its reading: a live tier
outranked the backlog ([the owner's order](what-the-owner-would-prioritise.md)), `hold: true` with its `holdSubjects` named (`cpu` means load past
`loadHold`, and a CPU hold with no gate lap actually running has misread its own gauge), ceiling A hit and
named — `ceilings.lowest` is the id to name — or the board genuinely has no ready doc or ask. **"At cap" is not one of them unless the row count survives
the paragraph above.** `tick-record` enforces this per row for groomed ready p0–p2 docs and asks ([idle-capacity.md](idle-capacity.md)).
