/**
 * What one pass of `slopweaver fleet recover` does to the world, as the contract `recoveryPass.ts` is driven through:
 * the desktop app (`recoveryHost.ts`), the scratch directories (`recoveryScratch.ts`), routing, the clock and the
 * Recovery lock. Types only, so a test hands a pass plain functions and the CLI hands it the real ones.
 */
import type { Result } from "#lib/result.js";

import type { AppSessionSnapshot } from "../sessionHarness/appProtocol.js";
import type { FleetError } from "./errors.js";
import type { RecoveryCandidate, RecoveryEvidence, RecoveryVendor } from "./recoveryCheck.js";

/** A throwaway session as this pass addresses it. */
export interface RecoverySession {
  readonly sessionId: string;
  readonly handle: string;
}

/** A launch that did not finish, and the session it left standing when it named one. */
export interface RecoveryOpenFailure {
  readonly message: string;
  readonly left?: RecoverySession;
  /** The app never answered the launch, so its card may still open after this failure. */
  readonly unanswered?: true;
}

/** The desktop app, as far as a pass needs it. */
export interface RecoveryHost {
  /**
   * Open one throwaway session and send it its one message.
   *
   * @param options the plan, the directory it runs in, its ledger key, the message and when it was decided
   * @returns the session, or why it did not open and what it left
   */
  readonly open: (options: {
    candidate: RecoveryCandidate;
    directory: string;
    ledgerKey: string;
    prompt: string;
    openedAtIso: string;
  }) => Promise<Result<RecoverySession, RecoveryOpenFailure>>;
  /**
   * Every session the app knows, ended ones included.
   *
   * @returns the snapshots, or why the app could not be asked
   */
  readonly list: () => Promise<Result<readonly AppSessionSnapshot[], string>>;
  /**
   * End one session and its ledger row.
   *
   * @param options the session
   * @returns nothing once it is proven gone, or why that is not known
   */
  readonly close: (options: { session: RecoverySession }) => Promise<Result<void, string>>;
  /**
   * The throwaway sessions the ledger still holds open.
   *
   * @returns the sessions, or why the ledger could not be read
   */
  readonly leftOpen: () => Result<readonly RecoverySession[], string>;
}

/** The directories throwaway sessions run in. */
export interface RecoveryScratch {
  /**
   * Make one attempt's directory.
   *
   * @param options the attempt
   * @returns the directory, or the failure
   */
  readonly make: (options: { attemptId: string }) => Result<string, FleetError>;
  /**
   * Remove every attempt's directory.
   *
   * @returns nothing, or the failure
   */
  readonly clear: () => Result<void, FleetError>;
  /**
   * Whether a directory is one of this home's.
   *
   * @param options the directory
   * @returns true inside this home's scratch
   */
  readonly holds: (options: { directory: string }) => boolean;
}

/** Everything a pass does to the world. */
export interface RecoveryPassDeps {
  readonly host: RecoveryHost;
  readonly scratch: RecoveryScratch;
  /**
   * What routing says about one vendor's plans, read as its turn comes.
   *
   * @param options the vendor
   * @returns the plans to try and the ones passed over
   */
  readonly evidence: (options: { vendor: RecoveryVendor }) => Promise<RecoveryEvidence>;
  /**
   * The clock.
   *
   * @returns epoch milliseconds
   */
  readonly nowMs: () => number;
  /**
   * Wait a moment between two looks at a session.
   *
   * @returns once the moment is over
   */
  readonly pause: () => Promise<void>;
  readonly randomBytes: (size: number) => Buffer;
  /**
   * Whether this pass still holds the Recovery lock.
   *
   * @returns false once another took it
   */
  readonly lockHeld: () => boolean;
}
