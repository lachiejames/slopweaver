/**
 * The query parameters an admitted operation REQUIRES, pinned per operation and measured from the
 * provider's own refusal.
 *
 * ## Why this file has to exist at all
 *
 * The generated registry carries an operation's origin, method, path and pagination. It carries nothing
 * about a query parameter the provider will not serve the request without — the three pinned specification
 * files that would have supplied one are not on this machine, and `client.ts` deliberately DISCARDS a
 * failure's response body, because a body is exactly where a provider echoes a credential back. So the
 * sentence the provider was writing — _"Parameter (targets) is Required"_ — never reached a reader, and
 * the operation published as `OPERATION_UNUSABLE` forever.
 *
 * MEASURED against the live tenancy, which is how every row below was derived: each operation pinned
 * here answered 4xx on one published generation, and the provider named the
 * missing parameter, and in most cases its whole allowable vocabulary, in the refusal it sent.
 *
 * ## Each row is NAMED, never matched by a pattern
 *
 * The same discipline `sensitiveFields.ts` applies to a denied field applies here: an operation is listed
 * by its registry name and its parameters are written out, so a new operation the next specification bump
 * adds is UNCONTRACTED and visibly so, rather than silently swept into a rule somebody wrote for a
 * different endpoint. `requestContracts.test.ts` asserts every name here is a row the registry admits, so a
 * renamed operation fails the build rather than going quietly unbound.
 *
 * ## A vocabulary is exhaustive on purpose
 *
 * `targets` on a graph endpoint is not "pick one" — a read that asks for `user` alone is a read that
 * silently omits every other association the record has. So each entry lists every value the provider
 * declared allowable for THAT path — and each value is its OWN CALL, because the provider takes exactly one
 * target per request. MEASURED against the live tenancy: all five system targets repeated in one
 * request answer `failed to list graph associations (…): must provide exactly 1 target, got 5`, and each of
 * the five sent alone answers 200. That refusal stood behind an `OPERATION_UNUSABLE` row for every
 * graph-association call in one generation, in every kind that has one. {@link jumpcloudQueryVariants} is where one contract becomes one query per
 * target; `syncRead.ts` reads each and merges them into the operation's one answer.
 *
 * Reproduce any row: `slopweaver atlas jumpcloud sync`, then read the kind's gap list. The refusal text is
 * the provider's own and is quoted in `measuredFrom`.
 */
import { createHash } from "node:crypto";

import { parseIsoMs } from "../../lib/date.js";

import { JUMPCLOUD_SURFACES } from "./generated/surfaces.js";

/** Milliseconds in one day, so the window arithmetic reads as a window rather than as four factors. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** What one operation needs beyond its path, and the refusal that proved it. */
export interface JumpcloudRequestContract {
  /** The registry row's own name. */
  readonly operation: string;
  /** Parameters to send on every call, a repeated one written as an array. */
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  /** The provider's own refusal, verbatim, from the call that had this parameter missing. */
  readonly measuredFrom: string;
  /**
   * A parameter the provider takes ONE value of per request, so the operation is read once per value.
   * Absent for every contract whose parameters all travel together.
   */
  readonly onePerCall?: string;
}

/**
 * Every association target the provider declares allowable, per graph path.
 *
 * Harvested by sending one deliberately invalid `targets` value and reading the enumeration back out of the
 * refusal — a probe that reaches no record and returns nothing but the vocabulary. The lists are NOT the
 * same across families and could not be shared: a system takes no `system_group`, a system group takes no
 * `system` but does take `radius_server`, and a command takes `password_manager_item` that nothing else
 * does. A single shared list would have over-asked on every family and been rejected wholesale.
 */
const ASSOCIATION_TARGETS: Readonly<Record<string, readonly string[]>> = {
  "v2-graph-active-directory-associations-list": ["user", "user_group"],
  "v2-graph-application-associations-list": ["agent_group", "user", "user_group"],
  "v2-graph-command-associations-list": ["system", "system_group", "password_manager_item"],
  "v2-graph-g-suite-associations-list": ["user", "user_group"],
  "v2-graph-idp-routing-policy-associations-list": ["user", "user_group"],
  "v2-graph-ldap-server-associations-list": ["user", "user_group"],
  "v2-graph-office365-associations-list": ["user", "user_group"],
  "v2-graph-password-manager-item-associations-list": ["user", "user_group", "command"],
  "v2-graph-policy-associations-list": ["system", "system_group", "user", "user_group"],
  "v2-graph-policy-group-associations-list": ["system", "system_group", "user", "user_group"],
  "v2-graph-radius-server-associations-list": ["user", "user_group", "system_group"],
  "v2-graph-rule-associations-list": ["system", "system_group"],
  "v2-graph-softwareapps-associations-list": ["system", "system_group"],
  "v2-graph-system-associations-list": ["command", "policy", "policy_group", "user", "user_group"],
  "v2-graph-system-group-associations-list": [
    "command",
    "policy",
    "policy_group",
    "radius_server",
    "user",
    "user_group",
  ],
  "v2-graph-user-associations-list": [
    "active_directory",
    "application",
    "g_suite",
    "idp_routing_policy",
    "ldap_server",
    "office_365",
    "password_manager_item",
    "policy",
    "policy_group",
    "radius_server",
    "system",
    "system_group",
  ],
  "v2-graph-user-group-associations-list": [
    "active_directory",
    "application",
    "g_suite",
    "idp_routing_policy",
    "ldap_server",
    "office_365",
    "password_manager_item",
    "policy",
    "policy_group",
    "radius_server",
    "system",
    "system_group",
  ],
};

/**
 * How far back a windowed statistics operation asks, in days.
 *
 * `/api/v2/identityrisk/*` refuses without `start_time` and `end_time` and declares no default, so the
 * window is this atlas's choice rather than the provider's. Thirty days is the shortest window that spans
 * a full monthly review cycle, which is what an ISO 27001 evidence read is for; a longer one would make the
 * figure answer a question nobody asked, and a shorter one would miss a month-end.
 *
 * It is a CONSTANT rather than a caller's argument because the window is part of what the stored record
 * means: two generations whose windows differed would not be comparable, and nothing in the record would
 * say so.
 */
export const JUMPCLOUD_RISK_WINDOW_DAYS = 30;

/**
 * How many days of application usage `/saas-management/applications/{id}/usage` is asked for.
 *
 * Same reasoning as {@link JUMPCLOUD_RISK_WINDOW_DAYS}: the provider requires `day_count` and declares no
 * default, so the number is this atlas's and is pinned rather than passed.
 */
const JUMPCLOUD_USAGE_WINDOW_DAYS = 30;

/** Every contract that is not a graph `targets` list, written out. */
const EXPLICIT_CONTRACTS: readonly JumpcloudRequestContract[] = [
  {
    measuredFrom: '{"code":602,"message":"day_count in query is required"}',
    operation: "v2-get-application-usage",
    query: { day_count: String(JUMPCLOUD_USAGE_WINDOW_DAYS) },
  },
  {
    measuredFrom: '{"message":"invalid request: start_time and end_time are required","status":"INVALID_ARGUMENT"}',
    operation: "v2-risk-stats-service-get-login-type-distribution",
    query: {},
  },
  {
    measuredFrom: '{"message":"invalid request: start_time and end_time are required","status":"INVALID_ARGUMENT"}',
    operation: "v2-risk-stats-service-get-risky-identities",
    query: {},
  },
  {
    measuredFrom: '{"message":"invalid request: start_time and end_time are required","status":"INVALID_ARGUMENT"}',
    operation: "v2-risk-stats-service-get-risky-access-geolocation",
    query: {},
  },
  {
    measuredFrom: '{"message":"invalid request: start_time and end_time are required","status":"INVALID_ARGUMENT"}',
    operation: "v2-risk-stats-service-get-stats",
    query: {},
  },
];

/** The operations whose contract is a time window rather than a fixed value. */
const WINDOWED_OPERATIONS: ReadonlySet<string> = new Set([
  "v2-risk-stats-service-get-login-type-distribution",
  "v2-risk-stats-service-get-risky-identities",
  "v2-risk-stats-service-get-risky-access-geolocation",
  "v2-risk-stats-service-get-stats",
]);

/**
 * Every pinned contract, graph and explicit alike, keyed by operation name.
 *
 * @returns one entry per contracted operation
 */
export const JUMPCLOUD_REQUEST_CONTRACTS: Readonly<Record<string, JumpcloudRequestContract>> = Object.fromEntries(
  [
    ...Object.entries(ASSOCIATION_TARGETS).map(([operation, targets]): JumpcloudRequestContract => ({
      measuredFrom: `Parameter (targets) is value at index 0 not an allowable value (${targets.join(", ")}); must provide exactly 1 target`,
      onePerCall: "targets",
      operation,
      query: { targets },
    })),
    ...EXPLICIT_CONTRACTS,
  ].map((contract) => [contract.operation, contract]),
);

/**
 * The query one contracted operation adds to its request.
 *
 * A windowed operation's two instants are derived from the run's own clock rather than stored, so the
 * window travels with the read epoch the generation already records.
 *
 * @param operation the registry row's name
 * @param now this run's ISO timestamp, which ends the window
 * @returns the query to merge into the request, empty for an operation with no pinned contract
 */
export function jumpcloudRequiredQuery({
  operation,
  now,
}: {
  operation: string;
  now: string;
}): Readonly<Record<string, string | readonly string[]>> {
  const contract = JUMPCLOUD_REQUEST_CONTRACTS[operation];
  if (contract === undefined) {
    return {};
  }
  if (!WINDOWED_OPERATIONS.has(operation)) {
    return contract.query;
  }
  const endMs = parseIsoMs({ tsIso: now });
  if (endMs === undefined) {
    // The caller's clock is the sync's own ISO timestamp, so this is unreachable in the walk. Returning the
    // bare contract rather than inventing a window keeps the failure a provider refusal naming the missing
    // parameter, which is a fact a reader can chase, instead of a silently wrong interval.
    return contract.query;
  }
  const startMs = endMs - JUMPCLOUD_RISK_WINDOW_DAYS * MS_PER_DAY;
  return {
    ...contract.query,
    end_time: new Date(endMs).toISOString(),
    start_time: new Date(startMs).toISOString(),
  };
}

/**
 * The queries one operation is read with — one per value of its one-per-call parameter, else just one.
 *
 * @param operation the registry row's name
 * @param now this run's ISO timestamp, which ends a windowed operation's interval
 * @returns every query to read, in the contract's own declared order, never empty
 */
export function jumpcloudQueryVariants({
  operation,
  now,
}: {
  operation: string;
  now: string;
}): readonly Readonly<Record<string, string | readonly string[]>>[] {
  const required = jumpcloudRequiredQuery({ now, operation });
  const param = JUMPCLOUD_REQUEST_CONTRACTS[operation]?.onePerCall;
  if (param === undefined) {
    return [required];
  }
  const values = required[param];
  if (values === undefined || typeof values === "string") {
    return [required];
  }
  return values.map((value) => ({ ...required, [param]: value }));
}

/**
 * Operations the provider will not serve without a parameter this atlas has NO derivable source for.
 *
 * These are not contracts with a missing value — they are contracts whose value belongs to a family the
 * operation's own kind does not hold, or which the provider refuses in every spelling it names. Calling
 * them anyway is what produced a settled `OPERATION_UNUSABLE` on every sync forever: the same failure, at
 * the same cost, telling a reader nothing it did not already know. Declared here instead, they publish as a
 * plan `unrunnable` with the provider's own sentence and what would change it — which is the difference
 * between a gap a reader can act on and a failure a reader has to re-derive.
 *
 * Each entry's key is the registry row's name; the value is what a reader is told. MEASURED;
 * every sentence quotes the refusal verbatim.
 */
export const JUMPCLOUD_QUERY_UNBINDABLE: Readonly<Record<string, string>> = {
  "v2-bulk-user-states-get-next-scheduled": [
    "v2-bulk-user-states-get-next-scheduled is admitted and answers",
    "`Parameter (users) is Required` — it takes a list of USER ids, and its kind is `bulk`, which holds no",
    "user collection to bind them from. It answered 200 with `events_count: 0` for a single probe id, so the",
    "contract is understood and the SOURCE is what is missing: binding it needs a cross-kind rule this atlas",
    "does not have, because a parameter is bound from its own kind's own collection.",
  ].join(" "),
  "v2-get-device-asset-by-jcsystem-id": [
    "v2-get-device-asset-by-jcsystem-id is /api/v2/assets/devices/jc-system/{jcSystemId}: its parameter is a",
    "JumpCloud SYSTEM id, and its kind is `assets`, which holds no system collection to bind it from — so the",
    "pooled fallback bound it from asset ids and every call answered 404 (one per asset id, zero",
    "entities). The device assets it would return are read whole through v2-get-device-asset, so no record is",
    "lost; binding this lookup needs a cross-kind rule this atlas does not have.",
  ].join(" "),
  "v2-saved-views-list": [
    "v2-saved-views-list is admitted and answers `valid userObjectID is required` — a saved view belongs to a",
    "USER, and this operation sits under kind `systems`, which holds no user ids. It answered 200 with `[]`",
    "for a probe user id, so the contract is understood and the SOURCE is what is missing: binding it needs a",
    "cross-kind rule this atlas does not have.",
  ].join(" "),
  "v2-tags-service-list": [
    "v2-tags-service-list is admitted and answers `targetKind must be CREDENTIAL or RESOURCE` — and it",
    "answers exactly that for `targetKind=CREDENTIAL`, `targetKind=RESOURCE`, `target_kind=CREDENTIAL` and",
    "`targetKind=TARGET_KIND_CREDENTIAL` alike, so no value it names is a value it accepts. Recover the",
    "pinned specification for this path and pin the enum it actually declares, then it runs.",
  ].join(" "),
};

/**
 * A stable digest of one operation's PINNED contract, or `null` when it has none.
 *
 * ## Why the resume journal needs this, measured
 *
 * A settled failure is journalled and REPLAYED rather than re-attempted — `errors.ts`'s
 * `JUMPCLOUD_SETTLED_FAILURE_CODES`, consulted by `syncEngine.ts`, and the reason is real: one walk produced a settled failure
 * for every call to an uncontracted operation, and re-asking them every sync would repeat every one of those
 * calls to be told the same thing.
 * The key is `<surface>|<bound path>`, and a query parameter appears in neither half. So every `HTTP 400`
 * this file now fixes would come straight back out of the journal, unchanged, and the fix would do nothing
 * on the only machine that holds a journal. Reproduce before the fingerprint existed:
 * `slopweaver atlas jumpcloud sync` twice and watch the `systems` reason list stay identical.
 *
 * The fingerprint is of the contract's own DEFINITION, never of a resolved request: a windowed operation's
 * two instants come from the run's clock, so digesting those would mint a new key every sync and turn the
 * journal off for them entirely. An operation with no contract digests to `null` and its key is unchanged
 * byte for byte, which is what keeps this from invalidating the whole journal to fix the operations it pins.
 *
 * @param operation the registry row's name
 * @returns a short hex digest, or `null` when this operation has no pinned contract
 */
export function jumpcloudContractFingerprint({ operation }: { operation: string }): string | null {
  const contract = JUMPCLOUD_REQUEST_CONTRACTS[operation];
  if (contract === undefined) {
    return null;
  }
  const canonical = Object.keys(contract.query)
    .toSorted()
    .map((key) => {
      // Present by construction: `key` came from this object's own keys a line ago.
      const value = contract.query[key]!;
      return `${key}=${typeof value === "string" ? value : value.join(",")}`;
    })
    .join("&");
  const split = contract.onePerCall === undefined ? "" : `|one-per-call=${contract.onePerCall}`;
  return createHash("sha1").update(`${operation}?${canonical}${split}`).digest("hex").slice(0, 12);
}

/**
 * Whether the registry admits every operation this file names.
 *
 * Exported for the gate in `requestContracts.test.ts`: a contract naming an operation the registry no
 * longer holds is a contract nothing will ever apply, and it would read as coverage that exists.
 *
 * @returns the contracted operation names the registry does not admit, sorted
 */
export function uncontractedOperationNames(): readonly string[] {
  const admitted = new Set(JUMPCLOUD_SURFACES.map((row) => row.name));
  return [...Object.keys(JUMPCLOUD_REQUEST_CONTRACTS), ...Object.keys(JUMPCLOUD_QUERY_UNBINDABLE)]
    .filter((operation) => !admitted.has(operation))
    .toSorted();
}
