/**
 * What the vendor says a caller must BE, and how stable each operation is — read out of description prose,
 * because that is the only place Canva puts either.
 *
 * ## Why a whole module for two fields
 *
 * Because this is the reachability contract, and no machine-readable field in the document carries it. An
 * OpenAPI reader that took `security`, `parameters` and `responses` — which is every sibling atlas's
 * extraction — would publish a surface map saying `design:meta:read` is what the analytics family needs.
 * MEASURED over the pinned bytes: five analytics operations declare, in an `<Availability>`
 * block inside their own `description`, that the acting user must be a member of a Canva Enterprise
 * organisation. A scope grant does not make them callable, and nothing outside the prose says so.
 *
 * The census, all of it from the pinned description:
 *
 * - **Stability** — 20 operations carry a `<Warning>` saying the API is a preview (unannounced breaking
 *   changes, no version bump on a break, and a public integration using one cannot pass Canva's review);
 *   one, `createComment`, carries a `<Warning>` naming its replacement. The other 38 carry no warning.
 * - **Entitlement** — nine carry an `<Availability>`: seven require a Canva Enterprise organisation (the
 *   five analytics reads and the two autofill jobs), two require a premium plan (the two resize jobs).
 *
 * ## The vendor disagrees with itself, and that disagreement is atlas content
 *
 * Canva ALSO publishes a machine-readable `x-required-capabilities` extension, and it does not agree with
 * its own prose. Seven operations declare one — `analytics` on the five analytics reads, `resize` on the
 * two resize jobs — while nine declare an `<Availability>`. The two autofill jobs whose prose requires a
 * Canva Enterprise organisation declare NO capability at all. Reproduce it against the pinned document:
 *
 * ```bash
 * grep -c 'x-required-capabilities' <spec-dir>/api.yml   # 7
 * grep -c '<Availability>'          <spec-dir>/api.yml   # 9
 * ```
 *
 * This atlas keeps both — the extension on {@link ../surfaceRow.js#CanvaSurfaceRow.capabilities}, the
 * prose verdict on `entitlement` — and `gaps.ts` raises the difference rather than picking a winner. That
 * is `docs/atlas-intent/04-corroboration.md` applied to a disagreement INSIDE one surface: one field succeeding must
 * never erase what another already knew, and which side is right is not this session's to decide.
 *
 * Every function here is total over the pinned description and THROWS on a block it cannot classify, for
 * the reason `surfaceNaming.ts` states: the failure mode of an atlas is not a crash, it is a confident
 * wrong answer about what a platform lets you do.
 */
import { canvaFlattenProse } from "./surfaceNaming.js";
import type { CanvaEntitlement, CanvaStability } from "./surfaceRow.js";

/**
 * What the entitlement rule decided for one operation, and the vendor's own words for it.
 * @internal
 */
export interface CanvaEntitlementVerdict {
  readonly entitlement: CanvaEntitlement;
  /** The vendor's own requirement sentence. `null` only when the entitlement is `none`. */
  readonly entitlementBecause: string | null;
}

/**
 * The body of one named MDX block, or `null` when the description carries none.
 *
 * @param description the vendor's own description
 * @param tag the block name, e.g. `Availability`
 * @returns the block's inner prose, flattened, or `null`
 */
function mdxBlock({ description, tag }: { description: string; tag: string }): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(description);
  const body = match?.[1];
  if (body === undefined) {
    return null;
  }
  return canvaFlattenProse({ prose: body });
}

/**
 * How stable the vendor says one operation is.
 *
 * THROWS on a `<Warning>` matching neither known shape, so a description that grows a third kind of warning
 * fails the generator instead of being filed as `stable` — which would be the one wrong answer here that
 * nothing downstream could notice.
 *
 * @param description the vendor's own description
 * @param name the operation id, quoted in the failure so a bad row names itself
 * @returns what the prose says about its stability
 */
export function canvaStabilityFor({ description, name }: { description: string; name: string }): CanvaStability {
  const warning = mdxBlock({ description, tag: "Warning" });
  if (warning === null) {
    return "stable";
  }
  if (warning.includes("deprecated")) {
    return "deprecated";
  }
  if (warning.includes("provided as a preview")) {
    return "preview";
  }
  throw new Error(`canvaStabilityFor: ${name} carries a <Warning> this rule does not classify: ${warning}`);
}

/**
 * What the vendor says a caller must BE for one operation to work.
 *
 * Classified on the two things the requirement sentences actually name — a Canva Enterprise organisation,
 * or a plan with premium features — rather than on the whole sentence, because the trial paragraph that
 * follows differs between operations while the requirement does not.
 *
 * @param description the vendor's own description
 * @param name the operation id, quoted in the failure so a bad row names itself
 * @returns the entitlement and the vendor's own words for it
 */
export function canvaEntitlementFor({
  description,
  name,
}: {
  description: string;
  name: string;
}): CanvaEntitlementVerdict {
  const availability = mdxBlock({ description, tag: "Availability" });
  if (availability === null) {
    return { entitlement: "none", entitlementBecause: null };
  }
  if (availability.includes("Canva Enterprise")) {
    return { entitlement: "enterprise-organization", entitlementBecause: availability };
  }
  if (availability.includes("premium features")) {
    return { entitlement: "premium-plan", entitlementBecause: availability };
  }
  throw new Error(
    `canvaEntitlementFor: ${name} carries an <Availability> this rule does not classify: ${availability}`,
  );
}
