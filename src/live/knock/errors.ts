/**
 * The typed domain errors for the Knock read door — see `.claude/rules/error-handling.md` for the shape.
 *
 * One union: what this door refuses before a read (no key, an unreadable one, a URL outside the closed call list)
 * and what a read that was sent comes back as. No message here ever carries the key, a user id, a cursor, a filter
 * or a response body: a Knock path can hold a person's user id, so a refusal names the OPERATION, never the URL.
 */

/** No Knock secret key is in the secrets store. */
export interface KnockTokenMissingError {
  readonly code: "TOKEN_MISSING";
  readonly message: string;
}

/** The key file is present and could not be used: its mode, its kind, or its shape. */
export interface KnockCredentialUnreadableError {
  readonly code: "CREDENTIAL_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A URL or an id is not one the closed call list builds — refused before the key leaves the process. */
export interface KnockUrlRefusedError {
  readonly code: "URL_REFUSED";
  readonly message: string;
  readonly operation: string;
}

/** The GET did not answer 2xx; `status` is Knock's HTTP status, or `null` when it never answered. */
export interface KnockTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly operation: string;
  readonly status: number | null;
}

/** Knock answered 2xx with a body this door's strict boundary will not read — a fault, never an empty result. */
export interface KnockResponseRefusedError {
  readonly code: "RESPONSE_REFUSED";
  readonly message: string;
  readonly endpoint: string;
}

/** A paged read stopped because continuing would loop or pass the page ceiling. */
export interface KnockPaginationRefusedError {
  readonly code: "PAGINATION_REFUSED";
  readonly message: string;
}

/** Every failure this door produces. */
export type KnockReadError =
  | KnockTokenMissingError
  | KnockCredentialUnreadableError
  | KnockUrlRefusedError
  | KnockTransportFailedError
  | KnockResponseRefusedError
  | KnockPaginationRefusedError;

/**
 * The one step only the owner can take when no key is stored. Knock mints no read-only key: a secret key can make
 * any API request, so the GET-only transport is what bounds this door, and the key belongs in the production
 * environment the investigations are about.
 *
 * @internal
 */
export const KNOCK_KEY_HAND_STEP =
  "In dashboard.knock.app → your Knock account → Developers → API keys, copy the PRODUCTION environment's secret key " +
  "(`sk_…`), then run `slopweaver secrets set knock-api-key`, then `slopweaver knock verify`";

/** How to raise each {@link KnockReadError} — the factory the real code and its tests both call. */
export const KnockReadErrors = {
  credentialUnreadable: ({ path, reason }: { path: string; reason: string }): KnockCredentialUnreadableError => ({
    code: "CREDENTIAL_UNREADABLE",
    message: `${path} is present and could not be used: ${reason}`,
    path,
  }),
  paginationRefused: ({ why }: { why: string }): KnockPaginationRefusedError => ({
    code: "PAGINATION_REFUSED",
    message: `stopped paging Knock: ${why}`,
  }),
  responseRefused: ({ endpoint, why }: { endpoint: string; why: string }): KnockResponseRefusedError => ({
    code: "RESPONSE_REFUSED",
    endpoint,
    message: `${endpoint} answered a body this door will not read — refused, NOT an empty result: ${why}`,
  }),
  tokenMissing: (): KnockTokenMissingError => ({
    code: "TOKEN_MISSING",
    message: `no Knock secret key is configured (missing knock-api-key in $SLOPWEAVER_HOME/secrets). ${KNOCK_KEY_HAND_STEP}`,
  }),
  transportFailed: ({
    operation,
    status,
  }: {
    operation: string;
    status: number | null;
  }): KnockTransportFailedError => ({
    code: "TRANSPORT_FAILED",
    message:
      status === null
        ? `${operation} failed before Knock answered (network, timeout or a redirect this door refuses)`
        : `Knock answered ${String(status)} to ${operation}`,
    operation,
    status,
  }),
  urlRefused: ({ operation, why }: { operation: string; why: string }): KnockUrlRefusedError => ({
    code: "URL_REFUSED",
    message: `refused ${operation}: ${why}`,
    operation,
  }),
} as const;
