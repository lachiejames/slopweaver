# The local Supabase store

The user-level `$SLOPWEAVER_HOME` lives in one local Supabase —
every corpus, every atlas and the board in one database with relations, no third place. This file is what
that means concretely.

**The whole bronze CORPUS is in the store, and so are the atlases' entity rows** — their MEDIA is the one
part that is not, and [§ "The atlas: five tables, one generic loader, and the divergence that turned out
not to be one"](./store/tables-and-atlas.md#the-atlas-five-tables-one-generic-loader-and-the-divergence-that-turned-out-not-to-be-one) is where that half lives. [§ "The whole
corpus, and what loading it measured"](./store/corpus-scale-and-retrieval-slice.md#the-whole-corpus-and-what-loading-it-measured) carries the load, and the bot's own history leg reads the store rather than the files
([§ "The history leg a bot turn actually reaches"](./store/history-load-and-full-text.md)). The bronze `.jsonl` files under
`$SLOPWEAVER_HOME/corpus/bronze/` are the durable capture the store projects, never the first thing a
question reaches. There is no semantic index and no locally-built lexical one: `store read` and `store cite`
select through the store's own Postgres full-text index ([§ Bronze, the store, and what each source holds](./store/bronze-and-source-coverage.md)).

**How much has actually made the trip is a verb, not a paragraph here.** `slopweaver store share [--json]`
walks every record register under `$SLOPWEAVER_HOME`, counts its records and bytes, and puts each one beside
the store table it mirrors into and that table's live row count. A register nothing mirrors says so, and a
register the walk deliberately skipped says why rather than reporting zero. Two bounds are part of the
report rather than left to be inferred: how many top-level entries under the home no register claims, and
which scratch tier is named and never walked, because walking it costs more than the measurement is worth.
The codebase atlas page renders it live.

- [What is here](./store/overview-and-local-stack.md)
  - [Where the local stack is, and how to open Studio](./store/overview-and-local-stack.md#where-the-local-stack-is-and-how-to-open-studio)
- [The lifecycle, leg by leg against the archive's](./store/lifecycle-and-schema.md)
  - [The journal is ONE migration, and it IS the schema](./store/lifecycle-and-schema.md#the-journal-is-one-migration-and-it-is-the-schema)
  - [The `raw` envelope: what the store keeps beside the columns](./store/lifecycle-and-schema.md#the-raw-envelope-what-the-store-keeps-beside-the-columns)
- [The apply loop, and the gates over it](./store/apply-and-migration-gates.md)
  - [Six gates, and a verb for when two branches both generate](./store/apply-and-migration-gates.md#six-gates-and-a-verb-for-when-two-branches-both-generate)
- [The tables, and the shape the owner ruled on](./store/tables-and-atlas.md)
  - [The atlas: five tables, one generic loader, and the divergence that turned out not to be one](./store/tables-and-atlas.md#the-atlas-five-tables-one-generic-loader-and-the-divergence-that-turned-out-not-to-be-one)
- [Workstreams: rows, their own milestones, and one link table](./store/workstreams.md)
- [The fleet's own state: the board, the runs, the passes and the ledgers](./store/fleet-state-and-measurements.md)
  - [The measurements](./store/fleet-state-and-measurements.md#the-measurements)
  - [The owner's words from outside the fleet: dictations, Codex messages, and a dump restored](./store/owner-captures.md)
- [Published pages: the store is their only copy](./store/published-pages.md)
- [What `raw` was actually carrying](./store/what-raw-was-carrying.md)
- [Data classes: how far a stored record may travel beyond the owner](./store/data-classification.md)
- [People: the email is the key, each platform's id is a column](./store/people-and-live-apply.md)
  - [Three things that only a live apply catches](./store/people-and-live-apply.md#three-things-that-only-a-live-apply-catches)
- [The owner's own tables, and the column on the identity register](./store/owner-registers-and-roles.md)
  - [The roles, and the one that earns its keep](./store/owner-registers-and-roles.md#the-roles-and-the-one-that-earns-its-keep)
  - [A first boot: the profile hold on a machine the owner's profile never reached](./store/profile-first-boot.md)
- [The thread edge is a RELATION, and the backfill is its own verb](./store/thread-relations-and-detective-reads.md)
  - [The progressive-disclosure ladder the detectives climb](./store/thread-relations-and-detective-reads.md#the-progressive-disclosure-ladder-the-detectives-climb)
- [The query layer, and what it measured](./store/query-and-streaming.md)
  - [Breadth, and the two defects it found](./store/query-and-streaming.md#breadth-and-the-two-defects-it-found)
  - [A whole-corpus pass runs without holding the corpus](./store/query-and-streaming.md#a-whole-corpus-pass-runs-without-holding-the-corpus)
- [The denylist at the store, and the corpus at scale](./store/corpus-scale-and-retrieval-slice.md)
  - [The whole corpus, and what loading it measured](./store/corpus-scale-and-retrieval-slice.md#the-whole-corpus-and-what-loading-it-measured)
  - [The SMALL slice: a recency-weighted copy of the store](./store/corpus-scale-and-retrieval-slice.md#the-small-slice-a-recency-weighted-copy-of-the-store)
- [The history leg a bot turn actually reaches](./store/history-load-and-full-text.md)
  - [The load that pulls from the providers](./store/history-load-and-full-text.md#the-load-that-pulls-from-the-providers)
  - [Asking the store a question: full text, a person, and a fan-out of cheap readers](./store/history-load-and-full-text.md#asking-the-store-a-question-full-text-a-person-and-a-fan-out-of-cheap-readers)
- [Bronze, the store, and what each source holds](./store/bronze-and-source-coverage.md)
  - [Bronze reaches the store, and the rows that never did](./store/bronze-and-source-coverage.md#bronze-reaches-the-store-and-the-rows-that-never-did)
  - [The fathom source holds raw transcripts by speaker, and nothing else](./store/bronze-and-source-coverage.md#the-fathom-source-holds-raw-transcripts-by-speaker-and-nothing-else)
  - [Still open](./store/bronze-and-source-coverage.md#still-open)
- [The backup, and what it actually carries](./store/backup.md)
  - [How its bytes are stored: blobs and chunks](./store/backup-objects.md)
  - [A destination on an external drive, pinned by volume UUID](./store/backup-external-drive.md)
  - [The backup key, and the Vault leg it seals](./store/backup-key-and-vault.md)
  - [Each destination's record: status, strands and the sweep](./store/backup-destinations.md)
  - [Restoring it, and rehearsing that without touching the live database](./store/restore-runbook.md)
  - [A supervisor and the bot on another Mac, from this repo and the backup](./store/new-machine.md)
