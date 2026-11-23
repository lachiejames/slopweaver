/**
 * The typed domain errors for the GCP door — see `.claude/rules/error-handling.md` for the shape.
 *
 * One union for the whole door, because every variant is a reason ONE `slopweaver gcp` invocation stopped: an
 * argument it cannot act on, a request the closed builder refused, a call Google did not answer or answered in a
 * shape this version does not read, a write that would edit something that already exists, a long-running
 * operation that failed or is still running, a secret that failed its integrity check or could not be written
 * locally, and a multi-step write that stopped part way. A message never carries a secret's bytes.
 */

/** An invocation argument is not one the door can act on. */
export interface GcpInputInvalidError {
  readonly code: "INPUT_INVALID";
  readonly message: string;
}

/** A request was refused before any network call: a name or value the builder never puts in a URL or body. */
export interface GcpRequestRefusedError {
  readonly code: "REQUEST_REFUSED";
  readonly message: string;
  readonly what: string;
}

/** Google answered 404 for the resource read — a state the planner branches on, not a fault. */
export interface GcpNotFoundError {
  readonly code: "NOT_FOUND";
  readonly message: string;
  readonly operation: string;
}

/** Google did not answer, or refused; `status` is its HTTP status, or null when the call never reached it. */
export interface GcpTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly operation: string;
  readonly status: number | null;
}

/** Google answered a shape this version does not read. */
export interface GcpResponseChangedError {
  readonly code: "RESPONSE_CHANGED";
  readonly message: string;
  readonly endpoint: string;
}

/** The write would edit something that already exists, and no `--edit-existing` reason was given. */
export interface GcpEditExistingRefusedError {
  readonly code: "EDIT_EXISTING_REFUSED";
  readonly message: string;
  /** The four register lines, rendered by `hatchRefusalLines`. */
  readonly lines: readonly string[];
}

/** What was asked for is already true, so there is nothing to write. */
export interface GcpNoChangeError {
  readonly code: "NO_CHANGE";
  readonly message: string;
}

/** A long-running operation finished with an error. */
export interface GcpOperationFailedError {
  readonly code: "OPERATION_FAILED";
  readonly message: string;
  readonly operation: string;
}

/** A long-running operation was still running when the wait ended; re-reading it is safe, re-sending is not. */
export interface GcpOperationDeferredError {
  readonly code: "OPERATION_DEFERRED";
  readonly message: string;
  readonly operation: string;
}

/** A secret payload failed its checksum, decoding or size check. Never carries the bytes. */
export interface GcpSecretIntegrityError {
  readonly code: "SECRET_INTEGRITY_FAILED";
  readonly message: string;
}

/** A secret could not be read from, or written to, a local file. */
export interface GcpSecretFileError {
  readonly code: "SECRET_FILE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** A multi-step write stopped after some steps had already been performed; nothing is rolled back. */
export interface GcpPartialWriteError {
  readonly code: "PARTIAL_WRITE";
  readonly message: string;
  readonly done: readonly string[];
}

/** Every failure the GCP door produces. */
export type GcpDoorError =
  | GcpInputInvalidError
  | GcpRequestRefusedError
  | GcpNotFoundError
  | GcpTransportFailedError
  | GcpResponseChangedError
  | GcpEditExistingRefusedError
  | GcpNoChangeError
  | GcpOperationFailedError
  | GcpOperationDeferredError
  | GcpSecretIntegrityError
  | GcpSecretFileError
  | GcpPartialWriteError;

/** Factories for {@link GcpDoorError}: the one place each message is worded. */
export const GcpDoorErrors = {
  editExistingRefused: ({ lines }: { lines: readonly string[] }): GcpEditExistingRefusedError => ({
    code: "EDIT_EXISTING_REFUSED",
    lines,
    message: lines.join("\n"),
  }),
  inputInvalid: ({ why }: { why: string }): GcpInputInvalidError => ({ code: "INPUT_INVALID", message: why }),
  noChange: ({ what }: { what: string }): GcpNoChangeError => ({
    code: "NO_CHANGE",
    message: `nothing to write: ${what}`,
  }),
  notFound: ({ operation }: { operation: string }): GcpNotFoundError => ({
    code: "NOT_FOUND",
    message: `${operation}: Google answered 404 — the resource does not exist`,
    operation,
  }),
  operationDeferred: ({ operation }: { operation: string }): GcpOperationDeferredError => ({
    code: "OPERATION_DEFERRED",
    message:
      `operation ${operation} was still running when the wait ended — the write was sent and must NOT be re-sent; ` +
      "read the resource again to see whether it took",
    operation,
  }),
  operationFailed: ({ operation, detail }: { operation: string; detail: string }): GcpOperationFailedError => ({
    code: "OPERATION_FAILED",
    message: `operation ${operation} failed: ${detail}`,
    operation,
  }),
  partialWrite: ({
    done,
    failed,
    cause,
  }: {
    done: readonly string[];
    failed: string;
    cause: string;
  }): GcpPartialWriteError => ({
    code: "PARTIAL_WRITE",
    done,
    message:
      `stopped at step ${failed} after ${done.length === 0 ? "no step" : done.join(", ")} had been performed — ` +
      `nothing was rolled back: ${cause}`,
  }),
  requestRefused: ({ what, why }: { what: string; why: string }): GcpRequestRefusedError => ({
    code: "REQUEST_REFUSED",
    message: `refused to build a request for ${what}: ${why}`,
    what,
  }),
  responseChanged: ({ endpoint, detail }: { endpoint: string; detail: string }): GcpResponseChangedError => ({
    code: "RESPONSE_CHANGED",
    endpoint,
    message: `${endpoint} answered a shape this version does not read: ${detail}`,
  }),
  secretFile: ({ path, why }: { path: string; why: string }): GcpSecretFileError => ({
    code: "SECRET_FILE_FAILED",
    message: `${path}: ${why}`,
    path,
  }),
  secretIntegrity: ({ why }: { why: string }): GcpSecretIntegrityError => ({
    code: "SECRET_INTEGRITY_FAILED",
    message: `secret payload refused: ${why}`,
  }),
  transportFailed: ({
    operation,
    status,
    detail,
  }: {
    operation: string;
    status: number | null;
    detail: string;
  }): GcpTransportFailedError => ({
    code: "TRANSPORT_FAILED",
    message: `${operation} failed${status === null ? "" : ` (HTTP ${String(status)})`}: ${detail}`,
    operation,
    status,
  }),
} as const;
