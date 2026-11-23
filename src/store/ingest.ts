/**
 * The store's shared write: one batch of projected records into `content` and its side rows, the slice step a
 * bronze pass repeats, and the records-in entrance a live pull uses. `./ingestJsonl.ts` is the bronze-file
 * entrance built on it, and `./ingestIds.ts` and `./ingestSourceRows.ts` are the leaves a batch writes through.
 */
import { sql } from "drizzle-orm";

import { type IdentityExclusion, loadIdentityExclusion } from "../corpus/identityExclusion.js";
import { excludeFromSync, loadSyncExclusion, type SyncExclusion } from "../corpus/syncExclusion.js";
import type { CorpusRecord } from "../corpus/types.js";
import { err, ok, type Result } from "../lib/result.js";

import { type StoreAdmission, scrubExcludedIdentities } from "./admission.js";
import type { StoreClient } from "./client.js";
import { contentDataClass } from "./dataClassIntake.js";
import type { DataClassRule } from "./dataClassRules.js";
import { loadDataClassRules } from "./dataClassRulesFile.js";
import { type StoreError, StoreErrors, type StoreRowRefusedError } from "./errors.js";
import { ContainerIds, cacheKey, type IdCache, loadPeopleIndex, personFor } from "./ingestIds.js";
import { MAX_RETAINED_REFUSALS, readSlice } from "./ingestRead.js";
import { writeSourceRows } from "./ingestSourceRows.js";
import { type ProjectedRecord, projectRecord } from "./project.js";
import { contentTable } from "./schema/content.js";

/**
 * How many projected records are written per statement.
 *
 * Chosen so one batch's bound parameters stay well inside Postgres's 65,535 limit per statement — a
 * content row binds ten columns, so 500 rows is 5,000 parameters with room to spare. Raising it trades
 * fewer round trips for a larger statement whose failure rolls back further.
 *
 * @internal
 */
export const INGEST_BATCH_ROWS = 500;

/** What one ingest run did, whether or not every record in it was storable. */
export interface IngestReport {
  readonly linesRead: number;
  readonly recordsStored: number;
  readonly containersSeen: number;
  /** Authors whose platform id resolved to a person through `person`'s id columns. */
  readonly authorsResolved: number;
  /** Authors kept on `author_native_id` only — a bot, or a human the directory does not hold yet. */
  readonly authorsUnresolved: number;
  readonly duplicatesCollapsed: number;
  /** How many bounded slices the run took; one unless it was asked for a whole pass. */
  readonly slices: number;
  /** Whether the read reached the end of the file, as opposed to stopping on its ceiling. */
  readonly reachedEnd: boolean;
  /** Where a further pass would resume, which is the end of the file when {@link reachedEnd}. */
  readonly resumeByteOffset: number;
  readonly bytesRead: number;
  /** Retained EXAMPLES, capped at {@link MAX_RETAINED_REFUSALS}. Never a count — read {@link refusalsCounted}. */
  readonly refusals: readonly StoreRowRefusedError[];
  /**
   * How many rows this run refused, exactly.
   *
   * Separate from {@link refusals}.length because that array is capped, and a caller reading its length as
   * the count would report "200 refusals" for a run that refused two million. The cap's own comment
   * claimed the count stayed exact while no field carried it; this is that field.
   */
  readonly refusalsCounted: number;
  /** Denied records this run dropped. Never a refusal: a refusal is a row that could not be stored. */
  readonly recordsExcluded: number;
  /** Denied records rule D put back, because a human replied in their thread. */
  readonly recordsRescued: number;
  /** Candidates admitted because the rule-D hold was full — see {@link ./admission.MAX_DEFERRED_RECORDS}. */
  readonly deferralOverflow: number;
  readonly elapsedMs: number;
}

/**
 * Write one batch of projected records, resolving their foreign keys first.
 *
 * ## Why the whole batch is one transaction
 *
 * The store's presence constraint — every Slack, GitHub, Linear or Notion content row HAS its side row —
 * is a DEFERRED constraint trigger, so it fires at COMMIT rather than at the content insert. That is the
 * only arrangement under which two statements can satisfy it, and it means an interrupted batch leaves
 * nothing behind rather than half a record.
 *
 * @param client the open store
 * @param batch the projected records to write
 * @param cache the run's id maps
 * @param dataClassRules the run's composed data-class rules, which stamp each row's class at intake
 * @returns how many content rows the database accepted
 */
export async function writeBatch({
  client,
  batch,
  cache,
  dataClassRules,
}: {
  client: StoreClient;
  batch: readonly ProjectedRecord[];
  cache: IdCache;
  dataClassRules: readonly DataClassRule[];
}): Promise<number> {
  return client.db.transaction(async (writer): Promise<number> => {
    await cache.containers.resolve({ batch, writer });
    const values = batch.map((record) => ({
      ...record.content,
      dataClass: contentDataClass({ record, rules: dataClassRules }),
      authorId:
        record.author === null ? null : personFor({ author: record.author, cache, source: record.content.source }),
      authorNativeId: record.author === null ? null : record.author.nativeId,
      containerId: storedContainerId({ cache, record }),
    }));
    const written = await writer
      .insert(contentTable)
      .values(values)
      .onConflictDoUpdate({
        set: CONTENT_REFRESH_ON_CONFLICT,
        target: [contentTable.source, contentTable.sourceId],
      })
      .returning({ id: contentTable.id, source: contentTable.source, sourceId: contentTable.sourceId });

    const byNative = new Map(written.map((row) => [cacheKey({ nativeId: row.sourceId, source: row.source }), row.id]));
    const paired: { readonly contentId: string; readonly record: ProjectedRecord }[] = [];
    for (const record of batch) {
      const contentId = byNative.get(cacheKey({ nativeId: record.content.sourceId, source: record.content.source }));
      if (contentId !== undefined) {
        paired.push({ contentId, record });
      }
    }
    await writeSourceRows({ batch: paired, writer });
    return written.length;
  });
}

/**
 * The container id a content row is stored against: the id of the very container its data class was sorted on.
 *
 * Throws rather than storing `null`, inside the batch's transaction so nothing of the batch commits. A row with no
 * resolved container would be stored against no place while classed on its record's own — the same wrong-class
 * write as a misfiled one, so it fails closed the same way.
 *
 * @param record the projected record about to be written
 * @param cache the run's id maps, its containers already resolved for this batch
 * @returns the stored container id
 */
function storedContainerId({ record, cache }: { record: ProjectedRecord; cache: IdCache }): string {
  const id = cache.containers.idFor({ container: record.container });
  if (id === undefined) {
    throw new Error(
      `container ${record.container.source} ${record.container.nativeId} did not resolve; ` +
        `refusing to store ${record.content.source} ${record.content.sourceId} against no container while it is classed on that one`,
    );
  }
  return id;
}

/**
 * Drop every record but the last for each `(source, source_id)` in a slice.
 *
 * MEASURED, and this is a correctness fix rather than an optimisation. Postgres refuses an
 * `ON CONFLICT DO UPDATE` statement that would touch the same row twice — _"cannot affect row a second
 * time"_ — so a slice carrying one repeat sinks the WHOLE batch, which is exactly what a 1,200-record
 * GitHub ingest did. Its bronze holds 66 same-repository re-captures per 8,000 records: the same pull
 * request fetched by two overlapping refresh windows, each a legitimate line. Slack's 5,498-record
 * window had none, which is why slice two never saw it.
 *
 * The LAST occurrence wins because bronze is append-ordered, so the later line is the later capture.
 *
 * A collapsed record's author is dropped with it, and that is correct rather than a loss: ingest
 * never mints a person from an author it meets, so an author observation carries
 * nothing a row does not. MEASURED over bronze, a repeated `sourceId` carries a DIFFERENT
 * author 76,385 times in Linear — mostly one person as a UUID from one connector path and a display name
 * from another — and the survivor's native id is the one the row keeps.
 *
 * @param projected the records read off one file, in file order
 * @returns the deduplicated records and how many were collapsed
 */
export function collapseDuplicates({ projected }: { projected: readonly ProjectedRecord[] }): {
  readonly records: readonly ProjectedRecord[];
  readonly collapsed: number;
} {
  const byIdentity = new Map<string, ProjectedRecord>();
  for (const record of projected) {
    byIdentity.set(cacheKey({ nativeId: record.content.sourceId, source: record.content.source }), record);
  }
  return { collapsed: projected.length - byIdentity.size, records: [...byIdentity.values()] };
}

/**
 * Every column a later capture of the same record supersedes.
 *
 * ## Why this is all of them rather than the three it used to be
 *
 * It refreshed `body`, `metadata` and `title` only, and an adversarial review pass produced the divergence
 * that makes wrong: two captures of one Notion page, an older and a newer, in one file. Taken in ONE slice
 * they collapse before insertion and the newer wins outright, `occurred_at` included. Taken in two slices
 * the first inserts and the second only refreshes three columns, so `occurred_at` keeps the OLDER value.
 * The same file, the same rows, two different tables — decided by a `--limit` that is supposed to be a
 * heap bound and nothing else.
 *
 * So a later capture supersedes completely. `id`, `source`, `source_id` and `created_at` are excluded
 * because they are the row's identity and its own arrival, and `searchable` is generated from `title` and
 * `body`, so it follows them without being named.
 *
 * @internal
 */
const CONTENT_REFRESH_ON_CONFLICT = {
  authorId: sql`excluded.author_id`,
  // Refreshed with `author_id`, the same author's platform id, so the row's author and the author its data class was
  // sorted on are one value: kept stale, a rule matching the new author would class a row still naming the old one.
  authorNativeId: sql`excluded.author_native_id`,
  // Derived from the capture being written, like `parent_source_id` below, so the later capture is the
  // better answer — and listing it is what lets a re-ingest correct a row `store bots` has not reached yet.
  authorIsBot: sql`excluded.author_is_bot`,
  body: sql`excluded.body`,
  containerId: sql`excluded.container_id`,
  // Re-sorted on every capture, so a changed rule reclassifies a row the next time it arrives, and a removed rule
  // can never leave a row in a wider class than any rule now gives it. A future assessment's verdict must therefore be
  // written somewhere a re-ingest reads, or this refresh returns its row to `unknown` (closed, never open).
  dataClass: sql`excluded.data_class`,
  kind: sql`excluded.kind`,
  metadata: sql`excluded.metadata`,
  occurredAt: sql`excluded.occurred_at`,
  // `parent_source_id` refreshes because it is DERIVED from the id being written, so the incoming value
  // is always at least as good as the stored one. `parent_id` deliberately is NOT here: a re-ingest
  // carries no resolved uuid, so listing it would null out every edge in the store on every refresh and
  // the only symptom would be a thread walk that quietly returned one row. It is written by
  // {@link ./resolveEdges.resolveEdges} instead, which never touches a row it cannot resolve.
  parentSourceId: sql`excluded.parent_source_id`,
  title: sql`excluded.title`,
  url: sql`excluded.url`,
  visibility: sql`excluded.visibility`,
} as const;

/** What one records-in write did, whether or not every record in it was storable. */
export interface WriteReport {
  readonly recordsStored: number;
  /** Denied records this write dropped, so a caller never reports a filtered batch as a whole one. */
  readonly recordsExcluded: number;
  /** Denied records rule D put back, because a human replied in their thread. */
  readonly recordsRescued: number;
  readonly containersSeen: number;
  readonly authorsResolved: number;
  readonly authorsUnresolved: number;
  readonly duplicatesCollapsed: number;
  readonly refusals: readonly StoreRowRefusedError[];
  readonly elapsedMs: number;
}

/**
 * Project every record a caller already holds, keeping bounded examples of what would not project.
 *
 * Shared by the array entrance and by the rule-D release, because a rescued record is an ordinary record
 * that arrived out of order rather than a second kind of row.
 *
 * @param records the records to project
 * @returns the rows that projected, and up to the retention cap of the refusals that did not
 */
export function projectAll({ records }: { records: readonly CorpusRecord[] }): {
  projected: ProjectedRecord[];
  refusals: StoreRowRefusedError[];
} {
  const projected: ProjectedRecord[] = [];
  const refusals: StoreRowRefusedError[] = [];
  records.forEach((record) => {
    const row = projectRecord({ record });
    if (row.isErr()) {
      appendBounded({ from: [row.error], into: refusals });
      return;
    }
    projected.push(row.value);
  });
  return { projected, refusals };
}

/**
 * Resolve BOTH lists an entrance to the store must honour, or the reason one of them could not be used.
 *
 * Resolved inside the boundary rather than by the caller, so the entrance cannot be the one that forgets:
 * `src/cli/commands/store/load.ts` reaches {@link ingestRecords} directly, and a write path that had never
 * heard of the author denylist is the defect `docs/constraints/refusals.md` already records. Returning them as a pair
 * is what stops the identity list becoming that same defect a second time — there is no shape here that
 * loads one without the other.
 *
 * An unreadable list refuses the run in both cases. An index quietly rebuilt with a list off is
 * indistinguishable from one built with it on until somebody notices what came back.
 *
 * @param lane which entrance is asking, so a refusal names the verb the operator ran
 * @returns both resolved lists, or the first one that could not be used
 */
export function loadExclusionLists({
  lane,
  home,
}: {
  lane: "ingest" | "write";
  home?: string;
}): Result<
  { denylist: SyncExclusion; identities: IdentityExclusion; dataClassRules: readonly DataClassRule[] },
  StoreError
> {
  const where = home === undefined ? {} : { home };
  const denylist = loadSyncExclusion(where);
  if (denylist.isErr()) {
    return err(StoreErrors.queryFailed({ cause: denylist.error.join("; "), what: `store ${lane} denylist` }));
  }
  const identities = loadIdentityExclusion(where);
  if (identities.isErr()) {
    return err(
      StoreErrors.queryFailed({ cause: identities.error.join("; "), what: `store ${lane} identity exclusion` }),
    );
  }
  const dataClassRules = loadDataClassRules(where);
  if (dataClassRules.isErr()) {
    return err(
      StoreErrors.queryFailed({ cause: dataClassRules.error.message, what: `store ${lane} data-class rules` }),
    );
  }
  return ok({ dataClassRules: dataClassRules.value, denylist: denylist.value, identities: identities.value });
}

/**
 * Write records the caller already holds into the store — the entry a LIVE PULL uses.
 *
 * ## Why this exists beside {@link ./ingestJsonl.ingestJsonl} rather than inside it
 *
 * Every load into the store before this one read a bronze `.jsonl` off disk; `store ingest --file` was
 * the only path into `content` at all (reproduce: `grep -rn "insert(contentTable)" src` finds exactly one
 * site, and this module is its only caller). The other
 * direction is regenerable and resumable, a repull from scratch, so a connector's own freshly fetched `CorpusRecord`s need a way in that never touches a
 * file. Everything below the projection is shared: the same {@link projectRecord}, the same
 * {@link collapseDuplicates}, the same {@link writeBatch} with the same id cache. Only the SOURCE of the
 * records differs, which is exactly the seam that should differ.
 *
 * ## The bound is the caller's, and it is not optional in practice
 *
 * There is no `--limit` here because the records are already in the caller's hand — the heap bound was
 * spent by whatever fetched them. A caller pulling a live window is responsible for bounding the FETCH,
 * which is what {@link ../cli/commands/store/load} does with a per-source cap.
 *
 * @param client the open store
 * @param records the records to write, in the order they should collapse (later supersedes earlier)
 * @param cache the id cache to reuse across calls, so a multi-source run resolves a person once
 * @param home the Slopweaver home the denylist is resolved under, when no resolved one is supplied
 * @returns what was written, with every refusal counted and reported
 */
export async function ingestRecords({
  client,
  records,
  cache,
  home,
}: {
  client: StoreClient;
  records: readonly CorpusRecord[];
  cache?: IdCache;
  home?: string;
}): Promise<Result<WriteReport, StoreError>> {
  const started = Date.now();
  const lists = loadExclusionLists({ lane: "write", ...(home === undefined ? {} : { home }) });
  if (lists.isErr()) {
    return err(lists.error);
  }
  // The whole array is in hand, so rule D needs no deferral: `excludeFromSync` gathers its own human-thread
  // evidence from these same records before it filters them.
  const admitted = excludeFromSync({ exclusion: lists.value.denylist, records });
  const scrubbed = admitted.kept.map(
    (record) => scrubExcludedIdentities({ exclusion: lists.value.identities, record }).record,
  );
  const ids: IdCache = cache ?? {
    containers: new ContainerIds(),
    people: await loadPeopleIndex({ client }),
    resolved: new Set(),
    unresolved: new Set(),
  };
  const taken = projectAll({ records: scrubbed });
  const refusals = taken.refusals;
  const deduped = collapseDuplicates({ projected: taken.projected });
  let stored = 0;
  try {
    for (let at = 0; at < deduped.records.length; at += INGEST_BATCH_ROWS) {
      stored += await writeBatch({
        batch: deduped.records.slice(at, at + INGEST_BATCH_ROWS),
        cache: ids,
        client,
        dataClassRules: lists.value.dataClassRules,
      });
    }
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store write of fetched records" }));
  }
  return ok({
    containersSeen: ids.containers.size(),
    duplicatesCollapsed: deduped.collapsed,
    elapsedMs: Date.now() - started,
    recordsExcluded: admitted.excluded,
    recordsRescued: admitted.rescued,
    authorsResolved: ids.resolved.size,
    authorsUnresolved: ids.unresolved.size,
    recordsStored: stored,
    refusals,
  });
}

/**
 * Mint the id cache a multi-source run shares, loading the person set once for the whole run.
 *
 * Exported because {@link ingestRecords} is called once per source by a load, and a fresh cache per source
 * would re-read every person from the database per source — the exact per-record round trip the cache
 * exists to avoid, at source granularity instead of record granularity.
 *
 * @param client the open store
 * @returns the empty id maps, carrying every person already known
 */
export async function newIngestCache({ client }: { client: StoreClient }): Promise<IdCache> {
  return {
    containers: new ContainerIds(),
    people: await loadPeopleIndex({ client }),
    resolved: new Set(),
    unresolved: new Set(),
  };
}

/** The id cache a caller carries between {@link ingestRecords} calls. */
export type IngestCache = IdCache;

/** What a whole pass has accumulated so far, extended in place by each slice. */
export interface PassTally {
  stored: number;
  linesRead: number;
  collapsed: number;
  slices: number;
  offset: number;
  reachedEnd: boolean;
  /** Every refusal the pass produced, exactly — see {@link IngestReport.refusalsCounted}. */
  refusalsCounted: number;
  readonly refusals: StoreRowRefusedError[];
}

/**
 * Read, project and write ONE bounded slice, advancing the pass.
 *
 * @param client the open store
 * @param path the bronze file being read
 * @param limit the per-slice record ceiling, which is the heap bound
 * @param cache the run's id maps
 * @param tally the pass's accumulated counts and cursor, extended in place
 * @param dataClassRules the run's composed data-class rules
 * @returns whether another slice would read anything new
 */
export async function ingestOneSlice({
  client,
  path,
  limit,
  cache,
  tally,
  admission,
  dataClassRules,
}: {
  client: StoreClient;
  path: string;
  limit: number;
  cache: IdCache;
  tally: PassTally;
  admission: StoreAdmission;
  dataClassRules: readonly DataClassRule[];
}): Promise<boolean> {
  const slice = readSlice({ admission, from: tally.offset, limit, path });
  tally.slices += 1;
  tally.linesRead += slice.linesRead;
  tally.refusalsCounted += slice.refusalCount;
  appendBounded({ from: slice.refusals, into: tally.refusals });

  const deduped = collapseDuplicates({ projected: slice.projected });
  tally.collapsed += deduped.collapsed;
  for (let at = 0; at < deduped.records.length; at += INGEST_BATCH_ROWS) {
    tally.stored += await writeBatch({
      batch: deduped.records.slice(at, at + INGEST_BATCH_ROWS),
      cache,
      client,
      dataClassRules,
    });
  }

  // The end is "this slice filled NEITHER ceiling", not "it stored nothing": a slice can be entirely
  // refusals and still have more file behind it, which is why the examined-lines ceiling counts here too.
  // Reading only the projected one would call a wholly-refused slice the end of the file and stop.
  tally.reachedEnd = slice.projected.length < limit && slice.linesRead < limit;
  const advanced = slice.resumeByteOffset > tally.offset;
  tally.offset = slice.resumeByteOffset;
  return !tally.reachedEnd && advanced;
}

/**
 * Append refusals up to the retention cap, dropping the rest.
 *
 * @param from the refusals this slice produced
 * @param into the run's retained refusals, extended in place
 */
function appendBounded({ from, into }: { from: readonly StoreRowRefusedError[]; into: StoreRowRefusedError[] }): void {
  for (const refusal of from) {
    if (into.length >= MAX_RETAINED_REFUSALS) {
      return;
    }
    into.push(refusal);
  }
}
