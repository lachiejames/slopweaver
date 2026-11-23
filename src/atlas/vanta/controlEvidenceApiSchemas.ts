/**
 * Zod schemas for the Manage API surfaces used to explain one control live (frameworks, control detail,
 * control tests, and a bounded sample of the entities behind one test) — built from Vanta's own published
 * OpenAPI document.
 */
import { z } from "zod";

import {
  vantaCustomFieldSchema,
  vantaFrameworkProgramFields,
  vantaFrameworkStatusSchema,
  vantaOwnerSchema,
  vantaPageEnvelopeSchema,
} from "./apiSchemas.js";

/** A framework progress count: -1 is Vanta's own value for a framework outside the program (`isPurchased: false`). */
const frameworkCountSchema = z.number().int().min(-1);

export const vantaFrameworkDtoSchema = z
  .object({
    description: z.string(),
    displayName: z.string(),
    id: z.string(),
    numControlsCompleted: frameworkCountSchema,
    numControlsTotal: frameworkCountSchema,
    numDocumentsPassing: frameworkCountSchema,
    numDocumentsTotal: frameworkCountSchema,
    numTestsPassing: frameworkCountSchema,
    numTestsTotal: frameworkCountSchema,
    shorthandName: z.string(),
    status: vantaFrameworkStatusSchema.optional(),
    ...vantaFrameworkProgramFields,
  })
  .strict();

export type VantaFrameworkDto = z.infer<typeof vantaFrameworkDtoSchema>;
export const vantaFrameworksPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaFrameworkDtoSchema });

export const vantaControlDetailDtoSchema = z
  .object({
    creationDate: z.iso.datetime().nullable(),
    customFields: z.array(vantaCustomFieldSchema),
    description: z.string(),
    domains: z.array(z.string()),
    externalId: z.string().nullable(),
    id: z.string(),
    implementationDetails: z.string().nullable().optional(),
    modificationDate: z.iso.datetime().nullable(),
    name: z.string(),
    note: z.string().nullable(),
    numDocumentsPassing: z.number().int().nonnegative(),
    numDocumentsTotal: z.number().int().nonnegative(),
    numTestsPassing: z.number().int().nonnegative(),
    numTestsTotal: z.number().int().nonnegative(),
    owner: vantaOwnerSchema.nullable(),
    /** Nullable and absent from `ControlDetail`'s `required` list in the pinned document. */
    role: z.string().nullable().optional(),
    source: z.enum(["Vanta", "Custom"]),
    status: z.string().min(1),
  })
  .strict();

export type VantaControlDetailDto = z.infer<typeof vantaControlDetailDtoSchema>;

const vantaTestVersionSchema = z
  .object({ major: z.number().int().nonnegative(), minor: z.number().int().nonnegative() })
  .strict();
const vantaDeactivatedStatusInfoSchema = z
  .object({
    deactivatedReason: z.string().nullable(),
    isDeactivated: z.boolean(),
    lastUpdatedDate: z.iso.datetime().nullable(),
  })
  .strict();
const vantaRemediationStatusInfoSchema = z
  .object({
    itemCount: z.number().int().nonnegative(),
    soonestRemediateByDate: z.iso.datetime().nullable(),
    status: z.string().min(1),
  })
  .strict();

export const vantaControlTestDtoSchema = z
  .object({
    category: z.string(),
    deactivatedStatusInfo: vantaDeactivatedStatusInfoSchema,
    description: z.string(),
    failureDescription: z.string(),
    id: z.string(),
    integrations: z.array(z.string()),
    lastTestRunDate: z.iso.datetime(),
    // Nullable per Vanta's own OpenAPI spec: a test that has never flipped status has no flip date.
    latestFlipDate: z.iso.datetime().nullable(),
    name: z.string(),
    owner: vantaOwnerSchema.nullable(),
    remediationDescription: z.string(),
    remediationStatusInfo: vantaRemediationStatusInfoSchema,
    status: z.string().min(1),
    version: vantaTestVersionSchema,
  })
  .strict();

export type VantaControlTestDto = z.infer<typeof vantaControlTestDtoSchema>;
export const vantaControlTestsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaControlTestDtoSchema });

/**
 * The values `GET /tests/{testId}/entities` takes as its `entityStatus` query parameter — the spec's
 * `EntityStatus` enum, verbatim. Vanta answers FAILING when the parameter is absent.
 */
export const VANTA_TEST_ENTITY_STATUSES = ["FAILING", "DEACTIVATED"] as const;

export type VantaTestEntityStatus = (typeof VANTA_TEST_ENTITY_STATUSES)[number];

/**
 * One row of `GET /tests/{testId}/entities` (`TestResourceEntity`). It carries a `deactivatedReason` and a
 * `lastUpdatedDate`, and NO field naming who deactivated an entity or when — `lastUpdatedDate` is the last
 * change of any kind, so a reader must never present it as the deactivation date.
 */
const vantaTestEntityDtoSchema = z
  .object({
    createdDate: z.iso.datetime().nullable(),
    deactivatedReason: z.string().nullable(),
    displayName: z.string(),
    entityStatus: z.string().min(1),
    id: z.string(),
    lastUpdatedDate: z.iso.datetime().nullable(),
    responseType: z.string(),
  })
  .strict();

export type VantaTestEntityDto = z.infer<typeof vantaTestEntityDtoSchema>;
export const vantaTestEntitiesPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaTestEntityDtoSchema });
