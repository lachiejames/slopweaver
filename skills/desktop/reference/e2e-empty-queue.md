# An empty Queue in `desktop e2e`

**An empty Queue is a state, not a failure.** On a fresh install nothing waits on the owner's word, so the card step has no
card to open. It waits, bounded, for a Queue row or the Queue's designed empty state (`data-page-empty="queue"`, drawn only once
every register's latest read answered, none is still replacing an earlier reading, no overlay that can take a card off
draws an earlier reading, and no row exists; until then the list draws a spinner or a staleness mark, never the line). A fresh home that has never recorded a `github landing`
reading is not provably empty: `pull requests on your judgment` answers "no reading yet" until one is recorded. A row is opened as ever; the line makes the step **not applicable**,
printed `N/A` with its reason and photographed, counted in `report.json`'s `notApplicable` apart from both `passed`
and `failed`, and named in the summary (`15 of 16 step(s) passed, 1 not applicable (queue-card)`). Neither is still
`blocked`, because a Queue that never says it is empty has not been proven empty. A page error, console error, 5xx
or error overlay seen while it looked still fails the step. Exit 0 only when no step failed and nothing stopped the
run; a not-applicable step is never a pass.
