/**
 * A product this ORGANISATION does not have, recorded as a fact rather than left as a failed read.
 *
 * Owner ruling: the point of the atlas is to hold everything reachable, so what cannot be reached is
 * excluded and said to be unreachable. As a general rule, a product the organisation does not have is valid
 * to exclude, or else the rule would be nonsensical.
 *
 * The case that raised it: the JumpCloud atlas declares `gcep` (Google Chrome Enterprise Premium), the
 * tenancy has no such product, the provider answers 404, and `./mandatoryKinds.ts` refused every publish
 * because a never-acquired mandatory kind was exempt only when a {@link AtlasPermissionBlock} explained it.
 * No grant and no re-run can acquire a product the organisation never bought, so the atlas could never
 * publish at all.
 *
 * It is a SIBLING of `./permissionBlock.ts` rather than a second use of it, because the ruling that
 * field implements is that a reader must never guess WHY a surface is dark: a permission block says a grant
 * would light it, and this says nothing short of the organisation adopting the product would. Folding one
 * into the other would print "reachable if the permissions are widened" over a product nobody owns.
 *
 * What makes the exemption safe is the same thing that makes the permission one safe: a platform stamps this
 * only after CLASSIFYING the provider's own answer from a typed error — every failure on the kind a
 * route-absent answer, and nothing read at all. A kind that 404s on one record among many it did read is a
 * record gone, not a product absent, and must not carry this.
 *
 * This module imports nothing but Zod for the reason `./permissionBlock.ts` states: the atlas model modules
 * declare their manifest schemas against it, and an import back into the store tree puts the schema inside
 * an import cycle.
 */
import { z } from "zod";

/** See this module's header — the one field that tells a reader "the organisation has none of this". */
export interface AtlasProductAbsence {
  /** When the provider last answered that the product is absent, so a stale answer is visible as stale. */
  readonly at: string;
  /** The provider's own answer, carried rather than paraphrased — which operation, and what it said. */
  readonly detail: string;
}

/** {@link AtlasProductAbsence}, as a schema — see this module's header for why the field exists at all. */
export const atlasProductAbsenceSchema = z
  .object({
    at: z.iso.datetime(),
    detail: z.string().min(1),
  })
  .strict();
