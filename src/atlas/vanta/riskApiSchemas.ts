/**
 * Zod schemas for the Vanta Manage API's risk-scenario surface — the DTO both `risks-risk-scenario` and
 * `risks-enterprise-risk` answer in, and its page envelope.
 *
 * Built from Vanta's own published OpenAPI document (`RiskScenario`, `ScoreBreakdownEntry`), and `.strict()`
 * on the same closed-shape contract `apiSchemas.ts` states: an unrecognised field fails that page closed
 * rather than silently passing through.
 *
 * It sits beside `apiSchemas.ts` rather than inside it because that file grew past the 300-code-line
 * ratchet when `scoreBreakdown` arrived, and the per-kind split is the seam this directory already uses —
 * `vulnerabilityApiSchemas.ts`, `censusApiSchemas.ts`, `childApiSchemas.ts`, `controlEvidenceApiSchemas.ts`
 * and `policyDocumentApiSchemas.ts` are the same shape. The page envelope, the owner and the custom-field
 * schemas stay shared in `apiSchemas.ts`; nothing here is duplicated from it.
 */
import { z } from "zod";

import { vantaCustomFieldSchema, vantaPageEnvelopeSchema } from "./apiSchemas.js";

const ciaSchema = z.enum(["Confidentiality", "Integrity", "Availability"]);
const treatmentSchema = z.enum(["Mitigate", "Transfer", "Avoid", "Accept"]);
const reviewStatusSchema = z.enum([
  "APPROVED",
  "DRAFT",
  "NOT_REVIEWED",
  "AWAITING_SUBMISSION",
  "PENDING_APPROVAL",
  "REQUESTED_CHANGES",
]);
const riskScenarioTypeSchema = z.enum(["Risk Scenario", "Enterprise Risk"]);

/**
 * One node of Vanta's inherent-risk scoring tree, ordered parents before children and linked by
 * `parentId`. Strict and fully required, exactly as the document declares `ScoreBreakdownEntry`.
 */
const scoreBreakdownEntrySchema = z
  .object({
    id: z.string(),
    kind: z.enum(["SCORE", "DIMENSION", "FACTOR"]),
    name: z.string(),
    parentId: z.string().nullable(),
    score: z.number().nullable(),
    scoreLabel: z.string().nullable(),
    status: z.enum(["SCORED", "MISSING", "NOT_APPLICABLE"]).nullable(),
  })
  .strict();

export const vantaRiskScenarioDtoSchema = z
  .object({
    categories: z.array(z.string()),
    ciaCategories: z.array(ciaSchema),
    customFields: z.array(vantaCustomFieldSchema),
    description: z.string(),
    /** Nullable and absent from `RiskScenario`'s `required` list in the pinned document. */
    detailedDescription: z.string().nullable().optional(),
    identificationDate: z.string(),
    impact: z.number().int().nullable(),
    isArchived: z.boolean(),
    isSensitive: z.boolean().nullable(),
    likelihood: z.number().int().nullable(),
    note: z.string().nullable(),
    owner: z.string().nullable(),
    requiredApprovers: z.array(z.string()),
    residualImpact: z.number().int().nullable(),
    residualLikelihood: z.number().int().nullable(),
    reviewStatus: reviewStatusSchema,
    riskId: z.string(),
    riskRegister: z.string().nullable(),
    // Vanta added this field after this schema was written, and `.strict()` refused the page closed:
    // MEASURED, `risks-risk-scenario` came back `results.data.<n>: Unrecognized
    // key: scoreBreakdown` on every row, which refused the risk kind, refused the `risk-scenario-controls` fan-out over
    // it, and exited `slopweaver atlas vanta sync` 1 on every run since. The document declares the field
    // REQUIRED and nullable; it is OPTIONAL here because the document also marks it CLOSED BETA and nothing
    // reads it, so a provider withdrawing it must not buy another permanent exit 1. Settle it again with
    // `slopweaver atlas vanta sync` — every row carried the key with the value `null`.
    scoreBreakdown: z.array(scoreBreakdownEntrySchema).nullable().optional(),
    treatment: treatmentSchema.nullable(),
    type: riskScenarioTypeSchema,
  })
  .strict();

export type VantaRiskScenarioDto = z.infer<typeof vantaRiskScenarioDtoSchema>;

export const vantaRiskScenariosPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaRiskScenarioDtoSchema });
