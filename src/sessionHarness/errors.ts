/**
 * The session-harness domain's typed errors. An implementation maps its own transport's failures into this
 * union at its boundary (`./cmuxSession.ts`), keeping the original message so a verb's stderr reads the same
 * whichever harness answered.
 */
import type { CodexQuotaKind } from "../codex/quotaTypes.js";
import type { SessionDelivery } from "./sessionHarness.js";

/** The contract operation a failure came from. */
export type SessionHarnessOperation = "list" | "resolve" | "message" | "interrupt" | "close" | "park" | "press-stop";

/** A handle that names no session the harness can reach today. */
export interface SessionNotFoundError {
  readonly code: "SESSION_NOT_FOUND";
  readonly message: string;
  readonly handle: string;
}

/** A delivery this implementation cannot honour, refused before anything reached the session. */
export interface SessionDeliveryUnsupportedError {
  readonly code: "DELIVERY_UNSUPPORTED";
  readonly message: string;
  readonly delivery: SessionDelivery;
  readonly implementation: string;
}

/** The harness itself could not be reached at all. */
export interface SessionHarnessUnavailableError {
  readonly code: "HARNESS_UNAVAILABLE";
  readonly message: string;
  readonly operation: SessionHarnessOperation;
  readonly causeCode: string;
  /**
   * The harness answered and refused THIS process access, as opposed to not answering at all — cmux's refusal of a
   * process it did not start. A sender reports the two differently, so the distinction survives the seam.
   */
  readonly accessDenied?: true;
}

/** The harness was reached and the operation failed. */
export interface SessionHarnessOperationFailedError {
  readonly code: "HARNESS_OPERATION_FAILED";
  readonly message: string;
  readonly operation: SessionHarnessOperation;
  readonly causeCode: string;
}

/** Which launch act a call is — the ledger's `openedBy`. */
export type HarnessLaunchOperation = "open" | "resume";

/** The address a failed launch left behind, as far as the host named it. */
export interface HarnessLaunchAddress {
  readonly handle: string;
  readonly endpointHandle: string;
  /** Absent when the host failed before naming the session's id. */
  readonly sessionId?: string;
}

/**
 * A launch that could not finish — its own shape rather than a member of {@link SessionHarnessError}, because a
 * caller decides materially different things from what it left: a session left holding its initial message must
 * be neither closed nor relaunched beside, and an exhausted Codex seat is closed and recorded.
 */
export interface SessionLaunchFailedError {
  readonly code: "SESSION_LAUNCH_FAILED";
  readonly message: string;
  readonly operation: HarnessLaunchOperation;
  /** What the failure left addressed — absent when nothing was opened at all. */
  readonly opened?: HarnessLaunchAddress;
  /** A Codex usage-exhaustion banner caught right after the initial message: booted, cannot respond. */
  readonly quotaKind?: CodexQuotaKind;
  /** The initial message was sent and is still typed in the input: the session is open and holds it. */
  readonly initialMessageStranded?: true;
  /** The initial message was sent and nothing saw it submitted: the session is open and holds whatever happened. */
  readonly initialMessageUnproven?: true;
  /** What it left open is the session its open ledger row already records, continued, so that row moves. */
  readonly resumed?: true;
}

/** Every way a session-harness operation can fail. */
export type SessionHarnessError =
  | SessionNotFoundError
  | SessionDeliveryUnsupportedError
  | SessionHarnessUnavailableError
  | SessionHarnessOperationFailedError;

/** The factory every producer of a {@link SessionHarnessError} constructs through — tests included. */
export const SessionHarnessErrors = {
  deliveryUnsupported: ({
    delivery,
    implementation,
    why,
  }: {
    delivery: SessionDelivery;
    implementation: string;
    why: string;
  }): SessionDeliveryUnsupportedError => ({
    code: "DELIVERY_UNSUPPORTED",
    delivery,
    implementation,
    message: `the ${implementation} session harness cannot honour delivery "${delivery}": ${why}; nothing was sent`,
  }),
  launchFailed: ({
    operation,
    message,
    opened,
    quotaKind,
    initialMessageStranded,
    initialMessageUnproven,
    resumed,
  }: {
    operation: HarnessLaunchOperation;
    message: string;
    opened?: HarnessLaunchAddress | undefined;
    quotaKind?: CodexQuotaKind | undefined;
    initialMessageStranded?: true | undefined;
    initialMessageUnproven?: true | undefined;
    resumed?: true | undefined;
  }): SessionLaunchFailedError => ({
    code: "SESSION_LAUNCH_FAILED",
    message,
    operation,
    ...(opened === undefined ? {} : { opened }),
    ...(quotaKind === undefined ? {} : { quotaKind }),
    ...(initialMessageStranded === undefined ? {} : { initialMessageStranded }),
    ...(initialMessageUnproven === undefined ? {} : { initialMessageUnproven }),
    ...(resumed === undefined ? {} : { resumed }),
  }),
  operationFailed: ({
    operation,
    causeCode,
    message,
  }: {
    operation: SessionHarnessOperation;
    causeCode: string;
    message: string;
  }): SessionHarnessOperationFailedError => ({ causeCode, code: "HARNESS_OPERATION_FAILED", message, operation }),
  sessionNotFound: ({ handle, message }: { handle: string; message: string }): SessionNotFoundError => ({
    code: "SESSION_NOT_FOUND",
    handle,
    message,
  }),
  unavailable: ({
    operation,
    causeCode,
    message,
    accessDenied,
  }: {
    operation: SessionHarnessOperation;
    causeCode: string;
    message: string;
    accessDenied?: true | undefined;
  }): SessionHarnessUnavailableError => ({
    ...(accessDenied === undefined ? {} : { accessDenied }),
    causeCode,
    code: "HARNESS_UNAVAILABLE",
    message,
    operation,
  }),
} as const;
