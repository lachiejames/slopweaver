/**
 * The WorkOS atlas's own typed failures.
 *
 * A discriminated union scoped to this one bounded module, per `.claude/rules/error-handling.md`: every
 * variant is `{ code, message, ...domain fields }`, `code` is what a caller branches on and `message` is
 * what it displays. There is no shared base type with any other atlas — a similarity of shape between this
 * union and Hive's is a coincidence, not a reason to merge them.
 *
 * ## Why a union here rather than the default `readonly string[]`
 *
 * The callers genuinely branch, and this atlas branches on one thing no other does. A missing API key is an
 * ORDINARY state that still leaves the run's most valuable half intact — the route map needs no credential
 * — so `syncCoverage.ts` builds a `not-configured` cell for the content surface, a `synced` cell for the route
 * surface, and `sync.ts` exits 0. A transport failure is different: it means the route map itself could not be
 * built, so the surface that is normally filled becomes `unreadable` and the run exits non-zero. A
 * `ORACLE_UNTRUSTWORTHY` failure is different again, and is the one worth naming: the probe reached WorkOS
 * and the control path did NOT come back absent, which means every verdict in the run is unclassifiable
 * rather than merely unavailable. Reporting that as a transport failure would invite a retry; reporting it
 * as "no routes found" would publish an empty map and call it synced.
 */

/** No WorkOS API key is configured anywhere this atlas looks. */
export interface WorkosCredentialMissingError {
  readonly code: "CREDENTIAL_MISSING";
  readonly message: string;
  /** Every place that was checked, in the order they were checked, so a reader can fix the right one. */
  readonly checked: readonly string[];
}

/** The key file exists but could not be read, or holds nothing usable. */
export interface WorkosCredentialUnreadableError {
  readonly code: "CREDENTIAL_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The request never completed — DNS, TLS, a timeout, a dropped socket. */
export interface WorkosTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly endpoint: string;
  readonly cause?: unknown;
}

/**
 * The endpoint answered with a status this atlas cannot turn into a fact about the tenant.
 *
 * The `body` is carried because on this API the status alone does not say what went wrong: a `400` from a
 * listing that wanted a filter and a `400` from a malformed cursor are the same number, and WorkOS puts
 * the difference in the body it already sent. It is a BOUNDED slice rather than the whole payload — see
 * `client.ts`'s `WORKOS_ERROR_BODY_LIMIT`.
 */
export interface WorkosHttpStatusError {
  readonly code: "HTTP_STATUS";
  readonly message: string;
  readonly endpoint: string;
  readonly statusCode: number;
  /** A bounded slice of what the endpoint answered with, or `""` when it sent nothing. */
  readonly body: string;
}

/**
 * An authenticated 200 arrived and its body is not the shape this atlas reads — not JSON, or a key WorkOS
 * added, dropped or renamed. The message is the strict boundary's own, naming the key and never a value.
 */
export interface WorkosResponseChangedError {
  readonly code: "RESPONSE_CHANGED";
  readonly message: string;
}

/**
 * The control path did not answer `absent`, so no verdict in this run can be trusted.
 *
 * See `routeCandidates.ts` on why a control is probed at all: the route map's entire value rests on
 * `absent` meaning something, and a server that stopped distinguishing a missing route would otherwise fill
 * the atlas with routes that do not exist.
 */
export interface WorkosOracleUntrustworthyError {
  readonly code: "ORACLE_UNTRUSTWORTHY";
  readonly message: string;
  /** The control path that was probed. */
  readonly controlPath: string;
  /** What the control answered instead of proving itself absent. */
  readonly observedVerdict: string;
}

export type WorkosApiError =
  | WorkosCredentialMissingError
  | WorkosCredentialUnreadableError
  | WorkosTransportFailedError
  | WorkosHttpStatusError
  | WorkosResponseChangedError
  | WorkosOracleUntrustworthyError;

/** Construct one of this atlas's typed failures. The real code calls these, so a test should too. */
export const WorkosApiErrors = {
  credentialMissing: ({ checked }: { checked: readonly string[] }): WorkosCredentialMissingError => ({
    checked: [...checked],
    code: "CREDENTIAL_MISSING",
    message:
      "no WorkOS API key is configured — checked " +
      checked.join(", ") +
      ". Mint one in the dashboard under API Keys for the environment you want mapped, then run: " +
      "slopweaver secrets set workos-api-key",
  }),
  credentialUnreadable: ({ path, reason }: { path: string; reason: string }): WorkosCredentialUnreadableError => ({
    code: "CREDENTIAL_UNREADABLE",
    message: `could not read the WorkOS API key at ${path}: ${reason}`,
    path,
  }),
  httpStatus: ({
    endpoint,
    statusCode,
    body,
  }: {
    endpoint: string;
    statusCode: number;
    body: string;
  }): WorkosHttpStatusError => ({
    body,
    code: "HTTP_STATUS",
    endpoint,
    message:
      body.length === 0
        ? `${endpoint} answered HTTP ${String(statusCode)} with an empty body`
        : `${endpoint} answered HTTP ${String(statusCode)}: ${body}`,
    statusCode,
  }),
  oracleUntrustworthy: ({
    controlPath,
    observedVerdict,
  }: {
    controlPath: string;
    observedVerdict: string;
  }): WorkosOracleUntrustworthyError => ({
    code: "ORACLE_UNTRUSTWORTHY",
    controlPath,
    message:
      `the control path ${controlPath} answered "${observedVerdict}" rather than proving itself absent, so ` +
      "no route verdict in this run can be trusted — WorkOS has changed how it answers an unrouted path, " +
      "and `src/atlas/workos/routeProbe.ts` needs re-measuring against the running server",
    observedVerdict,
  }),
  responseChanged: ({ message }: { message: string }): WorkosResponseChangedError => ({
    code: "RESPONSE_CHANGED",
    message,
  }),
  transportFailed: ({ endpoint, cause }: { endpoint: string; cause: unknown }): WorkosTransportFailedError => ({
    cause,
    code: "TRANSPORT_FAILED",
    endpoint,
    message: `could not reach ${endpoint}: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;

/**
 * Whether this failure means "nothing is configured" rather than "something is broken".
 *
 * The distinction decides a coverage state and an exit code, so it is a function rather than a comparison
 * repeated at each call site — see this file's header.
 *
 * @param error the failure to classify
 * @returns `true` when the atlas is unconfigured rather than unreadable
 */
export function isWorkosCredentialGap({ error }: { error: WorkosApiError }): boolean {
  return error.code === "CREDENTIAL_MISSING";
}
