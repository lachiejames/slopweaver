# The query layer, and what it measured

Part of [The local Supabase store](../store.md).

`slopweaver store query | facets | detail | read | collect | load | ingest | identity | status`. `query`
lists and filters by source, kind, container, author, **person**, time window, visibility and full text,
**plus each source's own columns** — `--channel`,
`--repo`, `--team`, `--assignee`, `--state`; `facets` groups counts by six source-neutral columns and nine
namespaced ones (`slack.channel`, `linear.team`, `github.state`, `notion.parent`, …); `detail` retrieves one
row whole with its per-source columns, addressed by the `(source, native id)` pair a citation already
carries.

**A namespaced facet is not decoration.** GitHub's `state` and Linear's `state` are different vocabularies,
so a bare `--facet state` would have to guess. It also settles the join: a facet names one source's table.
A query naming two sources' columns, or one contradicting `--source`, is REFUSED before a connection opens
— it could only ever return nothing, and an empty answer reads exactly like a fact about the corpus. Every
filter is validated against the store's own enums BEFORE a connection opens, so a misspelled `--source
slak` is a refusal printing the seven real sources rather than an empty result set.

**MEASURED** against the local Supabase stack on Postgres 17.6, over a multi-day Slack
window containing thousands of records and tens of MB of bronze. Reproduce with `slopweaver store ingest --file
~/.slopweaver/corpus/bronze/slack/<six-day-window>.jsonl --limit 6000`, then the verbs. Every query time is
the median of five warm laps.

| What                                                  | Measured                                 |
| ----------------------------------------------------- | ---------------------------------------- |
| Ingest, whole window, zero refusals                   | 1,431 ms (3,842 rows/s)                  |
| Count all rows                                        | 1.4 ms                                   |
| Full-text search                                      | 1.4–2.2 ms                               |
| List one container, newest 50                         | 1.2 ms                                   |
| Retrieve one row by `(source, id)`, with its side row | 2.1 ms                                   |
| Facet by container, author or day, all groups         | 3.3–4.5 ms                               |
| Facet by `slack.channel` (a per-source column)        | 5.8 ms                                   |
| Filter by `--channel` (a per-source semi-join)        | 3.6 ms                                   |
| A literal `grep -c` over the same 18.7 MB             | 120 ms (BSD grep 2.6.0, `/usr/bin/grep`) |

A full-text search is roughly **55 to 85 times** faster than a literal scan of the same bytes, and the scan
only ever produced a COUNT — it cannot filter by author, kind, channel or time window, and it returns no
structured row. A per-source facet costs about 2 ms more than a plain column because it is a correlated
lookup on the side table's primary key rather than a join; a join was rejected because it can change what
the outer query counts and a scalar subquery cannot.

What the provider's verbatim `raw` envelope costs on a loaded database is measured in [§ "The `raw`
envelope"](lifecycle-and-schema.md#the-raw-envelope-what-the-store-keeps-beside-the-columns).

## Breadth, and the two defects it found

This slice chose breadth over depth: a little of Notion, GitHub, Slack and Linear each finds more issues than
taking a thousand Slack records to a million. 1,200 records of
each of the four found two things a fifth million Slack rows would not have.

**GitHub's bronze `sourceId` is not an id.** It is `#<number>`, unique inside a repository and not across
them, and the store's identity is `(source, source_id)`. In the first 8,000 GitHub records there are 15
pairs that are the same `#n` in two different repositories — `#6` is one issue in
`acme/1password-scim-gcp` and a different issue in `acme/baseline-acme-flow` — so stored
verbatim the second silently overwrites the first. Every other source was clean at the same scale: Slack,
Linear, Notion, `self` and the mailbox each had zero cross-container collisions in 8,000 records. A GitHub
row's id is qualified with its repository (`acme/acme-admin#<number>`).

**A failed batch never prints the corpus.** `postgres.js` builds its error message from the failed
statement plus every bound parameter — one real constraint failure spilled nearly a megabyte, the verbatim
bodies of about a hundred pull requests. A store whose error path prints what it holds is a boundary with a
hole in it, so `StoreErrors.queryFailed` walks to the driver's own error underneath Drizzle's wrapper and
takes its first line, capped.

Only a live apply catches the other ordering rule: a per-source composite foreign key must follow the unique
key it references, which Postgres otherwise refuses ([§ "The journal"](lifecycle-and-schema.md#the-journal-is-one-migration-and-it-is-the-schema)).
`src/__tests__/unit/store/migrationOrder.test.ts` asserts the invariant over the emitted SQL.

**A third thing the breadth pass made visible is not a defect at all.**
`store facets --facet github.state` over 1,200 GitHub records answers `closed` 346, `open` 168,
`COMMENTED` 104, `MERGED` 66, `OPEN` 26 — one column carrying two vocabularies, because the connector
fetches issues through the REST API (lowercase `state`) and pull-request review state through GraphQL
(screaming case in `attrs`).

**Take the provider's word, and define no vocabulary of our own.** A value is called whatever the provider calls
it, because a layer of indirection that serves no purpose is worth avoiding, and no uppercase or lowercase
convention is imposed. So the mixed casing STAYS: the
projection reads the provider's value and stores it unchanged.

That is a standing rule, and it is the reason `content_linear.state` is a free text
column rather than an enum: Linear lets a team define its own issue states, so some things have to go with
whatever the provider says. A provider-defined state is stored as the provider spells it.
Only a vocabulary that is OURS — `content_source`, `content_kind`, `visibility` — is a closed enum.

**A repeated id inside one slice collapses rather than sinking it.** Postgres refuses an `ON CONFLICT DO
UPDATE` that touches the same row twice, and GitHub's bronze holds 66 same-repository re-captures per 8,000
records — the same pull request fetched by two overlapping refresh windows, each a legitimate line. The
loader collapses them to their latest capture and says how many, which is a fact about bronze rather than about the run.

## A whole-corpus pass runs without holding the corpus

`store ingest` REQUIRES `--limit`, the per-SLICE heap bound rather than a ceiling on the run. `--all` keeps taking slices of that size until the file ends; `--from <byte>` resumes at an offset
a previous run REPORTED. A file or source that reaches a `no-access` path on the owner's protect list is
refused before the store is opened ([why](bronze-and-source-coverage.md)). `readJsonlLines` takes a `startByteOffset`, so a resumed read seeks rather than
re-reads, and every byte range it reports stays absolute in the file.

**MEASURED** over `notion/compact.jsonl`, about 400 MB:

| How it was taken             |   Slices | Peak RSS     | Rows in `content`     |
| ---------------------------- | -------: | ------------ | --------------------- |
| One slice (`--limit 200000`) |        1 | **1,357 MB** | about eighty thousand |
| `--limit 500 --all`          | hundreds | **540 MB**   | the same, to the row  |

Same table, 2.5x less memory, and the sliced figure is FLAT in the size of the file rather than
proportional to it. Reproduce with `/usr/bin/time -l` on each. That is the whole point: the nearly seven
gigabytes of one Slack file are reachable by the same command.

**The resume cursor is not `bytesRead`.**
The read stops at a CHUNK boundary rather than at the limit, so the chunk that reached the ceiling has
already delivered its remaining lines to a callback that skipped them — and `bytesConsumed` counts those
skipped lines as consumed. Resuming from it would step over every record between the ceiling and the end of
that 8 MiB chunk, silently. Measured on the six-day Slack window: a 1,000-row slice reported about 8 MB
consumed and only about 2 MB accounted for, so a resume would have skipped ~6.2 MB of records. The
cursor is the end of the last line the slice ACCOUNTED FOR, clamped to the file size.

**Nothing persists the offset between invocations, deliberately.** `compact` stages a new file and renames
it into place, which invalidates every byte offset into that source at once — so a stored cursor would be a
number that is silently wrong after an ordinary maintenance run. The offset lives only inside one `--all`
loop, and a re-run is safe because `content` upserts on `(source, source_id)`.

**A later capture supersedes COMPLETELY, and slicing cannot change the table.** The upsert refreshes every
column a record supplies. Refreshing only `body`, `metadata` and `title`, two captures of one page taken in
ONE slice collapse and the newer wins outright, while taken in two slices `occurred_at` keeps the OLDER
value — the table decided by a `--limit` that is supposed to be a heap bound and nothing else. The property
is measured rather than asserted: over `notion/compact.jsonl`, one slice and hundreds of slices produce **identical
md5 digests over every row** across source, id, kind, url, occurred_at, title, body and visibility.
Narrowing the set clause to those three columns makes that digest diverge, so the check can fail.

**A collapsed record's AUTHOR survives.** Dedup keeps the newest version of a repeated `(source,
source_id)` and every author the older versions named, so whether a person reaches the graph never depends
on whether two captures landed in the same slice. It is not rare: a repeated id carries a DIFFERENT author **tens of thousands of** times in Linear, about a thousand in
Slack and hundreds in GitHub, most of them one person under two representations (a UUID from one connector path, a display name
from another). Measured on `linear/compact.jsonl`, about ninety thousand rows: dropping the older authors, one slice
produced **about a quarter fewer** people than hundreds of slices did; keeping them, both produce **the same
count**, and the row digests match too.

**A multi-slice run reports row VERSIONS, not rows.** Dedup happens within a slice, so a record appearing
in two slices is written twice: the same file reported about half as many rows again across hundreds of slices as in one, with
the table holding the one-slice count either way. Both numbers are true, and the report labels which is which.

One refusal never sinks a run. A malformed line, a source the store has no column for, a container whose
per-source row cannot be filled — each is counted, grouped by reason with an example, and reported at the
end while every other row lands.
