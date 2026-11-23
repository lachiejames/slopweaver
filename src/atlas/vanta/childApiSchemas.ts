/**
 * Zod schemas for the Manage API collections this atlas reaches by fanning out over a parent it already
 * holds — one request per parent row, rather than one request for the whole family.
 *
 * Every schema below is transcribed from the OpenAPI document pinned in `generated/specLock.ts` and then
 * checked against the live answer. Reproduce the check with `yarn tsx tools/probeVantaGetEndpoints.ts`,
 * which sends each of these against a real parent id chained out of the collection above it.
 *
 * ## Only three schemas live here, and the rest is the point
 *
 * `sdk/schemas/vendors.ts` and `sdk/schemas/documents.ts` already declare the row shapes for a vendor's
 * assessments, its security reviews, its documents, a document's links and a document's uploads — built
 * from the same published spec, field for field. A Codex review pass found the first draft of this file
 * redeclaring all five, which is the duplication `.claude/rules/error-handling.md` names as the class that
 * regenerates through careful work. They are imported by `childCensus.ts` instead, and what remains here
 * is the three shapes nothing else in this repository had.
 *
 * ## Five of the child surfaces carry no new object, and that is why `childCensus.ts` splits them out
 *
 * MEASURED against the document: the rows `/controls/{controlId}/documents` returns are the
 * `/documents` row shape exactly, `/documents/{documentId}/controls` and `/frameworks/{frameworkId}/controls`
 * return the `/controls` row shape exactly, and `/groups/{groupId}/people` returns the `/people` row shape
 * exactly. The only thing those four calls establish that this atlas did not already hold is the PAIRING,
 * so the pairing is what is stored and the object stays where it already lives, addressed by its id. Storing
 * it twice would be the duplication `covered-by-list` exists to prevent, on the same objects.
 *
 * `/risk-scenarios/{riskScenarioId}/controls` is the fifth and is a pairing by construction — Vanta returns
 * `{ controlId, controlType }` and no control object at all.
 */
import { z } from "zod";

/** One kind of resource a connected integration exposes, and what Vanta may change about it. */
export const vantaResourceKindDtoSchema = z
  .object({
    canUpdateDescription: z.boolean(),
    canUpdateOwner: z.boolean(),
    integrationId: z.string(),
    isScopable: z.boolean(),
    resourceKind: z.string(),
  })
  .strict();

export type VantaResourceKindDto = z.infer<typeof vantaResourceKindDtoSchema>;

/**
 * One account an integration attributes to a discovered vendor — a person's login, or a machine.
 *
 * A discriminated union on `type` rather than one widened object, because the two arms genuinely differ: a
 * USER carries an email and no owner, a COMPUTER carries an owner and may carry no display name at all.
 *
 * A COMPUTER's owner is the document's `DiscoveredVendorUser`, `{ id, email, displayName, type }`, closed. This
 * schema once required an `emailAddress` beside them, borrowed from the census owner ref with no live owner behind
 * it: every live account the sync read was a USER, so the document is the only evidence either way.
 */
export const vantaDiscoveredVendorAccountDtoSchema = z.discriminatedUnion("type", [
  z.object({ displayName: z.string(), email: z.string(), id: z.string(), type: z.literal("USER") }).strict(),
  z
    .object({
      displayName: z.string().optional(),
      id: z.string(),
      owner: z
        .object({ displayName: z.string(), email: z.string(), id: z.string(), type: z.literal("USER") })
        .strict()
        .nullable(),
      type: z.literal("COMPUTER"),
    })
    .strict(),
]);

export type VantaDiscoveredVendorAccountDto = z.infer<typeof vantaDiscoveredVendorAccountDtoSchema>;

/** One control a risk scenario names, and whether it already exists or is part of the treatment plan. */
export const vantaRiskControlLinkDtoSchema = z
  .object({ controlId: z.string(), controlType: z.enum(["EXISTING", "TREATMENT_PLAN"]) })
  .strict();

export type VantaRiskControlLinkDto = z.infer<typeof vantaRiskControlLinkDtoSchema>;
