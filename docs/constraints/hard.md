# Hard constraints

Part of [Design constraints](../constraints.md).

These are load-bearing. A design that breaks one is wrong, not clever.

## 1. Answer quality beats speed. Always.

The point of the product is a _correct grounded answer to a hard question_. Latency is the secondary
constraint, and a fast wrong answer is a failure.

The specific trap: the cheapest way to make retrieval fast is to make it consider less — shrink the candidate
set, cap the corpus, lower the limit. Every one of those passes a stopwatch and quietly
destroys the capability. **Cross-cutting questions are precisely the ones that need breadth.** If a change
narrows what retrieval considers, that is a product decision with a recall cost, and it must be stated
explicitly and owned — never absorbed as an optimisation.

## 1a. Retrieval is Postgres full text over the store. Nothing else.

**The mechanism is settled and the alternatives are banished.** The owner's ruling: full text search over the
whole store answers in single-digit milliseconds and already covers every row for free, so everything else goes —
no index build, no days of work and no gigabytes spent on one. No pgvector, no embeddings, no
re-ranking, no semantic search, no locally-built lexical index — and no arm that could reintroduce one.

**What answers a question instead.** `content.searchable` is a GENERATED `tsvector` column with a GIN index,
so full text cannot drift from the text it indexes and costs nothing to keep. Structured filters narrow it,
`--person` spans platforms, and the selection comes back newest first. Then a fan-out of cheap Haiku readers
judges what came back, each quoting the record it read, and `store collect` refuses a finding whose quote is
not verbatim in the shard its reader was given.

**The constraint is the OUTCOME, and that half is the owner's:** what is mandatory is being able to ask a
question and get an answer that feels omniscient. What
reaches that outcome is investigating the way the owner would — following a thread, reading the conversation AROUND a hit rather than the
hit alone, asking better queries when the first is thin — because following the conversation reaches evidence
that ranking cannot.

**The cost, stated rather than buried.** The detective fan-out is slower than a single ranked query and
spends more model calls. The owner took that trade explicitly: the slowdown is negligible against how much the
quality and the capability ceiling rise. The owner's golden rule —
correctness over speed — is constraint 1 above.

## 2. Nothing is silently degraded

If the answer was computed over less than the whole corpus, it says so and says what was excluded. If a cache
missed, that is reported, not swallowed. If a stage was skipped, the progress output cannot claim completion.

This is the repo's most expensive recurring defect class — state that is false reported as true, or not
reported at all. It has cost a silently-reverted PR, an outage that a green suite hid, a batch cache that
re-spent without warning, and a plugin that did not load for weeks. Answering over a subset without saying so
is the same shape.

## 3. No content is silently dropped from what gets indexed

Postgres full text indexes the whole `content.searchable` column with no cap at all, so **what the store can
FIND is the whole record**.

**Two caps exist, and both are reported rather than silent.** A fan-out shard clips an individual record
past `MAX_RECORD_CHARS` (`src/retrieval/fanout.ts`) and marks the shard record `clipped`, so a reader can see
its own record was cut; and `distil` gives a batch of n records n × `DISTIL_RECORD_CHARS` (1,200) characters of
body, water-filled smallest-first by `promptBodies` (`src/gold/recordBody.ts`), which `distil status` reports per
batch before you spend it. `slopweaver slice verify` renders each body through
the REAL shard renderer and goes red when one does not survive, which is the falsifiable witness that keeps
this honest.

**The measurement behind it.** Measured over 280,279 records / 149.6M characters: 31,768 records
(11.3%) exceeded 1,200 characters, discarding 67.4M — 45.0% of all text — and the longest single record was
163,939 characters. A conclusion tends to live at the BOTTOM of a long PR description, Linear
document or thread, so any cap on what a reader is handed is a cap on what can be concluded. Reporting a loss
is not fixing it.

## 4. `refresh` is the only writer into bronze — with one targeted exception

One deterministic gate into the corpus. Run it again tomorrow and it adds the delta. Anything else that wants
derived state writes its own artefact under `$SLOPWEAVER_HOME` — an index, a cache, a report — never corpus
records.

The exception is `fathom share <url>` (and `fathom discover --ingest`, which calls it): a call somebody else
recorded is reachable only as a share page, which no crawl can list. It writes through the SAME committer
(`createBronzeCommitter` — denylist, redaction, dedup) and never moves a watermark, so the next refresh is
untouched.

Several ways to populate bronze would cost more than they are worth, and an interactive command that moves a
watermark would silently truncate the next real refresh.

## 4a. A lane scanned off a local tree is not rebuildable until survival says so

`refresh` can re-fetch a provider lane whenever it likes. It cannot re-fetch a lane it SCANNED, because a
re-scan reads the tree as it is today — and when that tree has been pruned since, the corpus is the only copy
of everything that went. Nothing about the lane looks different: the records are all present, every count is
stable, and `dev manifest --compare` is perfectly green, because conservation compares the corpus to itself
and this loss happened outside it.

So a verdict that a lane may be discarded, rebuilt or wiped **cites the origin-survival reading** —
`slopweaver dev manifest` prints it on every run, per lane, as the number of distinct local origin files that
are GONE. `intact` clears a lane; `lossy` refuses it. A lane with **no local origins is not cleared either** —
that reading looked at nothing, and it must be argued rebuildable some other way.

Measured, which is why this is a constraint and not a note: a fleet session and the supervisor
independently graded this install's `self` lane WIPE at high confidence within minutes of each other. Both had
checked that the scan was read-only and that it targeted the right directory. Neither had checked whether the
files it scanned still existed — 3,982 of 5,019 did not. What caught it was the owner attaching a condition to
a wipe they had just authorised, which is not a mechanism.

## 5. Search runs in your own Postgres. No hosted search or embedding API.

Zero-key is the product, not a feature of it. Reaching for a hosted search or embedding service would undo
the only thing that makes this project structurally different from hosted enterprise search. There is no
embedding step anywhere, hosted or local ([1a](#1a-retrieval-is-postgres-full-text-over-the-store-nothing-else)): full text and trigram are Postgres
features, on your machine, over a database you selected.

## 6. Corpus data does not leave the machine

Beyond the egresses already documented and disclosed in [security.md](../security.md): the source reads you
authorise, the Claude calls you already make, Slack messages you send, the Codex passes you explicitly run —
**and whatever those passes choose to fetch.** Codex runs with network access and live web search, so that
last one has no fixed destination — **and whatever the console voice's thinking model searches for**, through
OpenAI's hosted web search (the owner's choice). Those two are the only
egresses in the product that cannot be enumerated in advance, which is exactly why they are named here rather
than left inside "the Codex passes" and "the console voice".
A new egress is a trust-model change and needs `security.md` updated in the same PR.

**Local-first is permanent: Slopweaver runs on the owner's one Mac, never in the cloud.** That is the owner's
ruling on the containerised-and-portable options, and a hard rule the owner set early. The nightly store backup is
**disaster recovery only**, written encrypted to a local directory (the owner's ruling: no GCP), and GitHub
Actions is **compute offload for tests**. Beyond that and the
egresses listed above, nothing leaves the machine, and the data
never lives in a cloud database. The portability goal is a disposable Mac: every durable class in the store,
and one `recover` command that rebuilds a fresh install from the backup. So no hosted store, no VM running the
CLI or the listener, no cloud agent sessions and no devcontainer. The owner's three reasons are the constraint, so
re-open it only when one of them stops holding:

- **Compliance will push Claude use to be device-bound**, rather than account-bound on personal accounts, so
  the laptop is where a session is allowed to run.
- **No new vendors in Vanta for Slopweaver.** No Supabase cloud, no Voyage AI, no VM. Every new host is a
  vendor to review and a control to keep passing.
- **The laptop setup just works.** Cloud would add Codex, browser and local-tooling access problems. The owner
  will not take those on unless the team asks, and does not expect that soon, if ever.
