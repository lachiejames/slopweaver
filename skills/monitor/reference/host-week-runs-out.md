# `host-week-runs-out`: a note when one model host's plans are projected to run out

A floating note backed by a Queue card when EITHER the Claude plans OR
the Codex plans look like running out before the weekly reset, and not when one of five plans quietly runs dry while
the others take over: false positives train the owner to ignore it. `fleet-runs-dry`
stays the MEASURED card (every plan of both model hosts spent now); this one is the PROJECTION, per model host.

- **What it projects.** Per model host, every routable plan routed the way its production router routes, hour by
  hour for a week, at a constant demand. A spell is an hour with every routable plan of that host at its effective
  ceiling and demand left over; one plan capping while another carries is never one.
  - **Claude** reuses `claude forecast`'s historical trend (each plan's start and the trailing demand off the
    drawdown journal) and re-runs today's `headroom` router (`src/claude/weekRisk.ts`). A spell can end at a
    week's last-five-hours spend-out lift, before its reset.
  - **Codex** starts every plan from the newest filed `machine capacity` reading and measures the trailing draw off
    the week of filed readings, high-water marked per window (`src/capacity/weekDemand.ts`); the simulation routes
    by the router's own level line (`src/codex/levelLine.ts`) and **claims free resets the way the chair tick's
    `codex reset --at-limit` does** — a plan at its bar holding one is refilled to 0% with its reset moved to seven
    days on (`src/codex/weekSimulation.ts`). Ignoring them was a false alarm: replayed once, four plans
    at 99% holding three resets each read as a 36-hour spell.
- **Opens below the trend, holds at it.** A card OPENS only on a spell of `MIN_DRY_HOURS` or more at 90% of
  trailing demand (`WEEK_RISK_DEMAND_GUARD`, the low edge of the ±10% week-to-week noise
  [plan survival](../../supervisor/reference/plan-survival.md) measured). An OPEN card is held while any whole dry
  hour is projected at the full rate, so a projection on the margin cannot flicker one note into three
  (`PLAN_WEEK_OPENING`, `PLAN_WEEK_HOLDING`, `src/monitor/hostWeekRunsOut.ts`). The looser bar only ever KEEPS
  what the open card names (`src/monitor/hostWeekRunsOutHold.ts`): a model host at risk only at the holding bar
  joins the fold just when that keeps the card's revision, never as a newcomer that would re-cut it, and a card
  whose key has lapsed holds nothing, so only the opening bar can raise its successor.
- **Never repeated while it stands.** Keyed by the hour the earliest projected spell ends plus a digest of the
  at-risk model hosts' routable plans and their ceilings — never a percentage, a demand or an instant — with
  `fleet-runs-dry`'s own readers (`holdRevision`, `lapsesAt`). Drift holds the card; a plan paused, resumed or
  re-limited re-cuts it; it settles on a clear pass or once the spell's hour passes.
- **Every gap is unmeasurable, never clear and never a card**: a capacity reading over two hours old, a routable
  plan the reading does not measure, a Codex weekly reset more than a week out, a monthly-spend plan, a Codex series or a Claude journal spanning under 24
  hours, a stale Claude journal, or a Codex spell resting on free resets nobody read. One model host unmeasurable beside the other at
  risk is the card, the gap its blind spot. A held machine does not blind it: plan windows are measured whatever
  the load.
- **The card shows the reset maths** (a card asking defer-or-keep-pace without it is unanswerable). It opens on the problem (which model host, how long, from when, whose reset
  ends it). Its details are one basis line per at-risk model host — guarded and trailing demand, the plan-weeks the
  next 7 days need and how many go unmet, the free resets the chair may claim and how many the run claims, and the
  plan-weeks left unspent at the current resets — then one line per configured plan, paused ones included: used of
  its ceiling, the week left before its reset, the projected hour the routed draw fills it and how early, or where
  it ends that window and what is unspent, and (Codex) its free resets held and claimed, or that none is claimed
  under the owner's own usage limit. Twelve lines, two five-plan hosts, is the `checkedDetails` cap exactly, so a totals
  row never stands alone. The decision: keep the pace and accept the gap (the lean), or
  defer the least urgent work. Never a purchase, never a console click; a free reset is the chair's own claim.
  `work` and `floats`, fired every supervisor tick after `codex-plans`.
- **A clear pass prints the same lines.** `slopweaver monitor check --only host-week-runs-out` prints every
  simulated model host's basis and plan lines under `clear` (`ClearReading.evidence`, never carded), so the maths
  can be read, or put on an ask, when nothing fires.
- **Not modelled**, each erring toward a miss rather than a false alarm: the Codex five-hour window, and a free
  reset's expiry.
