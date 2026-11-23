/**
 * The store-backed workstream register: read the whole register, write one workstream or the register-level document
 * by compare-and-set, delete one workstream. Every decision is made here; `./rows.ts` and `./aggregateWrite.ts` only
 * speak SQL.
 *
 * Workstreams live in the store as rows, not files. So there is no file here at all — no import, no fallback: a store outage is
 * `WORKSTREAM_STORE_UNAVAILABLE`, never an empty register and never the retired `register.json`.
 *
 * ## A write
 *
 * The aggregate is decoded and judged first (`./decode.ts`, `./validation.ts`) and refused whole on any problem.
 * A `workstream` link's target is not judged here: the write transaction locks every target `FOR KEY SHARE`, in id
 * order, and refuses unless each one is there, so a target deleted mid-write cannot leave a dangling link. Revision
 * `null` creates; a number updates iff the row still carries it. A lost race is a typed conflict and nothing retries
 * it — re-judging against a register that moved is the caller's.
 *
 * ## A batch
 *
 * Changing more than one thing at once — several workstreams, a delete, the register document — is `applyBatch`: one
 * transaction judged against the register it leaves (`./batchWrite.ts`), never a loop over `put`. Its optional
 * `wholeRegister` is the whole-register compare-and-set.
 *
 * Dormant: nothing in production imports this yet; the verbs move over in the PR after the migration is pushed.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { WorkstreamRegisterMetaRow } from "../../store/schema.js";

import {
  assembleWorkstreamRegister,
  storedWorkstreamOf,
  type WorkstreamAggregateRows,
  type WorkstreamRegisterRows,
} from "./assembly.js";
import type { WorkstreamBatchOutcome, WorkstreamBatchRefusal } from "./batchPlan.js";
import { type WorkstreamStoreError, WorkstreamStoreErrors, type WorkstreamStoreUnavailableError } from "./errors.js";
import { judgeAggregateWrite, judgeBatch, judgeMetaWrite, judgeRemove, type WorkstreamBatchRequest } from "./judge.js";
import type {
  StoredWorkstream,
  StoredWorkstreamMeta,
  WorkstreamAggregate,
  WorkstreamRegisterMeta,
  WorkstreamRegisterSnapshot,
} from "./types.js";

/** What one aggregate write did inside its transaction. */
export type AggregateWriteOutcome =
  | { readonly kind: "written"; readonly rows: WorkstreamAggregateRows; readonly lockedTargets: readonly string[] }
  | { readonly kind: "conflict" }
  | { readonly kind: "missing-targets"; readonly missing: readonly string[] };

/** What one delete did inside its transaction. */
export type WorkstreamDeleteOutcome =
  | { readonly kind: "deleted" }
  | { readonly kind: "conflict" }
  | { readonly kind: "referenced"; readonly referencedBy: readonly string[] };

/** The statements one open connection offers, and the handle that closes it. */
export interface WorkstreamRows {
  /** Every row of the register, read in one read-only, repeatable-read transaction. */
  readonly readAll: () => Promise<Result<WorkstreamRegisterRows, WorkstreamStoreUnavailableError>>;
  /** Write one aggregate whole: lock targets, compare-and-set the row, replace its children, read it back. */
  readonly writeAggregate: (request: {
    readonly aggregate: WorkstreamAggregate;
    readonly expectedRevision: number | null;
  }) => Promise<Result<AggregateWriteOutcome, WorkstreamStoreUnavailableError>>;
  /** Delete one workstream iff it is at `expectedRevision` and nothing links to it; its children cascade. */
  readonly deleteWorkstream: (request: {
    readonly expectedRevision: number;
    readonly workstreamId: string;
  }) => Promise<Result<WorkstreamDeleteOutcome, WorkstreamStoreUnavailableError>>;
  /** Insert the register document (`null`) or update it iff at the revision; undefined when the race was lost. */
  readonly writeMeta: (request: {
    readonly document: WorkstreamRegisterMeta;
    readonly expectedRevision: number | null;
  }) => Promise<Result<WorkstreamRegisterMetaRow | undefined, WorkstreamStoreUnavailableError>>;
  /** Run one judged batch in one transaction, rolled back on every refusal (`./batchWrite.ts`). */
  readonly applyBatch: (
    request: WorkstreamBatchRequest,
  ) => Promise<Result<WorkstreamBatchOutcome, WorkstreamStoreUnavailableError>>;
  readonly close: () => Promise<void>;
}

/** What one batch wrote: every written workstream as stored, and the register document when it wrote one. */
export interface WorkstreamBatchResult {
  /** In id order, exactly as the transaction read them back. */
  readonly written: readonly StoredWorkstream[];
  /** The register document as stored, or `null` when the batch wrote none — left it, asserted none or deleted it. */
  readonly meta: StoredWorkstreamMeta | null;
}

/** Every effect the register performs, injected so each decision is testable without a database. */
export interface WorkstreamStoreSeams {
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<WorkstreamRows, WorkstreamStoreUnavailableError>>;
}

/** The register's five operations, as one value a caller threads. */
export interface WorkstreamStore {
  /**
   * Several workstreams created, updated and deleted, and the register document written, in one transaction or not
   * at all — the one way to change more than one thing at once; never a loop over `put`.
   */
  readonly applyBatch: (
    request: WorkstreamBatchRequest & { readonly home: string },
  ) => Promise<Result<WorkstreamBatchResult, WorkstreamStoreError>>;
  readonly read: (request: {
    readonly home: string;
  }) => Promise<Result<WorkstreamRegisterSnapshot, WorkstreamStoreError>>;
  readonly put: (request: {
    readonly aggregate: WorkstreamAggregate;
    readonly expectedRevision: number | null;
    readonly home: string;
  }) => Promise<Result<StoredWorkstream, WorkstreamStoreError>>;
  readonly remove: (request: {
    readonly expectedRevision: number;
    readonly home: string;
    readonly workstreamId: string;
  }) => Promise<Result<void, WorkstreamStoreError>>;
  readonly putMeta: (request: {
    readonly document: WorkstreamRegisterMeta;
    readonly expectedRevision: number | null;
    readonly home: string;
  }) => Promise<Result<StoredWorkstreamMeta, WorkstreamStoreError>>;
}

/**
 * What a caught value says about itself, never a thrown request object.
 *
 * @returns its message, or a constant when it is not an Error
 */
export function describeStoreCause({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "unknown failure";
}

/**
 * The revision a conflict names: a create expected no row, which the error factories spell `0` because a real
 * revision starts at 1.
 *
 * @returns the expected revision, `0` for a create
 */
function creatingAsZero({ expectedRevision }: { expectedRevision: number | null }): number {
  if (expectedRevision === null) {
    return 0;
  }
  return expectedRevision;
}

/**
 * Run one operation over a connection this opens and always closes; a seam that throws is a store refusal.
 *
 * A failed close replaces a READ's answer, which nothing has acted on yet. It never replaces a write's: by then the
 * write's transaction has committed or rolled back, so `WORKSTREAM_STORE_UNAVAILABLE` would claim nothing was written
 * over a batch that was.
 *
 * @param writes whether the operation writes, so its answer outlives a failed close
 * @returns the operation's answer, or the refusal
 */
async function withRows<Answer>({
  body,
  home,
  seams,
  writes,
}: {
  body: (rows: WorkstreamRows) => Promise<Result<Answer, WorkstreamStoreError>>;
  home: string;
  seams: WorkstreamStoreSeams;
  writes: boolean;
}): Promise<Result<Answer, WorkstreamStoreError>> {
  const unavailable = ({ cause, doing }: { cause: unknown; doing: string }): WorkstreamStoreError =>
    WorkstreamStoreErrors.unavailable({ doing, reason: describeStoreCause({ cause }) });
  let rows: Result<WorkstreamRows, WorkstreamStoreUnavailableError>;
  try {
    rows = await seams.connect({ home });
  } catch (cause) {
    return err(unavailable({ cause, doing: "be opened" }));
  }
  if (rows.isErr()) {
    return err(rows.error);
  }
  let answer: Result<Answer, WorkstreamStoreError>;
  try {
    answer = await body(rows.value);
  } catch (cause) {
    answer = err(unavailable({ cause, doing: "finish the operation" }));
  }
  try {
    await rows.value.close();
  } catch (cause) {
    if (!writes) {
      return err(unavailable({ cause, doing: "close its connection" }));
    }
  }
  return answer;
}

/**
 * Write one judged aggregate and decode what the transaction read back.
 *
 * @returns the stored workstream, or the refusal
 */
async function putAggregate({
  aggregate,
  expectedRevision,
  rows,
}: {
  aggregate: WorkstreamAggregate;
  expectedRevision: number | null;
  rows: WorkstreamRows;
}): Promise<Result<StoredWorkstream, WorkstreamStoreError>> {
  const judged = judgeAggregateWrite({ aggregate, expectedRevision });
  if (judged.isErr()) {
    return err(WorkstreamStoreErrors.invalid({ problems: judged.error }));
  }
  const written = await rows.writeAggregate({ aggregate: judged.value, expectedRevision });
  if (written.isErr()) {
    return err(written.error);
  }
  const outcome = written.value;
  if (outcome.kind === "conflict") {
    return err(
      WorkstreamStoreErrors.conflict({
        expectedRevision: creatingAsZero({ expectedRevision }),
        workstreamId: aggregate.id,
      }),
    );
  }
  if (outcome.kind === "missing-targets") {
    const problems = outcome.missing.map(
      (target) => `${aggregate.id} links workstream ${target}, which the register does not hold`,
    );
    return err(WorkstreamStoreErrors.invalid({ problems }));
  }
  const stored = storedWorkstreamOf({
    knownWorkstreamIds: new Set([aggregate.id, ...outcome.lockedTargets]),
    rows: outcome.rows,
  });
  return stored.mapErr((problems) => WorkstreamStoreErrors.storedInvalid({ problems }));
}

/**
 * Decode, judge and write the register document by compare-and-set.
 *
 * @returns the stored document, or the refusal
 */
async function putMetaDocument({
  document,
  expectedRevision,
  rows,
}: {
  document: WorkstreamRegisterMeta;
  expectedRevision: number | null;
  rows: WorkstreamRows;
}): Promise<Result<StoredWorkstreamMeta, WorkstreamStoreError>> {
  const decoded = judgeMetaWrite({ document, expectedRevision });
  if (decoded.isErr()) {
    return err(WorkstreamStoreErrors.invalid({ problems: decoded.error }));
  }
  const written = await rows.writeMeta({ document: decoded.value, expectedRevision });
  if (written.isErr()) {
    return err(written.error);
  }
  if (written.value === undefined) {
    return err(WorkstreamStoreErrors.metaConflict({ expectedRevision: creatingAsZero({ expectedRevision }) }));
  }
  const row = written.value;
  return ok({ document: decoded.value, revision: row.revision, updatedAtIso: row.updatedAt.toISOString() });
}

/**
 * A batch the transaction refused, as the register's typed refusal — the one mapping, which the in-memory store the
 * tests drive answers through too.
 *
 * @param outcome what the batch's transaction refused on
 * @returns the refusal
 */
export function batchRefusalError({ outcome }: { outcome: WorkstreamBatchRefusal }): WorkstreamStoreError {
  switch (outcome.kind) {
    case "workstream-conflict":
      return WorkstreamStoreErrors.conflict({
        expectedRevision: creatingAsZero({ expectedRevision: outcome.expectedRevision }),
        workstreamId: outcome.workstreamId,
      });
    case "missing-targets":
      return WorkstreamStoreErrors.invalid({
        problems: outcome.missing.map(
          (target) =>
            `${outcome.workstreamId} links workstream ${target}, which the batch does not leave in the register`,
        ),
      });
    case "referenced":
      return WorkstreamStoreErrors.referenced({
        referencedBy: outcome.referencedBy,
        workstreamId: outcome.workstreamId,
      });
    case "meta-conflict":
      return WorkstreamStoreErrors.metaConflict({
        expectedRevision: creatingAsZero({ expectedRevision: outcome.expectedRevision }),
      });
    case "whole-register-conflict":
      return WorkstreamStoreErrors.wholeRegisterConflict({ actual: outcome.actual, expected: outcome.expected });
    case "stored-invalid":
      return WorkstreamStoreErrors.storedInvalid({ problems: outcome.problems });
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}

/**
 * Judge a batch and run it in one transaction, which decodes what it read back before it commits.
 *
 * @returns every written workstream and the document as stored, or the refusal — and then nothing was written
 */
async function putBatch({
  request,
  rows,
}: {
  request: WorkstreamBatchRequest;
  rows: WorkstreamRows;
}): Promise<Result<WorkstreamBatchResult, WorkstreamStoreError>> {
  const judged = judgeBatch({ request });
  if (judged.isErr()) {
    return err(WorkstreamStoreErrors.invalid({ problems: judged.error }));
  }
  const applied = await rows.applyBatch(judged.value);
  if (applied.isErr()) {
    return err(applied.error);
  }
  const outcome = applied.value;
  if (outcome.kind !== "applied") {
    return err(batchRefusalError({ outcome }));
  }
  let meta: StoredWorkstreamMeta | null = null;
  const document = judged.value.meta?.document;
  if (outcome.meta !== null && document != null) {
    meta = {
      document,
      revision: outcome.meta.revision,
      updatedAtIso: outcome.meta.updatedAt.toISOString(),
    };
  }
  return ok({ meta, written: outcome.written });
}

/**
 * The register over whichever seams it is handed.
 *
 * @param seams the effects — production's are `productionWorkstreamStoreSeams` in `./rows.ts`
 * @returns the register's operations
 */
export function workstreamStore({ seams }: { seams: WorkstreamStoreSeams }): WorkstreamStore {
  return {
    applyBatch: ({ home, ...request }) =>
      withRows({ body: (rows) => putBatch({ request, rows }), home, seams, writes: true }),
    put: ({ aggregate, expectedRevision, home }) =>
      withRows({ body: (rows) => putAggregate({ aggregate, expectedRevision, rows }), home, seams, writes: true }),
    putMeta: ({ document, expectedRevision, home }) =>
      withRows({ body: (rows) => putMetaDocument({ document, expectedRevision, rows }), home, seams, writes: true }),
    read: ({ home }) =>
      withRows({
        body: async (rows) => {
          const read = await rows.readAll();
          if (read.isErr()) {
            return err(read.error);
          }
          return assembleWorkstreamRegister({ rows: read.value }).mapErr((problems) =>
            WorkstreamStoreErrors.storedInvalid({ problems }),
          );
        },
        home,
        seams,
        writes: false,
      }),
    remove: ({ expectedRevision, home, workstreamId }) =>
      withRows({
        body: async (rows) => {
          const judged = judgeRemove({ expectedRevision, workstreamId });
          if (judged.isErr()) {
            return err(WorkstreamStoreErrors.invalid({ problems: judged.error }));
          }
          const deleted = await rows.deleteWorkstream({ expectedRevision, workstreamId });
          if (deleted.isErr()) {
            return err(deleted.error);
          }
          const outcome = deleted.value;
          if (outcome.kind === "conflict") {
            return err(WorkstreamStoreErrors.conflict({ expectedRevision, workstreamId }));
          }
          if (outcome.kind === "referenced") {
            return err(WorkstreamStoreErrors.referenced({ referencedBy: outcome.referencedBy, workstreamId }));
          }
          return ok(undefined);
        },
        home,
        seams,
        writes: true,
      }),
  };
}
