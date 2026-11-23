/**
 * The shape of one row in the generated Canva surface registry.
 *
 * Hand-written and kept beside the generator's output rather than inside it, so the TYPE is reviewable
 * independently of the rows that satisfy it — a generated file nobody reads is a poor place to discover
 * that a field changed meaning. Nightfall's `surfaceRow.ts` is the sibling this follows.
 *
 * ## The vendor names its own operations and its own kinds, and that is why this atlas invents neither
 *
 * MEASURED over the pinned description: all 59 operations carry an `operationId`, and all 59
 * carry EXACTLY ONE tag. Every sibling atlas had to derive a taxonomy from path segments and defend it;
 * here the vendor publishes one, so {@link CanvaSurfaceRow.kind} is its own tag kebab-cased and
 * {@link CanvaSurfaceRow.name} is its own `operationId`. A derived name would be a second, competing
 * vocabulary for something the platform already answers, and the generator asserts both properties on
 * every run rather than assuming them.
 *
 * ## One server, so the provider key is `<METHOD> <path>`
 *
 * Nightfall needed the server in its key because two of its six documents declared byte-identical path
 * templates against different base URLs. This description declares exactly one server
 * (`https://api.canva.com/rest`) and one document, so the server is recorded on the row for provenance and
 * left out of the identity — a key carrying a constant distinguishes nothing.
 *
 * ## Three fields carry what a scope column cannot say
 *
 * {@link CanvaSurfaceRow.stability}, {@link CanvaSurfaceRow.entitlement} and
 * {@link CanvaSurfaceRow.capabilities} exist because this vendor puts a large part of its reachability
 * contract somewhere no OpenAPI field reaches. MEASURED over the pinned bytes: 20 operations are marked
 * PREVIEW and one DEPRECATED inside a `<Warning>` block in their own `description` prose, and nine declare
 * a plan or organisation requirement inside an `<Availability>` block. An integration holding every one of
 * the 18 published scopes still cannot call those nine. `eligibility.ts` carries the extraction and the
 * one place the vendor disagrees with itself.
 */

/**
 * What ISSUING one operation would DO to the account, judged one operation at a time.
 *
 * This atlas never calls the Connect API — it holds no credential — so this is not a fetch plan. It is the
 * answer to "what can Canva be made to do", which is atlas content a reader cannot get from the method
 * alone. `POST /v1/designs/{designId}/analytics/page-views` is why: it is a POST that READS, taking its
 * filter in a body because the filter is too big for a query string. Reading effect off the verb would file
 * it as a write and be wrong about the one operation where it matters most.
 *
 * - `read` — it returns existing state and changes nothing.
 * - `mutating` — it creates, edits, moves or deletes something in the user's Canva account.
 * - `side-effecting` — it changes no stored content but makes Canva ACT: render an export, mint or revoke a
 *   credential. Not an observation, whatever its HTTP verb says.
 */
export type CanvaEffect = "read" | "mutating" | "side-effecting";

/**
 * How an operation returns more than one page.
 *
 * - `continuation` — it declares a `continuation` query parameter and a `continuation` response field.
 *   Every listing operation in this description uses exactly that pair, under the vendor's own name for it.
 * - `none` — a single-shot read, a write, or a job poll.
 */
type CanvaPaging = "continuation" | "none";

/**
 * What the vendor says about an operation's own stability, read from its description prose.
 *
 * - `stable` — the description carries no stability warning at all.
 * - `preview` — its `<Warning>` block says the API is provided as a preview: unannounced breaking changes,
 *   no new API version for a break, and a public integration using it cannot pass Canva's review.
 * - `deprecated` — its `<Warning>` block names the replacement to use instead.
 *
 * This is not the same field as {@link CanvaSurfaceRow.deprecated}, and keeping them apart is the point:
 * `deprecated` is the description's own machine-readable flag, and this is what its prose says. MEASURED
 * over the pinned bytes they agree exactly once — `createComment` is the only operation carrying either —
 * which makes the pair a corroboration rather than a duplication.
 */
export type CanvaStability = "stable" | "preview" | "deprecated";

/**
 * What a caller must BE, beyond holding a scope, for an operation to work at all.
 *
 * - `none` — the scope grant is the whole requirement.
 * - `enterprise-organization` — the acting user must be a member of a Canva Enterprise organisation.
 * - `premium-plan` — the acting user must be on a Canva plan with premium features.
 *
 * The single most useful thing this atlas holds about Canva, because it is invisible to every other way of
 * reading the description. An `<Availability>` block is prose inside `description`; no scope, security
 * scheme or response code carries it, so a reader who mapped only the machine-readable fields would
 * conclude that `design:meta:read` is sufficient for the analytics family. It is not.
 */
export type CanvaEntitlement = "none" | "enterprise-organization" | "premium-plan";

/** One Canva Connect API operation, as the closed registry holds it. */
export interface CanvaSurfaceRow {
  /** Every request body field name the declared body schema carries, sorted. Empty for a bodyless call. */
  readonly bodyParams: readonly string[];
  /**
   * Every value of the description's own `x-required-capabilities` extension, sorted. Empty for most
   * operations — see {@link CanvaEntitlement} and `eligibility.ts` for what it does and does not cover.
   */
  readonly capabilities: readonly string[];
  /** The description's own `deprecated` flag. */
  readonly deprecated: boolean;
  /** What issuing it would do — see {@link CanvaEffect}. */
  readonly effect: CanvaEffect;
  /** Why it is not a plain `read`. `null` only when it is one. */
  readonly effectBecause: string | null;
  /** What the caller must BE for it to work — see {@link CanvaEntitlement}. */
  readonly entitlement: CanvaEntitlement;
  /** The vendor's own words for the requirement. `null` only when the entitlement is `none`. */
  readonly entitlementBecause: string | null;
  /** Every header parameter name the description declares, sorted. */
  readonly headerParams: readonly string[];
  /** The atlas kind this contributes to — the vendor's own tag, kebab-cased. */
  readonly kind: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The vendor's own `operationId`, which is also this registry's unique name. */
  readonly name: string;
  readonly paging: CanvaPaging;
  /** Every path parameter name, in path order. */
  readonly pathParams: readonly string[];
  /** The description's own path template, `{brace}` parameters intact. */
  readonly path: string;
  /** Every query parameter name the description declares, sorted. */
  readonly queryParams: readonly string[];
  /**
   * The description's own `x-rate-limit-per-client-user`, in requests per minute. `null` where it declares
   * none — MEASURED, 53 of the 59 operations declare one.
   */
  readonly rateLimitPerUserPerMinute: number | null;
  /** Every response field name the declared success schema carries at its top level, sorted. */
  readonly responseFields: readonly string[];
  /** Every OAuth scope this operation requires, sorted. Empty when it takes no user grant. */
  readonly scopes: readonly string[];
  /** The security scheme names the description requires, sorted. Empty when it declares public access. */
  readonly security: readonly string[];
  /** The description's own single server URL — provenance, not identity. See this file's header. */
  readonly server: string;
  /** What the vendor says about its stability — see {@link CanvaStability}. */
  readonly stability: CanvaStability;
  /**
   * One line saying what the operation does, derived from the vendor's own `description`.
   *
   * Derived rather than copied, because this description declares no `summary` on ANY of its 59 operations
   * and every one of them opens with markdown blocks rather than a sentence — `surfaceNaming.ts` carries
   * the rule and the measurement. Never `null`: every operation carries a description.
   */
  readonly synopsis: string;
  /**
   * Whether the vendor's own description tells the reader to use the Canva UI for something.
   *
   * `docs/atlas-intent/02-both-surfaces.md` says both surfaces are mandatory because they diverge, and this is that claim
   * evidenced from the vendor's own bytes rather than asserted: MEASURED, nine operations name the Canva UI.
   * Most only compare themselves to it — `deleteAsset` "mirrors the behavior in the Canva UI" — and TWO send
   * the reader there for something the description says the Connect API cannot do at all; `sync.ts` names
   * which two and `gaps.ts` raises them, because the difference is a judgement over prose rather than a
   * property a flag can carry.
   */
  readonly namesTheCanvaUi: boolean;
}
