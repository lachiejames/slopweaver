# The auto-ranked priority matrix on an alert card

Bundled reference for the `automation` skill. Every scheduled alert post leads
with whether the service is on fire and how much against previous days, and ranks what fired by a priority a
reader could have worked out themselves, in every alerts channel. Both alert card kinds carry it — the
`slack alert-summary` tally and the `datadog alert-digest` probe card — so every scheduled alerts post has the same shape.

## The card, above the fold

```
alerts-service-p1 24h · P2 · 56 fired across 7 monitors. 1.2× the prior 3 windows.

1. 🔴 [1] P2 · Payment guardrail — violation on check:payment_plan_cap… · impact ? · 24×
2. 🔴 [4] P3 · Payments — no successful Stripe payment (AU) in 2h · <0.1% · 1×
```

The TL;DR carries the channel's WORST priority, which is what makes eleven of these scannable down a sidebar.
The ranked list IS the matrix — three columns per row: the state colour (severity), the estimated blast radius,
and the `P0`-`P4` those two derive. It is a Slack-numbered `ordered` index, so the colour-coded ranked
list is drawn rather than merely claimed, and every line opens with a colour because
`orderedIndexIssues` refuses one that does not.

## The matrix, and the two cells worth arguing about

`src/outbound/artifact/priority.ts` is the whole of it. Severity down, impact band across:

|                             | broad ≥10% | wide ≥1% | narrow ≥0.1% | slim <0.1% | unknown |
| --------------------------- | ---------- | -------- | ------------ | ---------- | ------- |
| **red** (firing)            | P0         | P1       | P2           | P3         | P2      |
| **orange** (warn / no data) | P1         | P2       | P3           | P3         | P3      |
| **green** (recovered)       | P2         | P3       | P3           | P4         | P4      |
| **absent**                  | P2         | P3       | P3           | P4         | P4      |

- **P0 is `red` × `broad` ALONE.** A P0 that fires weekly answers a different question from the one the owner
  asks these cards.
- **`unknown` ranks where `narrow` ranks**, so an unmeasured red alert outranks a measured tiny one. An
  unmeasured blast radius is evidence of neither a large one nor a small one — this is the cell to attack first.
- **An ABSENT severity ranks as `green`.** `alertTally` leaves severity undefined when the most recent
  occurrence carried no lifecycle word, and reading that as red would promote every unparsed title to the top.

## Where the impact number comes from, and what it is NOT

The census carries a monitor's id, name, query and type and no tag, no SLO and no audience, so there is nothing
on this install to look an audience up in. What there is, for a monitor whose own query is an EVENT SEARCH, is
the service its events land on:

- **numerator** — the monitor's own search rerun over the card's window, grouped by `service`; the LARGEST
  group's own count, never the total, which for a query spanning services would overstate one service's share.
  One call per kept row, at most ten.
- **denominator** — `service:<the largest group>` over the same window and the same PRODUCT, memoised per
  service across the run. One to four services usually cover a channel, so the lane comes to about a dozen
  sequential reads rather than twenty.

Two monitor kinds qualify. MEASURED on the installed census: log alerts are the largest
kind and trace-analytics alerts the next. Log alerts alone left `alerts-service-p1` with ONE measured row
of seven; both kinds took it to four. The rest are metric thresholds
(`sum(last_15m):sum:payments.sentinel.fired{…}`) and stay unmeasured on purpose — a threshold has no event
population to be a share of.

**It is not a count of users, and the card says so** in one below-fold sentence rather than on every line; the
tilde on `~3.4%` is what marks the number an estimate where a scanner will see it. The denominator is a
service's WHOLE telemetry volume, and a service emits dozens of spans and lines per request, so a share is
small by construction — every measured row on that payments card was `slim`. That distribution is intended:
`broad` means the alert genuinely IS a tenth of everything the service emitted.

**Every failure degrades visibly.** A row nothing could resolve reads `impact ?` and ranks on severity alone,
and the lane prints one stderr line naming those rows by label. No census, no credential, a window past
retention, an aggregate that threw: each is a warning and a `impact ?`, never a refused post at the unattended
hour (`src/cli/commands/slack/alertImpactRun.ts`).

## The trend: one wider crawl, cut on the timestamp

The verb reads `window × (1 + 3)` of the channel in ONE crawl and splits the messages on `ts`
(`src/live/slack/alertTrend.ts`). The newest window is the card, unchanged in every number it reports; the rest
is the baseline. Nothing is banked anywhere, so a session running `slack alert-summary` by hand sees the same
trend a scheduled firing does.

A channel too noisy to page four days completely falls back to the card's own window and says so — the
baseline is what gives way, because a card with no trend clause beats no card at the scheduled hour.

**An empty baseline yields NO verdict.** A first firing, a crawl that stopped early and a genuinely silent
baseline are indistinguishable, so the TL;DR omits the clause entirely and the below-fold paragraph says only
that no comparison was made — never why, since a digest's zero baseline was read in full and an unsafe firing
total declines one that was not zero. Both raw numbers are printed there — `Prior 3 × 24h: 140 alerts, 46.7 per window.
This window: 56.` (a digest says `counted`: a facet-sum probe sums an attribute, not events) — because a ratio hides the thing most likely to be wrong about it, which is a baseline that
crossed a deploy or a muted weekend.

## The digest rows: the same matrix, read from probes

`datadog alert-digest` emits a digest form carrying an `alerts` block, and that block is what routes
`src/outbound/artifact/digest.ts` to this card, derived in `digestAlerts.ts`, instead of the triage one — the cycle-hygiene card and
model-authored triage share `kind: "digest"` and stay exactly as they were. The table is `P | Issue | Impact |
<window>`, four columns being the layout's cap, so an item's `state` rides the Issue cell.

- **Impact** — a FIRING `logs-count` or `logs-facet-sum` probe's own query, rerun grouped by service and divided
  by that service's total: the same numerator and memoised denominator as above, through the shared
  `src/cli/commands/datadog/impactMeasurementRun.ts`. A `metric-sum` has no event population and a heartbeat
  (`count-is-zero`) alarms on silence, so both read `impact ?`, and one stderr line names them.
- **Trend** — every `count-above-zero` probe not declared green, reread over the three windows before this one
  and summed; the current total is the same population's counts. ONE failed baseline read discards the whole
  baseline, because a partial sum is a smaller baseline and would inflate the ratio.
- **The lead** — an alerts digest's authored lead is capped at 60 characters, not 90: its TL;DR also carries the
  priority and the trend clause.
- **Shedding** — the two below-fold sentences give way first, the baseline one before the impact basis, and only
  then does a recommendation shed. Each is a stderr warning from the verb.

## No row param carries it

Everything here is derived by the verbs, so an `alert-summary` or `datadog-alert-digest` row picks it up at its
next firing with no params change. An alert-channel row the owner put a hold on posts
nothing until the owner approves its new version in the owner's private bot DM: `automation due` reads it `OFF · HELD`,
and the hold outranks `enabled` — [holds](holds.md).
