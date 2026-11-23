/**
 * The shape of one row in the generated Knock operation registry.
 *
 * Hand-written and kept beside the generator's output for the reason `atlas/datadog/surfaceRow.ts` gives:
 * the TYPE has to be reviewable independently of the rows that satisfy it.
 *
 * ## Four dispositions, adopted rather than re-derived
 *
 * They are the Datadog, Airtable, Figma and Prisma registries', because the owner's scope rule is the same
 * rule on every platform: everything reachable, minus the voluminous, where "voluminous" is a TREATMENT and
 * never a refusal (`docs/atlas-intent/06-holdings.md`).
 *
 * ## What this platform adds is {@link KnockSurfaceRow.identifierFrom}, and it is the row's best field
 *
 * Knock publishes TWO APIs, and a read operation's identifier does not always come from the API that
 * declares it. `GET /v1/audiences/{key}/members` is a data-API operation and nothing in the data API lists
 * audiences — only the Management API does. `GET /v1/users/{user_id}/channel_data/{channel_id}` needs a
 * channel key that only the Management API can produce. So an integration built against one credential
 * discovers at runtime that a documented operation is unreachable, and a reader of either document alone
 * cannot see it coming.
 *
 * Recording it per operation turns that into arithmetic instead of a claim, and it produces the atlas's
 * third state: `unavailable`, an operation whose identifier NEITHER document produces. `GET
 * /v1/objects/{collection}` is the sharpest one — neither API declares an operation that lists an
 * account's object collections at all, so the whole objects tree is addressable only by a caller who
 * already knows the collection name, and this atlas says so rather than filing it as an ordinary entity.
 */
import type { KnockProbeEvidence } from "./apiProbe.js";
import type { KnockAtlasKind } from "./kinds.js";
import type { KnockApi, KnockHttpMethod, KnockPaging } from "./surfaceNaming.js";

/**
 * What this atlas DOES with one operation. Every row has exactly one, and the generator refuses to emit a
 * row it cannot decide.
 *
 * - `entity` — read, projected, and stored as records in this kind's file.
 * - `shape-index` — read over a bounded window, and only its SHAPE is stored: which record types the family
 *   emits and what a record's fields look like. Never a row per record, never a value. This is the
 *   voluminous DISPOSITION of `docs/atlas-intent/06-holdings.md`, applied per operation rather than per family.
 * - `probe-only` — called to establish posture and never stored. `GET /v1/whoami` is the whole set: it
 *   answers which service token this installation holds and what it is scoped to, which is a fact about the
 *   installation rather than about the organisation.
 * - `excluded` — inventoried and never called, for the reason on the row.
 * @internal
 */
export type KnockDisposition = "entity" | "shape-index" | "probe-only" | "excluded";

/**
 * Why an inventoried operation is never called.
 *
 * - `mutating` — it changes the account. This atlas only ever reads, so every `POST`, `PUT` and `DELETE`
 *   is inventoried with its parameters and never sent. Knock upserts by `PUT`, so this is 108 of the 216
 *   declared operations rather than the smaller set a `PATCH`-shaped API would give.
 * - `not-enumerable` — it answers about one identifier the caller must already hold, and no operation in
 *   EITHER published document produces the set of those identifiers. There is nothing for a sync to walk.
 * @internal
 */
export type KnockExclusionReason = "mutating" | "not-enumerable";

/**
 * Where the identifier a templated read needs comes from.
 *
 * - `none` — the operation takes no path parameter at all; it is a collection root.
 * - `same-api` — every `{brace}` segment is produced by a collection the SAME document declares. One
 *   credential walks it end to end.
 * - `other-api` — at least one is produced only by the OTHER document. Reaching it needs both a data-API
 *   key and a Management API service token, which no single page of Knock's own documentation says.
 * - `unavailable` — at least one is produced by NEITHER document. The operation is reachable only by a
 *   caller who already knows the value, and this atlas can never enumerate it.
 * @internal
 */
export type KnockIdentifierSource = "none" | "same-api" | "other-api" | "unavailable";

/** One Knock operation, as the closed registry holds it. */
export interface KnockSurfaceRow {
  /** Which of Knock's two published documents declared this operation. */
  readonly api: KnockApi;
  /** Whether the document marks this operation deprecated. Still served, and still in the registry. */
  readonly deprecated: boolean;
  readonly disposition: KnockDisposition;
  /** Why this row is not a plain `entity`. `null` only when it is one. */
  readonly dispositionBecause: string | null;
  /** Which refusal applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: KnockExclusionReason | null;
  /** Where the identifiers this operation's path template needs come from. See {@link KnockIdentifierSource}. */
  readonly identifierFrom: KnockIdentifierSource;
  /**
   * Whether the operation declares an `environment` query parameter, so a caller must say which
   * environment it means rather than inheriting one from the credential. True on 71 of the Management
   * API's 98 operations and on none of the data API's.
   */
  readonly environmentScoped: boolean;
  /**
   * The atlas kind this operation's own resource belongs to, decided in `kinds.ts` by path prefix rather
   * than taken from the tag — that file's header carries why the tag cannot be used on this platform.
   */
  readonly kind: KnockAtlasKind;
  readonly method: KnockHttpMethod;
  /**
   * Knock's own `operationId`.
   *
   * NOT a name Knock chose freely, which is why it is carried as a label and never used as this atlas's
   * key: EIGHT of the data-API document's 118 operations carry an id whose uniqueness was manufactured by
   * appending a literal ` (2)` — `triggerWorkflow (2)`, `markMessageUnseen (2)` and six more — so the id of
   * a given operation depends on the order the generator met them and moves when Knock reorders the
   * document. The Management API's 98 have none. `providerId` is `<METHOD> <path>` for that reason.
   */
  readonly operationId: string;
  readonly paging: KnockPaging;
  /** The document's own path template, `{brace}` parameters intact. Never a caller-supplied identifier. */
  readonly path: string;
  /** What an unauthenticated request established about this route — see `apiProbe.ts`. */
  readonly probeEvidence: KnockProbeEvidence;
  /** How many distinct response field PATHS the document declares for this operation's success response. */
  readonly responseFieldCount: number;
  /** Knock's own one-line `summary`, or `null` when it publishes none. */
  readonly summary: string | null;
  /** Knock's own first tag, kept verbatim so the provider's vocabulary stays greppable beside ours. */
  readonly tag: string;
}
