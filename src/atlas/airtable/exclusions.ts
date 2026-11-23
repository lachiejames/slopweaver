/**
 * What this atlas does with each Airtable operation that is not simply stored — the four tables the
 * generator consults, and the reason attached to every row they decide.
 *
 * ## The HTTP verb decides ONE direction only, and Airtable is the platform that shows why
 *
 * A non-GET is refused unless it appears in {@link AIRTABLE_OBSERVATIONAL_POSTS}, which has exactly one
 * member. That direction is safe here in a way it is not on Datadog, because Airtable's REST surface is
 * REST-shaped: it reads with GET and writes with POST/PATCH/PUT/DELETE, and the one exception is HyperDB's
 * `POST …/getRecords`, which takes a primary-key list in a body because a key list does not fit a query
 * string. The operation NAMES itself `hyperdb-table-read-records`, and `exclusions.test.ts` asserts that no
 * admitted non-GET's `operationId` begins with a mutating verb — the same cheap second opinion the Datadog
 * atlas put on its own hand-reviewed list, after a POST that reads by shape turned out to be a create.
 *
 * The OTHER direction is not safe, and it is not safe here either: a GET is not automatically an
 * observation, and it is not automatically an entity. Three of Airtable's GETs return unbounded event
 * feeds, so they are shape-indexed rather than refused ({@link AIRTABLE_VOLUMINOUS_OPERATIONS}), and one
 * answers a question about this installation rather than about the organisation, so it is stored nowhere at
 * all ({@link AIRTABLE_PROBE_ONLY_OPERATIONS}).
 *
 * ## The voluminous criterion CUTS THROUGH the auditing family, which is the whole reason it is a criterion
 *
 * `docs/atlas-intent/06-holdings.md` states it: a family is voluminous when its records are time-series
 * OBSERVATIONS — emitted by the platform, unbounded, growing with the clock, and identified by an INSTANT
 * rather than by a name somebody chose. Configuration is the complement: what a person or a system CREATED,
 * and what can be listed exhaustively.
 *
 * Airtable's `auditing` surface is the worked example, and the two halves are one path segment apart:
 *
 * - `GET …/auditLogEvents` returns the event stream itself. Observations. Shape-indexed.
 * - `GET …/auditLogs` returns the export REQUESTS somebody made against that stream. Each was created by a
 *   person, carries a name and a state, and the list is finite. Entities.
 *
 * A rule stated as a list of FAMILIES to skip would have dropped the second along with the first, which is
 * precisely the failure the criterion was sharpened to prevent.
 *
 * ## The records families are decided per SCOPE, not here
 *
 * `AIRTABLE_VOLUME_JUDGED_OPERATIONS` names the three operations whose volume the registry deliberately
 * does not settle — `surfaceRow.ts`'s header carries the reasoning, and the handover's own words are
 * _"per-base record volume is judged base by base against the voluminous-surface exclusion"_. Membership
 * here does NOT change an operation's disposition: all three stay `entity`, because in the ordinary case
 * they are exactly the ops tables this atlas exists to hold. What it changes is where the volume question
 * is answered, which is at sync time against a real base, and recorded on that base's own coverage cell.
 *
 * ## An excluded row still EXISTS
 *
 * It is addressable by surface name for inventory and coverage, publishing its reason, because an atlas
 * that silently omitted `POST /v0/meta/bases` would answer "Airtable cannot create a base", which is false.
 * What an excluded row does not have is a callable request variant.
 */

/**
 * Every non-GET operation this atlas will call, by `operationId`.
 *
 * One member, and the reason it is a LIST rather than a boolean is that the next Airtable release may add a
 * second — a search endpoint that takes a filter body is the obvious shape — and a reviewer should be
 * adding a line here rather than widening a predicate.
 */
export const AIRTABLE_OBSERVATIONAL_POSTS: readonly string[] = ["hyperdb-table-read-records"];

/**
 * The operations whose records are time-series observations: called over a bounded window, shape recorded,
 * never an entry stored.
 *
 * Each carries the sentence a coverage cell prints, so a reader learns the surface EXISTS and what it holds
 * without a single row of it being fetched — which is the difference between a declared voluminous surface
 * and one nobody looked at.
 */
export const AIRTABLE_VOLUMINOUS_OPERATIONS: readonly {
  readonly detail: string;
  readonly operationId: string;
}[] = [
  {
    detail:
      "the enterprise audit-log event stream — every action taken in the enterprise account, emitted by " +
      "Airtable, identified by its own timestamp and growing with the clock. Paged on a previous/next " +
      "cursor pair over a startTime/endTime window. The atlas records which event categories and types " +
      "exist and what an entry's attributes look like; a specific event is fetched live, never stored here",
    operationId: "audit-log-events",
  },
  {
    detail:
      "the enterprise change-event stream — cell, schema and permission changes across every base, emitted " +
      "by Airtable over a startTime/endTime window. Same criterion as the audit log: observations, not " +
      "configuration",
    operationId: "change-events",
  },
  {
    detail:
      "a webhook's own payload backlog — the change notifications Airtable generated for that webhook, " +
      "walked on a monotonic cursor that only ever advances. The webhook itself is configuration and IS " +
      "stored as an entity; its payload stream is the observation half and is not",
    operationId: "list-webhook-payloads",
  },
];

/**
 * The operations called to establish posture and stored nowhere.
 *
 * `GET /v0/meta/whoami` answers which identity this installation's token carries and which scopes it was
 * granted. That is a fact about the CREDENTIAL, not about the organisation, so publishing it as an entity
 * would put an installation detail in a file whose every other row is a thing the organisation owns. It is
 * still called on every sync, because a coverage cell that cannot say which scopes were held cannot explain
 * why a kind came back empty.
 */
export const AIRTABLE_PROBE_ONLY_OPERATIONS: readonly {
  readonly detail: string;
  readonly operationId: string;
}[] = [
  {
    detail:
      "credential posture. It answers which user this token authenticates as and which of the 23 declared " +
      "OAuth scopes it actually holds, which is what lets a coverage cell distinguish 'this organisation " +
      "has none' from 'this token may not ask'. `slopweaver atlas airtable sync` calls it first for exactly " +
      "that reason",
    operationId: "get-user-id-scopes",
  },
];

/**
 * The operations whose volume is judged per scope at sync time rather than settled in the registry.
 *
 * All three remain `entity`. See this file's header and `surfaceRow.ts`'s.
 */
export const AIRTABLE_VOLUME_JUDGED_OPERATIONS: readonly string[] = [
  "hyperdb-table-read-records",
  "list-comments",
  "list-records",
];

/**
 * The operations refused as `side-effecting` rather than `mutating`, and why the distinction is kept.
 *
 * Both are refusals, so nothing behaves differently — but the reason is what a reader sees, and "this
 * changes stored configuration" is a false description of an operation that changes none and instead
 * reaches out and does something to a person. Recording the right one is the whole value of the field.
 */
export const AIRTABLE_SIDE_EFFECTING_OPERATIONS: readonly {
  readonly operationId: string;
  readonly reason: string;
}[] = [
  {
    operationId: "logout-user",
    reason:
      "it ends a named person's Airtable sessions on every device. Nothing in the tenant's stored " +
      "configuration changes, and somebody is signed out of their work regardless — an act, not an " +
      "observation, whatever its HTTP verb",
  },
];

/**
 * What this atlas does with one operation that is not a plain stored entity.
 *
 * Pure, and the single place the four tables above are consulted, so the generator and the tests read the
 * same decision rather than two copies of it.
 *
 * @param method the operation's HTTP method
 * @param operationId Airtable's own operation id
 * @returns the disposition, the reason it is not a plain entity, and which refusal applied
 */
export function airtableDispositionOf({ method, operationId }: { method: string; operationId: string }): {
  readonly disposition: "entity" | "shape-index" | "probe-only" | "excluded";
  readonly dispositionBecause: string | null;
  readonly exclusionReason: "mutating" | "side-effecting" | null;
} {
  const sideEffecting = AIRTABLE_SIDE_EFFECTING_OPERATIONS.find((row) => row.operationId === operationId);
  if (sideEffecting !== undefined) {
    return { disposition: "excluded", dispositionBecause: sideEffecting.reason, exclusionReason: "side-effecting" };
  }
  if (method !== "GET" && !AIRTABLE_OBSERVATIONAL_POSTS.includes(operationId)) {
    return {
      disposition: "excluded",
      dispositionBecause: `${method} changes the tenant, and this atlas only ever reads`,
      exclusionReason: "mutating",
    };
  }
  const probe = AIRTABLE_PROBE_ONLY_OPERATIONS.find((row) => row.operationId === operationId);
  if (probe !== undefined) {
    return { disposition: "probe-only", dispositionBecause: probe.detail, exclusionReason: null };
  }
  const voluminous = AIRTABLE_VOLUMINOUS_OPERATIONS.find((row) => row.operationId === operationId);
  if (voluminous !== undefined) {
    return { disposition: "shape-index", dispositionBecause: voluminous.detail, exclusionReason: null };
  }
  return { disposition: "entity", dispositionBecause: null, exclusionReason: null };
}
