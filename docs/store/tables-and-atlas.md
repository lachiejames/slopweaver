# The tables, and the shape the owner ruled on

Part of [The local Supabase store](../store.md).

One `content` table with a `source` discriminator, per the owner's archive's unified content model, plus **one
table per source** carrying the columns that platform actually gives — `content_slack` a channel, a
message ts and its counts, `content_github` a repo, a number, a state and its labels, `content_linear` a
team, a workflow state and its planning fields, `content_notion` its page hierarchy and its property bag.
The schema aligns with the reality of what a platform gives, in a proper table rather than a blob.

**`memories` is the register itself**, the first table holding something no provider can be asked for again,
and the first whose rows a VERB writes under a store role rather than as the database owner. Most
learnings are retrieved rather than always-loaded, by full text search over the memories table; `knowledge record`
and the settle gate sit on it, so this table is what `handover settle` reads before a run may close. A row
is a RECORDING — `recording_id` is the key and the claim `id` is deliberately not unique, because a repeated
claim is the consolidation signal (`src/store/schema/memories.ts`). `searchable` is a generated STORED
`tsvector` over the domain, claim, evidence, caveat and both placement fields, with a GIN index; `kind`
splits a paid-for `lesson` from an owner `preference` and a CHECK constraint keeps the lesson-only facets off
a preference — which is also what lets every lesson reader select `kind = 'lesson'` at the database rather
than trusting a filter. The bot role is denied by a `false` read policy, mirroring the 0600 file it replaces,
and `slopweaver_owner` carries the one INSERT grant in `storeTableGrantStatements` — a `for: "all"` policy is
not a grant, and a table with only `grant select` refuses the owner's insert however permissive its policy
reads.

MEASURED against a throwaway Postgres 17 — reproduce with
`docker run -d --rm -e POSTGRES_PASSWORD=proof -p 55498:5432 postgres:17`, then `slopweaver store push --no-generate` and
`slopweaver knowledge import-lessons --file ~/.slopweaver/knowledge/lessons.jsonl --apply`. **That file is history now** — `knowledge record` writes the table — but its row count is still not a
constant to quote: a worktree on a commit before the cutover keeps appending until it rebases, and the count
moved from several hundred to over a thousand across the days this work took. The import key is per LINE precisely so a
second apply over a file that grew writes only what was appended, and `--rekey` puts a table imported under
the older whole-file key onto that scheme after verifying every row against its own line. MEASURED on this
install: every row rekeyed, then the apply wrote only the few dozen lines appended since,
leaving a handful more imported rows than distinct claims. Re-measure rather than quoting a number.

**The last two rows are the whole of a multi-round review argument, and they are worth reproducing.** Review
found the same class three times over, one precision deeper each time: `recorded_at` is millisecond-precision in
the register, `created_at` is microsecond-precision in Postgres but millisecond-precision through
`toISOString()`, and in between a restore was dropping `created_at` altogether. Every
timestamp-based tie-break collapses at SOME precision and then falls through to an arbitrary
`recording_id`, showing an older `confirmed` where a newer `refuted` should be.

Two changes end it rather than moving it. The ordering is `recorded_at DESC, seq DESC`, and `seq` is a
`bigserial` — a monotonic integer with no precision to lose — exported and restored verbatim, with the
sequence advanced past the highest restored value so the restored database still takes new writes. A
`restore --merge` into a live database is the one exception: it renumbers the rows it adds above the live
maximum, keeping the export's own relative order. And
**both timestamp columns are declared `precision: 3`**, so the database itself holds exactly what the wire
format can carry: a microsecond instant is rounded to the millisecond ON WRITE, by Postgres, whatever wrote
it. The fourth round landed on `recorded_at`, the PRIMARY ordering term that no tie-break
can rescue, which is what made a schema fix the only terminal one.

Reproduce: insert two recordings of one claim whose instants differ only in microseconds, read the stored
values back (they are already rounded and still distinct), then export and restore — recall answers the
same verdict on both sides.

`person` is one row per human keyed by their EMAIL, with each platform's id as its own UNIQUE column,
which replaced a GIN-indexed `identities` array.
`person_link_candidate` beside it holds the matches identity resolution found and refused to apply.
`container` is self-referencing so a thread sits inside a channel without a second table.

**A cross-source attach is a database refusal, both ways.** `content` carries a unique index on
`(id, source)` that its primary key makes look redundant; it is there so each per-source table can key
`(content_id, source)` onto it and pin `source` with a CHECK. The other direction — every Slack content row
HAS its `content_slack` row — is a DEFERRED constraint trigger, because no key can express "a row exists
over there". Deferred is the whole trick: the two rows are written by two statements, so an immediate check
would refuse the first one every time, and at COMMIT a correct transaction has written both. Verified live
on Postgres 17: a lone Slack content row raises `slack content row … has no content_slack row`, a
`content_slack` row pointed at a GitHub content row is refused by the foreign key, and both halves inside
one transaction commit.

## The atlas: five tables, one generic loader, and the divergence that turned out not to be one

All the atlases land in Supabase, because that is where the data should sit. Before `store import-atlas`
none did — the atlas home held hundreds of thousands of entity rows across hundreds of kind files and
dozens of platforms, and the store held none.

They are **their own tables, never `content` rows**, because the atlas is DISTINCT from the
corpus (bridging them into retrieval was rejected on exactly that). An atlas says what
a PLATFORM contains; the corpus says what this organisation SAID.

**That ruling is about STORAGE, not RETRIEVAL** — stated here because the two were once read as one thing, and reading them as one thing is what left the detective fan-out
unable to see hundreds of thousands of rows. The atlases are among the best data sources there are, and keeping them from the
detectives would waste them. So an atlas row is still never merged
into `content`, and a reader may still ask the atlas tables a question in THEIR OWN SHAPE and hand a
detective what it finds. `slopweaver atlas probe` is that reader (`src/store/atlas/probe.ts`): two rungs —
the platform's own handle for a thing (`atlas_entity.provider_id`, the kind name) and what a channel
learned about it (`atlas_entity_channel.detail`) — counted per `(platform, kind)` with each cell's last
successful sync beside it, seconds for the whole estate. `store detect` spends a detective per
platform off that count (`src/detective/atlasLead.ts`), and the brief a detective gets carries the claim
boundary the count does not: **a count is of STORED records and proves nothing about a provider.**

| table                  | what it holds                                                                                                                                                         | rows loaded                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `atlas_entity`         | one thing one platform contains — `(platform, kind, entity_id)`, its `provider_id`, and a `jsonb` `extra` for the fields a platform carries beside the canonical four | hundreds of thousands                   |
| `atlas_entity_channel` | one channel's independent view of one entity, cascading off it                                                                                                        | hundreds of thousands                   |
| `atlas_kind_status`    | each kind's cell from its platform's `manifest.json` — digest, entity count, last attempt, last success                                                               | hundreds, one per kind file             |
| `atlas_coverage`       | each kind file envelope's coverage cells                                                                                                                              | thousands                               |
| `atlas_gap`            | each envelope's gaps, deduped                                                                                                                                         | thousands, of tens of thousands on disk |

**All five declare a bot-read policy of `false`, and that is INERT today — the one thing to know before it stops
being.** Nothing in this tree ever runs `set role slopweaver_bot`: `connectStore` connects as the owning
user and the policy is never consulted, which is why `atlas probe` reads the whole imported population rather than none.
The declaration is a decision already taken about a lane that has not been switched on (`src/store/policies.ts`
§ why each role is granted back). **Its activation condition is the row to act on**: the day a Slack-facing
turn actually assumes that role, every atlas leg — the probe, the detective leads, the `atlas-estate`
capability row — goes dark and reports ZERO, which is indistinguishable from an estate holding nothing.
That is precisely the failure `src/atlas/kit/estateEvidence.ts` exists to prevent, so switching the lane on
means deciding what the bot may read here in the same change, never afterwards. Reproduce with `grep -rn "set role" src/` and `slopweaver atlas probe`.

**The keys are NATURAL, not the house surrogate `uuid`, and the reason is the loader.** An entity and its
channel views arrive on the SAME line of a kind file, and a kind file's size is a property of the tenant —
one account document measured in the hundreds of MiB. With a surrogate key the loader would
have to insert the entity, read its generated id back, and hold an id-per-entity map before writing a single
channel row, re-introducing the whole-file buffering one layer down. With the natural key both batches are
built in one streaming pass. The cost is tens of MB of repeated key columns across hundreds of thousands of channel rows; the benefit is
that `select … from atlas_entity_channel where platform = 'vanta'` needs no join.

**The bot is denied all five**, same posture as `memories` and for the same reason: these files are 0600 on
disk, so the conservative port denies the Slack-facing role in the migration that creates the table rather
than widening access there. Verified live under `set role slopweaver_bot`: the bot sees none; the agent sees the complete imported
population.

### The divergence is ONE rule, and there are no adapters

The board row this implements described "one generic loader plus three adapters", because cloudflare,
crowdstrike and github predate `kit/channelEntity.ts` and carry no `channels` map. Re-measured
by streaming every kind file, that is not what the divergence is:

- **Every** entity row carries `id` and `providerId` as strings — zero exceptions,
  including every pre-`channels` row. **Every** envelope carries `kind` — zero exceptions.
- A pre-`channels` entity is a SINGLE-channel entity whose view is the row's own
  `{state, firstSeenAt, lastSeenAt?, source, detail?}` — exactly the fields a `ChannelView` carries.
- The only thing missing is the channel's NAME, and every such row carries it, in `source.channel`
  (cloudflare) or `source.surface` (crowdstrike, aether, github). **Zero name neither.**

So `src/store/atlas/project.ts` has one fallback (`channelNameOf`) and no per-platform branch anywhere.
Reproduce the split by testing line 2 of every kind file for
`has id && has kind && has providerId && has channels`.

### Three exclusions, each measured rather than assumed

**`jumpcloud/_resume.jsonl` is not atlas content** — hundreds of MB of sync progress records, a large share of
`atlas/`, and the only `_`-prefixed file in the tree.

**A directory under `atlas/` is not necessarily an atlas.** `atlas/apps-surface-map/` holds source artifacts
but no manifest or kind file, and nothing in `src/` names it. The platform
list therefore comes from `src/atlas/registry.ts` — the seam every generic atlas verb already goes through —
intersected with what is on disk, never from a `readdir`.

**The KIND comes from the envelope, never from the file name.** The file is `browser-pages.jsonl` and the
kind is `browser-page`.

### A generation becomes a transaction, which is what the leg buys

`src/atlas/kit/generationSwap.ts`'s header names the residue the filesystem cannot close: _"what it cannot do
is survive a process KILL mid-commit … closing that needs the whole generation to hang off one renameable
pointer, which is a layout change across every atlas"_. In Postgres a transaction IS that pointer.
`replaceKindSlice` deletes one `(platform, kind)` slice and streams the new one in inside a single
transaction, so a killed import leaves the previous generation intact — strictly safer than the two-phase
rename, with no layout change at all. The unit of resumption is the KIND, not a byte offset: a generation can
be swapped underneath a reader between runs, so an offset into the file it started on addresses different
bytes than it did. A kind whose stored digest matches its manifest's is skipped outright — a full re-run over
an unmoved estate is ~100 ms per platform.

### Three things the first real load found, none of which a fresh database would have

**Postgres `jsonb` cannot hold U+0000.** `vanta/policy-documents.jsonl`, `vanta/vulnerabilities.jsonl` and
`cloudflare/worker-script.jsonl` carry `\u0000` inside extracted document text and the insert fails with
`unsupported Unicode escape sequence`. It is stripped rather than refused — refusing would drop 8 real policy
documents over a control character that is not content — and **counted** (a few hundred on this estate), gated on a
substring scan of the raw line so all but three of the estate's files never pay for the walk.

**The estate already contains duplicate keys.** One entity (`cloudflare/api-gateway.jsonl`, twice) and
**91.4% of all gap records, tens of thousands of them**; `jumpcloud/applications.jsonl` alone holds dozens of
gaps that are 3 distinct ones. Every colliding group is byte-identical (0 lossy collapses estate-wide), so the fold loses
nothing — but it is REPORTED per run rather than absorbed, because the count is the only place the writer's
defect becomes visible.

**A count you derive is not a count you have.** `countStored` counts the table inside the transaction: a
projected count knows nothing of a duplicate `onConflictDoNothing` swallowed (a full rehearsal reported
one more entity written than the hundreds of thousands of rows in the table), and it leaves the collapse statistic unable to fire.

### Measured cost, and why the number moved

**About a gigabyte for the whole estate on a FRESH load** — against somewhat less input JSONL, that is
**1.26x**, not the 2.98x a 10,000-row sample projected earlier. The sample stored each whole entity as one
`body jsonb`; these tables put the key columns in columns and only `detail` stays jsonb.

The same estate read **more than its fresh-load size** on a database that had been loaded several times over. Both numbers are
real and the difference is ordinary Postgres bloat: `replaceKindSlice` DELETEs a slice before inserting it,
so a re-loaded table carries dead tuples until it is vacuumed. Quote the fresh-load figure for capacity and
expect a working store to sit above it.

Re-measure by loading a throwaway from empty:

```bash
docker run -d --rm -e POSTGRES_PASSWORD=proof -p 55496:5432 postgres:17
SLOPWEAVER_STORE_URL=postgres://postgres:proof@127.0.0.1:55496/postgres \
  SLOPWEAVER_ALLOW_UNLANDED_MIGRATION=1 slopweaver store push --no-generate
SLOPWEAVER_STORE_URL=… slopweaver store import-atlas
psql … -c "select pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and relname like 'atlas%' and relkind = 'r'"
```

The full load took 143 s.

### What this deliberately does not do

No merge into `content` and no `store read`/`store cite` integration — the atlas stays distinct in
STORAGE, which is not the same as being unreadable: `atlas probe` and the fan-out's atlas leg read
these five tables in their own shape, above. No human-name derivation. And **no atlas MEDIA**: an entity's `artifacts` field is a list of
`{byteLength, kind, mediaType, relativePath, sha256}` and `schema/atlas.ts` stores it as `jsonb`, so this
import carries the POINTERS and has never carried one byte of what they point at. That is not a gap the
database backup closes — it is the `corpus/attachments` shape one platform over, and it is why `atlas` is
on `BACKED_UP_FILE_ROOTS` ([§ "The backup, and what it actually carries"](backup.md)). The Storage API is written through — by the measurements ([§ "The measurements"](fleet-state-and-measurements.md#the-measurements)), not by the atlas, whose
media still rides the files leg.
