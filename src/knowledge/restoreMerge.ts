/**
 * Planning a `knowledge restore` — into an empty database, or merged into a live one. Pure: no I/O.
 *
 * The store half (`./memoryRestoreStore.ts`) reads the live rows INSIDE its one transaction and hands them
 * here, so the plan is made against exactly the state it is written over.
 *
 * ## The default: recovery into an empty database
 *
 * Both tables must be empty, and every row goes in verbatim — `seq` included, because a restore that
 * renumbered would change which of two same-instant recordings recall shows.
 *
 * ## `--merge`: an export added to a live database, refused whole on any clash
 *
 * - A row whose `recordingId` (or `recallId`) the database already holds is SKIPPED when it is identical,
 *   column for column bar the generated `searchable` and the remappable `seq`, and is a CLASH otherwise.
 *   A merge never picks one history over another.
 * - A row carrying an `importKey` another stored recording already holds is a clash, even with identical
 *   prose: the key asserts the same source line, and two physical recordings of one line is the duplicate
 *   the key exists to prevent.
 * - Every inserted row is renumbered above its table's live maximum, in ascending incoming `seq` order, so
 *   the export's own order survives as the tie-break among the rows it adds. The two tables' sequences are
 *   independent. Every timestamp is carried verbatim; only `seq` moves, and only for an inserted row.
 * - Every link an inserted row makes must close over the live rows plus the accepted incoming ones: a
 *   `supersedes` names a claim of the same kind that is not its own, and a recall names a recording that
 *   exists AND belongs to the claim the recall names — both existing is not enough, a crossed link would pass.
 *
 * In both modes a duplicate key INSIDE the export — a `recordingId`, a non-null `importKey`, a `seq`, a
 * `recallId` — is a damaged backup and is refused before anything else is looked at.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { MemoryRecordingRow } from "../store/schema/memories.js";
import type { MemoryRecallRow } from "../store/schema/memoryRecalls.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import type { RecallRecord } from "./recallRestore.js";
import type { RestoredRecording } from "./restore.js";
import type { RestoreDuplicateKeyError, RestoreTable } from "./restoreErrors.js";

/** What an export holds, fully decoded before any transaction opens. */
export interface RestoreInput {
  readonly memories: readonly RestoredRecording[];
  readonly recalls: readonly RecallRecord[];
}

/** The live rows a plan is made against, read inside the restore's own transaction. */
export interface LiveRestoreState {
  readonly memories: readonly MemoryRecordingRow[];
  readonly recalls: readonly MemoryRecallRow[];
}

/** Which kind of restore: recovery into an empty database, or a checked merge into a live one. */
export type RestoreMode = "empty" | "merge";

/** What a restore will write, and how many identical rows a merge skipped. */
export interface RestorePlan {
  readonly memories: readonly RestoredRecording[];
  readonly recalls: readonly RecallRecord[];
  readonly skippedMemories: number;
  readonly skippedRecalls: number;
}

/**
 * The memory columns a merge never compares: `seq`, which a merge remaps, so a second merge of the same export
 * still skips what the first one wrote; the generated `searchable`, which no export carries; the
 * `recordingId` the rows were matched on; and the two timestamps, which compare by instant below.
 */
type MemoryUncompared = "seq" | "searchable" | "recordingId" | "recordedAt" | "createdAt";

/** The recall columns a merge never compares, for the same reasons. */
type RecallUncompared = "seq" | "recallId" | "recordedAt" | "createdAt";

/**
 * Every other memory column, as a record so a column added to the schema fails to compile here until it is
 * named. A list could silently omit one, and a differing row would then be skipped as identical.
 */
const MEMORY_COMPARED_COLUMNS = {
  behaviourChange: true,
  caveat: true,
  claim: true,
  domain: true,
  evidence: true,
  id: true,
  importKey: true,
  kind: true,
  learner: true,
  outcome: true,
  question: true,
  repro: true,
  retrievalCue: true,
  run: true,
  supersedes: true,
  surface: true,
  tier: true,
  verdict: true,
} as const satisfies Record<Exclude<keyof MemoryRecordingRow, MemoryUncompared>, true>;

/** Every other recall column, exhaustive for the same reason. */
const RECALL_COMPARED_COLUMNS = {
  evidence: true,
  memoryId: true,
  outcome: true,
  recordingId: true,
  run: true,
} as const satisfies Record<Exclude<keyof MemoryRecallRow, RecallUncompared>, true>;

/**
 * Pure: a column record's own keys, typed as its keys — narrowed by a predicate over the record itself rather
 * than a cast, so the list is exactly what the record names.
 *
 * @param columns a record naming every compared column
 * @returns its keys
 */
function columnsOf<Column extends string>({ columns }: { columns: Record<Column, true> }): readonly Column[] {
  return Object.keys(columns).filter((key): key is Column => Object.hasOwn(columns, key));
}

export const MEMORY_COMPARED = columnsOf({ columns: MEMORY_COMPARED_COLUMNS });
export const RECALL_COMPARED = columnsOf({ columns: RECALL_COMPARED_COLUMNS });

/**
 * Pure: plan a restore of one decoded export against the live rows.
 *
 * @param incoming the decoded export, register and ledger together
 * @param live every row the two tables hold now
 * @param mode `empty` for recovery, `merge` for a checked merge
 * @returns the rows to insert, or the typed refusal — a refusal writes nothing
 */
export function planRestore({
  incoming,
  live,
  mode,
}: {
  incoming: RestoreInput;
  live: LiveRestoreState;
  mode: RestoreMode;
}): Result<RestorePlan, KnowledgeError> {
  const duplicate = incomingDuplicate({ incoming });
  if (duplicate !== undefined) {
    return err(duplicate);
  }
  if (mode === "empty") {
    if (live.memories.length > 0) {
      return err(KnowledgeErrors.restoreNotEmpty({ table: "memories" }));
    }
    if (live.recalls.length > 0) {
      return err(KnowledgeErrors.restoreNotEmpty({ table: "memory_recalls" }));
    }
    return ok({ memories: incoming.memories, recalls: incoming.recalls, skippedMemories: 0, skippedRecalls: 0 });
  }
  return planMerge({ incoming, live });
}

/**
 * Pure: the merge half of {@link planRestore}, past the duplicate check.
 *
 * @param incoming the decoded export
 * @param live every live row
 * @returns the renumbered rows to insert, or the first clash or broken link
 */
function planMerge({
  incoming,
  live,
}: {
  incoming: RestoreInput;
  live: LiveRestoreState;
}): Result<RestorePlan, KnowledgeError> {
  const memories = acceptMemories({ incoming: incoming.memories, live: live.memories });
  if (memories.isErr()) {
    return err(memories.error);
  }
  const recalls = acceptRecalls({ incoming: incoming.recalls, live: live.recalls });
  if (recalls.isErr()) {
    return err(recalls.error);
  }
  const closed = closureRefusal({ accepted: memories.value, acceptedRecalls: recalls.value, live });
  if (closed !== undefined) {
    return err(closed);
  }
  const memoryFloor = highestSeq({ rows: live.memories });
  const recallFloor = highestSeq({ rows: live.recalls });
  if (memoryFloor + memories.value.length > Number.MAX_SAFE_INTEGER) {
    return err(KnowledgeErrors.restoreSeqExhausted({ floor: memoryFloor, table: "memories" }));
  }
  if (recallFloor + recalls.value.length > Number.MAX_SAFE_INTEGER) {
    return err(KnowledgeErrors.restoreSeqExhausted({ floor: recallFloor, table: "memory_recalls" }));
  }
  return ok({
    memories: renumbered({ floor: memoryFloor, rows: memories.value }),
    recalls: renumbered({ floor: recallFloor, rows: recalls.value }),
    skippedMemories: incoming.memories.length - memories.value.length,
    skippedRecalls: incoming.recalls.length - recalls.value.length,
  });
}

/**
 * Pure: the first key inside the export that two rows share, as the refusal it earns.
 *
 * @param incoming the decoded export
 * @returns the refusal, or undefined when every key is unique
 */
function incomingDuplicate({ incoming }: { incoming: RestoreInput }): KnowledgeError | undefined {
  const checks: readonly {
    readonly table: RestoreTable;
    readonly key: RestoreDuplicateKeyError["key"];
    readonly values: readonly (string | null)[];
  }[] = [
    { key: "recordingId", table: "memories", values: incoming.memories.map((row) => row.recordingId) },
    { key: "importKey", table: "memories", values: incoming.memories.map((row) => row.importKey) },
    { key: "seq", table: "memories", values: incoming.memories.map((row) => String(row.seq)) },
    { key: "recallId", table: "memory_recalls", values: incoming.recalls.map((row) => row.recallId) },
    { key: "seq", table: "memory_recalls", values: incoming.recalls.map((row) => String(row.seq)) },
  ];
  for (const check of checks) {
    const seen = new Set<string>();
    for (const value of check.values) {
      if (value === null) {
        continue;
      }
      if (seen.has(value)) {
        return KnowledgeErrors.restoreDuplicateKey({ key: check.key, table: check.table, value });
      }
      seen.add(value);
    }
  }
  return undefined;
}

/**
 * Pure: whether an incoming recording is the stored one, column for column bar `seq` and `searchable`.
 *
 * @param incoming the decoded recording
 * @param stored the live row with the same `recordingId`
 * @returns true when nothing a reader could see differs
 */
function sameRecording({ incoming, stored }: { incoming: RestoredRecording; stored: MemoryRecordingRow }): boolean {
  return (
    MEMORY_COMPARED.every((key) => incoming[key] === stored[key]) &&
    incoming.recordedAt.getTime() === stored.recordedAt.getTime() &&
    incoming.createdAt.getTime() === stored.createdAt.getTime()
  );
}

/**
 * Pure: whether an incoming recall is the stored one, column for column bar `seq`.
 *
 * @param incoming the decoded recall
 * @param stored the live row with the same `recallId`
 * @returns true when nothing differs
 */
function sameRecall({ incoming, stored }: { incoming: RecallRecord; stored: MemoryRecallRow }): boolean {
  return (
    RECALL_COMPARED.every((key) => incoming[key] === stored[key]) &&
    incoming.recordedAt.getTime() === stored.recordedAt.getTime() &&
    incoming.createdAt.getTime() === stored.createdAt.getTime()
  );
}

/**
 * Pure: the incoming recordings a merge inserts — every one the database does not already hold identically.
 *
 * @param incoming the decoded recordings
 * @param live every live recording
 * @returns the recordings to insert, in export order, or the first clash
 */
function acceptMemories({
  incoming,
  live,
}: {
  incoming: readonly RestoredRecording[];
  live: readonly MemoryRecordingRow[];
}): Result<readonly RestoredRecording[], KnowledgeError> {
  const byId = new Map(live.map((row) => [row.recordingId, row]));
  const liveKeys = new Set(live.flatMap((row) => (row.importKey === null ? [] : [row.importKey])));
  const accepted: RestoredRecording[] = [];
  for (const row of incoming) {
    const stored = byId.get(row.recordingId);
    if (stored !== undefined) {
      if (!sameRecording({ incoming: row, stored })) {
        return err(
          KnowledgeErrors.restoreConflict({ conflict: "recording-differs", rowId: row.recordingId, table: "memories" }),
        );
      }
      continue;
    }
    if (row.importKey !== null && liveKeys.has(row.importKey)) {
      return err(
        KnowledgeErrors.restoreConflict({ conflict: "import-key-taken", rowId: row.recordingId, table: "memories" }),
      );
    }
    accepted.push(row);
  }
  return ok(accepted);
}

/**
 * Pure: the incoming recalls a merge inserts.
 *
 * @param incoming the decoded recalls
 * @param live every live recall
 * @returns the recalls to insert, in export order, or the first clash
 */
function acceptRecalls({
  incoming,
  live,
}: {
  incoming: readonly RecallRecord[];
  live: readonly MemoryRecallRow[];
}): Result<readonly RecallRecord[], KnowledgeError> {
  const byId = new Map(live.map((row) => [row.recallId, row]));
  const accepted: RecallRecord[] = [];
  for (const row of incoming) {
    const stored = byId.get(row.recallId);
    if (stored === undefined) {
      accepted.push(row);
      continue;
    }
    if (!sameRecall({ incoming: row, stored })) {
      return err(
        KnowledgeErrors.restoreConflict({ conflict: "recall-differs", rowId: row.recallId, table: "memory_recalls" }),
      );
    }
  }
  return ok(accepted);
}

/**
 * Pure: the first link an inserted row makes that closes over nothing, as the refusal it earns.
 *
 * Checked against the live rows plus the ACCEPTED incoming ones — a skipped row is already live.
 *
 * @param accepted the recordings the merge inserts
 * @param acceptedRecalls the recalls the merge inserts
 * @param live every live row
 * @returns the refusal, or undefined when every link closes
 */
function closureRefusal({
  accepted,
  acceptedRecalls,
  live,
}: {
  accepted: readonly RestoredRecording[];
  acceptedRecalls: readonly RecallRecord[];
  live: LiveRestoreState;
}): KnowledgeError | undefined {
  const kindsByClaim = new Map<string, Set<string>>();
  const claimByRecording = new Map<string, string>();
  for (const row of [...live.memories, ...accepted]) {
    const kinds = kindsByClaim.get(row.id);
    if (kinds === undefined) {
      kindsByClaim.set(row.id, new Set([row.kind]));
    } else {
      kinds.add(row.kind);
    }
    claimByRecording.set(row.recordingId, row.id);
  }
  const supersedes = supersedesRefusal({ accepted, kindsByClaim });
  if (supersedes !== undefined) {
    return supersedes;
  }
  return recallLinkRefusal({ acceptedRecalls, claimByRecording });
}

/**
 * Pure: the first inserted recording whose `supersedes` names no claim of its own kind, or itself.
 *
 * @param accepted the recordings the merge inserts
 * @param kindsByClaim every kind each claim id is recorded under, live and accepted
 * @returns the refusal, or undefined when every supersedes link closes
 */
function supersedesRefusal({
  accepted,
  kindsByClaim,
}: {
  accepted: readonly RestoredRecording[];
  kindsByClaim: ReadonlyMap<string, ReadonlySet<string>>;
}): KnowledgeError | undefined {
  for (const row of accepted) {
    if (row.supersedes === null) {
      continue;
    }
    const targetKinds = kindsByClaim.get(row.supersedes);
    if (row.supersedes === row.id || targetKinds === undefined || !targetKinds.has(row.kind)) {
      return KnowledgeErrors.restoreClosureBroken({ link: "supersedes", rowId: row.recordingId, table: "memories" });
    }
  }
  return undefined;
}

/**
 * Pure: the first inserted recall whose recording is missing, or belongs to a claim other than the one it names.
 *
 * @param acceptedRecalls the recalls the merge inserts
 * @param claimByRecording the claim id each recording belongs to, live and accepted
 * @returns the refusal, or undefined when every recall link closes
 */
function recallLinkRefusal({
  acceptedRecalls,
  claimByRecording,
}: {
  acceptedRecalls: readonly RecallRecord[];
  claimByRecording: ReadonlyMap<string, string>;
}): KnowledgeError | undefined {
  for (const recall of acceptedRecalls) {
    const claim = claimByRecording.get(recall.recordingId);
    if (claim === undefined) {
      return KnowledgeErrors.restoreClosureBroken({
        link: "recall-recording",
        rowId: recall.recallId,
        table: "memory_recalls",
      });
    }
    if (claim !== recall.memoryId) {
      return KnowledgeErrors.restoreClosureBroken({
        link: "recall-claim",
        rowId: recall.recallId,
        table: "memory_recalls",
      });
    }
  }
  return undefined;
}

/**
 * Pure: the highest `seq` a table holds, or zero for an empty one — the floor a merge renumbers above.
 *
 * @param rows every live row of one table
 * @returns the maximum
 */
function highestSeq({ rows }: { rows: readonly { readonly seq: number }[] }): number {
  let highest = 0;
  for (const row of rows) {
    highest = Math.max(highest, row.seq);
  }
  return highest;
}

/**
 * Pure: renumber rows above a floor in ascending incoming `seq` order — the export's own order kept as the
 * tie-break among the rows it adds. Duplicate sequences were refused before this runs, so the order is total.
 *
 * @param rows the rows to insert
 * @param floor the table's live maximum
 * @returns the rows, in their new order, each carrying its new `seq`
 */
function renumbered<Row extends { readonly seq: number }>({
  rows,
  floor,
}: {
  rows: readonly Row[];
  floor: number;
}): readonly Row[] {
  return rows.toSorted((left, right) => left.seq - right.seq).map((row, index) => ({ ...row, seq: floor + index + 1 }));
}
