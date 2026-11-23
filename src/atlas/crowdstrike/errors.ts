/**
 * The CrowdStrike atlas's own failure kinds.
 *
 * A discriminated union rather than a list of strings because callers genuinely branch on these: a scope
 * refusal becomes `unreadable` coverage naming the scope, a 404 becomes `unavailable` with its ambiguity
 * stated, and a repeated auth failure becomes `invalid-configuration`. Those are three different sentences
 * a reader needs, and collapsing them to a message would make the coverage grader guess by string-matching.
 *
 * The three that matter most are the ones a credential can produce while looking healthy: `SCOPE_REFUSED`
 * is a working token that may not see something, `ROUTE_ABSENT` cannot distinguish a decommissioned
 * endpoint from a product this tenant never bought, and `INCOMPLETE_READ` is the one that must never be
 * treated as an empty result — an empty answer stales stored entities, and a failed read must not.
 */

/** A call refused because the credential lacks the scope. Distinguishable, and quoted verbatim by coverage. */
export interface ScopeRefusedError {
  readonly code: "SCOPE_REFUSED";
  readonly message: string;
  readonly callId: string;
  readonly scope: string | null;
}

/** A 404. Falcon does not say whether the route is gone or the product was never provisioned. */
export interface RouteAbsentError {
  readonly code: "ROUTE_ABSENT";
  readonly message: string;
  readonly callId: string;
}

/** The token could not be minted, or was rejected after a fresh mint. */
export interface AuthFailedError {
  readonly code: "AUTH_FAILED";
  readonly message: string;
  readonly remintAttempted: boolean;
}

/** The provider answered, but not in a shape this build can store. */
export interface UnusableResponseError {
  readonly code: "UNUSABLE_RESPONSE";
  readonly message: string;
  readonly callId: string;
}

/**
 * A family read that did not finish. The most dangerous error here, and why it is its own kind: an
 * incomplete read must never stale the entities it failed to see.
 */
export interface IncompleteReadError {
  readonly code: "INCOMPLETE_READ";
  readonly message: string;
  readonly callId: string;
  readonly observedSoFar: number;
}

/** Rate limiting or a transport failure that outlived the retry budget. */
export interface TransportExhaustedError {
  readonly code: "TRANSPORT_EXHAUSTED";
  readonly message: string;
  readonly callId: string;
}

export type CrowdstrikeError =
  | ScopeRefusedError
  | RouteAbsentError
  | AuthFailedError
  | UnusableResponseError
  | IncompleteReadError
  | TransportExhaustedError;

/** Construct every CrowdStrike failure, so a message is written once and callers branch on `code`. */
export const CrowdstrikeErrors = {
  authFailed: ({ reason, remintAttempted }: { reason: string; remintAttempted: boolean }): AuthFailedError => ({
    code: "AUTH_FAILED",
    message: remintAttempted
      ? `CrowdStrike rejected a freshly minted bearer: ${reason}. Verify the API host, client id and client secret.`
      : `CrowdStrike would not mint a bearer: ${reason}`,
    remintAttempted,
  }),
  incompleteRead: ({
    callId,
    observedSoFar,
    reason,
  }: {
    callId: string;
    observedSoFar: number;
    reason: string;
  }): IncompleteReadError => ({
    callId,
    code: "INCOMPLETE_READ",
    message: `CrowdStrike did not complete ${callId} after ${observedSoFar} record(s): ${reason}. The family read is incomplete, so nothing was staled.`,
    observedSoFar,
  }),
  routeAbsent: ({ callId, path }: { callId: string; path: string }): RouteAbsentError => ({
    callId,
    code: "ROUTE_ABSENT",
    message: `CrowdStrike returned HTTP 404 for ${path}; the route is absent, decommissioned, or the product is not provisioned for this tenant, and this credential cannot distinguish those causes`,
  }),
  scopeRefused: ({
    callId,
    scope,
    path,
  }: {
    callId: string;
    scope: string | null;
    path: string;
  }): ScopeRefusedError => ({
    callId,
    code: "SCOPE_REFUSED",
    message: `CrowdStrike refused ${path} with HTTP 403: access denied, scope not permitted${scope === null ? "" : `; the configured API client lacks ${scope}`}`,
    scope,
  }),
  transportExhausted: ({ callId, reason }: { callId: string; reason: string }): TransportExhaustedError => ({
    callId,
    code: "TRANSPORT_EXHAUSTED",
    message: `CrowdStrike did not answer ${callId} within the retry budget: ${reason}`,
  }),
  unusableResponse: ({ callId, reason }: { callId: string; reason: string }): UnusableResponseError => ({
    callId,
    code: "UNUSABLE_RESPONSE",
    message: `CrowdStrike returned an unusable ${callId} response: ${reason}`,
  }),
} as const;

/**
 * Whether an error means stored entities must be left alone.
 *
 * The single most consequential branch in this atlas. A read that failed is not an empty result, and
 * treating one as the other deletes real machines from the map — so this is a named predicate a caller
 * cannot forget to apply, rather than a condition rewritten at each call site.
 *
 * @param error the failure to judge
 * @returns whether the family read must be treated as incomplete
 *
 * @internal
 */
export function forbidsStaling({ error }: { error: CrowdstrikeError }): boolean {
  return error.code !== "ROUTE_ABSENT";
}
