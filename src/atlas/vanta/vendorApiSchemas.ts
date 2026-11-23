/**
 * Zod schemas for the three vendor-register families the census walks: discovered vendors, assessment types
 * and risk attributes — one file per family group, the seam `riskApiSchemas.ts` and
 * `vulnerabilityApiSchemas.ts` also sit on. Each schema is `.strict()` for the same reason every census
 * schema is: a field Vanta adds fails the page closed rather than passing silently into a stored entity.
 */
import { z } from "zod";

/**
 * One vendor an integration noticed being paid for, before anyone put it on the register.
 *
 * `ignored` and `rejected` are OBJECTS in the pinned document — who decided, when and why — and `null` while
 * nobody has. Every live row the sync read carried `null` for both, which is why a boolean here went
 * unrefuted: the first vendor anyone ignores would have refused the page.
 */
export const vantaDiscoveredVendorDtoSchema = z
  .object({
    category: z.object({ name: z.string() }).strict().nullable(),
    discoveredDate: z.string(),
    id: z.string(),
    ignored: z
      .object({
        ignoredAtDate: z.string().nullable(),
        ignoredByUserId: z.string().nullable(),
        ignoredReason: z.string().nullable(),
      })
      .strict()
      .nullable(),
    name: z.string(),
    normalizedName: z.string(),
    numberOfAccounts: z.number(),
    rejected: z
      .object({
        rejectedAtDate: z.string().nullable(),
        rejectedByUserId: z.string().nullable(),
        rejectedReason: z.string().nullable(),
      })
      .strict()
      .nullable(),
    source: z.string(),
  })
  .strict();

type VantaDiscoveredVendorDto = z.infer<typeof vantaDiscoveredVendorDtoSchema>;

/**
 * The `audience` key Vanta started sending on assessment types and vendor assessments, which
 * refused both pages and exited `atlas vanta sync` 1. Vanta's SERVED document declares it nowhere (no
 * `audience` key in `VANTA_SPEC_PIN.url`'s body), so its type is the measured one: a string,
 * `"EXTERNAL"` on every live assessment type and vendor assessment that carried it.
 * Optional, because every other vendor's assessments came back without it on the same sync, and a string
 * rather than an enum, because the values measured so far are not a closed set. Reproduce: `slopweaver atlas vanta sync`
 * reports `new field "results.data[0].audience"` against a schema without it.
 */
export const vantaAssessmentAudienceField = { audience: z.string().optional() } as const;

/** One vendor assessment type. `description` is required and nullable in the pinned document. */
export const vantaVendorAssessmentTypeDtoSchema = z
  .object({
    ...vantaAssessmentAudienceField,
    description: z.string().nullable(),
    id: z.string(),
    name: z.string(),
    status: z.string(),
  })
  .strict();

type VantaVendorAssessmentTypeDto = z.infer<typeof vantaVendorAssessmentTypeDtoSchema>;

/**
 * One vendor risk attribute. `riskSection` is Vanta's own `VendorRiskSection`, required and closed at
 * `{ id, name }` in the pinned document; measured on every live row carrying exactly those two keys.
 * `vendorCategoryIds` arrived on every live row and failed the page closed; Vanta's
 * document declares it a required string array, the authoritative category ids, and marks `vendorCategories`
 * (the display labels) deprecated. Both are read while Vanta serves both.
 */
export const vantaVendorRiskAttributeDtoSchema = z
  .object({
    description: z.string(),
    enabled: z.boolean(),
    id: z.string(),
    name: z.string(),
    riskLevel: z.string(),
    riskSection: z.object({ id: z.string(), name: z.string() }).strict(),
    vendorCategories: z.array(z.string()),
    vendorCategoryIds: z.array(z.string()),
  })
  .strict();

type VantaVendorRiskAttributeDto = z.infer<typeof vantaVendorRiskAttributeDtoSchema>;

/** Every DTO a vendor-register census family can yield. */
export type VantaVendorRegisterDto =
  VantaDiscoveredVendorDto | VantaVendorAssessmentTypeDto | VantaVendorRiskAttributeDto;
