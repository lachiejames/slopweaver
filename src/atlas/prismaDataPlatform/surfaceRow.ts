/**
 * The shape of one row in the generated Prisma Data Platform surface registry.
 *
 * Hand-written and kept beside the generator's output for the reason `atlas/datadog/surfaceRow.ts` gives:
 * the TYPE has to be reviewable independently of the rows that satisfy it.
 *
 * ## Four dispositions, adopted rather than re-derived
 *
 * They are the Datadog, Airtable and Figma registries', because the owner's scope rule is the same rule on
 * every platform: everything reachable, minus the voluminous, where "voluminous" is a TREATMENT and never a
 * refusal (`docs/atlas-intent/06-holdings.md`).
 *
 * ## What this platform adds are `stability` and `documented`, and both are facts rather than decisions
 *
 * Seventy of the 115 operations carry Prisma's own `x-prisma-stability: experimental`, and the docs site
 * publishes a page for exactly the other 45. Recording both per operation is what lets the atlas state the
 * partition as arithmetic instead of asserting it — and it is the finding that makes this atlas worth
 * having, since a reader working from `www.prisma.io/docs` alone would conclude the Management API is 45
 * operations over Prisma Postgres, and never learn that the whole Prisma Compute product is reachable.
 *
 * `deprecated` is the third such fact. Eleven operations carry it, all eleven under `/v1/apps`, and every
 * one is mirrored by a `/v1/services` sibling — so the flag being per-operation is what lets
 * `generated/specLock.ts` name a whole noun being renamed in place rather than eleven unrelated retirements.
 *
 * There is deliberately no `volumeJudgedPerScope` here, and its absence is the point rather than an
 * omission. Airtable needed it because one operation is an entity source in one base and a warehouse dump
 * in the next. Prisma has no such operation: the two genuinely unbounded families are the build and
 * deployment log streams, and they are unbounded for every scope, so they are settled statically as
 * `shape-index`. A flag no row would ever set would be a contract claiming a judgement nobody makes.
 */
import type { PrismaProbeEvidence } from "./apiProbe.js";
import type { PrismaDataPlatformAtlasKind } from "./kinds.js";
import type { PrismaAuthMethod, PrismaHttpMethod, PrismaPaging, PrismaStability } from "./surfaceNaming.js";

/**
 * What this atlas DOES with one operation. Every row has exactly one, and the generator refuses to emit a
 * row it cannot decide.
 *
 * - `entity` — called, projected, and stored as records in this kind's file.
 * - `shape-index` — called over a bounded window, and only its SHAPE is stored: which record types the
 *   stream emits and what a line's fields look like. Never a line, never a value.
 * - `probe-only` — called to establish posture and never stored. `GET /v1/me` is the whole set: it answers
 *   which identity this installation's credential carries, which is a fact about the installation rather
 *   than about the organisation, and its response carries a person's email address.
 * - `excluded` — inventoried and never called, for the reason on the row.
 * @internal
 */
export type PrismaDisposition = "entity" | "shape-index" | "probe-only" | "excluded";

/**
 * Why an inventoried operation is never called.
 *
 * - `mutating` — it changes the tenant. This atlas only ever reads.
 * - `not-enumerable` — it answers about one identifier the caller must already hold, and no operation
 *   anywhere produces the set of those identifiers. There is nothing for a sync to walk.
 *
 * There is deliberately no `render-only` member, and Figma's having one is why that is worth stating
 * rather than leaving as an absence. Nothing on this platform's read surface returns a generated artifact
 * behind an expiring address — every GET here answers with a fact about the account.
 * @internal
 */
export type PrismaExclusionReason = "mutating" | "not-enumerable";

/** One Prisma Data Platform management-API operation, as the closed registry holds it. */
export interface PrismaSurfaceRow {
  /** Every OTHER kind this one response also fills, because it carries them nested. Usually empty. */
  readonly alsoFeeds: readonly PrismaDataPlatformAtlasKind[];
  /** Every credential form the document says this operation accepts, sorted. */
  readonly authMethods: readonly PrismaAuthMethod[];
  /** Whether the document marks this operation deprecated. Still served, and still in the registry. */
  readonly deprecated: boolean;
  readonly disposition: PrismaDisposition;
  /** Why this row is not a plain `entity`. `null` only when it is one. */
  readonly dispositionBecause: string | null;
  /**
   * The `www.prisma.io/docs` page that documents this operation, or `null` when the docs site publishes
   * none. Measured against the docs sitemap rather than inferred from {@link stability}.
   */
  readonly docsUrl: string | null;
  /** Which refusal applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: PrismaExclusionReason | null;
  /**
   * The atlas kind this operation's own resource belongs to, decided in `kinds.ts` by path prefix rather
   * than taken from the tag — that file's header carries why the tag cannot be used on this platform.
   */
  readonly kind: PrismaDataPlatformAtlasKind;
  readonly method: PrismaHttpMethod;
  /** Prisma's own generated `operationId`, unique across the document and used as the surface name. */
  readonly name: string;
  readonly paging: PrismaPaging;
  /** The document's own path template, `{brace}` parameters intact. Never a caller-supplied identifier. */
  readonly path: string;
  /**
   * What an unauthenticated request established about this route, or `unprobed-mutating` for the 61
   * operations this atlas will not send. See `apiProbe.ts`.
   */
  readonly probeEvidence: PrismaProbeEvidence;
  /** How many distinct response field PATHS the document declares across every status code for this row. */
  readonly responseFieldCount: number;
  /** Every OAuth scope the document says this operation requires, sorted. Empty when it declares none. */
  readonly scopes: readonly string[];
  /** What Prisma's own `x-prisma-stability` extension says, with its absence named `stable`. */
  readonly stability: PrismaStability;
  /** Prisma's own one-line `summary`, or `null` when it publishes none. */
  readonly summary: string | null;
  /** Prisma's own first tag, kept verbatim so the provider's vocabulary stays greppable beside ours. */
  readonly tag: string;
}
