/**
 * Why a staged import will not apply — its own union, beside staging's `importErrors.ts`, because applying meets
 * failures staging never can: a batch whose plan the live store has moved past, an answer still owed, an append-only
 * difference a strict apply stops on, and a staged row that no longer decodes to the row it was staged as.
 */
import type { UnmetDependency } from "./closure.js";
import type { ImportGuardsMissingError } from "./importErrors.js";
import type { StoreExportPartKind } from "./parts.js";

/**
 * One row an append-only part holds differently from the export: the live row stands, and the imported one stays
 * staged, unapplied. Every one is reported, answered or not.
 */
export interface AppendOnlyDifference {
  readonly questionId: string;
  readonly part: StoreExportPartKind;
  readonly key: string;
  readonly current: string;
  readonly imported: string;
  /** Whether the owner has acknowledged it. Acknowledged or not, the live row is what stands. */
  readonly resolved: boolean;
}

/** The batch's plan is not the one the export plans to against the live store now, so its answers answer another store. */
export interface ImportBatchStaleError {
  readonly code: "IMPORT_BATCH_STALE";
  readonly message: string;
  readonly batchId: string;
  readonly stagedPlanDigest: string;
  readonly currentPlanDigest: string;
}

/** Questions an apply needs answered first: a restored instruction's activation, or a conflict an answer settles. */
export interface ImportQuestionsOpenError {
  readonly code: "IMPORT_QUESTIONS_OPEN";
  readonly message: string;
  readonly batchId: string;
  readonly questionIds: readonly string[];
}

/** A strict apply met an append-only difference, so none of the batch's rows was applied. */
export interface ImportAppendOnlyConflictError {
  readonly code: "IMPORT_APPEND_ONLY_CONFLICT";
  readonly message: string;
  readonly batchId: string;
  readonly differences: readonly AppendOnlyDifference[];
}

/** A staged row does not decode, under its own domain's schema, to the row it was staged as. */
export interface ImportStagedPayloadInvalidError {
  readonly code: "IMPORT_STAGED_PAYLOAD_INVALID";
  readonly message: string;
  readonly part: StoreExportPartKind;
  /** The row's key, or `null` for a part judged whole — a directive overlay or a standing-ask register. */
  readonly key: string | null;
}

/** The batch's rows do not hang together: a row, question or answer naming something the batch does not hold. */
export interface ImportStagedBatchIncompleteError {
  readonly code: "IMPORT_STAGED_BATCH_INCOMPLETE";
  readonly message: string;
  readonly batchId: string;
}

/**
 * A row the import would write needs one nothing live or written provides — a recall of a memory an alignment kept
 * out, above all — so the register would refuse that write, and none of the batch's rows is applied.
 */
export interface ImportDependencyUnmetError {
  readonly code: "IMPORT_DEPENDENCY_UNMET";
  readonly message: string;
  readonly batchId: string;
  readonly unmet: readonly UnmetDependency[];
  /** Every alignment keeping an imported row out, which may be what left a need unmet. */
  readonly alignmentQuestionIds: readonly string[];
}

/** No batch is staged under the id an apply was given. */
export interface ImportBatchNotStagedError {
  readonly code: "IMPORT_BATCH_NOT_STAGED";
  readonly message: string;
  readonly batchId: string;
}

/** The session writes in replica mode, under which an ALWAYS trigger is the only guard left, so none of its rows is applied. */
export interface ImportReplicaSessionError {
  readonly code: "IMPORT_REPLICA_SESSION";
  readonly message: string;
  readonly batchId: string;
}

/** The instant an apply would record a replaced standing ask withdrawn at is not one the register admits. */
export interface ImportInstantInvalidError {
  readonly code: "IMPORT_INSTANT_INVALID";
  readonly message: string;
  readonly batchId: string;
  readonly nowIso: string;
}

/** A register's writer refused, or a statement failed, part way through: the whole apply rolled back. */
export interface ImportApplicationFailedError {
  readonly code: "IMPORT_APPLICATION_FAILED";
  readonly message: string;
  readonly batchId: string;
  /** The register whose write failed, or `the store` for a failure no register owns. */
  readonly register: string;
}

/**
 * The apply ran to its end but COMMIT went unanswered, or was answered with a code that does not say it rolled back, so
 * the batch may or may not have been written: the one outcome that is unknown rather than a refusal. Running the apply
 * again finds the receipt if the commit stood, and otherwise tries the batch again.
 */
export interface ImportCommitUnconfirmedError {
  readonly code: "IMPORT_COMMIT_UNCONFIRMED";
  readonly message: string;
  readonly batchId: string;
}

/** Every way a staged import will not apply, or may not have. */
export type StoreImportApplyError =
  | ImportBatchStaleError
  | ImportDependencyUnmetError
  | ImportQuestionsOpenError
  | ImportAppendOnlyConflictError
  | ImportStagedPayloadInvalidError
  | ImportStagedBatchIncompleteError
  | ImportBatchNotStagedError
  | ImportReplicaSessionError
  | ImportInstantInvalidError
  | ImportApplicationFailedError
  | ImportCommitUnconfirmedError
  | ImportGuardsMissingError;

/** The longest cause a failed or unconfirmed apply's message carries, so a driver's long statement text never floods it. */
const CAUSE_LIMIT = 400;

/** A cause cut to `CAUSE_LIMIT`. */
function boundedCause({ why }: { why: string }): string {
  return why.length <= CAUSE_LIMIT ? why : `${why.slice(0, CAUSE_LIMIT - 1)}…`;
}

export const StoreImportApplyErrors = {
  appendOnlyConflict: ({
    batchId,
    differences,
  }: {
    batchId: string;
    differences: readonly AppendOnlyDifference[];
  }): ImportAppendOnlyConflictError => ({
    batchId,
    code: "IMPORT_APPEND_ONLY_CONFLICT",
    differences,
    message:
      `batch ${batchId} differs from the live store in ${String(differences.length)} append-only row(s), and a ` +
      `strict apply stops on any: ${differences.map((one) => `${one.part} ${one.key}`).join(", ")}`,
  }),
  applicationFailed: ({
    batchId,
    register,
    why,
  }: {
    batchId: string;
    register: string;
    why: string;
  }): ImportApplicationFailedError => ({
    batchId,
    code: "IMPORT_APPLICATION_FAILED",
    message: `batch ${batchId} did not apply, and none of its rows was written: ${register}: ${boundedCause({ why })}`,
    register,
  }),
  commitUnconfirmed: ({ batchId, why }: { batchId: string; why: string }): ImportCommitUnconfirmedError => ({
    batchId,
    code: "IMPORT_COMMIT_UNCONFIRMED",
    message:
      `batch ${batchId} ran to its end but its commit went unanswered, or was answered with a code that does not say ` +
      `it rolled back, so whether its rows were written is unknown: ${boundedCause({ why })}; the same apply, run ` +
      "again against the same store, reports it already applied if the commit stood, and otherwise tries the batch again",
  }),
  batchNotStaged: ({ batchId }: { batchId: string }): ImportBatchNotStagedError => ({
    batchId,
    code: "IMPORT_BATCH_NOT_STAGED",
    message: `no batch ${batchId} is staged; store import --from <dir> --approve <digest> stages one`,
  }),
  instantInvalid: ({ batchId, nowIso }: { batchId: string; nowIso: string }): ImportInstantInvalidError => ({
    batchId,
    code: "IMPORT_INSTANT_INVALID",
    message:
      `batch ${batchId} was not applied, and nothing was read or written: ${JSON.stringify(nowIso)} is not an ` +
      "ISO instant with an offset, the only time a standing ask records a withdrawal at",
    nowIso,
  }),
  replicaSession: ({ batchId }: { batchId: string }): ImportReplicaSessionError => ({
    batchId,
    code: "IMPORT_REPLICA_SESSION",
    message: `batch ${batchId} was not applied: this session writes in replica mode, which an apply never does`,
  }),
  batchIncomplete: ({ batchId, why }: { batchId: string; why: string }): ImportStagedBatchIncompleteError => ({
    batchId,
    code: "IMPORT_STAGED_BATCH_INCOMPLETE",
    message: `batch ${batchId} does not hang together: ${why}`,
  }),
  batchStale: ({
    batchId,
    stagedPlanDigest,
    currentPlanDigest,
    why,
  }: {
    batchId: string;
    stagedPlanDigest: string;
    currentPlanDigest: string;
    why: string;
  }): ImportBatchStaleError => ({
    batchId,
    code: "IMPORT_BATCH_STALE",
    currentPlanDigest,
    message: `batch ${batchId} is stale: ${why}; stage the export again and answer its questions`,
    stagedPlanDigest,
  }),
  dependencyUnmet: ({
    batchId,
    unmet,
    alignmentQuestionIds,
  }: {
    batchId: string;
    unmet: readonly UnmetDependency[];
    alignmentQuestionIds: readonly string[];
  }): ImportDependencyUnmetError => {
    const needs = unmet.map((one) => `${one.part} ${one.key} needs ${one.needs}`).join("; ");
    const kept =
      alignmentQuestionIds.length === 0
        ? "no alignment keeps an imported row out"
        : `the alignment(s) keeping an imported row out: ${alignmentQuestionIds.join(", ")}`;
    return {
      alignmentQuestionIds,
      batchId,
      code: "IMPORT_DEPENDENCY_UNMET",
      message: `batch ${batchId} would write ${String(unmet.length)} row(s) whose need nothing live or written provides, so none of its rows is applied: ${needs}; ${kept}`,
      unmet,
    };
  },
  payloadInvalid: ({
    part,
    key,
    why,
  }: {
    part: StoreExportPartKind;
    key: string | null;
    why: string;
  }): ImportStagedPayloadInvalidError => {
    const what = key === null ? `staged ${part} rows are` : `staged ${part} row ${key} is`;
    return {
      code: "IMPORT_STAGED_PAYLOAD_INVALID",
      key,
      message: `${what} not what was staged: ${why}`,
      part,
    };
  },
  questionsOpen: ({
    batchId,
    questionIds,
  }: {
    batchId: string;
    questionIds: readonly string[];
  }): ImportQuestionsOpenError => ({
    batchId,
    code: "IMPORT_QUESTIONS_OPEN",
    message:
      `batch ${batchId} has ${String(questionIds.length)} question(s) to answer before it applies ` +
      `(store import-questions, then store import-resolve): ${questionIds.join(", ")}`,
    questionIds,
  }),
} as const;
