# The denylist at the store, and the corpus at scale

Part of [The local Supabase store](../store.md).

The sync-author denylist holds at bronze write, silver derive and the store's ingest. A store entrance that
skips it is no hypothetical: MEASURED, a fill through an ingest that never read the denylist
wrote **about a million** `#monitor-feed` rows into `content_slack` that should not have been indexed,
and tens of thousands of Nightfall rows followed. Reproduce the shape of that failure on any store:

```sql
select date_trunc('day', c.created_at)::date, count(*)
from content c join content_slack s on s.content_id = c.id
where s.channel_name = '#monitor-feed' group by 1 order by 1;
```

**Both entrances resolve the policy themselves.** `ingestJsonl` and `ingestRecords` each load the denylist
inside the store boundary rather than taking it from a caller, because the failure to guard against is a
second door nobody wired, not a wrong filter: `src/cli/commands/store/load.ts` reaches `ingestRecords`
directly. Exclusion happens between the parse and the projection:
below the projection the raw payload's `app_id`, `bot_id` and `thread_ts` are gone, and past it a denied
alert would still mint the person that "wrote" it.

**Rule D defers rather than guesses.** A denied row that sits in a thread is HELD, not dropped, because the
human reply that rescues it may be a hundred thousand lines further on — the held set is bounded by how many
denied rows carry a `thread_ts` at all, measured at 471 over the whole store, and settles once the read
reaches the end of the file. A pass that stopped on its ceiling keeps its candidates held for the resumed
run rather than releasing them on half a file's evidence. `recordsExcluded`, `recordsRescued` and
`deferralOverflow` are on every ingest report, and the CLI prints them whenever any is non-zero.

**`store exclusions` is the verb.** `detect` counts every `(app, channel)` pair and proposes the ones where
one app holds ≥95% of a channel and ≥500 rows; it changes nothing, and a proposal becomes policy only when
somebody writes its line into the denylist. `purge` counts what the denylist already covers and deletes it
with `--apply`, against `content` rather than `content_slack` so the per-source row cascades with it. Bronze is never touched, so a re-ingest with the line removed restores exactly what a purge took.

**`purge` honours rule D, and `--delete-human-threads` is the waiver.** A denied alert a human replied under
is kept, so the reply never loses its parent; the preview reports how many that was. The count and the
delete share one sql fragment rather than two agreeing predicates, which is what stops a preview from
describing a different population than the delete. `--delete-human-threads` takes them anyway, kept reachable because an operator has to be able
to reproduce a full purge. **MEASURED** over the pairs the detector then proposed: tens of thousands of rows
were proposed, and the human-thread rule cost only tens of rows while retaining dozens of threads and
hundreds of human messages. Repro: `slopweaver store exclusions purge` twice, with and without the flag.

**MEASURED, the quick win applied:** the store population was roughly halved, deleting more than a million
rows, nearly all of them Slack. A second `--apply` deletes zero.

## The whole corpus, and what loading it measured

`store ingest --source <s> --limit <n> [--all] [--from-file <basename>]` reads one source's WHOLE bronze:
`listBronzeFiles` enumerates it recursively and `sortBronzeEntries` orders it — the canonical
`compact.jsonl` first, then window files by name — and each file goes through the same `ingestJsonl` a
`--file` run uses. `--all` reads each file to its end; without it, ONE bounded slice per file, which is a
cheap pass that reports what a source's bronze will refuse before a multi-hour load spends the time.
`--from-file` resumes at a named file and REFUSES a basename that matches nothing, printing the real ones.
`--file` and `--source` are mutually exclusive, and `--from` (a byte offset into one file) is refused with
`--source` rather than silently ignored.

**Nothing new decides the ORDER, and that is the point.** `content` upserts on `(source, source_id)` and a
later capture supersedes completely, so the file written LAST decides what the row holds — and a
`CorpusRecord` carries no capture timestamp to sort by (`tsIso` is when the event happened). Position is
the only signal, which is why this reuses bronze's own read order rather than inventing an mtime sort:
`corpusPaths.sortBronzeEntries` carries the measurement that settled it, where a plain sort put
`compact.jsonl` last and all 60 re-projected meeting transcripts resolved to their superseded versions
with nothing reporting it.

**MEASURED**, the whole corpus, `/usr/bin/time -l` per source at `--limit 500
--all`. Reproduce with `slopweaver store ingest --source <s> --limit 500 --all` and `store status`. Order
classes per source:

| Source | Bronze bytes read | Row versions written  | Peak RSS       | Elapsed             |
| ------ | ----------------- | --------------------- | -------------- | ------------------- |
| self   | tens of MB        | tens of thousands     | hundreds of MB | seconds             |
| gmail  | MB                | thousands             | hundreds of MB | seconds             |
| github | hundreds of MB    | tens of thousands     | hundreds of MB | seconds to a minute |
| notion | hundreds of MB    | hundreds of thousands | hundreds of MB | minutes             |
| linear | hundreds of MB    | hundreds of thousands | hundreds of MB | minutes             |
| slack  | several GB        | millions              | hundreds of MB | minutes             |

**In total, several GB, millions of row versions and content rows, and minutes of wall time.** The
per-source peaks are the finding: Slack's multi-GB bronze peaked LOWER than a GitHub file a fraction of its
size, and peak RSS stayed sub-gigabyte and FLAT in the size of the file. What varies is the identity graph a
source builds, not the bytes it reads, so `github`'s peak is about its cross-container id collisions and its
record SIZE rather than its length.

`store status` after the load reports the rows per source, Slack by far the largest. Row versions exceed rows because dedup happens within a slice, so a
record appearing in two slices or two files is written twice — both numbers are true and the report says
which is which.

**One refusal class showed up and it is a fact about bronze**: a small number of Notion records among hundreds of MB, reported
grouped by reason with an example. Nothing else refused a single row.

**A slice is bounded by the lines it examines, not only by its successes.** It examines at most `limit`
non-blank lines, retained refusals are capped where they are PRODUCED, and `reachedEnd` reads both
ceilings — bounded by successes alone, a file whose every line is unstorable reads to EOF in one slice
holding a refusal object per line, the very heap shape the bound exists to prevent. The report's refusal
count is `refusalsCounted`, exact, never the capped example array's length, and the printed breakdown says
when it is of the examples.

**What is NOT built, stated rather than discovered.** There is no durable cursor across invocations, for
the reason the single-file case has none: `compact` stages a new canonical file and renames it into place,
which invalidates every byte offset into that source at once, so a stored cursor would be a number that is
silently wrong after an ordinary maintenance run. What makes a re-run cheap instead is that every write
upserts, so repeating a source is idempotent. There is no `--all-sources`; a recorded loop over
`BRONZE_SOURCES` is what a whole-corpus load is, and a second orchestration verb buys nothing.

## The SMALL slice: a recency-weighted copy of the store

**Retrieval is Postgres full text plus `pg_trgm` substring over this store, read by a fan-out of visible
Haiku detectives** — no pgvector, no embeddings, no
re-ranking, no semantic search, no locally-built lexical index. Nothing reopens that short of a new decision
from the owner. The slice is a small, recency-weighted copy of the whole store, about 10,000 rows of each
integration, because a test over it is valid only if its questions can be at least somewhat answered from that
amount of information.

So the store holds **two databases on the same local Postgres**, one connection string apart — which is
what "no verb defaults its database" buys:

| Database           |                     Rows | What it is for                           |
| ------------------ | -----------------------: | ---------------------------------------- |
| `postgres`         |        about two million | the whole corpus, § above                |
| `slopweaver_small` | under a hundred thousand | the small slice, about 10,000 per source |

**MEASURED.** Taken with `store ingest --source <s> --limit 10000` — one bounded slice per
file, no `--all` — against a database created with `create database slopweaver_small` and migrated by
`slopweaver store push --no-generate`, which applied 3 migrations, 6 role statements and 60 guard statements from scratch.

| Source |                  Rows |
| ------ | --------------------: |
| slack  |  over twenty thousand |
| notion | about twenty thousand |
| linear |     over ten thousand |
| self   |    about ten thousand |
| github |    about ten thousand |
| gmail  |    under two thousand |
| fathom |             a handful |

**A compact file is newest-FIRST, which is why a 10,000-record head is recency-weighted rather than
arbitrary.** Verified per source: `slack/compact.jsonl`'s first line is its newest record and its last is
its oldest. So `--limit 10000` off a compact takes roughly the newest 10,000, and the four org-shared
sources reach the latest days because their post-compact window files are small enough to read whole in the
same pass. **Two sources do NOT reach recent days** — `github` and `self` stop short of the build date,
because each has only a compact and 10,000 records of it does not span to its build date. That is a
coverage gap a question set over the slice has to work around, not a defect in the loader.

**A question passed VERBATIM as a `--search` term has near-zero recall at ANY scale**, because Postgres
full text AND-s every word of it. Measured on one question the corpus demonstrably answers:

| Query for that question      | Small slice (under 100k) | Whole corpus (about 2M) |
| ---------------------------- | -----------------------: | ----------------------: |
| the whole question, verbatim |         **0 candidates** |        **2 candidates** |
| its two content words        |                        1 |                       — |
| its one distinctive word     |                        7 |                      43 |

Two rows out of two million for a question the corpus answers is the retrieval problem stated as a
number, and the small slice turns it into zero — which is exactly the owner's validity condition biting.
Reproduce with `store query --search "<phrase>" --limit 2` against each database. **Query construction,
not corpus size, decides recall.**

**`--contains` and `--like` are a different QUESTION rather than a better spelling of the same one.** `--search` asks the tsvector whether the stemmed WORDS appear;
`--contains` asks the two trigram indexes whether the literal CHARACTERS appear; `--like` hands `ILIKE` the
caller's own pattern. MEASURED against about a million rows (the count § above records, after the alert purge):
`--contains U04` returns a few hundred rows and
`--search U04` returns ZERO, because `to_tsvector` never emits a token for a member id sitting inside a
`<@U…>` mention — reproduce with `slopweaver store query --contains U04 --limit 3`. The plan is a bitmap
scan of `idx_content_body_trgm` and `idx_content_title_trgm` at 0.266 ms, which is why the predicate names
those two expressions and never their concatenation (`src/store/predicates.ts`'s `ilikeBothColumns` carries the
reason).

**Neither flag is fast unconditionally, and the floor is three characters.** `pg_trgm` indexes trigrams, so
a pattern whose longest run of literal characters is shorter than `TRIGRAM_FLOOR`
(`src/store/probe/shapes.ts`) has nothing to look up and plans as a parallel sequential scan: MEASURED,
`body ilike '%z%'` is **2,923 ms** against the same index that answers `%U04%` in 0.266 ms.
Neither flag REFUSES a short pattern — `--like` handing you your own pattern is the whole point of it, and a
refusal would need a hatch row for a query that is merely slow rather than wrong — so the cost is stated
here instead. Reproduce both with `explain (analyze) select count(*) from content where body ilike '%z%'`. `--contains` escapes `%` and `_` so a literal one finds itself: `--contains "100%"` selects some
sixteen thousand rows where the unescaped pattern selects about twice that. **At most one of the three per query** —
`textPredicateConflict` (`src/store/query.ts`) refuses two rather than ANDing them, since a page thinned by
an accidental conjunction reads as a fact about the store.
