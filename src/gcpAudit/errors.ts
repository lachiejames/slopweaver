/**
 * The typed domain errors for the GCP audit-log reader — see `.claude/rules/error-handling.md` for the shape.
 *
 * One union for the whole reader, because every variant is a reason ONE `google audit-log` invocation stopped:
 * a request the closed transport refused to build, a call Google did not answer, an answer whose shape drifted,
 * a store that could not be read or written, a plan that does not parse. A refusal Google returns for ONE
 * resource (a 403 on a project's logs) is not here: the pull records it in the manifest and carries on.
 */

/** A request was refused before any network call: a host, path, method or parameter the transport never sends. */
export interface GcpAuditRequestRefusedError {
  readonly code: "REQUEST_REFUSED";
  readonly message: string;
  readonly what: string;
}

/** Google did not answer; `status` is its HTTP status, or null when the call never reached it. */
export interface GcpAuditTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly operation: string;
  readonly status: number | null;
}

/** Google answered a shape this version does not read. */
export interface GcpAuditResponseChangedError {
  readonly code: "RESPONSE_CHANGED";
  readonly message: string;
  readonly endpoint: string;
}

/** An invocation argument is not one the reader can act on (a malformed instant, an empty principal list). */
export interface GcpAuditInputInvalidError {
  readonly code: "INPUT_INVALID";
  readonly message: string;
}

/** The local store could not be read or written. */
export interface GcpAuditStoreFailedError {
  readonly code: "STORE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** No completed generation exists to summarise, or the named one is incomplete. */
export interface GcpAuditNoGenerationError {
  readonly code: "NO_GENERATION";
  readonly message: string;
}

/** A plan file does not parse, or names a role the generation never cached. */
export interface GcpAuditPlanInvalidError {
  readonly code: "PLAN_INVALID";
  readonly message: string;
}

/** Every failure the GCP audit-log reader produces. */
export type GcpAuditError =
  | GcpAuditRequestRefusedError
  | GcpAuditTransportFailedError
  | GcpAuditResponseChangedError
  | GcpAuditInputInvalidError
  | GcpAuditStoreFailedError
  | GcpAuditNoGenerationError
  | GcpAuditPlanInvalidError;

/** Factories for every {@link GcpAuditError} variant. */
export const GcpAuditErrors = {
  inputInvalid: ({ why }: { why: string }): GcpAuditInputInvalidError => ({
    code: "INPUT_INVALID",
    message: why,
  }),
  noGeneration: ({ why }: { why: string }): GcpAuditNoGenerationError => ({
    code: "NO_GENERATION",
    message: `no completed audit-log generation to read: ${why}`,
  }),
  planInvalid: ({ why }: { why: string }): GcpAuditPlanInvalidError => ({
    code: "PLAN_INVALID",
    message: `the plan cannot be assessed: ${why}`,
  }),
  requestRefused: ({ what, why }: { what: string; why: string }): GcpAuditRequestRefusedError => ({
    code: "REQUEST_REFUSED",
    message: `refused before sending ${what}: ${why}`,
    what,
  }),
  responseChanged: ({ endpoint, detail }: { endpoint: string; detail: string }): GcpAuditResponseChangedError => ({
    code: "RESPONSE_CHANGED",
    endpoint,
    message: detail,
  }),
  storeFailed: ({ path, detail }: { path: string; detail: string }): GcpAuditStoreFailedError => ({
    code: "STORE_FAILED",
    message: `audit-log store ${path}: ${detail}`,
    path,
  }),
  transportFailed: ({
    operation,
    detail,
    status,
  }: {
    operation: string;
    detail: string;
    status: number | null;
  }): GcpAuditTransportFailedError => ({
    code: "TRANSPORT_FAILED",
    message: `${operation} failed${status === null ? "" : ` (HTTP ${String(status)})`}: ${detail}`,
    operation,
    status,
  }),
} as const;
