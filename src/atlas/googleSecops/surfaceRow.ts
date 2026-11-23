/**
 * The shape of one row in the generated Google SecOps (Chronicle) v1 method inventory.
 *
 * Hand-written and kept beside the generator's output rather than inside it, so the TYPE is reviewable
 * independently of the rows that satisfy it. `googleAdmin/surfaceRow.ts` is the sibling this follows.
 *
 * ## Where a row comes from
 *
 * googleapis' own `google/cloud/chronicle/v1/*.proto` files, pinned at one commit in
 * `generated/protoLock.ts`, give every rpc and its `option (google.api.http)` binding; the service config
 * `chronicle_v1.yaml` at the same commit gives which services the API publishes (`apis:`), the
 * `google.longrunning.Operations` mixin's bindings (`http.rules`) and every method's OAuth scopes
 * (`authentication.rules`). They are read rather than a discovery document because they need no
 * credential: the regional `$discovery` endpoint was measured answering 403 unauthenticated (for
 * v1alpha), and a commit-addressed raw URL serves immutable bytes.
 *
 * ## `scopes` is a first-class field, and it is what decides reach
 *
 * Every row carries the scopes the service config grants it. On this platform that is the whole question
 * of which grant can read what: some services accept `chronicle.readonly`, and others accept ONLY
 * `cloud-platform`, a write-capable token over every GCP API the account can touch. The census of GETs per
 * scope class is in `generated/protoLock.ts`.
 */

/** The REST method an rpc's `google.api.http` binding declares. */
export type GoogleSecopsHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * What this atlas DOES with one method. Every row has exactly one.
 *
 * - `entity` — a GET `List*`/`Get*` read this atlas would call and store, once a credential exists.
 * - `probe-only` — called to establish posture and never stored. No v1 method takes it today.
 * - `excluded` — inventoried and never called, for the reason on the row.
 */
export type GoogleSecopsDisposition = "entity" | "probe-only" | "excluded";

/**
 * Why an inventoried method is never called. READ-ONLY FOREVER means every non-GET is one of these.
 *
 * - `mutating` — it creates, changes or deletes something on the instance.
 * - `query` — it only reads, but it is a POST: a search, a query, a batch get or a text verification
 *   whose request carries a body. Still never called — a POST read is not a GET, and the door sends GETs.
 */
export type GoogleSecopsExclusionReason = "mutating" | "query";

/** One Chronicle v1 method, as the closed inventory holds it. */
export interface GoogleSecopsSurfaceRow {
  /** The fully qualified method, e.g. `google.cloud.chronicle.v1.RuleService.ListRules`. */
  readonly id: string;
  /** The fully qualified service, e.g. `google.cloud.chronicle.v1.RuleService`. */
  readonly service: string;
  /** The bare rpc name, e.g. `ListRules`. */
  readonly rpc: string;
  readonly httpMethod: GoogleSecopsHttpMethod;
  /** The binding's own path template, `{brace}` variables intact. */
  readonly pathTemplate: string;
  readonly disposition: GoogleSecopsDisposition;
  /** Why the row takes its disposition, in one sentence a reader needs no other file for. */
  readonly dispositionBecause: string;
  /** Which refusal applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: GoogleSecopsExclusionReason | null;
  /** The OAuth scopes `chronicle_v1.yaml` grants the method, sorted. Never empty — no rule is a refusal. */
  readonly scopes: readonly string[];
  /** Which pinned file declared the binding — a `.proto`, or `chronicle_v1.yaml` for the Operations mixin. */
  readonly document: string;
}
