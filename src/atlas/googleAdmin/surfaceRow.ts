/**
 * The shape of one row in the generated Google Admin surface registry.
 *
 * Hand-written and kept beside the generator's output rather than inside it, so the TYPE is reviewable
 * independently of the rows that satisfy it — a generated file nobody reads is a poor place to discover
 * that a field changed meaning. Nightfall's `surfaceRow.ts` is the sibling this follows.
 *
 * ## `scopes` is a first-class field here, and that is the finding rather than a formality
 *
 * On this platform the OAuth scope is what decides whether a call is reachable AT ALL: every operation in
 * these eleven documents is gated by an administrator-granted scope, and the Admin console is the only
 * place those are granted. Carrying the declared set on every row is what lets a reader answer "what
 * would this installation have to be granted to ask that", which is the question a surface map about an
 * admin console exists to answer.
 *
 * MEASURED: **19 of the 336 operations declare NO scope at all** — every
 * `chromemanagement` connector-config, certificate-provisioning and operations method, and every
 * `cloudidentity` user-invitation method. Google publishes them with an empty `scopes` array, so an OAuth
 * caller cannot know what to ask for from the document alone. `gaps.ts` raises that as
 * `undeclared-scope` rather than letting an empty array read as "no scope needed". Reproduce it:
 *
 * ```bash
 * grep -c '"scopes":\[\]' src/atlas/googleAdmin/generated/surfaces.ts
 * ```
 */
import type { GoogleAdminApi, GoogleAdminDocument, GoogleAdminPaging } from "./surfaceNaming.js";

/**
 * What this atlas DOES with one operation. Every row has exactly one, and the generator refuses to emit a
 * row it cannot decide.
 *
 * The four members are the kit's, reused rather than re-derived because the ruling behind them is
 * platform-independent: "everything reachable minus the highly voluminous" (`docs/atlas-intent/06-holdings.md`) is
 * a different TREATMENT, never a refusal.
 *
 * - `entity` — a read this atlas would call and store, once a credential exists.
 * - `shape-index` — a read whose records are time-series observations: the family is reached over a
 *   bounded window and only its SHAPE stored, never a row per record.
 * - `probe-only` — called to establish posture and never stored.
 * - `excluded` — inventoried and never called, for the reason on the row.
 */
export type GoogleAdminDisposition = "entity" | "shape-index" | "probe-only" | "excluded";

/**
 * Why an inventoried operation is never called.
 *
 * - `mutating` — it changes the Workspace account. This atlas only ever reads.
 * - `side-effecting` — it does not change stored configuration but it makes Google ACT: the three `watch`
 *   methods register a push-notification channel against a URL the caller supplies, which is an outward
 *   subscription rather than an observation of existing state.
 * - `egressing` — issuing it would send this machine's own content to Google as the request body. The two
 *   media uploads are the whole of this class.
 */
export type GoogleAdminExclusionReason = "mutating" | "side-effecting" | "egressing";

/** One Google Admin operation, as the closed registry holds it. */
export interface GoogleAdminSurfaceRow {
  /** Which product API declares it — the Admin console area, in Google's own words. */
  readonly api: GoogleAdminApi;
  /** The document's own base URL, which `path` is relative to. */
  readonly baseUrl: string;
  /** The document's own `description`, first line only, or `null` where it declares none. */
  readonly description: string | null;
  readonly disposition: GoogleAdminDisposition;
  /** Why this row is not a plain `entity`. `null` only when it is one. */
  readonly dispositionBecause: string | null;
  /** Which discovery document declared it — the reproduction handle back to Google's own bytes. */
  readonly document: GoogleAdminDocument;
  /** Which of the three refusals applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: GoogleAdminExclusionReason | null;
  /** Google's own method `id`, e.g. `directory.users.list`. NOT unique across documents — see the header. */
  readonly id: string;
  /** The atlas kind this contributes to. */
  readonly kind: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The name a caller passes instead of a URL, kebab-cased and unique across the whole registry. */
  readonly name: string;
  readonly paging: GoogleAdminPaging;
  /** Every parameter name the method declares, sorted — path, query and the request body alike. */
  readonly parameters: readonly string[];
  /** Every parameter Google marks `required`, sorted. */
  readonly parametersRequired: readonly string[];
  /** The document's own `flatPath` (or `path` where it declares no flat form), `{brace}` parameters intact. */
  readonly path: string;
  /** The vendor's own request-body schema name, or `null` for a bodyless call. */
  readonly requestSchema: string | null;
  /** Every field name the declared response schema carries at its top level, sorted. */
  readonly responseFields: readonly string[];
  /** The vendor's own response schema name, or `null` where the method declares no response body. */
  readonly responseSchema: string | null;
  /** The OAuth scopes Google declares for it, sorted. EMPTY for 19 of them — see the header. */
  readonly scopes: readonly string[];
  /** Whether Google marks it as accepting a media upload — what makes a row `egressing`. */
  readonly supportsMediaUpload: boolean;
}
