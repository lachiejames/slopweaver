/**
 * The Zod schema for Vanta's controls library, split out of `censusApiSchemas.ts` because it is a CONTROL
 * shape rather than one more census family: it tracks the controls-list row (`apiSchemas.ts`) and the
 * control detail (`controlEvidenceApiSchemas.ts`) field for field, and drifts when they do.
 *
 * `.strict()` like every census schema, so a field Vanta adds fails the page closed (reproduce with
 * `slopweaver atlas vanta sync` and read the refusal a drifted page earns).
 */
import { z } from "zod";

import { vantaCustomFieldSchema } from "./apiSchemas.js";
import { vantaOwnerRefSchema } from "./censusApiSchemas.js";

/**
 * One control from Vanta's own library — every control the platform ships, whether or not this organisation
 * has adopted it.
 *
 * The row is the `/controls` shape plus two fields that collection does not carry: the frameworks the
 * library control maps to, and the reason a deactivated one was deactivated. That difference is why this is
 * a call rather than a `covered-by-list` claim about `/controls` — the two responses are not the same
 * object.
 */
export const vantaLibraryControlDtoSchema = z
  .object({
    creationDate: z.string().nullable(),
    customFields: z.array(vantaCustomFieldSchema),
    deactivationReason: z.string().nullable(),
    description: z.string(),
    domains: z.array(z.string()),
    externalId: z.string().nullable(),
    frameworks: z.array(
      z
        .object({
          displayName: z.string(),
          id: z.string(),
          sections: z.array(z.string()),
          shorthandName: z.string(),
        })
        .strict(),
    ),
    id: z.string(),
    /** Optional and nullable, as on the controls-list row and the detail; no live row here has measured it. */
    implementationDetails: z.string().nullable().optional(),
    modificationDate: z.string().nullable(),
    name: z.string(),
    owner: vantaOwnerRefSchema.nullable(),
    /** Absent from `DeactivatedControl`'s `required` list, as on the controls-list row and the detail. */
    role: z.string().nullable().optional(),
    source: z.enum(["Vanta", "Custom"]),
  })
  .strict();

export type VantaLibraryControlDto = z.infer<typeof vantaLibraryControlDtoSchema>;
