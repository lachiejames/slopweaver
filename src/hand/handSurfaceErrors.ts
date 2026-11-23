/**
 * The hand-step failures of the surfaces and ledgers around the register: a machine that cannot raise a floating
 * note or a notification, a note or notification macOS would not take, the Later ledger and the snooze store
 * failing, and a snooze marker with no wake time this register can trust.
 *
 * `./errors.ts` composes this sub-union with the posting and register groups into the one `HandStepError`, and
 * spreads this factory into the one `HandStepErrors`. A new surface, platform or ledger failure goes here.
 */

/**
 * This machine cannot raise a floating note or post a notification, which is a FACT rather than a fault.
 *
 * Its own kind because the caller branches: every surfacing verb reports it and exits 0, the way
 * `../browser/foreground.ts` leaves the foreground alone on a platform it cannot read.
 */
export interface NotThisPlatformError {
  readonly code: "NOT_THIS_PLATFORM";
  readonly message: string;
  readonly platform: string;
}

/** The note or the notification could not be handed to macOS. The step itself is still recorded. */
export interface SurfaceFailedError {
  readonly code: "SURFACE_FAILED";
  readonly message: string;
  /** `note` or `notification` — which of the two surfaces did not come up. */
  readonly surface: string;
  readonly cause?: unknown;
}

/** The owner's Later press could not be written to the Later ledger, or the ledger would not read. */
export interface LaterLedgerError {
  readonly code: "LATER_LEDGER";
  readonly message: string;
  readonly path: string;
  readonly cause: string;
}

/** The owner's snooze could not be written to the snooze store, or a record in it would not read. */
export interface SnoozeStoreError {
  readonly code: "SNOOZE_STORE";
  readonly message: string;
  readonly path: string;
  readonly cause: string;
}

/** A snooze marker whose answer or press instant is not one this register can turn into a wake time. */
export interface InvalidSnoozeError {
  readonly code: "INVALID_SNOOZE";
  readonly message: string;
  /** The step the marker names. */
  readonly id: string;
  readonly why: string;
}

/** Every failure of the hand-step surfaces and the ledgers beside the register. */
export type HandSurfaceError =
  NotThisPlatformError | SurfaceFailedError | LaterLedgerError | SnoozeStoreError | InvalidSnoozeError;

/** Constructors for {@link HandSurfaceError}, spread into `HandStepErrors` by `./errors.ts`. */
export const HandSurfaceErrors = {
  notThisPlatform: ({ platform }: { platform: string }): NotThisPlatformError => ({
    code: "NOT_THIS_PLATFORM",
    message:
      `a floating note and a notification are macOS surfaces, and this is ${platform} — the step is still ` +
      "recorded, and `slopweaver hand list` reads it",
    platform,
  }),
  surfaceFailed: ({ surface, cause }: { surface: string; cause: unknown }): SurfaceFailedError => ({
    cause,
    code: "SURFACE_FAILED",
    message: `the ${surface} could not be raised — the step is still recorded and nothing was lost`,
    surface,
  }),
  laterLedger: ({ path, cause }: { path: string; cause: string }): LaterLedgerError => ({
    cause,
    code: "LATER_LEDGER",
    message: `the Later ledger at ${path} failed: ${cause}`,
    path,
  }),
  snoozeStore: ({ path, cause }: { path: string; cause: string }): SnoozeStoreError => ({
    cause,
    code: "SNOOZE_STORE",
    message: `the snooze store at ${path} failed: ${cause} — refusing rather than reading the step as awake`,
    path,
  }),
  invalidSnooze: ({ id, why }: { id: string; why: string }): InvalidSnoozeError => ({
    code: "INVALID_SNOOZE",
    id,
    message: `the snooze on ${id} has no wake time this register can trust: ${why}`,
    why,
  }),
} as const;
