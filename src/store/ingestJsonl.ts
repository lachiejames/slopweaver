/**
 * The loader: bronze JSONL in, store rows out, over a bounded slice of one file.
 *
 * ## The bound is the design, not a shortcut
 *
 * `slack/compact.jsonl` is 6,899,158,625 bytes in ONE file (measured, `ls -l
 * ~/.slopweaver/corpus/bronze/slack/`). The owner's own sequencing for this migration is tooling first,
 * then about a thousand Slack records to surface unknown unknowns, then the gigabytes — so this loader
 * takes a REQUIRED record ceiling and stops the read at it, rather than pretending to a whole-file pass
 * it cannot yet do safely.
 *
 * The reason it cannot yet is worth stating rather than discovering. `readJsonlLines` is synchronous, by
 * the deliberate design its own header gives, and a database write is not — so a loader cannot flush
 * mid-read, and an unbounded run would hold every projected row in the heap while it read. That is the
 * same shape that makes `audit run` refuse on this corpus at ~16,426 MiB against a 4,288 MiB ceiling. A
 * resumable reader that takes a byte offset is what a whole-corpus pass needs, and it is the next slice.
 * Until then the ceiling is required rather than defaulted, so nobody gets the unbounded shape by
 * omission.
 *
 * ## Why one refusal never sinks the run
 *
 * A malformed line, a source the store has no column for, a container that yields no required field —
 * each is a real shape bronze can hold, and on two million records some of them will be. Each is COUNTED
 * and reported, and the other rows still land. A loader that aborted on the first would make a
 * whole-corpus ingest an exercise in finding the next bad line, one lap at a time.
 *
 * ## Why containers and people are resolved per batch
 *
 * `content.container_id` and `content.author_id` are real foreign keys, so the referenced row has to
 * exist first. Resolving them per record would be one round trip per row. Per batch it is one round trip
 * per few hundred, and the id map is kept for the whole run because a channel appears in thousands of
 * records and a person in more.
 */
import type { CorpusRecord } from "../corpus/types.js";
import { err, ok, type Result } from "../lib/result.js";
import type { ProtectedPath } from "../protectedPaths/registry.js";

import { openAdmission, releaseDeferred, type StoreAdmission } from "./admission.js";
import type { StoreClient } from "./client.js";
import type { DataClassRule } from "./dataClassRules.js";
import { type StoreError, StoreErrors } from "./errors.js";
import {
  collapseDuplicates,
  INGEST_BATCH_ROWS,
  type IngestReport,
  ingestOneSlice,
  loadExclusionLists,
  type PassTally,
  projectAll,
  writeBatch,
} from "./ingest.js";
import { ContainerIds, type IdCache, loadPeopleIndex } from "./ingestIds.js";
import { protectedBronzeFile } from "./protectedBronze.js";

/**
 * Read a bounded slice of one bronze JSONL file into the store, and report what happened.
 *
 * @param client the open store
 * @param path the bronze file to read
 * @param limit how many storable records to take, required rather than defaulted so nobody gets an
 *   unbounded read by omission
 * @param protection the owner's protect-list entries, REQUIRED so no caller reads bronze without having read
 *   them: a file reaching a `no-access` path is `BRONZE_PROTECTED` before anything opens it
 * @returns what the run did, the protect-list refusal, or the database failure, which is fatal in a way a
 *   per-row refusal is not
 */
export async function ingestJsonl({
  client,
  path: asked,
  limit,
  protection,
  home,
  from = 0,
  wholeFile = false,
}: {
  client: StoreClient;
  path: string;
  limit: number;
  protection: readonly ProtectedPath[];
  home?: string;
  from?: number;
  wholeFile?: boolean;
}): Promise<Result<IngestReport, StoreError>> {
  const allowed = protectedBronzeFile({ entries: protection, path: asked });
  if (allowed.isErr()) {
    return err(allowed.error);
  }
  const path = allowed.value;
  const started = Date.now();
  const lists = loadExclusionLists({ lane: "ingest", ...(home === undefined ? {} : { home }) });
  if (lists.isErr()) {
    return err(lists.error);
  }
  const { dataClassRules } = lists.value;
  const admission = openAdmission({ exclusion: lists.value.denylist, identities: lists.value.identities });
  const cache: IdCache = {
    containers: new ContainerIds(),
    people: await loadPeopleIndex({ client }),
    resolved: new Set(),
    unresolved: new Set(),
  };
  const tally = freshTally({ from });

  try {
    for (;;) {
      const more = await ingestOneSlice({ admission, cache, client, dataClassRules, limit, path, tally });
      if (!more || !wholeFile) {
        break;
      }
    }
    // Settled only once the read has stopped, and only when it stopped at the END. A pass that halted on
    // its ceiling has more file behind it, so a candidate's rescuing human reply may still be coming — and
    // releasing it here would drop it permanently on the evidence of half a file. Held candidates simply
    // stay held, and the resumed run judges them with everything it has read by then.
    if (tally.reachedEnd) {
      const records = releaseDeferred({ admission });
      tally.stored += await writeReleased({ cache, client, dataClassRules, records });
    }
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: `store ingest of ${path}` }));
  }

  return ok(reportFor({ admission, cache, from, startedMs: started, tally }));
}

/**
 * A pass's accumulators before its first slice: nothing read, nothing stored, resuming at `from`.
 *
 * @param from the byte offset the pass resumes at
 * @returns the zeroed tally the slices mutate
 */
function freshTally({ from }: { from: number }): PassTally {
  return {
    collapsed: 0,
    linesRead: 0,
    offset: from,
    reachedEnd: false,
    refusals: [],
    refusalsCounted: 0,
    slices: 0,
    stored: 0,
  };
}

/**
 * Fold a finished pass's three accumulators into the report a caller reads.
 *
 * Separate from {@link ingestJsonl} because it is the one part of that function with no control flow in it
 * at all: every field is a read off state the pass already settled, and holding thirty lines of field
 * assignment in your head while looking for the loop's exit condition is what the length cap is about.
 *
 * @param tally what the slices accumulated
 * @param admission what the denylist and rule D decided
 * @param cache the id maps, whose sizes are the container and person counts
 * @param from where this pass started reading, so the bytes read are this pass's rather than the file's
 * @param startedMs the wall clock at the first slice
 * @returns the finished report
 */
function reportFor({
  tally,
  admission,
  cache,
  from,
  startedMs,
}: {
  tally: PassTally;
  admission: StoreAdmission;
  cache: IdCache;
  from: number;
  startedMs: number;
}): IngestReport {
  return {
    bytesRead: tally.offset - from,
    containersSeen: cache.containers.size(),
    deferralOverflow: admission.deferralOverflow,
    duplicatesCollapsed: tally.collapsed,
    elapsedMs: Date.now() - startedMs,
    linesRead: tally.linesRead,
    authorsResolved: cache.resolved.size,
    authorsUnresolved: cache.unresolved.size,
    reachedEnd: tally.reachedEnd,
    recordsExcluded: admission.excluded,
    recordsRescued: admission.rescued,
    recordsStored: tally.stored,
    refusals: tally.refusals,
    refusalsCounted: tally.refusalsCounted,
    resumeByteOffset: tally.offset,
    slices: tally.slices,
  };
}

/**
 * Project and write the records rule D rescued, after the last line has been read.
 *
 * They go through the same projection and the same batching as everything else — a rescued record is an
 * ordinary record that arrived out of order, not a second kind of row. A rescued record that will not
 * project is simply not stored: it was already denied, so a refusal here would report a failure for
 * something the run was under no obligation to keep.
 *
 * @param client the open store
 * @param records the rescued records
 * @param cache the run's id maps
 * @param dataClassRules the run's composed data-class rules
 * @returns how many were stored
 */
async function writeReleased({
  client,
  records,
  cache,
  dataClassRules,
}: {
  client: StoreClient;
  records: readonly CorpusRecord[];
  cache: IdCache;
  dataClassRules: readonly DataClassRule[];
}): Promise<number> {
  const deduped = collapseDuplicates({ projected: projectAll({ records }).projected });
  let stored = 0;
  for (let at = 0; at < deduped.records.length; at += INGEST_BATCH_ROWS) {
    stored += await writeBatch({
      batch: deduped.records.slice(at, at + INGEST_BATCH_ROWS),
      cache,
      client,
      dataClassRules,
    });
  }
  return stored;
}
