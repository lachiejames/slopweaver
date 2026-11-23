/**
 * The typed failures of `supervisor tick-reseal` — the ledger it will not rewrite, the digest that moved, the
 * lock it could not take and the write or read-back that failed.
 *
 * Its own union per `.claude/rules/error-handling.md`, beside `./errors.ts` rather than inside it: those are the
 * readers' and the appender's failures, these are one repair's, and no reader ever branches on one of them.
 */

/** The ledger is absent, unreadable or empty, so there is nothing a reseal can stand on. */
export interface TickResealLedgerUnreadableError {
  readonly code: "LEDGER_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A row carries a defect other than stale stats, or the ledger's order is broken; each reason names its line. */
export interface TickResealLedgerRefusedError {
  readonly code: "LEDGER_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every row's stats already match, so there is nothing to rewrite. */
export interface TickResealNothingToResealError {
  readonly code: "NOTHING_TO_RESEAL";
  readonly message: string;
  readonly path: string;
}

/** The ledger's bytes are not the ones the preview hashed. */
export interface TickResealSourceMovedError {
  readonly code: "SOURCE_MOVED";
  readonly message: string;
  readonly expected: string;
  readonly actual: string;
}

/** Another writer holds the tick ledger's lock. */
export interface TickResealBusyError {
  readonly code: "BUSY";
  readonly message: string;
  readonly why: string;
}

/** A filesystem step of the rewrite failed; `step` names which. */
export interface TickResealWriteFailedError {
  readonly code: "WRITE_FAILED";
  readonly message: string;
  readonly step: string;
  readonly cause: unknown;
}

/** The rewritten ledger did not read back clean through the ordinary reader, so it was not installed. */
export interface TickResealReadBackFailedError {
  readonly code: "READ_BACK_FAILED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every failure `supervisor tick-reseal` authors. */
export type TickResealError =
  | TickResealLedgerUnreadableError
  | TickResealLedgerRefusedError
  | TickResealNothingToResealError
  | TickResealSourceMovedError
  | TickResealBusyError
  | TickResealWriteFailedError
  | TickResealReadBackFailedError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const TickResealErrors = {
  busy: ({ why }: { why: string }): TickResealBusyError => ({
    code: "BUSY",
    message: `the tick ledger's lock is held by another writer, so nothing was written — run it again once that writer finishes (${why})`,
    why,
  }),
  ledgerRefused: ({ reasons }: { reasons: readonly string[] }): TickResealLedgerRefusedError => ({
    code: "LEDGER_REFUSED",
    message: `the ledger carries a defect a reseal does not repair — only stale stats are resealed: ${reasons.join("; ")}`,
    reasons,
  }),
  ledgerUnreadable: ({ path, why }: { path: string; why: string }): TickResealLedgerUnreadableError => ({
    code: "LEDGER_UNREADABLE",
    message: `${path} could not be read for a reseal: ${why}`,
    path,
  }),
  nothingToReseal: ({ path }: { path: string }): TickResealNothingToResealError => ({
    code: "NOTHING_TO_RESEAL",
    message: `every row of ${path} already carries the stats its content measures to — nothing was written`,
    path,
  }),
  readBackFailed: ({ reasons }: { reasons: readonly string[] }): TickResealReadBackFailedError => ({
    code: "READ_BACK_FAILED",
    message: `the rewritten ledger does not read back clean, so it was not installed: ${reasons.join("; ")}`,
    reasons,
  }),
  sourceMoved: ({ expected, actual }: { expected: string; actual: string }): TickResealSourceMovedError => ({
    actual,
    code: "SOURCE_MOVED",
    expected,
    message:
      `the ledger hashes to ${actual}, not the ${expected} the preview read — a row was written since. ` +
      "Run the preview again and apply the digest it prints.",
  }),
  writeFailed: ({ step, cause }: { step: string; cause: unknown }): TickResealWriteFailedError => ({
    cause,
    code: "WRITE_FAILED",
    message: `${step} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    step,
  }),
} as const;
