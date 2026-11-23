/**
 * Typed failures for {@link ./loadCorpus} — see `.claude/rules/error-handling.md` for the shape.
 *
 * Scoped to this ONE loader rather than shared with `corpusStore.ts`'s own `CorpusStoreError`: a genuine
 * absence here is `loadCorpus`'s OWN check (`resolveCorpusScan` found no `.jsonl` file and no unreadable
 * dir), a different signal from the bronze reader underneath it failing outright. The two happen to share
 * identical user-facing text, so {@link noCorpusFoundMessage} composes it once for both.
 */
import { type CorpusHeapCeilingError, noCorpusFoundMessage } from "../corpus/corpusStore.errors.js";
import { type RecordKeyCollision, recordKeyCollisionMessage } from "./recordKey.js";

/** No corpus exists at all — a genuine absence, not a read failure. */
export interface LoadCorpusEmptyError {
  readonly code: "LOAD_CORPUS_EMPTY";
  readonly message: string;
  readonly dir: string;
}

/** The bronze reader itself failed (a permissions problem, a corrupt root) rather than finding nothing. */
export interface LoadCorpusBronzeReadFailedError {
  readonly code: "LOAD_CORPUS_BRONZE_READ_FAILED";
  readonly message: string;
}

/**
 * Two or more distinct records collided on one retrieval key ({@link ../retrieval/recordKey}). Refused
 * rather than silently merged — a merged posting would carry both records' term frequencies and hand a
 * query matching either one a citation for the wrong record.
 */
export interface LoadCorpusRecordKeyCollisionError {
  readonly code: "LOAD_CORPUS_RECORD_KEY_COLLISION";
  readonly message: string;
  readonly collisions: readonly RecordKeyCollision[];
}

/**
 * The corpus would not fit under this process's heap ceiling. Refused with the numbers rather than left to
 * V8, whose out-of-memory fatal names nothing. `stage` names the allocation refused — the bronze reader's
 * own guard, the only one left in this path since the per-query BM25 index it used to guard here is never
 * built in heap any more (see `loadCorpus`'s own doc comment) — and stays a literal rather than a bare
 * string so a second allocation this loader starts guarding again has somewhere typed to land.
 */
export interface LoadCorpusHeapCeilingError {
  readonly code: "LOAD_CORPUS_HEAP_CEILING";
  readonly message: string;
  readonly stage: "records";
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly projectedBytes: number;
  readonly suggestedLimitMib: number;
}

/**
 * The install's sync author denylist exists but could not be read.
 *
 * Its own variant rather than a bronze-read failure, because the two send a reader to different files and
 * different fixes. Refused rather than defaulted to excluding nothing: a query that answered from records
 * the operator had excluded, and said nothing, is exactly what the denylist exists to prevent.
 */
export interface LoadCorpusExclusionUnreadableError {
  readonly code: "LOAD_CORPUS_EXCLUSION_UNREADABLE";
  readonly message: string;
}

/** Every way {@link ./loadCorpus.loadCorpus} can fail. */
export type LoadCorpusError =
  | LoadCorpusEmptyError
  | LoadCorpusBronzeReadFailedError
  | LoadCorpusRecordKeyCollisionError
  | LoadCorpusExclusionUnreadableError
  | LoadCorpusHeapCeilingError;

/** Factories for {@link LoadCorpusError} — the one place its message text is composed. */
export const LoadCorpusErrors = {
  /**
   * Build a {@link LoadCorpusBronzeReadFailedError} wrapping the bronze reader's own failure.
   *
   * @param message the underlying bronze-read failure message
   * @returns the typed error
   */
  bronzeReadFailed: ({ message }: { message: string }): LoadCorpusBronzeReadFailedError => ({
    code: "LOAD_CORPUS_BRONZE_READ_FAILED",
    message,
  }),
  /**
   * Build a {@link LoadCorpusExclusionUnreadableError}.
   *
   * @param message the underlying denylist-load failure, which already names the file
   * @returns the typed error
   */
  exclusionUnreadable: ({ message }: { message: string }): LoadCorpusExclusionUnreadableError => ({
    code: "LOAD_CORPUS_EXCLUSION_UNREADABLE",
    message,
  }),
  /**
   * Build a {@link LoadCorpusEmptyError}.
   *
   * @param dir the corpus dir that held no `.jsonl` file and no unreadable directory
   * @returns the typed error
   */
  empty: ({ dir }: { dir: string }): LoadCorpusEmptyError => ({
    code: "LOAD_CORPUS_EMPTY",
    dir,
    message: noCorpusFoundMessage({ dir }),
  }),
  /**
   * Build a {@link LoadCorpusHeapCeilingError} from the bronze reader's own typed refusal, carrying its
   * numbers forward.
   *
   * @param cause the bronze reader's typed refusal
   * @returns the typed error
   */
  heapCeiling: ({ cause }: { cause: CorpusHeapCeilingError }): LoadCorpusHeapCeilingError => ({
    code: "LOAD_CORPUS_HEAP_CEILING",
    limitBytes: cause.limitBytes,
    message: cause.message,
    projectedBytes: cause.projectedBytes,
    stage: "records",
    suggestedLimitMib: cause.suggestedLimitMib,
    usedBytes: cause.usedBytes,
  }),
  /**
   * Build a {@link LoadCorpusRecordKeyCollisionError} naming every colliding key.
   *
   * @param collisions every key genuinely shared by two or more distinct records
   * @returns the typed error
   */
  recordKeyCollision: ({
    collisions,
  }: {
    collisions: readonly RecordKeyCollision[];
  }): LoadCorpusRecordKeyCollisionError => ({
    code: "LOAD_CORPUS_RECORD_KEY_COLLISION",
    collisions,
    message: collisions.map((collision) => recordKeyCollisionMessage({ collision })).join("; "),
  }),
} as const;
