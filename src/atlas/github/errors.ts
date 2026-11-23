/**
 * The typed failures the GitHub atlas produces, and why each is its own variant rather than a message.
 *
 * A caller branches on `code` and displays `message`. The variants exist because the coverage table and the
 * gap list both have to tell them apart: "this token may not see it", "GitHub has no such route here" and
 * "the read stopped part-way" are three different facts about the atlas, and a reader who cannot separate
 * them cannot act on any of them.
 *
 * ## `SCOPE_REFUSED` is the ordinary case on this platform, not an error condition
 *
 * GitHub answers 403 for a great many legitimate reasons: a fine-grained token without a permission, a
 * classic token whose SSO authorisation has not been granted for the organisation, a member who is not an
 * owner, a plan that does not include the feature. All of them mean the same thing to this atlas — the
 * setting exists and this credential may not read it — and all of them belong in the coverage table as a
 * stated boundary rather than as a failure. A GitHub atlas that treated 403 as an error would spend most of
 * its run failing.
 *
 * `PLAN_UNAVAILABLE` is separated from it deliberately. GitHub also answers 403 when a FEATURE is not on
 * the account's plan at all, and that is a different fact: no scope grant fixes it, so a coverage reason
 * that told the reader to ask for a scope would be advice that cannot work.
 *
 * ## Refusals are a second union, not more read failures
 *
 * `GithubAtlasError` describes a READ that failed, and the coverage table and the gap list switch over it
 * exhaustively. `GithubRefusalError` is a different fact: the atlas declining to report or publish over
 * nothing — a description whose shape moved, a walk with no seeds, a generation that is not coherent.
 * Folding those into the read union would force a coverage cell and a gap class for each, which neither has,
 * so they stay apart and leave for their `readonly string[]` callers through `githubRefusalErrorLines`.
 */

/** A credential that may not read something it can see the existence of. */
export interface GithubScopeRefusedError {
  readonly code: "SCOPE_REFUSED";
  readonly message: string;
  /** The permission or scope GitHub named, when it named one. */
  readonly scope: string | null;
}

/** A route GitHub does not serve here — decommissioned, or never present on this host. */
export interface GithubRouteAbsentError {
  readonly code: "ROUTE_ABSENT";
  readonly message: string;
  readonly route: string;
}

/** A feature the account's plan does not include, which no scope grant will open. */
export interface GithubPlanUnavailableError {
  readonly code: "PLAN_UNAVAILABLE";
  readonly message: string;
  readonly feature: string;
}

/** A read that stopped before the provider ran out of pages. */
export interface GithubIncompleteReadError {
  readonly code: "INCOMPLETE_READ";
  readonly message: string;
  readonly observed: number;
}

/** A credential GitHub rejected outright. */
export interface GithubAuthFailedError {
  readonly code: "AUTH_FAILED";
  readonly message: string;
}

/** Rate limiting or a transport failure that outlived its retries. */
export interface GithubTransportExhaustedError {
  readonly code: "TRANSPORT_EXHAUSTED";
  readonly message: string;
  readonly cause?: unknown;
}

/** A 200 whose body is not the shape the projection declares. */
export interface GithubUnusableResponseError {
  readonly code: "UNUSABLE_RESPONSE";
  readonly message: string;
  readonly route: string;
}

/** Every way a GitHub atlas read can fail. */
export type GithubAtlasError =
  | GithubScopeRefusedError
  | GithubRouteAbsentError
  | GithubPlanUnavailableError
  | GithubIncompleteReadError
  | GithubAuthFailedError
  | GithubTransportExhaustedError
  | GithubUnusableResponseError;

/** Construct a GitHub atlas failure. The only way one is made, so a message is never assembled ad hoc. */
export const GithubAtlasErrors = {
  authFailed: ({ reason }: { reason: string }): GithubAuthFailedError => ({
    code: "AUTH_FAILED",
    message: `GitHub rejected the credential: ${reason}`,
  }),
  hiddenAsNotFound: ({ route }: { route: string }): GithubScopeRefusedError => ({
    code: "SCOPE_REFUSED",
    message: `this credential may not read ${route} — GitHub answered 404, which it does on this admin-gated route for a credential without the repository admin or organisation owner role`,
    scope: null,
  }),
  incompleteRead: ({ route, observed }: { route: string; observed: number }): GithubIncompleteReadError => ({
    code: "INCOMPLETE_READ",
    message: `the read of ${route} stopped after ${String(observed)} record(s) without reaching the end of its own result set`,
    observed,
  }),
  planUnavailable: ({ feature }: { feature: string }): GithubPlanUnavailableError => ({
    code: "PLAN_UNAVAILABLE",
    feature,
    message: `${feature} is not available on this account's plan, so no permission grant will make it readable`,
  }),
  routeAbsent: ({ route }: { route: string }): GithubRouteAbsentError => ({
    code: "ROUTE_ABSENT",
    message: `GitHub answered 404 for ${route} — the route is not served on this host, or the object it names does not exist`,
    route,
  }),
  scopeRefused: ({ route, scope }: { route: string; scope: string | null }): GithubScopeRefusedError => ({
    code: "SCOPE_REFUSED",
    message:
      scope === null
        ? `this credential may not read ${route} — GitHub refused without naming a permission, which is usually an unaccepted SSO authorisation or a non-owner role`
        : `this credential may not read ${route} — GitHub named the missing permission as ${scope}`,
    scope,
  }),
  transportExhausted: ({ route, cause }: { route: string; cause: unknown }): GithubTransportExhaustedError => ({
    cause,
    code: "TRANSPORT_EXHAUSTED",
    message: `the request to ${route} did not complete after the client's own retries: ${cause instanceof Error ? cause.message : "no reason given"}`,
  }),
  unusableResponse: ({ route, reason }: { route: string; reason: string }): GithubUnusableResponseError => ({
    code: "UNUSABLE_RESPONSE",
    message: `${route} answered successfully with a body this atlas cannot read: ${reason}`,
    route,
  }),
} as const;

/** A refusal said in one sentence. */
interface Refusal<C extends string> {
  readonly code: C;
  readonly message: string;
}

/**
 * Every way the GitHub atlas refuses to report or publish over nothing.
 * @internal
 */
export type GithubRefusalError =
  | Refusal<"DESCRIPTION_SHAPE_CHANGED">
  | Refusal<"NO_ROUTES">
  | (Refusal<"GENERATION_UNPUBLISHABLE"> & { readonly reasons: readonly string[] })
  | (Refusal<"COMPLETENESS_CONTRADICTED"> & { readonly kind: string })
  | (Refusal<"CALL_UNREGISTERED"> & { readonly callId: string })
  | Refusal<"NO_SEEDS">;

/** Construct a GitHub atlas refusal, the one place its words live. */
export const GithubRefusalErrors = {
  callUnregistered: ({ callId }: { callId: string }): GithubRefusalError => ({
    callId,
    code: "CALL_UNREGISTERED",
    message: `github call "${callId}" is neither a discovery call nor a projected call in the closed inventory, so its records have no projection — refusing to publish rather than drop them`,
  }),
  completenessContradicted: ({ kind }: { kind: string }): GithubRefusalError => ({
    code: "COMPLETENESS_CONTRADICTED",
    kind,
    message: `${kind} had a failed read this run and still produced a completeness proof — refusing to publish rather than risk staling live configuration`,
  }),
  noRoutes: (): GithubRefusalError => ({
    code: "NO_ROUTES",
    message: "the GitHub OpenAPI description declared no route at all, so its `paths` shape has changed",
  }),
  noSeeds: (): GithubRefusalError => ({
    code: "NO_SEEDS",
    message: "no settings seeds were supplied, so a walk would report full coverage over nothing",
  }),
  shapeChanged: (): GithubRefusalError => ({
    code: "DESCRIPTION_SHAPE_CHANGED",
    message:
      "the GitHub OpenAPI description declares no `paths` or no `operations` interface — its shape has changed, and enumerating zero routes would report a complete API surface over nothing",
  }),
  unpublishable: ({ problems }: { problems: readonly string[] }): GithubRefusalError => {
    const reasons = [...problems, "nothing was written — this generation is not published"];
    return { code: "GENERATION_UNPUBLISHABLE", message: reasons.join("; "), reasons };
  },
} as const;

/**
 * The lines a {@link GithubRefusalError} prints: an unpublishable generation's problems one per line, then
 * its trailer, as the `readonly string[]` it replaced did, and every other refusal as its one sentence.
 *
 * @param error the GitHub atlas refusal being printed
 * @returns one line per problem, in the order they were found
 */
export function githubRefusalErrorLines({ error }: { error: GithubRefusalError }): readonly string[] {
  if (error.code === "GENERATION_UNPUBLISHABLE") {
    return error.reasons;
  }
  return [error.message];
}
