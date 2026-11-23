/**
 * The GraphQL Hive atlas's own typed failures.
 *
 * A discriminated union scoped to this one bounded module, per `.claude/rules/error-handling.md`: every
 * variant is `{ code, message, ...domain fields }`, `code` is what a caller branches on and `message` is
 * what it displays. There is no shared base type with any other atlas — a similarity of shape between this
 * union and Cloudflare's is a coincidence, not a reason to merge them.
 *
 * ## Why a union here rather than the default `readonly string[]`
 *
 * The callers genuinely branch. `sync.ts` treats a missing credential completely differently from a
 * transport failure: the first publishes a `not-configured` coverage cell naming exactly what would unblock
 * it and exits 0, while the second publishes an `unreadable` cell and exits non-zero. A verb that could not
 * tell those apart would report a machine with no token configured as a broken registry, which is the
 * failure mode this atlas's whole coverage vocabulary exists to prevent.
 */

/** No registry access token is configured anywhere this atlas looks. */
export interface HiveCredentialMissingError {
  readonly code: "CREDENTIAL_MISSING";
  readonly message: string;
  /** Every place that was checked, in the order they were checked, so a reader can fix the right one. */
  readonly checked: readonly string[];
}

/** The token file exists but could not be read, or holds nothing usable. */
export interface HiveCredentialUnreadableError {
  readonly code: "CREDENTIAL_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The request never completed — DNS, TLS, a timeout, a dropped socket. */
export interface HiveTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly endpoint: string;
  readonly cause?: unknown;
}

/** The endpoint answered, with a status that is not a GraphQL response. */
export interface HiveHttpStatusError {
  readonly code: "HTTP_STATUS";
  readonly message: string;
  readonly endpoint: string;
  readonly statusCode: number;
}

/** The endpoint answered 200 and the body was not the GraphQL envelope this atlas can read. */
export interface HiveMalformedResponseError {
  readonly code: "MALFORMED_RESPONSE";
  readonly message: string;
  readonly endpoint: string;
}

/** The endpoint answered with a GraphQL `errors` array — a provider-shaped false success. */
export interface HiveGraphqlErrorsError {
  readonly code: "GRAPHQL_ERRORS";
  readonly message: string;
  readonly endpoint: string;
  /** Every message the response carried, in order. */
  readonly errors: readonly string[];
}

export type HiveApiError =
  | HiveCredentialMissingError
  | HiveCredentialUnreadableError
  | HiveTransportFailedError
  | HiveHttpStatusError
  | HiveMalformedResponseError
  | HiveGraphqlErrorsError;

/** Construct one of this atlas's typed failures. The real code calls these, so a test should too. */
export const HiveApiErrors = {
  credentialMissing: ({ checked }: { checked: readonly string[] }): HiveCredentialMissingError => ({
    checked: [...checked],
    code: "CREDENTIAL_MISSING",
    message:
      "no GraphQL Hive access token is configured — checked " +
      checked.join(", ") +
      ". Create one in the console under an organisation's Settings → Access Tokens, then run: " +
      "slopweaver secrets set graphql-hive-token",
  }),
  credentialUnreadable: ({ path, reason }: { path: string; reason: string }): HiveCredentialUnreadableError => ({
    code: "CREDENTIAL_UNREADABLE",
    message: `could not read the GraphQL Hive access token at ${path}: ${reason}`,
    path,
  }),
  graphqlErrors: ({ endpoint, errors }: { endpoint: string; errors: readonly string[] }): HiveGraphqlErrorsError => ({
    code: "GRAPHQL_ERRORS",
    endpoint,
    errors: [...errors],
    message: `${endpoint} answered 200 with ${String(errors.length)} GraphQL error(s): ${errors.join("; ")}`,
  }),
  httpStatus: ({ endpoint, statusCode }: { endpoint: string; statusCode: number }): HiveHttpStatusError => ({
    code: "HTTP_STATUS",
    endpoint,
    message: `${endpoint} answered HTTP ${String(statusCode)}`,
    statusCode,
  }),
  malformedResponse: ({ endpoint, reason }: { endpoint: string; reason: string }): HiveMalformedResponseError => ({
    code: "MALFORMED_RESPONSE",
    endpoint,
    message: `${endpoint} answered 200 with a body this atlas cannot read: ${reason}`,
  }),
  transportFailed: ({ endpoint, cause }: { endpoint: string; cause: unknown }): HiveTransportFailedError => ({
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
export function isHiveCredentialGap({ error }: { error: HiveApiError }): boolean {
  return error.code === "CREDENTIAL_MISSING";
}
