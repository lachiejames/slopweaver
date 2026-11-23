# What stands behind an alert card's noisiest monitors

Bundled reference for the `automation` skill. An `alert-summary` row counts what a monitored Slack channel
said; this is the half the reader did not already see — what the telemetry says under it. The bot's
investigations and cron posts leverage the Datadog atlas where appropriate.

## The join, and why it is on the monitor ID

For the two noisiest tally rows whose notification embedded a `/monitors/<id>` link, the id is looked up in the
census map (`slopweaver datadog catalogue show`), the monitor's own `logs("…")` search is unwrapped, and that
SAME search is rerun over the card's window grouped by `service`. The line lands below the fold with a frozen
console link.

**Never on the row's label.** A tally row's label is normalised for a reader — tails cut, `head · key`
condensed, ellipsised — and a monitor's name can carry `{{…}}` template placeholders, which a real census has
plenty of. The link does not suffer either of those. `src/live/slack/alertBehind.ts` is the pure join.

## What it refuses rather than approximates

- **A monitor that is not a `log alert`** (about half the monitors here): a metric, trace or RUM monitor has no log search
  to rerun, so it gets no line at all rather than a query somebody guessed at.
- **A COMPOSITE log alert** — `logs("…") … AND logs("…") …`. Rerunning the head of it would report one arm
  while the card's own sentence claims it reran the monitor's query.
- **A window past the logs' retention**, read from the census manifest's own `retentionDays`.
- **No census, or no Datadog credential.** Each of these leaves the section absent with one stderr warning,
  and the tally still posts: the card is unattended, and a Datadog fault is not a reason to post nothing at
  the hour nobody is watching (`src/cli/commands/slack/alertBehindRun.ts`).

## An empty tally is TWO facts, and the card says which one it has

`nothing fired.` is a claim about the world, and it is unreachable when the tally recognised none of its
input. MEASURED on one alerts channel: 18 messages read, 18 skipped, 0 recognised over 14
days, and the card led with `nothing fired.` while the honest line sat below Show more, where a reader who had
already believed the headline never went.

- **Nothing to read** (`skipped` is 0) — the window PROVES nothing fired. The card still says `nothing fired.`
  and a supplied `--lead` is dropped, because an editorial read of an empty window is a sentence about nothing.
- **Nothing recognised** (`skipped` is non-zero) — the sentence describes the READ rather than the world, and
  it says so above the fold: `N messages read, none recognised.` A `--lead` SURVIVES here and is checked for
  unaccountable figures exactly as it would be with rows present, because why nothing parsed is the one thing
  a person can add that the code cannot.

`skipped` is capped at `ALERT_SUMMARY_COUNT_MAX` for that reason — the moment it reached the TL;DR its width
became part of a budget of 180, which the long form of the sentence would blow. That long form is not lost:
it is the below-fold paragraph, which is the progressive disclosure `AGENTS.md` rule 7 asks for.

## Two numbers, and what a share does not claim

The event total is the track's own `hitCount`; the groups come from the analytics aggregate. A share is
therefore arithmetic over two separately-measured numbers. The pure join drops a group whose count exceeds
the total, which bounds each printed share at 100% for anything the tick composes — the FORM schema does not
relate the two, so a hand-composed `behind` entry can still print a share over 100%. It does not bound their
sum either, and nothing claims it does.

`resync-atlas-datadog` is what keeps the census this reads current: it runs `atlas datadog sync && datadog
catalogue build --from 7d` daily. The card itself does NOT state that census's age — the `alert-summary` form
has no field for one — and the monitor query it reruns comes from that map, so a monitor whose query changed
since the last build is rerun as it stood then. `store detect` is where the age is printed.
