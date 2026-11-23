# The daily publication audit row

`publication-audit-daily` is one row of [the declared rows](declared-rows.md): `45 5 * * *`, `read-write`,
`onMissed: "skip"`.

**Declared OFF** (`enabled: false`). The owner's standing ruling keeps every automation off bar the store backup and the
self-improvement brief until they say, so this row registers parked and fires nothing. The declaration stays off; an
install turns its row on with `slopweaver automation enable publication-audit-daily --anchor <a> --words <w> --why <why>`,
on their word.

**What it runs.** `audit publications --fire --by-session recipe:publication-audit-daily`.

- It re-reads what the fleet published on GitHub, Slack, Linear and Notion through the outbound privacy check, and
  writes the sanitised report.
- It then runs the `publication-leak` pass over that report whatever it found, so each leak is one floating note and
  Queue card naming its class, door and link, never the term.
- It is a `verb-run` row, so `automation run-due` runs it inside the visible session that claimed it, never a daemon.
- It names no repository: the verb's own default is the repository this build publishes from.

**Its exit.** Under `--fire`, a run that worked over a report that is not clean (a finding, or a door read only in part)
exits 3, never 0. `run-due` stamps a 3 and settles the slot succeeded, so the row is neither retried into a second card
about the same leak nor held as failing, while the exit still says the run was not clean. 1 is a failed pass or a missed
expectation. A partial run still settles no card.

The monitor: [publication-leak](../../monitor/reference/publication-leak.md).
