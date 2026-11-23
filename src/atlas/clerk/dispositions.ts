/**
 * What this atlas may do with one Clerk operation, decided per OPERATION.
 *
 * ## The criterion, and why it cannot be a list of families
 *
 * `docs/atlas-intent/06-holdings.md`: a highly voluminous family is enumerated and declared rather than stored
 * whole, and what makes a family voluminous is that its records are **time-series OBSERVATIONS** — emitted
 * by the platform, unbounded, growing with the clock, identified by an instant rather than by a name
 * somebody chose. Configuration is the complement: what a person or a system CREATED, and what can be
 * listed exhaustively.
 *
 * That criterion cuts THROUGH a family rather than along it, and Clerk is a clean demonstration:
 * `GET /v1/users` returns rows about people the product signed up, while `GET /v1/users/count` is the
 * enumeration of that same family and is exactly what "enumerated and declared" means. Both are `/v1/users`.
 *
 * ## Three operations return a CREDENTIAL, and finding them is the point of doing this
 *
 * MEASURED against the pinned documents (reproduce with `slopweaver atlas clerk read --kind operation
 * --query secret`): `GET /v1/machines/{machine_id}/secret_key`, `GET /v1/api_keys/{apiKeyID}/secret` and
 * `GET /v1/users/{user_id}/oauth_access_tokens/{provider}` are ordinary-looking GETs whose 200 body is a
 * usable secret. They are `excluded` with a reason naming what comes back, so the atlas can say the
 * operation is THERE without any pass ever calling it — which is the whole difference between a map and a
 * hazard.
 *
 * ## End-user identity is EXCLUDED, and that is the §6 ruling applied rather than a squeamishness
 *
 * The rows behind `/v1/users`, `/v1/email_addresses`, the organisation membership lists and the Frontend
 * API's `/v1/me` tree are the product's own end users, whose record of truth is the application's database.
 * This atlas maps those operations in full — method, parameters, response field names, the dashboard page
 * that shows them — and holds no row. An `excluded` row says "we chose not to reach this and here is why",
 * which is a claim a reader can weigh; omitting the operation would say Clerk offers no way to list a user,
 * which is false.
 *
 * ## Every operation gets a row, mutations included
 *
 * A write is recorded as an `excluded` row saying why it will never be called. Recording that a mutation
 * EXISTS is not the same as being able to perform one, and nothing in this atlas can: there is no
 * credential, and no code path here issues a request to Clerk at all.
 */
import type { ClerkDisposition } from "./model.js";

/**
 * What one rule decided, and the sentence a reader gets for it.
 *
 * @internal
 */
export interface ClerkDispositionRuling {
  readonly disposition: ClerkDisposition;
  /** Why, in English. Never empty, including for `reachable`. */
  readonly reason: string;
  /** Which rule decided it, so a surprising row can be traced to the line that produced it. */
  readonly ruleId: string;
}

/** One reviewed rule: what it matches, what it decides, and the sentence it writes. */
interface DispositionRule {
  readonly id: string;
  readonly disposition: ClerkDisposition;
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * The reads whose 200 body IS a credential, tested before every other rule.
 *
 * Tested first because a later rule would otherwise grade two of them as ordinary configuration, and being
 * wrong in that direction is the only mistake in this file with a consequence.
 */
const CREDENTIAL_RULES: readonly DispositionRule[] = [
  {
    disposition: "excluded",
    id: "machine-secret-key",
    pattern: /^\/v1\/machines\/\{[^}]+\}\/secret_key$/,
    reason:
      "the 200 body is a machine's own secret key — a usable credential rather than a description of one. " +
      "The operation is mapped so the atlas can say it exists; nothing here calls it",
  },
  {
    disposition: "excluded",
    id: "api-key-secret",
    pattern: /^\/v1\/api_keys\/\{[^}]+\}\/secret$/,
    reason:
      "the 200 body is an API key's own secret. Mapped, never called — an atlas that fetched this would be " +
      "a place secrets accumulate rather than a map of where they live",
  },
  {
    disposition: "excluded",
    id: "oauth-access-token",
    pattern: /^\/v1\/users\/\{[^}]+\}\/oauth_access_tokens\/\{[^}]+\}$/,
    reason:
      "the 200 body is a live third-party OAuth access token belonging to one end user — a credential for " +
      "somebody else's account, reached through this one. Mapped, never called",
  },
];

/**
 * The reads whose rows are the product's own end users.
 *
 * Ordered so the enumeration escapes above the collection it counts; `clerkDispositionFor` tests
 * `/v1/users/count` before this list for the same reason the Microsoft 365 registry tests `$count` first.
 */
const END_USER_RULES: readonly DispositionRule[] = [
  {
    disposition: "excluded",
    id: "end-user-directory",
    pattern: /^\/v1\/(users|email_addresses|phone_numbers|sign_ups|waitlist_entries)(\/|$)/,
    reason:
      "the rows are the product's own end users and the identifiers they signed up with. Their record of " +
      "truth is the application's own database, so this atlas maps the operation and holds no row " +
      "(`docs/atlas-intent/06-holdings.md` applied to this platform)",
  },
  {
    disposition: "excluded",
    id: "membership-rosters",
    pattern: /^\/v1\/(organization_memberships|organization_invitations|invitations)(\/|$)/,
    reason:
      "a membership or invitation row names one end user by email address. The organisation SETTINGS that " +
      "govern them are ordinary configuration and are mapped as such; the roster is not this atlas's to hold",
  },
  {
    disposition: "excluded",
    id: "organization-rosters",
    pattern: /^\/v1\/organizations\/\{[^}]+\}\/(memberships|invitations)(\/|$)/,
    reason:
      "the same roster reached through one organisation. Excluded for the reason its collection-level twin " +
      "is, so the two cannot disagree about the same rows",
  },
  {
    disposition: "excluded",
    id: "frontend-signed-in-user",
    pattern: /^\/v1\/(me|client)(\/|$)/,
    reason:
      "the Frontend API's `me` and `client` trees answer AS one signed-in end user, so every response is " +
      "that person's own identity, devices and sessions. Mapped in full; never called",
  },
  {
    disposition: "excluded",
    id: "platform-instance-users",
    pattern: /^\/v1\/platform\/applications\/\{[^}]+\}\/instances\/\{[^}]+\}\/users(\/|$)/,
    reason: "the Platform API's own view of an instance's end users. Excluded for the reason `/v1/users` is",
  },
];

/**
 * The voluminous families, in the order they are tested.
 *
 * Each reason states the OBSERVATION being declared rather than the product it belongs to, because the
 * product is not what the criterion tests.
 */
const VOLUMINOUS_RULES: readonly DispositionRule[] = [
  {
    disposition: "voluminous",
    id: "sessions-and-devices",
    pattern: /^\/v1\/(sessions|clients)(\/|$)/,
    reason:
      "a session and the client that holds it are emitted every time somebody signs in, grow with the " +
      "clock and are identified by an instant rather than by a name anybody chose — declared, never stored " +
      "as a row per session",
  },
  {
    disposition: "voluminous",
    id: "machine-tokens",
    pattern: /^\/v1\/m2m_tokens(\/|$)/,
    reason:
      "machine-to-machine tokens are minted continuously by the systems that use them. The MACHINES that " +
      "mint them are configuration and are mapped as such; the tokens are an unbounded stream",
  },
  {
    disposition: "voluminous",
    id: "billing-statements",
    pattern: /^\/v1\/billing\/statements(\/|$)/,
    reason:
      "a statement and its payment attempts are a period's own record, appended forever. The PLANS and " +
      "PRICES they bill against are configuration somebody authored and stay reachable",
  },
  {
    disposition: "voluminous",
    id: "instance-usage",
    pattern: /^\/v1\/platform\/applications\/\{[^}]+\}\/instances\/\{[^}]+\}\/usage(\/|$)/,
    reason: "usage is a metered time series the platform computes — declared, and read live if ever needed",
  },
  {
    disposition: "voluminous",
    id: "connection-test-runs",
    pattern: /\/test_runs(\/|$)/,
    reason:
      "a test run is appended every time an enterprise connection is exercised — an observation with an " +
      "instant, not a thing somebody named",
  },
];

/**
 * Whether an operation is a read at all.
 *
 * Clerk expresses no read as a POST, so this is a plain method test rather than the reviewed
 * read-shaped-POST allowlist the Microsoft 365 registry needs. Where that changes, the allowlist is the
 * shape to add — never a prefix or a name heuristic, since `POST /v1/organizations/{id}/memberships` reads
 * like traversal and ADDS a member.
 *
 * @param method the HTTP method, upper-cased
 * @returns whether the operation only ever reads
 */
function isObservational({ method }: { method: string }): boolean {
  return method === "GET";
}

/**
 * Decide what this atlas may do with one operation.
 *
 * Pure and total: every operation gets a ruling, and the ruling always carries the rule that produced it,
 * so a surprising row in a published generation can be traced back to the line that decided it.
 *
 * @param method the HTTP method, upper-cased
 * @param wirePath the absolute path the request goes to, parameters left as placeholders
 * @returns the disposition, the reason, and the rule id
 */
export function clerkDispositionFor({
  method,
  wirePath,
}: {
  method: string;
  wirePath: string;
}): ClerkDispositionRuling {
  const credential = CREDENTIAL_RULES.find((rule) => rule.pattern.test(wirePath));
  if (credential !== undefined) {
    return { disposition: credential.disposition, reason: credential.reason, ruleId: credential.id };
  }
  if (!isObservational({ method })) {
    return {
      disposition: "excluded",
      reason:
        `${method} mutates. This atlas only ever reads: no user is created or deleted, no instance setting ` +
        "is changed, no session is revoked and no invitation is sent. The row exists so the atlas can say " +
        "the operation is THERE without being able to perform it",
      ruleId: "mutation",
    };
  }
  if (wirePath.endsWith("/count")) {
    return {
      disposition: "reachable",
      reason:
        "a count over a collection is the enumeration itself — it is what `enumerated and declared` means " +
        "for a family whose rows are not held, and it returns one number rather than a row",
      ruleId: "collection-count",
    };
  }
  const endUser = END_USER_RULES.find((rule) => rule.pattern.test(wirePath));
  if (endUser !== undefined) {
    return { disposition: endUser.disposition, reason: endUser.reason, ruleId: endUser.id };
  }
  const voluminous = VOLUMINOUS_RULES.find((rule) => rule.pattern.test(wirePath));
  if (voluminous !== undefined) {
    return { disposition: voluminous.disposition, reason: voluminous.reason, ruleId: voluminous.id };
  }
  return {
    disposition: "reachable",
    reason:
      "configuration: an instance setting, a connection, a template, a domain, a role or a plan — " +
      "something a person or a system created, listable exhaustively, and not identified by an instant. " +
      "Nothing else in this installation holds Clerk's own configuration, so the atlas would hold it once a " +
      "credential exists",
    ruleId: "configuration-default",
  };
}

/**
 * Every rule id this module can return, so a sync can raise a gap for one that matched nothing.
 *
 * A dead rule reads as considered judgement and is not one, which is why the sync checks this list against
 * what actually fired rather than trusting it.
 *
 * @returns the rule ids, sorted
 */
export function clerkDispositionRuleIds(): readonly string[] {
  return [
    "collection-count",
    "configuration-default",
    "mutation",
    ...CREDENTIAL_RULES.map((rule) => rule.id),
    ...END_USER_RULES.map((rule) => rule.id),
    ...VOLUMINOUS_RULES.map((rule) => rule.id),
  ].toSorted();
}
