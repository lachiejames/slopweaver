# Cassette follow-up redaction — why Option B, and why it stays scoped

A GraphQL follow-up query — the `ParentConnection($id: String!, $after: String)` request that pages one
overflowing nested connection (`src/corpus/linear/queries.ts`'s `nestedConnectionQuery`, used identically
for Linear and GitHub) — cannot replay by value: record time computes its match key from a real UUID `id`
and a real cursor, replay time from whatever the PARENT response's allowlist redaction left behind (a stable
synthetic id), and the two are never equal. A ROOT-level page 2 is keyed by a stable synthetic `cursor_N`
(`cursorKeys`, [integration-coverage.md § Paging is a replayable property](./integration-coverage.md#paging-is-a-replayable-property));
the nested follow-up uses the sentinel below, because its `id` half has no identity a request-time matcher
can recover, and the sentinel makes both halves agree.

## The fix chosen: Option B — a structural sentinel, not a value-shape trick

`isParentConnectionFollowup` (`src/__tests__/cassetteRequestRedact.ts`) recognises the follow-up by its query
TEXT — the only GraphQL operation in this repo that takes `$id` and `$after` together. When it matches,
`matchableGraphqlVariables` forces both variables to fixed sentinels (`<followup:id>`, `<followup:after>`)
**in the match key only** — never in what gets persisted, and never for any other query.

Option A (carry positional UUID placeholders through the response redactor too) is rejected: it would make
the RESPONSE allowlist redactor's `idKeys` scheme value-shape-aware in a way it deliberately isn't
elsewhere, coupling two systems (`cassetteRedactConfig.ts`'s allowlist, `cassetteRequestRedact.ts`'s
positional matcher) that are intentionally independent. Option B fixes the ONE place that actually needs to agree — the match key — without touching
response persistence at all.

## Why it stays scoped to exactly this query shape

Sentinelling is keyed off the query text, never off the variable name `after` alone. A root-level page 2/3
query (e.g. `Issues($after: ...)`) also carries an `after` variable, and forcing it to a fixed value would
collapse two genuinely different pages of the same connection onto one cassette entry — the exact regression
this fix must not reintroduce. `cassetteRequestRedact.test.ts`'s `"leaves a root-level page's own real
cursor alone, so two root pages stay distinct"` case asserts this directly: two root-level pages differing
only in their real `after` cursor still produce different match keys.

## The order-sensitivity this fix requires, and why

Once a `ParentConnection` call's `id`/`after` are fixed, **every page of the SAME overflowing connection
shares one match-key identifier**. Polly's default lenient config (`order: false`) resolves a repeated identical id to the SAME recorded entry
every time (`@pollyjs/persister`'s `uniqWith` on `_id`+`_order` even drops all but one of the _recorded_
entries at persist time) — the identical collision class `slackPoll.test.ts` already documents and opts out
of for a different id collision (`reactions.add` calls that differ only in emoji).

`setup-polly.ts`'s GraphQL request handler enables `matchRequestsBy.order: true` specifically when
`isParentConnectionFollowup` is true, so a connection needing more than one follow-up page replays each page
by call sequence rather than colliding onto page one's response. Every other GraphQL request's identifier
still varies with its real cursor or id, so leaving those at the lenient default is unaffected — `order`
only changes behaviour when two requests already share an identical id, which sentinelling causes for
follow-ups and nothing else.

## Proof

- `src/__tests__/unit/cassetteRequestRedact.test.ts`'s `"matchableGraphqlVariables — the ParentConnection
follow-up"` suite: record vs. replay value agreement, follow-up vs. unrelated-operation separation, and the
  root-level-page-collision guard above.
- The whole integration lane in CI, not just Linear — this is shared cassette infrastructure.
- `src/__tests__/integration/linearFollowupCassette.test.ts`, which records a genuinely overflowing nested
  connection live and replays it cleanly. No recording is committed, so the suite is quarantined in
  `config/vitest/integration.ts` until it is re-recorded.
