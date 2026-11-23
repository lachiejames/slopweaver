# The recommendations lane on a scheduled card

How a daily alert post carries the act that would clear each finding. The card-side form is
[the card form](../../slack/reference/the-card-form.md); this is what a ROW writes.

Monitoring says something is wrong and not how to fix it. So an `alert-summary` or
`datadog-alert-digest` row may declare `params.recommendations` — the act that would clear each finding, and
one or two opportunities nothing alerted on. They ride directly below the fold; the card form is in
[the card form](../../slack/reference/the-card-form.md). The example is illustrative, every target, id and host in it
synthetic.

```jsonc
"recommendations": [
  { "act": "tune-monitor", "change": "renotify 60 → 0 and add timeoutH so a stuck group stops re-posting",
    "clears": "Payment guardrail — violation detected on check:refund_unmatched",
    "target": "acme/api monitors/paymentSentinel.ts", "owner": "the payments owner",
    "evidenceUrl": "https://us3.datadoghq.com/monitors/700001" },
  { "act": "change-config", "change": "publish a payment heartbeat",
    "evidenceUrl": "https://us3.datadoghq.com/monitors/700002" } // no `clears` — an opportunity
]
```

Four things are the rule rather than a note:

- **The keys are different per kind, and neither is a title.** A digest's `clears` is a **probe id** the row
  itself declares, so a typo is reported as `clears-unknown` — told apart from a monitor that was simply
  quiet, and never refused, because refusing it would cost the whole card at the unattended hour. A summary's
  `clears` is the alert's **stable name**, which `slopweaver slack alert-summary --channel <id> --json`
  prints under `firedNames` — copy one exactly. A row label is condensed and elided per window, so it is
  never the key.
- **One place on the card is HELD for an opportunity** when the row authored any, so a noisy day still
  surfaces one; the rest of the five go to acts, ranked with their findings.
- **An act only appears on the day its finding FIRED**, ranked with it and coloured by its severity; an
  opportunity appears every day until somebody edits the row. Everything left off is REPORTED (the text run
  and `--json`), with `clears-unknown`, `not-fired-this-window`, `over-cap` or `shed-to-fit` — a mistyped key looks exactly
  like a quiet monitor on any one day, and the report is how you find one.
- **A session AUTHORS them; nothing on a clock composes one** (rule 2). Investigate first, then write the
  row: each line carries the evidence it stands on.
- **They never change whether a card sends.** A digest whose own prose already fills the detail cap sheds
  recommendations from the tail rather than pushing the card over it — after the alert card's own impact-basis and
  baseline sentences, which shed first.

## Closing the loop: the act the bot already TOOK

Yesterday's highest-ranked recommendation comes back in today's post as a
draft pull request the bot already wrote, linked from the post, **nobody asked to review it**. A draft nobody
merges still cost the team nothing, and that asymmetry is the whole argument for the row.

Two halves, and neither is a second card shape (rule 7: the cap is the schema).

- **A recommendation may carry `raisedPrUrl`** — the draft the bot opened to clear it. It REPLACES the act
  word with a clickable `Draft PR`, because once the pull request exists the line is reporting rather than
  advising. `evidenceUrl` stays exactly where it was and a form naming the SAME address for both is refused:
  evidence is what justified the line, the pull request is its output, and a card citing its own output reads
  as grounded in itself.
- **An `investigate` row does the work** — `team-alerts-actioned-<channel>`, cadence 45 minutes before that
  channel's `team-alerts-daily-<channel>` slot, so the draft exists when today's card renders. It asks in the
  owner's own DM rather than in the team's alert channel, because the question is internal plumbing and the
  team's only exposure to this loop is the link on the card. The seated session re-runs the same selection
  the card runs, takes the top `kept` line, writes the fix through the `slopweaver github` verbs, opens it
  DRAFT, requests review from NOBODY, records it with `slopweaver autonomy record`, writes `raisedPrUrl` back
  onto that recommendation in the daily row, and answers the thread with the URL.

The question names no PERMALINK and no recommendation. `params.question` is static row state that
`planInvestigate` re-validates at every firing, so a fixed permalink is stale on day two — it names the
DERIVATION instead, and the row survives the day the ranking changes. The question itself is capped at 500
characters by the automation prompt form, and the message it derives at the no-fold cap of 650 visible
characters INCLUDING the `automation · <recipeId>` trailing line, which a long recipe id eats into.

**One channel deliberately.** `alerts-service-p1` only, its actioned row `enabled: false` beside
the daily row it pairs with. A fan-out that lands ten half-working rows is worse than one that works.
