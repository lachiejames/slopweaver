# The fleet figure, what set it, and what is really binding

[fleet-capacity.md](fleet-capacity.md) carries the constraints and the gauge. This page carries the FIGURE:
each step of the ratchet with the reading that justified it, the ceiling that binds instead of the one being
raised, and the two costs of scale the constraint bullets only point at. Read it before proposing a step.

## N, the working seats the plans carry, is MEASURED each tick

The fill target is not a figure anyone sets. `slopweaver fleet ceiling` reads the plans' drawdown journal and
the supervisor tick ledger and answers **N**: how many WORKING seats the plans' remaining week carries at the
fleet's measured burn until each plan resets (`src/capacity/seatCeiling.ts`). Every
pass fills to the measured ceiling. MEASURED with `slopweaver fleet ceiling --days 7`: at most 13% of the
plans' week unused, **4.2 working seats on average** (peak 22 open), each working seat drawing about 17% of a
plan's week a day, N = 4.

**Working, not open.** A seat parked on the owner's steer or idle at a prompt draws nothing, so the gate counts the
watch report's `working` rows only. Twenty open seats with four working is a fleet at four.

**What the tick does with it** ([idle-capacity.md](idle-capacity.md)): the capture reads `fleet ceiling --days
7 --json`, `tick-draft --seat-ceiling` folds it into `capacity.workingSeatCeiling`, and `tick close` owes the
first N − working ready rows a spawn or a hold naming `{"kind":"ceiling","id":"machine"}`. At N it is clean. An
unmeasurable N falls back to every ready row owed, and the refusal says so. The machine figure below stays a
machine bound; it is never the fill target.

**What the owner sees**: the `fleet-ceiling-weekly` standing row publishes the same report as a local page each morning at 06:00, and
cards the owner's Queue only when a whole seat went unused or the reading broke ([automation](../../automation/SKILL.md)) — a
reader failing, or NO plan seen resetting; one plan newer than its first reset is uncounted, not broken — and the console's Fleet page draws N against the working seats on
every tick — with the verdict, the binding ceiling and the burst — off this same reading
([the glance band](../../../docs/console/fleet-and-workstreams.md)). The tick fills nothing extra for it.

## Why not more: `fleet why`, and what the hold actually measures

There is no hard minimum of ten, since two hundred sessions would halt the box. What matters is
WHY the fleet is not running more right now and WHAT it measured. `slopweaver fleet why --minutes 60` answers it
from the tick's own readings, and the Fleet page shows the same sentences. MEASURED: **7 working seats
against N = 4**, so the plans bound, not the machine. Ten working seats would spend the plans **2.1×** as fast as
they reset. 1 of 2 sampled machine readings in the hour held, on cpu.

**The cpu hold is a 1-minute load average, and that is a coarse proxy** (does it count cpu that mds,
the endpoint sensor and other foreign load hold but would yield to the fleet?). It counts every runnable thread, background
QoS and foreign included, and weighs an efficiency core the same as a performance core. MEASURED
(`top -l 2 -n 0 -s 1`, `machine capacity --json`'s `hiddenCpu`):

- A hold fired while `top` showed about four cores idle.
- mds runs at background QoS and does yield.
- The endpoint sensor, opendirectoryd and the other endpoint agents do not yield: they scale with the fleet's own process
  spawns, and kernel time was about half of the busy cpu.

So the fix that pays is less spawn churn, not a looser threshold. Changing `loadHold` needs a controlled run, never
a reading. `fleet why` names the hidden and foreign share so that run has its baseline.

## Why the figure is a floor, not the memory arithmetic

24 was chosen over 49 on purpose: the fleet had never been observed above **18 live across all 90
recorded observations**, so 49 was arithmetic over a per-session cost measured at **14** live. That is
the shape of every step since — the figure is a floor to ratchet off a real reading, never a number
derived from a division, and a step that cannot name the tick it was taken on is folk wisdom again.

## The step to 32

The aim was to max capacity: with a lot of idle cpu and the hook timeout issues fixed, the fleet could scale up.

The reading at the moment of the step, `slopweaver machine capacity` plus `slopweaver cmux list --json`:
**19 live workspaces · 1-min load 6.6 against a `loadHold` of 22 · 3.7 of 15 cores busy · swap 0/0 GB ·
compressor 9% of its segments limit · 0 swapfiles · verdict `ok on memory and cpu`** — against **428 ready
docs on the board**.

**Neither of 24's inputs held that day.** A `claude` process read **~0.3 GB** against the 545 MiB measured
earlier at 14 live; a `pre-push` runs **43.5 s**, not the whole validate lap ([toolchain/rebaseline-and-lanes.md](../../../docs/toolchain/rebaseline-and-lanes.md#two-lanes-the-local-one-is-a-secrets-scan-and-a-working-tree-check-and-everything-else-is-cis) § Two lanes);
and 19 live passed the "never observed above 18" that 24 was sized to.

**Say the uncomfortable half in the same breath: the ceiling was not what was limiting the fleet, and
raising it on its own changes nothing.** At the step the fleet sat at **19 against a floor of 24** with 428
ready docs and three quarters of the machine idle — nobody was filling to the figure that already stood. The
two things really binding are **Ceiling A** (plan usage, 96% and 97% weekly on plan-two and plan-four) and
**the fill step** itself. A tick reporting "at cap" off the larger number without first clearing § 7b has
made the same mistake at a higher figure.

## Why the fill step is the one to check first

**A workspace that is open is not a workspace that is moving, and the fill step counts the wrong one if it
counts live rows.** MEASURED: the fleet read "at cap 24" while ten green, gold-anchored pull
request sessions sat idle waiting to land and two finished workspaces had never been closed. A tick that has
not closed its finished workspaces and named its idle rows is not at capacity — it is holding slots nothing
is using.

## The disk ceiling

One live worktree measures **2.7 GB** (`du -sh <a live worktree>` — `node_modules` dominates it), and
`machine capacity` reported **90% used with 99.9 GB free** on the data volume the same minute, over **847
registered worktrees** (757 slopweaver, 90 acme-admin). 99.9 GB ÷ 2.7 GB is **~37 more live seats**, below the
~49 the memory line gives, so **disk is the arithmetic bound**.

It is also the one bound that **does not recover when a seat closes**: a worktree outlives its session until
something prunes it. That is why `machine capacity` prints the registered count beside the free space, and
why a ratchet step past 40 has to re-read the free space rather than the memory arithmetic.

## The hook tail is a cost of scale, and it is not a reason to hold a spawn

**Measured** over the window since the last of the hook fixes landed:
**34 `PreToolUse` calls went past the 15 s budget across 18 seats**, against 3,979 firings: 0.85%. Every one
released its tool call having reached no verdict, so the main-checkout, admit, browser-door, poll-gate and
depth guards were all off for that call. `slopweaver perf` reports it (`hookOverruns`, a react line, and
`no hook over the line NOW` in the summary), grading `PreToolUse` calls alone — a `SessionStart` mirror sync
past 15 s is inside its own 60 s and is not one; the census and its claim boundary are
[fleet-performance.md](fleet-performance.md) § Five quantities.

**It does NOT scale with seat count in the measured range, which is why it does not cap the fleet.** Per
10-minute bucket over that window the busiest (229 firings) had **zero** overruns, while the two highest
rates — **2.73%** and **1.92%** — were the two quietest (110 and 52 firings). Unbiased hook latency is
**p50 410 ms / p95 610 ms / p99 1,650 ms** at load 11.3 on 15 cores, so the body of the distribution is
nowhere near the line. Repro:
`echo '{"session_id":"t","tool_name":"Bash","tool_input":{"command":"echo hi"}}' | /usr/bin/time -p <install>/scripts/pretooluse.sh`.

So treat an overrun as a defect to chase on the seat that owns it, never as a reason to hold a spawn — and
**re-check that independence before any ratchet step past 40**, because one window at 19 live seats is not
evidence about 40.
