# Ceilings — one reading of what is unused now, and the lowest one the fill stops at

The fleet maxes capacity, and plan usage was being left on the table across Claude, Codex and machine resources.
So the fill reads every ceiling: a machine-only read stops at a free machine with four Claude weeks
two-thirds unspent and never says which ceiling it stopped at.

## The reading — `machine capacity`, every tick

`slopweaver machine capacity` prints it above the machine lines, and `--json` carries it under `ceilings`:

- **`machine`** — `load1` of `loadHold`. ANY hold (memory, cpu, boots) is zero headroom, whatever the load says.
- **`claude:<alias>`** — each configured plan's `seven-day` window as used of 100, with its reset, and its
  `five-hour` window only when the plan has one — measured, none does.
  `fable-seven-day` is shown but never counted: an all-models seat does not spend it.
- **`codex:<alias>`** — each registered destination's windows, on Codex's own 0..100 scale.

Each plan ceiling also carries `account` and `freeResets`; the machine's are `null`, and a capture older than both
omits them, which every reader takes as not recorded, never as empty. A Claude `account` is `claude gauge`'s
cell: the probe's organisation checked against the enrollment (`probedAccountCell`), a paused plan's
`CACHED <email>`, and an `@` only when an enrollment bound it. A Codex `account` is the live sign-in, with the
register named beside it when the two disagree (`codexLiveAccountText`). `freeResets` is Codex's
`resetCreditsAvailable`; for Claude it is always `null`, because the reset offer shares the probe's 429 budget
and only `slopweaver claude reset --plan` reads it.

`headroom` is 0..1. ZERO is measured exhaustion — a hold, a paused plan, one its router refuses. NULL is no claim
— a read that failed — and never reads as spent or as free.

**Plans are ROUTES, not a conjunction.** Each provider is one route through the plan its own ranker picks
(`rankClaudePlans` all-models, `assessCodexFleet`'s top), bound by the lesser of the machine and that plan.
`selectedRoute` is the route with the most headroom above zero, Claude first on a tie; `lowest` is its binding
ceiling. With no route above zero, `lowest` is the machine when it holds, or when ANY plan is unread, still
carries headroom no route took, or a provider's whole list is unread (a `problems` line) — nothing is proved
spent, so the machine alone admits. Only when every plan was measured at zero is the tick capped, bound by
the first spent route or plan. Every threshold is the ranker's own; nothing here re-derives the 95% cap.

**No new transport.** A Claude plan is read with the one-token probe `claude gauge` sends (`probePlan`), a Codex
plan with the fleet read `codex route` takes. A paused Claude plan is never probed; a paused weekly Codex plan is
still read (sign-in and limits, never a model turn) and stays out of every route. The probes are AWAITED before the
synchronous Codex and machine reads: MEASURED: left in flight across them all five timed out as
"the probe request … could not be completed" (`src/capacity/readCeilings.ts`). A plan read that fails is shown
and named under `could not read:`, never a failed capture and never a changed exit. Live wall time:
18.7s (`/usr/bin/time -p slopweaver machine capacity`).

**The double probe is accepted.** Sweep step 8a's `claude gauge` probes the same plans a moment later. `gauge`
owns the REACT lines and the chair's hand-off; `ceilings` owns the fill. Folding one into the other is a
follow-up, not a reason to skip either.

## Where it goes

- **The tick** — `supervisor tick-draft --capacity` maps it whole into `sources.capacity.facts.ceilings`.
- **The briefing** — the machine line ends `unused now: machine 0% (held, load1 32.31/22), claude:plan-two 64%
(seven-day 36/100 resets …), …; lowest machine`: each ceiling's binding window, then the lowest.
- **The Fleet page** — under the state and its defence, one closed line for Claude and one for Codex
  (`site/lib/planMeters.ts`). Each line shows the week left, averaged across that host's plans that take work —
  a paused plan is named and not counted — its running sessions and its `fleet burn` line. Opening it lists each
  plan by alias (`plan-one`), its account on hover, with its bars: the week, a 5-hour session only when the plan's
  reading carries one (none does, measured) and the free reset. The Fable week sits beside them, uncounted. The verdict itself judges Claude plans only.
- **A paused plan** — a Claude plan paused on purpose is never probed, so its ceiling carries `pause`: the
  instant it paused and its week AT the pause, read from the last `machine capacity` reading recorded at or
  before that instant (`src/capacity/pausedWeek.ts`), or `unavailable` naming why. The page prints "paused on
  purpose since …" and "n% left when paused", never a probe error.
- **The fill** — sweep step 13 fills to `lowest`, never the machine alone.
- **The gate** — `tick-record` refuses a tick with free capacity that left a groomed ready p0–p2 doc or ask with
  no seat, no spawn and no reason naming the row AND the binding ceiling ([idle-capacity.md](idle-capacity.md)).
  A captured reading is evidence, not a verdict: `rejudgedReading` rebuilds its routes, selection and `lowest`
  from its own ceilings. A ceiling whose status contradicts its headroom, or a top-level `hold` its machine
  ceiling contradicts, is malformed — `unreadable`, never judged by picking one.

## What went unused on past days

`slopweaver machine unused --days 7` measures the same ceilings over past days, off histories already on disk
(the gauge series, the Codex rollout logs, the capacity ticks) and with no probe. An expired window's last
reading is an UPPER bound on what it left unused; an open one shows its latest reading.
