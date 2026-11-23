/**
 * The Zod schema for Vanta's issues census, split out of `censusApiSchemas.ts` because it is the one family there
 * transcribed from the published document rather than measured: this account holds no issues.
 */
import { z } from "zod";

import { vantaCustomFieldSchema } from "./apiSchemas.js";

/** Who created or last changed an issue. */
const vantaIssueActorSchema = z.strictObject({
  actorId: z.string(),
  actorType: z.enum(["USER", "APPLICATION", "WORKFLOW_GENERATED"]),
});

/** The fields both issue templates carry, transcribed from the published document's `StandardIssue`. */
const issueBase = {
  closedMetadata: z
    .strictObject({
      closedAt: z.string(),
      comment: z.string(),
      reason: z.enum(["RESOLVED", "DUPLICATE", "ACCEPTED", "OTHER"]),
    })
    .nullable(),
  controlDomain: z.string().nullable(),
  correctiveAction: z.string().nullable(),
  createdBy: vantaIssueActorSchema,
  createdDate: z.string(),
  customFields: z.array(vantaCustomFieldSchema),
  description: z.string(),
  detectedDate: z.string(),
  dueDate: z.string().nullable(),
  id: z.string(),
  lastModifiedBy: vantaIssueActorSchema,
  lastModifiedDate: z.string(),
  mappedControlIds: z.array(z.string()),
  mappedPolicyIds: z.array(z.string()),
  mappedRiskScenarioIds: z.array(z.string()),
  owners: z.array(z.strictObject({ ownerId: z.string(), ownerType: z.enum(["USER", "TEAM"]) })),
  readableIssueId: z.string(),
  rootCause: z.string().nullable(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NO_SEVERITY"]),
  source: z
    .strictObject({
      sourceId: z.string().optional(),
      sourceType: z.enum(["AUDIT", "AUDIT_EXTERNAL", "INCIDENT", "EXTERNAL_PARTY", "SELF_ASSESSMENT", "OTHER"]),
    })
    .nullable(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "CLOSED"]),
  title: z.string(),
};

/**
 * One issue: the document's `Issue`, an `anyOf` of a standard issue and a POA&M, told apart by `template`.
 *
 * It is the one census family whose shape is UNMEASURED: this account holds no issues, and Vanta answers the
 * walk with an empty final page, which `pagination.ts` accepts as a real, authoritative zero. So this is the
 * published document's `StandardIssue` and `StandardPOAM`, transcribed, rather than a measurement. Strict all
 * the same: the first real issue that disagrees with the document refuses the page naming the field that
 * drifted, which is a one-line fix, where a loose schema would have stored whatever arrived without anyone
 * reading it.
 */
export const vantaIssueDtoSchema = z.discriminatedUnion("template", [
  z.strictObject({
    ...issueBase,
    template: z.literal("STANDARD_ISSUE"),
    type: z
      .enum([
        "AREA_OF_CONCERN",
        "MAJOR_NONCONFORMITY",
        "MINOR_NONCONFORMITY",
        "OPP_FOR_IMPROVEMENT",
        "EXCEPTION",
        "PROCESS_FOR_IMPROVEMENT",
      ])
      .nullable(),
  }),
  z.strictObject({
    ...issueBase,
    requiredResources: z.string().nullable(),
    systemsDescription: z.string().nullable(),
    template: z.literal("STANDARD_POAM"),
  }),
]);

export type VantaIssueDto = z.infer<typeof vantaIssueDtoSchema>;
