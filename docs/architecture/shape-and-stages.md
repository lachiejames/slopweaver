# Shape and stages

Part of [Architecture](../architecture.md).

## Shape

A single-package Claude Code and Codex plugin — no MCP server, no monorepo. A bundled CLI (the verb framework
under `src/cli/`) does the work; Claude commands and Codex skills shell that CLI. State lives in a medallion
corpus under `$SLOPWEAVER_HOME` and in the selected Postgres store, local by default. Sources flow in through
`refresh` to bronze, `derive` to silver and `distil` to gold; `store ingest` loads bronze into the store
(`store load` repulls a provider straight into it), and `store read` and `store cite` read back out of it;
`listen` captures an address and a visible session answers it through the admit door.
[The diagrams below](../architecture.md#diagrams) draw each of those out.

Also outside that pipeline: **`codex`** is a second brain used while _building_
Slopweaver, not part of the world model. **`audit` / `doctor`** read local state to answer
questions about the system itself, spending no tokens and touching no network.

## The atom

Everything hangs off one source-agnostic record — `CorpusRecord` (`src/corpus/types.ts`): `source`,
`sourceId`, `url`, `tsIso`, `kind`, `container`, `text`, `refs`, optional `author`/`title`. Connectors
project their data into this shape; every downstream stage consumes it, so adding a source never
touches the pipeline. Bronze is fed by direct-SDK connectors for **GitHub, Slack, Linear, and Notion**
(no MCP — single-package API clients); **Gmail, Calendar and Fathom** when a refresh names them; **ChatGPT**
from the data export the owner downloads (`chatgpt sync`, a file read with no network call); and `self`,
the owner's own notes scanned off disk by `refresh --self`. The synthetic `gold` source, gold markdown read back as
records, is never written to bronze.

## Stages

- **refresh → bronze** (`src/corpus/`): per-source direct-SDK connectors, each an effectful fetch edge
  (behind an injected seam) + a pure projection into `CorpusRecord` — GitHub (REST search + GraphQL
  activity), Slack (all accessible channels: messages/threads/reactions + ref-only file/image
  attachments), Linear, Notion (pages + databases; one markdown call per body, child pages drained by a
  queue, attachment BYTES fetched under a measured per-file ceiling into `corpus/attachments`, and each
  page's PARSED BODY stored the same content-addressed way into `corpus/bodies` so re-deriving its text is a
  local read rather than a Notion call). All flow through the one
  redact → fingerprint-dedup → JSONL writer with a per-source watermark for incremental resume.

  The **Linear** connector is the widest of the four. Within the window it captures: archived work
  (`includeArchived` everywhere the schema accepts it — a control window was 78% invisible without it); every
  nested connection paged to EXHAUSTION through one shared collector rather than truncated at a hard cap; the
  full content fields (`Project.content` and `Initiative.content`, not just the one-paragraph `description`);
  comment threading, reactions and external commenters; the planning scalars (priority, estimate, due date,
  cycle, milestone, the lifecycle timestamps); typed relations WITH their `createdAt`; and the bulk entities —
  customer needs, project milestones, initiative updates, templates, issue labels, custom views, external
  users, and the initiative→project links.

- **activity history → `corpus/history/`** (`src/corpus/history/`): Linear's `IssueHistory` and
  `IssueStateSpan` streams, captured to a SIBLING store of `bronze/` — the same shape as `members/` and
  `structures/`, and for a sharper reason. A history event is one line and would flood a selection with
  near-duplicate rows that say less than the issue they belong to; keeping the stream out of `bronze/` means
  `readCorpusDir` cannot reach it. What a question sees instead is a bounded per-issue digest folded into the
  issue's own searchable `text`. Null-stripped at the parse edge (71.2% of the raw bytes were explicit nulls),
  canonically ordered, and idempotent by event identity. `refresh --source <id>` / `--all-sources` select sources;
  bare `refresh` stays GitHub-only. Tokens resolve from env / `$SLOPWEAVER_HOME/secrets/*` (GitHub
  then falls back to the `gh` login); no data leaves the machine.
- **compact → bronze** (`src/corpus/compact.ts`): bronze's lifecycle. Every refresh appends another
  per-source window file, so overlapping windows accumulate and disk and every whole-corpus scan grow with
  the windows rather than the entities. Distil, audit, `slice verify`, `dev manifest` and the console pane
  stream bronze through the census (`src/corpus/corpusCensus.ts`), which keeps a few fields and a row pointer
  per logical identity and never a body, so heap scales with entities; `store read` and `store cite` read the
  store, not bronze. `compact` merges a source's window files into one canonical `bronze/<source>/compact.jsonl`,
  re-running the WRITER'S OWN fingerprint (`recordContentFingerprint`, reused not re-derived) across
  windows. Lossless by default — only a pair the writer would have collapsed is dropped, a line that is not
  JSON aborts the source rather than being rewritten away, and a well-formed row the reader already refuses
  (an empty `tsIso` or `text`) is skipped and counted. `--older-than <N|Nd>` is the one lossy mode and
  is off unless asked for. The canonical file is staged + renamed BEFORE the superseded windows are
  unlinked, so a crash always leaves a superset. Each source is compacted under its refresh slot
  (`src/corpus/refreshSlot.ts`), so a refresh writing that source is never rewritten under, and the
  `compact-corpus-daily` standing row makes it due, lossless, at 02:30. Watermarks and thread/repo cursors live
  outside `bronze/` and are never touched: resume is unaffected.
- **derive → silver** (`src/silver/`): free, deterministic synthesis — a people/container directory, a
  cross-ref graph (shared-token cliques), a **cross-source identity map** (the same human across
  GitHub/Slack/Linear/Notion resolved into one canonical person, data-first with a confidence +
  provenance on every link), and opportunity detection (cross-cutting / blocker / duplication). A full
  re-scan each run. The identity roster (the store's `identity-roster` row, off-repo) is the human
  override/seed that always wins; low-confidence name-only links are held (surfaced, not applied). The
  `identity` verb (`show`/`resolve`) reads it back, and `identity roster show`/`replace` reads and writes the row.
- **distil → gold** (`src/gold/`): batches → grounded per-container digests → per-source silver digests →
  gold markdown (overview / by-source / where-to-look) — composed by the visible agent session, one
  batch per handoff: `distil status` reports total/cached/remaining, `distil brief` pins the next
  uncached batch's exact prompt, you write the digest, `distil answer` re-proves the batch is unchanged and
  validates what you wrote before caching it. No model runs in the CLI. A content-hash batch cache means
  only the batches whose bronze changed need recomposing.
- **store read / store cite** (`src/store/`, `src/retrieval/fanout.ts`): Postgres full text plus structured filters select
  candidates out of the store, newest first. `store cite` prints them; `store read` shards them for cheap readers,
  prints each reader's instruction, and `store collect` admits only findings whose quote is verbatim in the
  shard that reader was given. The visible session dispatches the readers and composes — no model runs in the
  CLI. **Nothing ranks, and there is no index to build**: an owner ruling banishes pgvector,
  embeddings, re-ranking, semantic search and every locally-built lexical index.
