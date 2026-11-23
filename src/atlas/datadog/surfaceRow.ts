/**
 * The shape of one row in the generated surface registry.
 *
 * Hand-written and kept beside the generator's output rather than inside it, so the TYPE is reviewable
 * independently of the 1,735 rows that satisfy it — a generated file nobody reads is a poor place to
 * discover that a field changed meaning.
 */
import type { DatadogPaging, DatadogSpec } from "./surfaceNaming.js";

/**
 * What this atlas DOES with one operation. Every row has exactly one, and the generator refuses to emit a
 * row it cannot decide.
 *
 * Four dispositions rather than a callable/refused pair, because the owner's scope rule — "everything
 * reachable minus the voluminous" — is not a refusal. It is a different TREATMENT, and modelling it as a
 * refusal would have made this atlas answer "Datadog has no log search", which is false, and would have
 * contradicted the owner's rule that voluminous telemetry is still acted on, never skipped.
 *
 * - `entity` — called, projected, and stored as records in this kind's file.
 * - `shape-index` — called over a bounded window, and only its SHAPE is stored: which kinds exist and what
 *   an entry's attributes look like. Never an entry, never a value, never a metric point.
 * - `probe-only` — called to establish posture and never stored at all. The credential-validation calls are
 *   the whole set: they answer "does this key work", which is not a thing the atlas holds.
 * - `excluded` — inventoried and never called, for the reason on the row.
 */
export type DatadogDisposition = "entity" | "shape-index" | "probe-only" | "excluded";

/**
 * Why an inventoried operation is never called.
 *
 * - `mutating` — it changes the tenant. This atlas only ever reads.
 * - `side-effecting` — it does not change stored configuration but it makes Datadog ACT: trigger, page,
 *   send, or reach out to a third party. Not an observation, whatever its HTTP verb says.
 * - `secret-bearing` — issuing it discloses credential material that no projection can remove, because the
 *   material is in the REQUEST rather than only the response.
 * - `unsupported-sensitive-shape` — the response models carry free-form fields this atlas has no allowlist
 *   projection for, so a stored record could hold credential material nothing denies.
 *
 * ## The fourth reason is about THIS ATLAS, and that is the point of stating it here
 *
 * The first three are facts about the OPERATION and are true forever: a PUT writes, a trigger fires
 * traffic, a key in a path is disclosed. `unsupported-sensitive-shape` is a fact about what this atlas can
 * safely STORE today. It is true on every installation alike, and it stops being true when the allowlist
 * projection `sensitiveFields.ts` describes ships, not when anybody's tenant changes.
 *
 * It is never a way to make a hard kind smaller, and never for VOLUME, which is `shape-index`'s job and
 * stays so. The bar is a full atlas, so a kind carrying this reason is a gap the projection closes.
 */
export type DatadogExclusionReason = "mutating" | "side-effecting" | "secret-bearing" | "unsupported-sensitive-shape";

/** One Datadog operation, as the closed registry holds it. */
export interface DatadogSurfaceRow {
  readonly disposition: DatadogDisposition;
  /** Why this row is not a plain `entity`. `null` only when it is one. */
  readonly dispositionBecause: string | null;
  /** Which of the three refusals applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: DatadogExclusionReason | null;
  /** The atlas kind this contributes to — the provider's own first meaningful path segment. */
  readonly kind: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The name a caller passes instead of a URL — the SDK's own operation key, kebab-cased. */
  readonly name: string;
  /** The SDK's own `<spec>.<Class>Api.<operation>` key, kept verbatim as the reproduction handle. */
  readonly operationKey: string;
  /**
   * How a collection is walked. The exact parameter NAMES live in
   * {@link import("./generated/pagingParameters.js").DATADOG_PAGING_PARAMETERS} rather than on this row —
   * see that file's header for the measurement that put them there.
   */
  readonly paging: DatadogPaging;
  /** The SDK's own path template, `{brace}` parameters intact. Never a caller-supplied base. */
  readonly path: string;
  readonly spec: DatadogSpec;
  /**
   * Datadog's own unstable marking, read from the client's `unstableOperations` guard rather than guessed
   * from the path. A fact to weigh, gated by nothing — `kit/contract.ts` says why an atlas must not refuse
   * an undocumented or unstable endpoint that works.
   */
  readonly unstable: boolean;
  /** Datadog's own `deprecated` flag, from the pinned specification. The SDK drops it. */
  readonly deprecated: boolean;
}
