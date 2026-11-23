/**
 * The chunk store's own typed error union — every way cutting, sending or rebuilding a chunked file failed.
 *
 * Its own domain beside `./uploadErrors.ts` rather than inside it, per `.claude/rules/error-handling.md`: a
 * blob is one file under one name, a chunk is one piece of many files under the digest of its RAW bytes while
 * the destination holds it ENCODED, and the failures that shape adds — a piece that will not decode, a rebuilt file
 * that does not hash to its manifest — have no blob equivalent. Every variant is displayed today; `code` is
 * there for the caller that branches.
 */

/** A file could not be read while it was being cut. */
export interface ChunkPlanFailedError {
  readonly code: "CHUNK_PLAN_FAILED";
  readonly message: string;
  readonly path: string;
}

/** A chunk re-read for sending no longer hashes to the digest its plan recorded. */
export interface ChunkChangedError {
  readonly code: "CHUNK_CHANGED";
  readonly message: string;
  readonly path: string;
  readonly offset: number;
}

/** What landed for a chunk is not the encoded bytes this process sent under that name. */
export interface ChunkLandedWrongError {
  readonly code: "CHUNK_LANDED_WRONG";
  readonly message: string;
  readonly objectName: string;
}

/** A chunk that landed wrong could not be taken back out, so the destination still holds it. */
export interface ChunkLeftBehindError {
  readonly code: "CHUNK_LEFT_BEHIND";
  readonly message: string;
  readonly objectName: string;
}

/** A downloaded chunk would not decode, or decoded to bytes that are not the chunk its name promises. */
export interface ChunkCorruptError {
  readonly code: "CHUNK_CORRUPT";
  readonly message: string;
  readonly objectName: string;
}

/** A file rebuilt from its chunks could not be written where it was asked for. */
export interface ChunkRebuildFailedError {
  readonly code: "CHUNK_REBUILD_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Every way the chunk store fails. */
export type ChunkError =
  | ChunkPlanFailedError
  | ChunkChangedError
  | ChunkLandedWrongError
  | ChunkLeftBehindError
  | ChunkCorruptError
  | ChunkRebuildFailedError;

/** The message a thrown cause carries, for a line that has to quote it. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Factories for {@link ChunkError}, so every message is written once. */
export const ChunkErrors = {
  changed: ({ path, offset }: { path: string; offset: number }): ChunkChangedError => ({
    code: "CHUNK_CHANGED",
    message:
      `${path}: the chunk at byte ${String(offset)} no longer hashes to the digest it was cut with — the ` +
      `frozen copy changed under the send, so nothing was sent under that name.`,
    offset,
    path,
  }),
  corrupt: ({ objectName, why }: { objectName: string; why: string }): ChunkCorruptError => ({
    code: "CHUNK_CORRUPT",
    message: `${objectName}: ${why} — the file is not rebuilt from it.`,
    objectName,
  }),
  landedWrong: ({ objectName, why }: { objectName: string; why: string }): ChunkLandedWrongError => ({
    code: "CHUNK_LANDED_WRONG",
    message: `${objectName}: ${why}, so it was taken back out and the backup stops here.`,
    objectName,
  }),
  leftBehind: ({ objectName, why }: { objectName: string; why: string }): ChunkLeftBehindError => ({
    code: "CHUNK_LEFT_BEHIND",
    message:
      `${objectName} landed wrong and could NOT be removed (${why}). Delete it by hand before the next ` +
      `backup: a later run treats a chunk it finds as already sent.`,
    objectName,
  }),
  planFailed: ({ path, cause }: { path: string; cause: unknown }): ChunkPlanFailedError => ({
    code: "CHUNK_PLAN_FAILED",
    message: `${path}: could not be read to cut into chunks — ${causeText({ cause })}`,
    path,
  }),
  rebuildFailed: ({ path, cause }: { path: string; cause: unknown }): ChunkRebuildFailedError => ({
    code: "CHUNK_REBUILD_FAILED",
    message: `${path}: could not be rebuilt from its chunks — ${causeText({ cause })}`,
    path,
  }),
} as const;
