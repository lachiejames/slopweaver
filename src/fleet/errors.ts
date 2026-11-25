/**
 * Why a fleet verb could not produce its answer — the fleet domain's one discriminated union and its factory.
 *
 * A REFUSAL recovery recorded is not here: that is data the page renders (`./refusals.ts`). This is the verb
 * itself failing — a configuration it will not guess past, a journal it cannot write, a lock another pass holds.
 */

/** A capacity setting — the legacy `fleet/config.json` being imported, or a stored row — is not a valid one. */
export interface FleetConfigInvalidError {
  readonly code: "CONFIG_INVALID";
  readonly message: string;
}
/** A file the verb must read or write could not be. */
export interface FleetIoError {
  readonly code: "IO_FAILED";
  readonly message: string;
  readonly path: string;
}
/** Another recovery pass holds the lock, or the lock could not be taken. */
export interface FleetLockHeldError {
  readonly code: "LOCK_HELD";
  readonly message: string;
  /** The lock's own refusal: the holder's pid and age, or the filesystem fault. */
  readonly detail: string;
}
/** `supervisor reoriented` was run by something that is not the chair the attempt is waiting on. */
export interface FleetReorientationRefusedError {
  readonly code: "REORIENTATION_REFUSED";
  readonly message: string;
}

/** A cmux inside-call stamp was asked to carry something that is not an ISO instant. */
export interface FleetStampInvalidError {
  readonly code: "STAMP_INVALID";
  readonly message: string;
}

/**
 * The store holding the fleet's configuration and journals could not be opened or answered. Never a file fallback:
 * the rows are the authority, so with the store down what the fleet holds is unknown.
 */
export interface FleetStoreUnavailableError {
  readonly code: "STORE_UNAVAILABLE";
  readonly message: string;
}

/** The capacity setting changed between this write's read and its compare-and-set, so nothing was written. */
export interface FleetConfigConflictError {
  readonly code: "CONFIG_CONFLICT";
  readonly message: string;
  readonly expectedRevision: number;
}

/** A stored configuration row does not decode — a row a newer checkout wrote, or one written past the port. */
export interface FleetStoredInvalidError {
  readonly code: "STORED_INVALID";
  readonly message: string;
}

/** The home's runtime directory, where the locks and inside-call stamps live, could not be made or trusted. */
export interface FleetRuntimeUnavailableError {
  readonly code: "RUNTIME_UNAVAILABLE";
  readonly message: string;
}

/** A hop on the way to a Recovery check's scratch directory is a link, so nothing was made or removed through it. */
export interface FleetScratchLinkedError {
  readonly code: "SCRATCH_LINKED";
  readonly message: string;
  readonly path: string;
}

/** The desktop app answered a request with a reply of another kind, so what it holds was not read. */
export interface FleetAppAnswerUnexpectedError {
  readonly code: "APP_ANSWER_UNEXPECTED";
  readonly message: string;
  /** The kind of reply that came back. */
  readonly kind: string;
}

/** Why a fleet verb could not answer. */
export type FleetError =
  | FleetAppAnswerUnexpectedError
  | FleetConfigConflictError
  | FleetConfigInvalidError
  | FleetIoError
  | FleetLockHeldError
  | FleetReorientationRefusedError
  | FleetRuntimeUnavailableError
  | FleetScratchLinkedError
  | FleetStampInvalidError
  | FleetStoreUnavailableError
  | FleetStoredInvalidError;

/** The {@link FleetError} factory. */
export const FleetErrors = {
  appAnswerUnexpected: ({ kind, request }: { kind: string; request: string }): FleetAppAnswerUnexpectedError => ({
    code: "APP_ANSWER_UNEXPECTED",
    kind,
    message: `the desktop app answered ${request} with ${kind}, so what it holds was not read`,
  }),
  configConflict: ({ expectedRevision }: { expectedRevision: number }): FleetConfigConflictError => ({
    code: "CONFIG_CONFLICT",
    expectedRevision,
    message:
      `the fleet's capacity changed while this write was being made (it was read at revision ` +
      `${String(expectedRevision)}), so nothing was written — read it with \`slopweaver fleet health\` and decide again`,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): FleetStoreUnavailableError => ({
    code: "STORE_UNAVAILABLE",
    message:
      `the fleet's configuration and journals live in the store, and the store could not ${doing}, so what the ` +
      `fleet holds is UNKNOWN — refusing rather than reading a file that stopped being the authority ` +
      `(\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
  storedInvalid: ({ why }: { why: string }): FleetStoredInvalidError => ({
    code: "STORED_INVALID",
    message: `the stored fleet configuration does not decode (${why}) — rewrite it with \`slopweaver fleet configure --capacity <n>\``,
  }),
  configInvalid: ({ path, why }: { path: string; why: string }): FleetConfigInvalidError => ({
    code: "CONFIG_INVALID",
    message: `${path} is not a valid fleet configuration (${why}) — fix it or rewrite it with \`slopweaver fleet configure --capacity <n>\``,
  }),
  io: ({ path, cause }: { path: string; cause: unknown }): FleetIoError => ({
    code: "IO_FAILED",
    message: `${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  lockHeld: ({ detail }: { detail: string }): FleetLockHeldError => ({
    code: "LOCK_HELD",
    detail,
    message: `the recovery lock was not free, so this pass touched nothing — its progress is on the sessions page (${detail})`,
  }),
  reorientationRefused: ({ why }: { why: string }): FleetReorientationRefusedError => ({
    code: "REORIENTATION_REFUSED",
    message: `supervisor reoriented: ${why}`,
  }),
  runtimeUnavailable: ({ detail }: { detail: string }): FleetRuntimeUnavailableError => ({
    code: "RUNTIME_UNAVAILABLE",
    message: `nothing was locked or stamped — ${detail}`,
  }),
  scratchLinked: ({ path }: { path: string }): FleetScratchLinkedError => ({
    code: "SCRATCH_LINKED",
    message: `${path} is a link, so the Recovery check neither made nor removed anything through it`,
    path,
  }),
  stampInvalid: ({ atIso }: { atIso: string }): FleetStampInvalidError => ({
    code: "STAMP_INVALID",
    message: `a cmux inside-call stamp must carry an ISO instant, and "${atIso}" is not one — nothing was written`,
  }),
} as const;
