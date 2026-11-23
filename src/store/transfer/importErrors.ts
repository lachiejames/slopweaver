/**
 * Why staging an import, or answering one of its questions, was refused — the transfer domain's union widened
 * by the nine refusals only staging and resolving can meet. A store failure stays the store's own typed error,
 * so a caller still tells an unreachable database from a refused answer by `code`.
 */
import type { StoreError } from "../errors.js";

import type { ImportAction } from "./compare.js";
import type { StoreTransferError } from "./errors.js";
import type { StoreExportPartKind } from "./parts.js";

/** `--approve` named a plan digest other than the one the export plans to now. */
export interface ImportApprovalMismatchError {
  readonly code: "IMPORT_APPROVAL_MISMATCH";
  readonly message: string;
  readonly approved: string;
  readonly planned: string;
}

/** No staged question carries that id. */
export interface ImportQuestionNotStagedError {
  readonly code: "IMPORT_QUESTION_NOT_STAGED";
  readonly message: string;
  readonly questionId: string;
}

/** The answer given is not one the question takes. */
export interface ImportActionInvalidError {
  readonly code: "IMPORT_ACTION_INVALID";
  readonly message: string;
  readonly questionId: string;
  readonly action: string;
  readonly allowed: readonly ImportAction[];
}

/** The question already holds a different answer, and an answer is never changed. */
export interface ImportQuestionAlreadyResolvedError {
  readonly code: "IMPORT_QUESTION_ALREADY_RESOLVED";
  readonly message: string;
  readonly questionId: string;
  readonly recorded: ImportAction;
  readonly requested: string;
}

/** The plan asks about a row the reading never carried, so staging would leave a question with no row. */
export interface ImportStageInconsistentError {
  readonly code: "IMPORT_STAGE_INCONSISTENT";
  readonly message: string;
  readonly questionId: string;
  readonly part: StoreExportPartKind;
  readonly key: string;
}

/** A batch already holds this export's digest, but what it holds is not what the export stages. */
export interface ImportBatchMismatchError {
  readonly code: "IMPORT_BATCH_MISMATCH";
  readonly message: string;
  readonly batchId: string;
  readonly contentDigest: string;
}

/** A trigger that keeps what staging wrote is absent or disabled, so nothing is staged or answered over it. */
export interface ImportGuardsMissingError {
  readonly code: "IMPORT_GUARDS_MISSING";
  readonly message: string;
  readonly missing: readonly string[];
}

/**
 * The question belongs to a batch staged under another comparison version, or before batches recorded one: this
 * build would not ask it, so it is never answered as current.
 */
export interface ImportQuestionStaleError {
  readonly code: "IMPORT_QUESTION_STALE";
  readonly message: string;
  readonly questionId: string;
  /** The batch's recorded comparison version, `null` for one staged before batches recorded one. */
  readonly stagedVersion: number | null;
}

/** The plan was made under another comparison version, so its questions are not the ones this build stages. */
export interface ImportPlanStaleError {
  readonly code: "IMPORT_PLAN_STALE";
  readonly message: string;
  readonly planVersion: number;
}

/** Every way staging or resolving an import fails. */
export type StoreImportError =
  | ImportPlanStaleError
  | ImportQuestionStaleError
  | StoreTransferError
  | StoreError
  | ImportApprovalMismatchError
  | ImportQuestionNotStagedError
  | ImportActionInvalidError
  | ImportQuestionAlreadyResolvedError
  | ImportStageInconsistentError
  | ImportBatchMismatchError
  | ImportGuardsMissingError;

export const StoreImportErrors = {
  guardsMissing: ({ missing }: { missing: readonly string[] }): ImportGuardsMissingError => ({
    code: "IMPORT_GUARDS_MISSING",
    message:
      `the store lacks ${missing.length} always-enabled import guard trigger(s) (${missing.join(", ")}), as an apply that ` +
      "never finished leaves it; none of the import's rows was written — `slopweaver store push` installs them",
    missing,
  }),
  batchMismatch: ({
    batchId,
    contentDigest,
    difference,
  }: {
    batchId: string;
    contentDigest: string;
    difference: string;
  }): ImportBatchMismatchError => ({
    batchId,
    code: "IMPORT_BATCH_MISMATCH",
    contentDigest,
    message:
      `batch ${batchId} already holds ${contentDigest} but not what this export stages (${difference}); ` +
      "nothing was staged and the batch was not trusted",
  }),
  actionInvalid: ({
    questionId,
    action,
    allowed,
  }: {
    questionId: string;
    action: string;
    allowed: readonly ImportAction[];
  }): ImportActionInvalidError => ({
    action,
    allowed,
    code: "IMPORT_ACTION_INVALID",
    message: `${questionId} takes ${allowed.join(" or ")}, not ${action}`,
    questionId,
  }),
  alreadyResolved: ({
    questionId,
    recorded,
    requested,
  }: {
    questionId: string;
    recorded: ImportAction;
    requested: string;
  }): ImportQuestionAlreadyResolvedError => ({
    code: "IMPORT_QUESTION_ALREADY_RESOLVED",
    message: `${questionId} is already answered ${recorded}; an answer is never changed, so ${requested} was not recorded`,
    questionId,
    recorded,
    requested,
  }),
  approvalMismatch: ({ approved, planned }: { approved: string; planned: string }): ImportApprovalMismatchError => ({
    approved,
    code: "IMPORT_APPROVAL_MISMATCH",
    message:
      `the export plans to ${planned} now, not the approved ${approved}; the export or the live store moved, ` +
      "so read the plan again and approve the digest it prints",
    planned,
  }),
  notStaged: ({ questionId }: { questionId: string }): ImportQuestionNotStagedError => ({
    code: "IMPORT_QUESTION_NOT_STAGED",
    message: `no staged import question is ${questionId}; \`store import-questions\` lists the open ones`,
    questionId,
  }),
  planStale: ({
    planVersion,
    currentVersion,
  }: {
    planVersion: number;
    currentVersion: number;
  }): ImportPlanStaleError => ({
    code: "IMPORT_PLAN_STALE",
    message:
      `the plan was made under comparison version ${String(planVersion)}, and this build compares by version ` +
      `${String(currentVersion)}; nothing was staged — plan the export again with this build and approve that digest`,
    planVersion,
  }),
  questionStale: ({
    questionId,
    stagedVersion,
    currentVersion,
  }: {
    questionId: string;
    stagedVersion: number | null;
    currentVersion: number;
  }): ImportQuestionStaleError => {
    const staged =
      stagedVersion === null
        ? "before batches recorded their comparison version"
        : `under comparison version ${String(stagedVersion)}`;
    return {
      code: "IMPORT_QUESTION_STALE",
      message:
        `${questionId} was staged ${staged}, and this build compares by version ${String(currentVersion)}; ` +
        "it is not a question this build would ask, so no answer was recorded — the export has to be staged again",
      questionId,
      stagedVersion,
    };
  },
  stageInconsistent: ({
    questionId,
    part,
    key,
  }: {
    questionId: string;
    part: StoreExportPartKind;
    key: string;
  }): ImportStageInconsistentError => ({
    code: "IMPORT_STAGE_INCONSISTENT",
    key,
    message: `${questionId} asks about ${part} ${key}, which the export's reading does not carry; nothing was staged`,
    part,
    questionId,
  }),
} as const;
