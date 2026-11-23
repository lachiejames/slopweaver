/**
 * The shape of one row in the generated surface registry.
 *
 * Hand-written and kept beside the generator's output rather than inside it, so the TYPE is reviewable
 * independently of the 500-odd rows that satisfy it — a generated file nobody reads is a poor place to
 * discover that a field changed meaning.
 */
import type { JumpcloudPagination, JumpcloudSpec } from "../jumpcloud/surfaceNaming.js";

/**
 * Whether an operation may be called at all, or is inventoried and refused — and, for a refused one, why.
 *
 * The reason is part of what `excluded` MEANS rather than an optional extra beside it, so the two travel as
 * one discriminated pair: an excluded row with no reason does not compile, and a refusal never has to supply
 * a stand-in sentence for one.
 */
type JumpcloudCoverage =
  | {
      /** `reachable` rows have a callable request variant. */
      readonly coverage: "reachable";
      readonly excludedBecause: null;
    }
  | {
      /** `excluded` rows never have a callable variant. */
      readonly coverage: "excluded";
      /** Why the row is refused, stated in coverage output. */
      readonly excludedBecause: string;
    };

/** One JumpCloud operation, as the closed registry holds it. */
export type JumpcloudSurfaceRow = JumpcloudCoverage & {
  /** The atlas kind this contributes to — the provider's own first path segment. */
  readonly kind: string;
  readonly method: "GET" | "POST";
  /** The name a caller passes instead of a URL. */
  readonly name: string;
  /** Which pinned origin this is reached at; never a caller-supplied base. */
  readonly origin: "directory" | "insights";
  readonly pagination: JumpcloudPagination;
  /** The pinned prefix plus the specification's own path key, `{brace}` parameters intact. */
  readonly path: string;
  readonly spec: JumpcloudSpec;
};
