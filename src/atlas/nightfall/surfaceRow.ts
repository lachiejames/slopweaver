/**
 * The shape of one row in the generated Nightfall surface registry.
 *
 * Hand-written and kept beside the generator's output rather than inside it, so the TYPE is reviewable
 * independently of the rows that satisfy it — a generated file nobody reads is a poor place to discover
 * that a field changed meaning. Datadog's `surfaceRow.ts` is the sibling this follows.
 *
 * ## The SERVER is part of an operation's identity here, and that is a finding rather than a formality
 *
 * MEASURED while building this atlas: `GET /events`, `GET /events/search`, `GET /asset/activity`
 * and `GET /actor/activity` are each declared TWICE across the vendor's six published documents — once under
 * `https://api.nightfall.ai/exfiltration/v1` and once under `https://api.nightfall.ai/posture/v1`. The path
 * templates are byte-identical and the two return different things. An extraction that keyed on the path
 * alone silently folded twelve operations into six, which is exactly what the first scrape of the vendor's
 * documentation pages did before the OpenAPI documents were found. So {@link NightfallSurfaceRow.server} is
 * carried on every row and the provider key is `<METHOD> <server><path>`.
 */
import type { NightfallApi, NightfallPaging, NightfallSpecDocument } from "./surfaceNaming.js";

/**
 * What this atlas DOES with one operation. Every row has exactly one, and the generator refuses to emit a
 * row it cannot decide.
 *
 * The four members are Datadog's, and they are reused rather than re-derived because the ruling behind them
 * is the platform-independent one: "everything reachable minus the highly voluminous" (`docs/atlas-intent/06-holdings.md`
 * §6) is a different TREATMENT, never a refusal. Modelling the voluminous half as an exclusion would make
 * this atlas answer "Nightfall has no violation feed", which is false and is the single most misleading
 * thing a DLP atlas could say.
 *
 * - `entity` — called, projected, and stored as records in this kind's file.
 * - `shape-index` — called over a bounded window, and only its SHAPE is stored: that the family exists, what
 *   a record's field names are, and what the window returned as a COUNT. Never a violation, never a finding,
 *   never a person's exfiltrated bytes.
 * - `probe-only` — called to establish posture and never stored at all.
 * - `excluded` — inventoried and never called, for the reason on the row.
 */
export type NightfallDisposition = "entity" | "shape-index" | "probe-only" | "excluded";

/**
 * Why an inventoried operation is never called.
 *
 * - `mutating` — it changes the tenant. This atlas only ever reads.
 * - `side-effecting` — it does not change stored configuration but it makes Nightfall ACT: classify, bill,
 *   or accept content. Not an observation, whatever its HTTP verb says.
 * - `egressing` — issuing it would send this machine's own content to the vendor. The scan family is the
 *   whole of this class, and it is the one exclusion reason a DLP platform makes unavoidable: the product's
 *   primary endpoint takes your data as its REQUEST body.
 */
export type NightfallExclusionReason = "mutating" | "side-effecting" | "egressing";

/** One Nightfall operation, as the closed registry holds it. */
export interface NightfallSurfaceRow {
  /** Which of the vendor's published APIs declares it — the product area, in the vendor's own words. */
  readonly api: NightfallApi;
  /** Every request body field name the declared body schema carries, sorted. Empty for a bodyless call. */
  readonly bodyParams: readonly string[];
  /** The document's own `deprecated` flag. */
  readonly deprecated: boolean;
  readonly disposition: NightfallDisposition;
  /** Why this row is not a plain `entity`. `null` only when it is one. */
  readonly dispositionBecause: string | null;
  /** Which of the three refusals applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: NightfallExclusionReason | null;
  /** Every header parameter name the document declares, sorted. */
  readonly headerParams: readonly string[];
  /** The atlas kind this contributes to. */
  readonly kind: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The name a caller passes instead of a URL, kebab-cased and unique across the whole registry. */
  readonly name: string;
  /** The document's own `operationId`, or `null` where it declares none — most of these documents do not. */
  readonly operationId: string | null;
  readonly paging: NightfallPaging;
  /** Every path parameter name, in path order. */
  readonly pathParams: readonly string[];
  /** The document's own path template, `{brace}` parameters intact. */
  readonly path: string;
  /** Every query parameter name the document declares, sorted. */
  readonly queryParams: readonly string[];
  /** Every response field name the declared success schema carries at its top level, sorted. */
  readonly responseFields: readonly string[];
  /** The security schemes the document requires for it, sorted. */
  readonly security: readonly string[];
  /** The document's own server URL. Part of the identity — see this file's header. */
  readonly server: string;
  /** Which published document declared it — the reproduction handle back to the vendor's own bytes. */
  readonly specDocument: NightfallSpecDocument;
  /** The document's own one-line summary, or `null` when it declares none — never an empty string. */
  readonly summary: string | null;
}
