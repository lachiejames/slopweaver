/**
 * The fleet import's failures about a legacy LEDGER line the store already disagrees with, or will not hold.
 *
 * Split out of {@link ./errors.js} (the file-size ratchet) along that seam, and still ONE domain: these variants
 * are members of `FleetImportError`, and their factories are spread into `FleetImportErrors`, so no caller names
 * this module. What they share is that each one leaves the stored row standing and the file on disk unchanged —
 * the difference is named for the operator to look at, never reconciled by the import.
 */

/**
 * A legacy fallback document whose text differs from the row the store already holds under its id. The row is
 * the authority and is never overwritten; the leg says so and exits non-zero so the difference is looked at.
 */
export interface FallbackImportDivergedError {
  readonly code: "FALLBACK_IMPORT_DIVERGED";
  readonly message: string;
  readonly document: "request" | "receipt";
  readonly path: string;
  readonly requestId: string;
}

/** A legacy grant journal line that disagrees with the `grant_row` the store already holds for it. */
export interface GrantImportDivergedError {
  readonly code: "GRANT_IMPORT_DIVERGED";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
  readonly grantId: string;
}

/** A legacy autonomy register line that disagrees with the `autonomy_event` the store already holds for it. */
export interface AutonomyImportDivergedError {
  readonly code: "AUTONOMY_IMPORT_DIVERGED";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
  readonly actionId: string;
}

/**
 * A legacy autonomy register line the record rules refuse, or the store cannot hold verbatim. The import never
 * repairs one and never marks the register imported past one: `slopweaver autonomy adopt` is the repair.
 */
export interface AutonomyLineRefusedError {
  readonly code: "AUTONOMY_LINE_REFUSED";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
}

/**
 * A legacy door ledger line the store will not take as the verbatim record, or a disagreement between the file and
 * `door_event` the read-back found: a line with no row, a row with no line, or a row whose record differs. Never
 * reconciled by the import; the ledger stays refused until a clean pass.
 */
export interface DoorImportDivergedError {
  readonly code: "DOOR_IMPORT_DIVERGED";
  readonly message: string;
  readonly path: string;
  readonly importKey: string;
}

/** The factories for the ledger-line failures, spread into `FleetImportErrors` so callers build every failure through one object. */
export const LedgerImportErrors = {
  doorImportDiverged: ({
    importKey,
    path,
    why,
  }: {
    importKey: string;
    path: string;
    why: string;
  }): DoorImportDivergedError => ({
    code: "DOOR_IMPORT_DIVERGED",
    importKey,
    message: `${path} and door_event disagree at ${importKey}: ${why}; nothing was overwritten`,
    path,
  }),
  doorLineUnstorable: ({
    importKey,
    lineNumber,
    path,
    why,
  }: {
    importKey: string;
    lineNumber: number;
    path: string;
    why: string;
  }): DoorImportDivergedError => ({
    code: "DOOR_IMPORT_DIVERGED",
    importKey,
    message: `${path}:${String(lineNumber)} cannot be stored as the door's verbatim record: ${why}; nothing was written`,
    path,
  }),
  fallbackImportDiverged: ({
    document,
    path,
    requestId,
  }: {
    document: "request" | "receipt";
    path: string;
    requestId: string;
  }): FallbackImportDivergedError => ({
    code: "FALLBACK_IMPORT_DIVERGED",
    document,
    message: `${path}'s ${document} differs from the stored ${document} for ${requestId}; the stored row stands and was not overwritten`,
    path,
    requestId,
  }),
  autonomyImportDiverged: ({
    actionId,
    entryKind,
    lineNumber,
    path,
  }: {
    actionId: string;
    entryKind: string;
    lineNumber: number;
    path: string;
  }): AutonomyImportDivergedError => ({
    actionId,
    code: "AUTONOMY_IMPORT_DIVERGED",
    lineNumber,
    message: `${path}:${String(lineNumber)} differs from the stored ${entryKind} for act ${actionId}; the stored row stands and was not overwritten`,
    path,
  }),
  autonomyLineRefused: ({
    lineNumber,
    path,
    why,
  }: {
    lineNumber: number;
    path: string;
    why: string;
  }): AutonomyLineRefusedError => ({
    code: "AUTONOMY_LINE_REFUSED",
    lineNumber,
    message: `${path}:${String(lineNumber)} is not a record the ledger can hold (${why}) — repair it with \`slopweaver autonomy adopt\`, then import again`,
    path,
  }),
  grantImportDiverged: ({
    entryKind,
    grantId,
    lineNumber,
    path,
  }: {
    entryKind: string;
    grantId: string;
    lineNumber: number;
    path: string;
  }): GrantImportDivergedError => ({
    code: "GRANT_IMPORT_DIVERGED",
    grantId,
    lineNumber,
    message: `${path}:${String(lineNumber)} differs from the stored ${entryKind} for grant ${grantId}; the stored row stands and was not overwritten`,
    path,
  }),
} as const;
