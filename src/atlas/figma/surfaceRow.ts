/**
 * The shape of one row in the generated Figma surface registry.
 *
 * Hand-written and kept beside the generator's output for the reason `atlas/datadog/surfaceRow.ts` gives:
 * the TYPE has to be reviewable independently of the rows that satisfy it.
 *
 * ## Four dispositions, adopted rather than re-derived
 *
 * They are the Datadog and Airtable registries', because the owner's scope rule is the same rule on every
 * platform: everything reachable, minus the voluminous, where "voluminous" is a TREATMENT and never a
 * refusal (`docs/atlas-intent/06-holdings.md`).
 *
 * ## What Figma adds is `deprecated`, and it is a FACT rather than a decision
 *
 * Four operations carry `deprecated: true` and all four are still served, so all four keep an ordinary
 * disposition. The flag is on the row because a reader planning an integration needs it and because the
 * atlas can see something no single row shows: all three operations under the `Projects` tag are
 * deprecated, so a whole declared surface has been retired in place. `generated/specLock.ts` carries that
 * finding, and it is only expressible because the flag is recorded per operation rather than inferred from
 * a summary string.
 *
 * There is deliberately no `volumeJudgedPerScope` here, and its absence is the point rather than an
 * omission. Airtable needed it because `GET /v0/{baseId}/{tableIdOrName}` is an entity source in one base
 * and a warehouse dump in the next, so the same row had to be judged per scope. Figma has no such
 * operation: `getFile` returns one document whose size is a property of that document rather than of how
 * somebody chose to use the platform, and the genuinely unbounded families here — the activity log, the
 * developer log, the AI-usage feed, a webhook's request history and the library-analytics action feeds —
 * are unbounded for EVERY scope and are settled statically as `shape-index`. Carrying a flag no row would
 * ever set would be a contract claiming a judgement nobody makes.
 */
import type { FigmaAtlasKind } from "./kinds.js";
import type { FigmaAuthMethod, FigmaHttpMethod, FigmaPaging } from "./surfaceNaming.js";

/**
 * What this atlas DOES with one operation. Every row has exactly one, and the generator refuses to emit a
 * row it cannot decide.
 *
 * - `entity` — called, projected, and stored as records in this kind's file.
 * - `shape-index` — called over a bounded window, and only its SHAPE is stored: which event kinds exist and
 *   what an entry's attributes look like. Never an entry, never a value.
 * - `probe-only` — called to establish posture and never stored. `GET /v1/me` is the whole set: it answers
 *   which identity this installation's token carries, which is a fact about the installation rather than
 *   about the organisation.
 * - `excluded` — inventoried and never called, for the reason on the row.
 */
type FigmaDisposition = "entity" | "shape-index" | "probe-only" | "excluded";

/**
 * Why an inventoried operation is never called.
 *
 * - `mutating` — it changes the tenant. This atlas only ever reads.
 * - `render-only` — its response is a generated ARTIFACT rather than a fact about the platform: a rendered
 *   image behind an address Figma expires, or an embed fragment. Calling it produces something to look at
 *   and nothing to store, and the underlying nodes are already reachable through `getFileNodes`.
 * - `not-enumerable` — it answers a question about one identifier the caller must already hold, and no
 *   operation anywhere produces the set of those identifiers. There is nothing for a sync to walk.
 *
 * There is deliberately no `side-effecting` member, and the Airtable registry's having one is why that is
 * worth stating rather than leaving as an absence. Nothing in Figma's read surface reaches out and acts on
 * a person the way `POST …/users/{userId}/logout` does there, so declaring the refusal would be a
 * vocabulary claiming a judgement nobody made.
 */
type FigmaExclusionReason = "mutating" | "render-only" | "not-enumerable";

/** One Figma REST operation, as the closed registry holds it. */
export interface FigmaSurfaceRow {
  /** Every OTHER kind this one response also fills, because it carries them nested. Usually empty. */
  readonly alsoFeeds: readonly FigmaAtlasKind[];
  /** Every credential form the document says this operation accepts, sorted. */
  readonly authMethods: readonly FigmaAuthMethod[];
  /** Whether the document marks this operation deprecated. Still served, and still in the registry. */
  readonly deprecated: boolean;
  readonly disposition: FigmaDisposition;
  /** Why this row is not a plain `entity`. `null` only when it is one. */
  readonly dispositionBecause: string | null;
  /** Which of the three refusals applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: FigmaExclusionReason | null;
  /**
   * The atlas kind this operation's own resource belongs to, decided in `kinds.ts` rather than taken from
   * the tag — that file's header carries the reasons Figma's tags cannot be used directly.
   */
  readonly kind: FigmaAtlasKind;
  readonly method: FigmaHttpMethod;
  /** Figma's own `operationId`, unique across the document and used as the surface name. */
  readonly name: string;
  readonly paging: FigmaPaging;
  /** The document's own path template, `{brace}` parameters intact. Never a caller-supplied identifier. */
  readonly path: string;
  /** Every OAuth scope the document says this operation requires, sorted. Empty when it declares none. */
  readonly scopes: readonly string[];
  /** Figma's own one-line `summary`, or `null` when it publishes none. */
  readonly summary: string | null;
  /** Figma's own first tag, kept verbatim so the provider's vocabulary stays greppable beside ours. */
  readonly tag: string;
}
