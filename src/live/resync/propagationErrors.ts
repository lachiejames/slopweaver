/**
 * The typed failures corpus propagation authors: a record or batch file that would not write, read or retire,
 * and a confirmation naming a batch that is not open or a revision it cannot take.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to `./propagationStore.ts` and
 * `./propagationBatch.ts`. Every caller only displays one today — the resync's own output and `automation propagate`
 * — so `message` carries the whole sentence; `code` is what a caller would branch on.
 */

import { errorMessage } from "../../lib/errorMessage.js";

/** A propagation file could not be written, read or moved; `path` is the file and `cause` the throw. */
export interface PropagationFileError {
  readonly code: "RECORD_WRITE_FAILED" | "FILE_UNREADABLE" | "BATCH_WRITE_FAILED" | "BATCH_RETIRE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** A propagation file was read and is not the shape this build writes; `reasons` is every problem found. */
export interface PropagationFileInvalidError {
  readonly code: "FILE_INVALID";
  readonly message: string;
  readonly path: string;
  readonly reasons: readonly string[];
}

/** `--through-revision` named a revision the batch cannot be confirmed through. */
export interface PropagationRevisionError {
  readonly code: "REVISION_NOT_POSITIVE" | "REVISION_AHEAD";
  readonly message: string;
  readonly through: number;
}

/** `--batch` named a pass that is not the one open — it was retired, and a later sync opened another. */
export interface PropagationBatchMismatchError {
  readonly code: "BATCH_MISMATCH";
  readonly message: string;
  readonly expected: string;
  readonly got: string;
}

/** Every failure corpus propagation authors. */
export type PropagationError =
  PropagationFileError | PropagationFileInvalidError | PropagationRevisionError | PropagationBatchMismatchError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const PropagationErrors = {
  batchMismatch: ({ expected, got }: { expected: string; got: string }): PropagationBatchMismatchError => ({
    code: "BATCH_MISMATCH",
    expected,
    got,
    message: `batch ${got} is not the open pass — ${expected} is, opened by a sync your read never saw; read \`automation propagate --status\` again`,
  }),
  batchRetireFailed: ({ path, cause }: { path: string; cause: unknown }): PropagationFileError => ({
    code: "BATCH_RETIRE_FAILED",
    message: `could not retire the propagation batch: ${errorMessage({ error: cause })}`,
    path,
  }),
  batchWriteFailed: ({ path, cause }: { path: string; cause: unknown }): PropagationFileError => ({
    code: "BATCH_WRITE_FAILED",
    message: `could not write the propagation batch: ${errorMessage({ error: cause })}`,
    path,
  }),
  fileInvalid: ({ path, reasons }: { path: string; reasons: readonly string[] }): PropagationFileInvalidError => ({
    code: "FILE_INVALID",
    message: `${path}: ${reasons.join("; ")}`,
    path,
    reasons,
  }),
  fileUnreadable: ({ path, cause }: { path: string; cause: unknown }): PropagationFileError => ({
    code: "FILE_UNREADABLE",
    message: `could not read ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  recordWriteFailed: ({
    path,
    recipeId,
    cause,
  }: {
    path: string;
    recipeId: string;
    cause: unknown;
  }): PropagationFileError => ({
    code: "RECORD_WRITE_FAILED",
    message: `could not record the propagation for ${recipeId}: ${errorMessage({ error: cause })}`,
    path,
  }),
  revisionAhead: ({ through, revision }: { through: number; revision: number }): PropagationRevisionError => ({
    code: "REVISION_AHEAD",
    message: `revision ${String(through)} does not exist yet — the batch is at ${String(revision)}; read \`automation propagate --status\` again`,
    through,
  }),
  revisionNotPositive: ({ through }: { through: number }): PropagationRevisionError => ({
    code: "REVISION_NOT_POSITIVE",
    message: `--through-revision must be a positive whole number, not ${String(through)}`,
    through,
  }),
} as const;
