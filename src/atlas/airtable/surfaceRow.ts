/**
 * The shape of one row in the generated Airtable surface registry.
 *
 * Hand-written and kept beside the generator's output for the reason `atlas/datadog/surfaceRow.ts` gives:
 * the TYPE has to be reviewable independently of the rows that satisfy it.
 *
 * ## Four dispositions, and one flag the Datadog registry did not need
 *
 * The four dispositions are the Datadog atlas's, adopted rather than re-derived, because the owner's scope
 * rule is the same rule on both platforms: everything reachable, minus the voluminous, where "voluminous"
 * is a TREATMENT and never a refusal. What Airtable adds is {@link AirtableSurfaceRow.volumeJudgedPerScope},
 * and it is the handover's own words — _"per-base record volume is judged base by base against the
 * voluminous-surface exclusion"_.
 *
 * That flag exists because Airtable is the platform where the voluminous criterion cannot be settled by
 * looking at the operation. `GET /v0/{baseId}/{tableIdOrName}` returns rows a PERSON created, named, and
 * can list exhaustively — configuration by the criterion in `docs/atlas-intent/06-holdings.md`, and the ops tables
 * this atlas exists to hold. It is also the operation that would return a hundred thousand rows against a
 * base somebody is using as a warehouse. The same call is an entity source in one base and a voluminous
 * surface in the next, so the disposition on the ROW is `entity` and the judgement is made per scope at
 * sync time, recorded on that scope's own coverage cell. A registry that decided it statically would be
 * wrong in one direction or the other for every install.
 */
import type { AirtableAtlasKind } from "./kinds.js";
import type { AirtableAuthMethod, AirtableHttpMethod, AirtablePaging } from "./surfaceNaming.js";

/**
 * What this atlas DOES with one operation. Every row has exactly one, and the generator refuses to emit a
 * row it cannot decide.
 *
 * - `entity` — called, projected, and stored as records in this kind's file.
 * - `shape-index` — called over a bounded window, and only its SHAPE is stored: which event kinds exist and
 *   what an entry's attributes look like. Never an entry, never a value.
 * - `probe-only` — called to establish posture and never stored. `GET /v0/meta/whoami` is the whole set: it
 *   answers which token this installation holds and what it may ask for, which is a fact about the
 *   installation rather than about the organisation.
 * - `excluded` — inventoried and never called, for the reason on the row.
 */
type AirtableDisposition = "entity" | "shape-index" | "probe-only" | "excluded";

/**
 * Why an inventoried operation is never called.
 *
 * - `mutating` — it changes the tenant. This atlas only ever reads.
 * - `side-effecting` — it does not change stored configuration but it makes Airtable ACT on somebody:
 *   `POST …/users/{userId}/logout` ends a real person's sessions, and no HTTP verb makes that an
 *   observation.
 *
 * There is deliberately no `secret-bearing` member, and the Datadog registry's having one is why that is
 * worth stating rather than leaving as an absence. On Airtable the credential-disclosure class is entirely
 * in the RESPONSE direction — a webhook's `macSecretBase64`, an eDiscovery export's signed download URLs, a
 * share's token prefix — and a response is `sensitiveFields.ts`'s half of the boundary, not this one. No
 * operation here discloses credential material by being CALLED, so declaring a refusal with no member would
 * be a vocabulary claiming a judgement nobody made.
 */
type AirtableExclusionReason = "mutating" | "side-effecting";

/** One Airtable Web API operation, as the closed registry holds it. */
export interface AirtableSurfaceRow {
  /** Which of the three refusals applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: AirtableExclusionReason | null;
  /** Every credential form the specification says this operation accepts, sorted. */
  readonly authMethods: readonly AirtableAuthMethod[];
  readonly disposition: AirtableDisposition;
  /** Why this row is not a plain `entity`. `null` only when it is one. */
  readonly dispositionBecause: string | null;
  /**
   * The atlas kind this operation's own resource belongs to, decided in `kinds.ts` rather than taken from
   * the tag — that file's header carries the three reasons Airtable's tags cannot be used directly.
   */
  readonly kind: AirtableAtlasKind;
  /** Every OTHER kind this one response also fills, because it carries them nested. Usually empty. */
  readonly alsoFeeds: readonly AirtableAtlasKind[];
  /** Airtable's own first tag, kept verbatim so the provider's vocabulary stays greppable beside ours. */
  readonly tag: string;
  readonly method: AirtableHttpMethod;
  /** Airtable's own `operationId`, unique across the document and used as the surface name. */
  readonly name: string;
  readonly paging: AirtablePaging;
  /** The specification's own path template, `{brace}` parameters intact. Never a caller-supplied base. */
  readonly path: string;
  /** Every OAuth scope the specification says this operation requires, sorted. Empty when it declares none. */
  readonly scopes: readonly string[];
  /** Airtable's own one-line `summary`, or `null` when it publishes none. */
  readonly summary: string | null;
  /**
   * Whether this operation's volume is judged per SCOPE at sync time rather than settled here. See this
   * file's header — the records and comments families are the whole set.
   */
  readonly volumeJudgedPerScope: boolean;
}
