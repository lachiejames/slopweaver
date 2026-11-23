# The history leg a bot turn actually reaches

Part of [The local Supabase store](../store.md).

All the atlases, corpuses and identities live in Supabase, so a read that belongs in the store must not go to
local markdown files. A turn that cannot name the
corpus as a need reaches for the spelling that works — a bronze read and `rg` over bronze files — so the
brief shows the history row and the bot path has a database. The brief partitions every capability into
available / historical / unavailable (one reserved-id set in `route/liveCapabilityPolicy.ts`, an exhaustive
`never` switch on `truthMode`, three sections in `renderCapabilityContracts`), and `turn dispatch` runs the
needs/truthMode check. What makes a HISTORICAL row reachable and honest:

**The selection is REMEMBERED, and that is not the same as guessed.** `src/store/config.ts` resolves
`SLOPWEAVER_STORE_URL` first, then `$SLOPWEAVER_HOME/secrets/store-url` (`0600`, a row in
`src/secrets/credentials/storeAndBackup.ts`). Nothing synthesises a host, a port, a database or a password, and an
unselected store still REFUSES naming both places — so "no verb defaults its database" holds without a bot
turn needing an exported variable. `--home` is threaded through every store verb's opener for the
same reason the Slack token resolvers take it: a verb under `--home /elsewhere` reading the default home's
selection would answer one install's question out of another's records. Every verb that opens the store
takes it — `query`, `facets`, `detail`, `ingest`, `status`, `identity`, `read`, `cite` and `load` —
because the brief APPENDS it to every store command it grades, and a verb without it refuses
`unknown flag: --home` beside an AVAILABLE row.

**The history row is GRADED against the store it would read**, the way an atlas row is graded against its
generation. `observeStore` (`src/store/reading.ts`) opens one connection with a real
`statement_timeout` — Postgres cancelling its own work, not a `Promise.race` that abandons a running
query — proves reachability with `select 1`, then tries the grouped census. `src/route/storeReading.ts` is
the pure half: unselected and unreachable become `UNAVAILABLE` **with the command stripped**, so nothing
prints a verb that was always going to refuse; a reachable but empty store is unavailable and
`coverage: complete`, because zero is a fact; and a store whose census missed the budget is **available
with UNKNOWN extent**, never zero, because zero reads identically to empty and only one of those is true.
Missing the budget is exactly SQLSTATE `57014` — Postgres cancelling the statement — and nothing else: a
census the role cannot run, or a table that is not there, is UNAVAILABLE carrying the driver's own reason,
because the command the row would print cannot read the store either. The probe then reads one
WHOLE row, because the census reads three columns while retrieval reads the record — a role granted
`select (source, occurred_at)` alone passes a census and fails a record read with SQLSTATE `42501`.
A question that looks like a flag is fenced behind `--` where it is
materialised into argv, because a bare `-x` question refuses as an unknown flag before any database opens while
its row reads AVAILABLE ; `--home` is inserted before that fence, since everything after
one is question text. That row read comes FIRST and the census second, so
unknown extent is never reported without readability proven, and a cancelled row read is a REFUSAL rather than an unknown, because a cancelled statement says nothing about permission.
MEASURED: the whole probe costs 175 ms median of five warm laps against about two million rows, 5 ms more
than the census alone and 11x inside the 2,000 ms budget. Reproduce with `time slopweaver turn brief
--contracts --text x`. A malformed remembered
URL is UNAVAILABLE the same way rather than an abort of the whole brief.
`truthMode` stays `history` however loaded it is — the invariant that a `current` claim cannot rest on
history alone is enforced on the RELATION between legs, which is what makes grading safe.
The grading is keyed on what a row's command OPENS, never on its id: any history row whose argv is this
repository's launcher running `store …` or a `store read`/`store cite` read is graded against the same probe, because they
all open the same database under the same home. Keyed on the id, a copy of the generic row under a second
name would stay AVAILABLE beside a command that refuses. Reproduce with a `capability-profile.json`
carrying that copy and `turn brief --contracts --home <that home> --text q` with no store selected: both
rows read UNAVAILABLE.

**The contract names each source's NEWEST record, not only its row count**, and a dogfood baseline turn
is why. MEASURED: the Slack refresh leg had been frozen since its watermark cursor stopped, with the newest
Slack bronze file written a day later, while the store's Slack row count looked perfectly healthy at well over a million. A row count cannot tell a reader that its upstream stopped, so
`max(occurred_at)` rides the census statement rather than costing a second one, and the coverage prose says
plainly that the store can only be as fresh as the last bronze refresh that fed it. So the small
slice's own coverage gap self-reports: the contract prints a `github` and a `self` line carrying
an earlier newest-record date beside five sources that reach the latest days, so a turn can
see the hole instead of being told a healthy-looking total. Reproduce with
`slopweaver turn brief --contracts --text x` and read the `corpus` row's coverage line; the cursor
itself with `cat $SLOPWEAVER_HOME/corpus/watermarks/slack.json`.

**What froze that cursor is a coverage gap reported at the wrong granularity**, and the contract is what made
it visible. Slack raises one gap per conversation its progress watchdog abandons, and a gap held the POOLED
workspace cursor — so in a workspace of hundreds of conversations, where something stalls nearly every pass, the cursor
stopped moving while bronze kept landing. Holding it bought nothing: an abandoned conversation writes no
`visited` entry, and `planChannelOldest` reads a channel from its OWN cursor "outright over the pooled
window, in both directions", or from the epoch when it has none. A gap declares whether the lane's own
per-container resume state already withholds its span (`CoverageGap.heldPerContainer`,
`src/corpus/ingestJob.ts`), and only such a gap lets the pooled cursor advance — the run still FAILS and
still names the stalled conversation.

**MEASURED**, the probe alone, median of five warm laps, budget 2,000 ms:

| Store state                            | Observation cost |
| -------------------------------------- | ---------------: |
| nothing listening on the selected port |             2 ms |
| about a hundred thousand rows          |            19 ms |
| about two million rows (whole corpus)  |           170 ms |

11x inside the budget at full corpus scale, and a stopped Docker costs a turn 2 ms rather than a hang.
Reproduce with `time slopweaver turn brief --contracts --text x`.

**The bot's turn path is detective-first.**
`skills/loop-bot/reference/dynamic-planning.md` move 2 leads with `store probe` and a flat Haiku fan-out
rather than with the bronze files. `store read` / `store cite` are the SECOND opinion: they carry the `--person` lens — one human resolved to a
Slack member id, a Linear UUID and a GitHub login at once, which the file path has no equivalent of — and
they do not carry the shape ladder, which is what decided the order. A `--person` filter narrows a
population; it cannot widen the one the index could see in the first place, and the measurement above (dozens of
rows through `exact` against thousands through `wild-both` on one surname) is the whole of that difference.

## The load that pulls from the providers

`store ingest --file` reads an on-disk bronze `.jsonl` through `ingestJsonl`; `slopweaver store load` is the
other direction. It runs the connectors' own fetch and projection and writes
what comes back through `ingestRecords`, sharing every line below the projection with the file loader — the
same `projectRecord`, the same duplicate collapse, the same batch and the same id cache. It reads no bronze
file.

**Scope is a recent slice, not the whole history**: a week first across all platforms, or at most the most
recent 10,000 records across each platform, because fast feedback loops matter more than completeness of data
at this stage. The verb takes **the week as the bound and 10,000 as the ceiling**,
because the WINDOW is what makes a cross-platform question comparable; a record cap alone would give Slack a
week and Notion a year and an answer spanning both would have no way to say so.

**What the cap counts.** It bounds what is WRITTEN, not
what is fetched. The connectors' `fetchCap` is a PER-LANE hint — Slack applies it per lane and per channel,
Linear per collection, Notion builds its own budgets from it, and the GitHub org job accepts none at all —
so a load keeps the newest `cap` records of what came back and reports BOTH counts. MEASURED on the first
real load: Linear returned **somewhat over the cap** for a cap of 10,000, and the report says
`CAPPED at 10000 (<n> fetched)`. A source-wide budget threaded into each connector's lanes is the correct
fix and is not built.

**Resumable, with the PLATFORM as the unit.** `store ingest` resumes by byte offset into a file; a live pull
has no file and cannot. What it has is that every write upserts on `(source, source_id)` and every leg is
independent — a load that died after GitHub has stored GitHub, and re-running it re-pulls the same window
and overwrites the same rows. There is deliberately no provider cursor to resume within, because reusing one
is exactly the skip bug below.

**It is isolated from every cursor store on disk, in BOTH directions**, and two of the three leaks were
found by a Codex planning pass rather than by reading:

- **GitHub org mode keeps a SECOND resume store** beside the per-source watermark. `runGithubOrgActivity`
  skipped its per-repo advance only when `--sample` was set, so a `--fetch-cap` run advanced it; and it read
  those cursors unless told not to. A load passes `ignoreRepoCursors` for the read half and `cursorIsolated`
  for the write half.
- **Slack wrote thread cursors on a `--fetch-cap`-only run.** `persistSlackCursors` gated the thread-cursor
  write on `sampled` alone while gating the channel watermark on `bounded`. An isolated run withholds both,
  reads both cursor maps as EMPTY, and — the part that matters most — turns `backfillNewChannels` off: with
  the maps empty every channel looks never-crawled, so leaving it on would turn a seven-day load into an
  epoch-wide backfill of the workspace.
- **Linear wrote its activity history unconditionally** after a successful fetch. An isolated run writes none
  and says so in its notes.

**One side effect is stated rather than hidden**: Notion's crawl writes its own bronze durability checkpoint
per search page as it goes, bounded or not. That is the connector's kill-safety and it is not a port —
nothing here READS a bronze file — but a load does leave those bytes behind.

## Asking the store a question: full text, a person, and a fan-out of cheap readers

There is no pgvector and no semantic search at all: retrieval is full text search, or a query for what one
person wrote across the platforms, with a fan-out of cheap Haiku readers finding what is relevant. Nothing here
thinks about lexical indexes or vectors. The bar for ever reintroducing either is seeing this work in the real
world for a variety of use cases, fully wired up into the bot.

**`--person` is the axis that spans platforms**, and it is a resolution rather than a string comparison.
`content.author_id` already points at the `person` row the identity ladder resolved, so one filter reaches a
human's Slack member id, Linear UUID and GitHub login at once. A name reaches a person three ways — their
display name, a handle on any platform, or an address — all through the SAME `normalizeName`/`normalizeEmail`
the ladder links on, because a second definition of "the same person" written in SQL would drift from the
first. **A name that reaches nobody is a REFUSAL carrying the closest names the store holds**, never an
empty page: zero rows reads exactly like "this person said nothing anywhere", and only one of those is true.
A name that resolves and has no rows says that too, in as many words.

**`slopweaver store read <question>`** selects candidates with Postgres full-text plus whatever structured
filters are given, shards them into one file per reader, and prints the exact instruction for each. **No
model runs in the CLI** — rule 2 — so the visible session dispatches one in-process `Agent` per shard at
`model: "haiku"` and hands the replies back to **`store collect`**, which checks them. `store cite` and
`store read` are the same selection with a different ending.

**Two checks make a hallucinated finding unrepresentable rather than unlikely**, and both are in
`src/retrieval/fanout.ts`:

1. **A finding's id must be in the shard THAT reader was given** — not merely in the candidate set. An id
   borrowed from another shard is a reader reporting on something it was not shown.

   **Which shard is "its own" is a random token rather than the readable `s1`**, because two readers
   swapping those public ids validated against each other's shards and both were kept. The token refuses
   that MISLABEL. It is **not a secret and authenticates nobody**: every token is written into `plan.json`
   beside the shard files, so any reader that can read its own shard can read them all — and sealing the
   plan would change nothing, since a reader with filesystem access can read the other shard directly.

2. **A finding's quote must appear VERBATIM in one of that record's own fields.** A reader cannot produce a
   substring of a body it did not read, so the quote is the evidence that the read happened. Compared on
   collapsed whitespace only: every further normalisation is a way for a paraphrase to pass.

   **The title and the text are tested SEPARATELY, never joined.** With a title of `alpha bravo charlie`
   and a text of `delta echo foxtrot`, the joined string contains `charlie delta` — a phrase in NEITHER
   field that no reader could have read.

A third check catches the file moving underneath the reader — the plan records each shard file's SHA-256 and
`collect` re-hashes it. **Over the raw BYTES, in bounded chunks**, because `Buffer.toString("utf8")` is
lossy: two different byte sequences can decode to one string and hash identically (a replacement character
written as its own UTF-8 encoding and as an invalid byte — two files, one digest). Verified on a real plan: appending a single byte to a shard file turns a kept finding into
`shard-file-changed` and the verb exits 1.

**The plan carries each shard's COUNT, never its records.** Validated against records carried INLINE, a
plan naming a fabricated record beside an untouched shard file whose digest matches perfectly keeps a
finding for evidence that exists nowhere. Everything a finding is checked against is parsed from the bytes
that were hashed, which is what makes the digest mean something about the thing being validated. Verified: a plan edited to name `invented-id` against an untouched shard is
refused `not-in-shard` and exits 1.

**A plan written to disk carries a digest for EVERY shard, by construction.** An absent digest read as
"nothing to verify" would keep findings from a shard file that need not even exist, so `store read` refuses
to write such a plan and the on-disk schema requires the field — no branch skips the check.

**And a shard that cannot be hashed at all REFUSES.** A missing reading read as "unchanged" would pass a
shard `chmod 000`'d after the readers ran — or deleted, or replaced — and exit zero. Not knowing whether the
file moved is a reason to refuse, not a reason to accept. Three states stay apart: the plan recorded no
digest (an in-memory fan-out, nothing to check), the caller did not look, and the caller LOOKED and failed
(`shard-file-unreadable`). Verified the same way: `chmod 000` on a shard turns a kept finding into that
refusal and exits 1. **A shard-wide failure is its own channel, separate from per-finding refusals**:
recorded once per FINDING, a tampered shard answered with an EMPTY `findings` array would produce no
refusal, count as answered, and let a sibling shard's valid finding carry the whole run to exit zero. A failure of the slice is not a property of what the reader said about it.
Verified: with `s2` tampered after planning and its reply empty, the run keeps `s1`'s finding, prints
`refused the whole of shard s2: shard-file-changed`, and exits 1.

Every refusal is printed with its id and its reason, and a harvest with any refusal, any shard failure
or any unanswered shard **exits non-zero**, because a run whose readers hallucinated and whose exit code said
OK is a run a script would build on. Verified against a real plan: an invented id, a paraphrased quote and a
shard nobody planned are each refused by name while the one real finding survives.

**The shard partition is a COST and ATTENTION device, not a security boundary.** That is the honest
statement of what a filesystem hand-off can be. Nothing here
authenticates which reader produced a reply, and nothing can while readers and checker share a directory.
What protects an answer is the pair of checks that do not depend on reader identity at all — a finding's id
must be in the shard its reply names, and its quote must be verbatim in that record — and those hold
whichever reader sent it. Assert that property; do not assert the other one.

**What it does NOT prove, stated rather than discovered.** These checks make a fabricated record or quote
impossible to smuggle in. They cannot prove the reader read well: a reader can still mark a genuinely
relevant record irrelevant, or pick an exact but useless span. That is a recall question and it belongs to
visible evaluation, not to a validator — describing quote-checking as semantic validation would be the
false-confidence version of this mechanism.
