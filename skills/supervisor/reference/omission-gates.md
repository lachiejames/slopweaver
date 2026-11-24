# The two legs that refuse a briefing page for what it LEAVES OUT

Bundled reference for the `supervisor` skill, linked from [fleet-briefing-shape.md](fleet-briefing-shape.md)
§ The gate. Every other leg of `briefing check` asks how the page READS. These two ask what it does not say,
which means neither can be answered by the page's own bytes — both take their premises from the CLI edge,
the way the freshness leg takes a live GitHub read.

## Blocked on the owner — `src/briefing/blockedAsks.ts`

A bot turn that has stopped on something only the owner can do, and react-now does not LINK the thread, refuses the
page. The owner's design, in the owner's words: surface it maybe on the owner's react now in the fleet briefing, because that is one of
the most common places the owner looks lately — and explicitly not the bot DM, because there is so much stuff in
that DM that the owner never really looks at it ever.

Matched on the Slack permalink token (`p<ts with the dot removed>`), which is the only falsifiable handle: a
card is prose, so whether it MENTIONS a block cannot be checked, while whether it LINKS one can. Requiring
the link is worth more than the check — a card telling the owner a turn is waiting without linking the thread makes
the owner go and find it, which is the context switch the feature exists to remove.

## Gone quiet — `src/briefing/silentRows.ts`

A standing scheduled row that has stopped posting, and react-now does not NAME it, refuses the page. Matched
on the recipe id, which nothing else on the page produces by accident.

MEASURED: `vulnfix-digest-acme-admin` — the daily vulnerability digest the owner asked for by name so that
the owner would SEE those pull requests personally — posted nothing for two days.
`conversations.history` counted 0 messages in 24h and 1 in 48h, while `definition-runs.json` held
`{ exitCode: 0, lastRunAtIso: "2001-01-01T03:46:41Z" }`, which is byte-for-byte what a healthy row looks
like. `automation due --json` DID say `band: "overdue"` the whole time. The measurement existed; nothing carried
it anywhere the owner reads.

**The threshold is the row's OWN cadence** (`src/live/automation/silentRows.ts`): reported after ONE missed slot
when it fires at most daily, TWO when it fires more often. The daily case is not a new number at all — it is
exactly `definitionTolerance.ts`'s existing `overdue` band, since `firingsSinceWatermark` counts the firing
currently due as well. A firing the due verdict HANDED TO ITS SUCCESSOR (`deferredSlotIso`, past its period's
midpoint with no tick) is not due but given up, so it counts as missed at once. The sub-daily case asks for one more, because the owner reads one briefing a day and a
four-hourly row that missed a single tick has usually recovered several times over before the page reaches
the owner.

**Each row carries its own reason**, read off a record rather than guessed, because "late" alone is what made
this two days long instead of one tick long:

| reason          | read from                                                      |
| --------------- | -------------------------------------------------------------- |
| `DEFERRED`      | the firing's slot row holds a `deferred` outcome, with its why |
| `UNSCHEDULABLE` | the cadence will not parse, so the row will never fire again   |
| `NEVER RUN`     | no run stamp at all                                            |
| `FAILING`       | the last run's non-zero exit code                              |
| `MISSED`        | slots went by and the records say only that it did not run     |

`UNSCHEDULABLE` bypasses the slot threshold entirely: a cadence that will not parse produces no firings to
count, so a row waiting on one is never `due` and never appears in any other reader's list.

## Both legs fail SILENT, and both report a count

An absent or unreadable input makes a leg add nothing, never guess a page is wrong — an installation that has
never run the bot is not refused for failing to card blocks that do not exist. And each clean summary line
prints how many premises it CHECKED rather than the word "clean", so a measured zero can be told from a leg
that never ran. That distinction is the gone-quiet finding itself, one level up: "has not run for two days"
and "ran twice, fine" rendering identically is what cost two days of silence.
