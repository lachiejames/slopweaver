---
paths:
  - "src/corpus/**"
---

# Working in `src/corpus/`

Bronze: every source's activity, normalised to one record shape, redacted, deduped, watermarked (bar the
cursorless sources) and appended as JSONL under `$SLOPWEAVER_HOME/corpus/bronze/`. Scoped to this tree; the stage map (bronze to silver to
gold, and into the store) is [the corpus architecture](../../docs/architecture/corpus.md), the durable-capture
contract is [store](../../docs/store.md) with [bronze and source coverage](../../docs/store/bronze-and-source-coverage.md),
and the audit, identity and slice verbs are [corpus integrity](../../docs/corpus-integrity.md). Silver is
`src/silver`, not this tree, and the `refresh`, `compact` and `derive` verbs sit under `src/cli/commands/`,
governed by [area-cli](area-cli.md).

**It states the norm and what new code does, not an inventory.** A file that predates a rule, and each gate's
blind spot, is named in that module's own header, which wins where the two disagree; a deviation you meet is
debt to record, never a licence to copy it.

## One record shape, and a source is a new emitter of it

`types.ts` is the contract: every connector produces `CorpusRecord`s and every downstream stage — dedup,
graph, retrieval — consumes them unchanged, which is what keeps the engine connector-count-limited rather
than connector-shaped. Adding a source is emitting that shape, never a new downstream branch. The source
lists are distinct on purpose — what is fetched, what is written to bronze, what `--all-sources` sweeps — and a
source missing from the bronze list is DROPPED by `bronzeAppend.ts`'s bucketing, so none of them is kept by
hand: `src/integrations/corpusSources.ts` derives each from the integration manifests' `corpus` row (an
append-only `ordinal` and an `allSourcesSweep` flag), and a new integration that ingests appears in every one.
What is cursorless (`CURSORLESS_SOURCES`, `types.ts`) is still a deliberate per-source choice.

**Visibility is one additive axis, and one module stamps it.** `visibility.ts`'s `stampVisibility` is the only
function that MINTS a `private` mark, applied at projection time where the signal is known; the row decoder
(`corpusRowCore.ts`) only reads a stored one back. An absent mark reads `public` — the migration contract —
except for the always-private sources and kinds (`self`, the mailbox, the calendar, recorded calls, ChatGPT;
huddles and transcripts), which read private with or without it, and the header says why each one is.

## One write path: redact, then dedup, then append

`corpusWriter.ts` is the bronze write pipeline, and `ingestSource.ts` pushes every source through it and
advances ONLY that source's watermark, after its write succeeds — one source failing never rolls back
another's progress. Never append to bronze any other way.

- **The owner's protect list is judged before the dedup read and before the append** (`bronzeProtection.ts`):
  the source directory as a search, every entry its walk meets and each `.jsonl` refused, the window file as a
  write, under both registries, failing closed. A refused source writes nothing and keeps its watermark. A
  reader asks the same judge through a choke point — `listBronzeFiles`, or `scanJsonlProtected`/`scanCorpusRoot` —
  and returns a covered root's refusal as an `Err`, never as an empty corpus; below the root the shared walk skips a
  covered entry and names it in `protectedSkipped`, which every walk caller prints (`protectedSkipWarnings`). A
  corpus REWRITER lists every path it will touch and asks `preflightCorpusAccesses` (`corpusAccessGuard.ts`) before
  its first effect, a whole-tree write as `tree-write`, so it refuses whole and never writes part. A new reader or
  writer uses one, or is listed in `docs/security/protected-paths.md`; its tests inject an empty resolver
  (`src/__tests__/noProtection.ts`), never the owner's registry.

- **Redaction runs first, so no secret touches disk** and the fingerprint is taken over redacted content.
  `redactRecord.ts` says which fields are redacted and which are structural; `redact.ts` is pure and keeps the
  graph-edge tokens (`@mention`, `#<number>`, `TEAM-123`) intact, and a native-id-shaped `author` passes byte for
  byte because the identity roster joins on it.
- **Control bytes are the structural half** (`sanitise.ts`): bronze's one invariant is a record per line, and
  an embedded control byte can split a record into two unparseable halves or rewrite a terminal.
- **Dedup is per `sourceId`**: a record is written only when its content fingerprint is new for that id AND its
  `tsIso` is at least the newest stored, so a refresh is idempotent and update-aware. The fingerprint
  (`recordContentFingerprint`) blanks `tsIso` and drops `raw` on purpose, and `compact` reuses that one
  function. The one exception is `bronzeFreshness.ts`'s revertible set, `chatgpt` alone: a seen fingerprint
  that is not the one written last for its id is written again, so a chat renamed back serves the revert.
- **A disk refusal is an `Err`, never a throw** (`bronzeAppend.ts`).

## Stream every data-scale file; never one JS string

**Read a data-scale `.jsonl` with `corpusStore.ts`'s `readJsonlLines`**, its header's one sanctioned reader
(`notion/seenIndex.ts` still streams its own, line by line) — a bronze window has no record ceiling, and one
read whole once made every bronze-touching verb fail at once.
Write one with `writeFileAtomicStream` (`src/lib/writeAtomic.ts`) and append through `appendLines`
(`src/lib/appendSeparator.ts`). `whole-file-json` refuses a `.jsonl` read or written whole, and
`torn-tail-append` refuses an append that bypasses the one append path; the general rule is in
[TypeScript patterns](typescript-patterns.md). `heapGuard.ts` checks heap BETWEEN chunks and extrapolates its
advice from the observed read ratio; the static band stands in only where that ratio cannot speak, its floor
under a ratio measured below it and its ceiling when nothing was read yet.

A projection decides what is held, not what is read: `deriveProjection.ts` drops `text` for `derive` and
cuts `raw` down to the few scalars silver reads (silver reads neither wholesale), recording the one fact it
needs from the text before dropping it.

## A watermark only moves forward

`watermark.ts`: the cursor is the max OBSERVED `tsIso`, not the window's `until` (that would skip a record
landing later with an earlier timestamp). The one fallback to `until` is a source whose records in the
run all carry an empty `tsIso`, capped at the clock; a source with no records in the run gets no new cursor. Merged as MAX, so a narrower re-run can never move it backwards.
Each source's cursor is its own file under `corpus/watermarks/`, so concurrent per-source refreshes never
clobber each other, and the write is atomic. A cursorless source never gets one. How stale a source may
become before a scheduled pass refreshes it is `freshnessPolicy.ts`, and an override sits beside the default
it replaces.

## Compaction never rewrites history

`compact.ts` merges a source's window files into one, running a plain `(sourceId, fingerprint)` dedup across
windows — not the writer's ChatGPT revert exception, so a reverted chat's repeated row collapses there. It is
**lossless by default for every well-formed record**, bar one stated residue: only `(sourceId, fingerprint)`
duplicates drop, compared by a 128-bit digest whose collision `bronzeDedupIndex.ts` names (a Notion row's undashed page id is rekeyed to its dashed spelling first, so the two spellings are one id), a
superseded version on disk is history and survives, and age pruning is opt-in behind `--older-than`. A line
that is not JSON makes the FILE suspect, so the walk aborts that whole source before anything is renamed; a
well-formed row the reader refuses is skipped and counted in `CompactPlan.rejected`, never dropped in
silence. `bronzeStorage.ts` lists files exactly as the reader recurses, so `compact` and `audit` count the
same set.

## Each ingest directory owns the errors it authors

The failures a per-source directory authors itself are its own discriminated union with no shared base
(`github/errors.ts` is the worked example in [error handling](error-handling.md)), and a tree-level module that
outgrows plain strings declares a sibling `<module>.errors.ts`. A transport failure is the other layer: it
stays the shared `IngestError` its `safe*` boundary produced, as `linear/errors.ts`'s header says of a Linear
write. Never merge two sources' unions because they look alike, and never invent a cross-source domain type.
