# Whether the fleet would outlast the week, and which routing would keep every plan full

[plan-routing.md](plan-routing.md) decides which plan the NEXT spawn spends. This page answers the question it
cannot: if the burn the fleet actually drew repeats, would every Claude plan's week outlast its reset, and would
the router leave any plan's week unspent. The owner's ask: a forecast the owner can trust for the five Max plans,
per coming week, plus the routing change that keeps every plan full to its cap with none capping early. The owner has
ruled out a sixth plan, so the only lever is routing and burn, and a purchase is never the answer here.

**It is a historical trend, never a fact.** Every output says so: the text opens `claude historical trend at …` and
speaks conditionally ("would survive", "would leave the fleet dry"), and `--json` carries `basis: "historical trend"`.
The `fleet-runs-dry` card is not this forecast: it judges measured capacity now; `host-week-runs-out` is the
card this forecast feeds ([below](#the-standing-re-read)).

```bash
slopweaver claude forecast                      # four weeks at the trailing week's burn
slopweaver claude forecast --demand peak        # the same, at the busiest measured day's burn
slopweaver claude forecast --now <past iso>     # a backtest: forecast from what was known then
slopweaver claude forecast --weeks 12 --json    # the whole forecast as a document
```

## What it measures, and from where

Everything is read from `$SLOPWEAVER_HOME/claude-accounts/drawdown.jsonl`, the drawdown watch's samples. No
gauge is probed and nothing is sent to a provider.

- **A misread alias is dropped first.** Three times an alias read another account for a day or so, carrying
  its reset clock; left in, that draw counted twice and was the whole of the 1–3 hour spells the first version
  of this forecast put on two consecutive days. Two aliases on one weekly reset are one account, and the alias with fewer
  samples on it loses that span in every window (`withoutMisreadSeries`, `src/claude/survivalForecast.ts`).
- **Demand** is the fleet's summed seven-day draw per hour across the trailing week: each plan's positive
  same-reset deltas, plus a cycle's opening draw when its first sample landed within an hour of the reset.
  `--demand peak` uses the busiest calendar day, opening draws included. It is SERVED demand, so a floor: an
  hour whose newest sample of every plan sat at that plan's own cap hid what the fleet wanted, and those hours
  are counted as censored and printed, never filled. A plan's cap is its effective ceiling, so a 50% plan at 50%
  counts as capped (`src/claude/survivalDemand.ts`).
- **Where each plan stands** is its newest sample: utilisation, reset, the Fable week beside it, and the usage
  limit off its register row (`src/claude/survivalPlanState.ts`), paused plans included. **Gap:** the state
  carries no allowance kind, so a monthly-spend row is simulated as a weekly window, its limit read as a share of
  the week, where routing refuses that plan as `not-measured`. Any
  spendable plan whose newest sample is older than two hours is `unmeasurable`, never a forecast, and the reason
  names it. `claude watch` re-reads the register every tick, so a plan resumed mid-run is sampled on the next one.
- **A paused plan is counted, never spent** (all five plans are accounted for).
  It is placed from its newest sample of any age; a week that has reset since is rolled to a fresh one and
  labelled an estimate, and a plan never read is `unread`. No router spends it, because a pause can be a dead
  subscription; instead each placed paused plan gets its own today's-router scenario, printed as what resuming
  it alone would buy. Its draw this window stays in demand: the seats that drew it still need carrying.
- **How fast a plan can take work** is its measured five-hour ceiling: one full five-hour window is worth 0.19
  to 0.25 of a plan's week (measured). A fleet left with one open plan is throttled to that rate,
  never flattered by it.
- **Own pace** projects each plan alone: at the rate it has drawn since its reset, when it would reach its usage
  limit (100% when none is set), and whether that is before the reset.

## The model, and what it is not

Hour by hour, demand is split into slices and each slice goes to the plan a router picks, until a plan reaches
its **effective ceiling**: `claudeEffectiveUsageCeiling`, the same function routing reads — the routing bar, or
the spend-out bar in its week's final hours (by default 0.95, and 1.0 in the last five hours; every bar is the
register's Claude `thresholds`), and never past the plan's usage limit. The final-hours lift
raises the house bar and never a limit, so a 50% plan stops at 0.5 all week, and a 90% plan under an 80% bar
rises to 0.9 and no further: maximise to the user's cap, never over it. The `headroom` router ranks against that same ceiling.

An hour that leaves demand over with every plan at its effective ceiling is a **dry** hour — so a limit the owner set
can leave the fleet dry with provider allowance left, on purpose: the fleet respects the owner's limit even
if it means taking the fleet down. A **spell** runs until a plan gains room, and every spell in the horizon is
reported, each followed to its end. The final-hours lift frees the gap between the two bars (0.05 of one week by
default) on an unlimited plan, so a spell that dries up again before that plan resets is one spell with some
relief hours, never two; a plan already at its limit gains nothing from the lift, so its spell runs on to its reset. At each reset, what the owner allowed and
nobody spent — the hard stop (the whole week, or the usage limit where lower) less the week drawn — is
**stranded**, whatever the house bar is set to; the share above a limit was never the
fleet's, so it is never counted. Three routers are compared:

| Router           | Sends the next slice to                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| `headroom`       | the plan `rankClaudePlans` picks: furthest below its own level line — today's router |
| `least-used`     | the plan with the lowest week, earlier reset on a tie — the old rule                 |
| `earliest-reset` | the plan whose unspent week is lost soonest                                          |

A plan's level line rises from 0 when its week opens to its cap (95%, or its usage limit where lower) when its
final hours begin, then to 100% at the reset on an unlimited plan; the points a plan sits below it are week it will otherwise leave unused. Points, never points
per hour — a rate ranks a plan near its reset as furthest behind however full it is. `headroom` calls the production ranking
itself (`../../../src/claude/loadBalance.ts`), so a change to it moves the forecast with it. Every router is
judged at its best placement: real seats are sticky and the chair never moves, so the forecast is an upper bound
on what routing can achieve. The Fable week is printed but not simulated, because its share of demand is not
measured.

**Demand is the dominant error, and a backtest is how to read it.** Forecast from one week's start, the trailing
week read 0.73 plan-weeks a day and the week then drew 0.67, 9% less, so that forecast's 0.23 plan-weeks stranded
was a floor. Across the ten-day replay below the trailing figure ranged 0.64 to 0.77, about ±10%, so treat a
margin smaller than that as a coin toss.

## A worked reading of the trend

Measured over one trailing week, with `slopweaver claude forecast`:

- **Demand 0.67 plan-weeks a day; capacity 0.68 at the 0.95 cap.** The busiest day drew 0.79.
- **Own pace**: plan-one (82%) and plan-three (75%) wall on day 2, before their resets on days 4 and 5;
  plan-two and plan-four wall on day 3; plan-five is at 100% until its reset on day 3.
- **At the trailing burn every router's trend survived four weeks with no dry hour.** They differed in what they
  would waste:

  | Router           | Stranded a week      | Early caps from week 2                    |
  | ---------------- | -------------------- | ----------------------------------------- |
  | the older rank   | 0.00–0.01 plan-weeks | 1–4 a week, each at the five-hour mark    |
  | `least-used`     | 0.33 plan-weeks      | none                                      |
  | `earliest-reset` | 0.00                 | 4–5 a week, 93–116 hours before the reset |

- **At the peak burn every router's trend ran dry** from day 3 to plan-five's reset. That trough is
  structural: no router can move a reset.

**Why headroom is today's router.** The owner's desires: every spawn lands where the owner would put it seeing all
the usage — every plan drawn down at roughly equal rates, none maxed while another sits unused, capacity kept
maxed, no plan's week left on the table — and a plan at eighty percent usage that resets in an
hour is a different story from one at eighty percent that reset an hour ago, with the chair
never hitting a limit. Least-used leaves a third of a plan-week a week unspent, because it reads levels and not
reset days. Earliest-reset spends nothing wastefully but walls a plan days early while others sit idle. The
earlier table's ranking divided the gap to the line by the hours left, which met all four in the simulation but
once sent the chair to plan-four at 78% Fable over an empty plan-three. Headroom keeps the reset weighing and
drops the division: plans stay level against their own lines, and a plan reaches 95% only at its five-hour mark.
The early caps week 1 prints are plan-five, which is at 100% already.

**What no router fixes**: at the trailing burn the plans hold slightly more than the fleet draws, so the
difference is unused capacity under any routing. Only more work fills it.

## The standing re-read

The hourly fleet-capacity survival read (recipe id `claude-survival-forecast`, a legacy storage key) runs
`monitor check --only fleet-runs-dry --fire` ([declared rows](../../automation/reference/declared-rows.md#the-hourly-fleet-capacity-survival-read)).
That monitor is NOT this forecast: it judges the latest filed `machine capacity` reading, both providers, and
raises a floating note only when every routable Claude and Codex plan is measured spent for `MIN_DRY_HOURS` or more. The
card and its options: [the monitors](../../monitor/reference/the-monitors.md#fleet-runs-dry-a-note-only-when-no-claude-or-codex-plan-can-start-a-seat).

The PROJECTED card is [`host-week-runs-out`](../../monitor/reference/host-week-runs-out.md), fired every
supervisor tick: this forecast's one-week run under today's router, re-run at 90% of trailing demand so the ±10%
week-to-week noise cannot trip it, and the same projection for Codex off the filed capacity readings. One plan
capping early is never a card on either: the router moves on, and that trade is the headroom verdict above.

### The threshold

`MIN_DRY_HOURS` is 4: between the edge of a fading trough and a trough seen whole. MEASURED by
replaying the one-week forecast every six hours over a ten-day window (where a plan the
watch was not reading, the forecast is `unmeasurable`):

- **No forecast in the first four days saw a dry hour**, and no hour of the window had every plan at its cap.
- **Forecasts over the next three days saw one trough**, ending at plan-five's reset, under
  today's router: 5–11 dry hours whenever it was seen whole, 1–2 hours on the day trailing demand dipped,
  plus a lone hour a day after the reset. The older ranking cleared every one. Every later forecast is clear.
- So 4 hours raises a card when the trough first appears, settles it when demand dips, and re-raises it until the
  later forecasts clear. Nothing has been graded yet: the trough's end is the first.

Reproduce the trough whole, fading, and absent (substitute a UTC instant ending in `Z` from the trailing window):

```bash
slopweaver claude forecast --weeks 1 --now <instant-a> --json | jq -c '[.simulations[0,2].drySpells | map(.hours)]' # [[11],[]]
slopweaver claude forecast --weeks 1 --now <instant-b> --json | jq -c '[.simulations[0].drySpells[].hours]'         # [2]
slopweaver claude forecast --weeks 1 --now <instant-c> --json | jq -c '[(.simulations[0].drySpells | length), .demand.censoredHours]' # [0,0]
```

Re-measure after the trough ends, and whenever the fleet's shape changes (a plan added, paused or re-routed): a spell the
record refutes raises the floor, one that happens lowers it.

## What is out

Cloud sessions and the $250 cloud credit are out: nothing runs off the owner's machine (the local-first rule). There is
no Codex burn journal, so `claude forecast` is Claude's alone; Codex's week is projected only by
[`host-week-runs-out`](../../monitor/reference/host-week-runs-out.md), off the filed capacity readings and
claiming free resets as the chair does. There will be no sixth Codex plan either.
