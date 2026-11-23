/**
 * The Zod schema for one Vanta personnel record — `/people`, the largest single row the census reads.
 *
 * Held apart from `censusApiSchemas.ts` because a person is a whole surface of its own: field provenance,
 * leave, and the onboarding/offboarding task summary. Like every census schema it is `.strict()`, so a field
 * Vanta adds fails that page closed rather than passing silently into a stored entity, and each shape below
 * is the pinned Manage API document's (`generated/specLock.ts`), checked against the live account.
 */
import { z } from "zod";

/**
 * Where one of a person's fields came from: the document's `PersonInfoSource`, three arms keyed on `type`. A
 * `VANTA` or `SCIM` source carries its type alone. An `INTEGRATION` source requires `integrationId` and
 * `resourceId`, the latter NULLABLE, so `null` is read though no live row has carried one: measured across every
 * person the sync read, every integration source held a string.
 */
const vantaPersonSourceRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("VANTA") }).strict(),
  z.object({ type: z.literal("SCIM") }).strict(),
  z.object({ integrationId: z.string(), resourceId: z.string().nullable(), type: z.literal("INTEGRATION") }).strict(),
]);

const vantaNamedItemSchema = z.object({ name: z.string() }).strict();

/**
 * Why and when a person's task was switched off, or `null` while it is on — an OBJECT in the pinned document.
 * Every person the sync read carried `null` on every task, which is why a boolean here went unrefuted.
 */
const vantaPersonTaskDisabledSchema = z.object({ date: z.string(), reason: z.string().nullable() }).strict();

const vantaPersonTaskBaseSchema = {
  completionDate: z.string().nullable(),
  disabled: vantaPersonTaskDisabledSchema.nullable(),
  dueDate: z.string().nullable(),
  status: z.string(),
  taskType: z.string(),
};

const vantaPersonTasksDetailsSchema = z
  .object({
    acceptPolicies: z
      .object({
        ...vantaPersonTaskBaseSchema,
        acceptedPolicies: z.array(vantaNamedItemSchema),
        unacceptedPolicies: z.array(vantaNamedItemSchema),
      })
      .strict(),
    completeBackgroundChecks: z.object({ ...vantaPersonTaskBaseSchema }).strict(),
    completeCustomTasks: z
      .object({
        ...vantaPersonTaskBaseSchema,
        completedCustomTasks: z.array(vantaNamedItemSchema),
        incompleteCustomTasks: z.array(vantaNamedItemSchema),
      })
      .strict(),
    completeOffboardingCustomTasks: z
      .object({
        ...vantaPersonTaskBaseSchema,
        completedCustomOffboardingTasks: z.array(vantaNamedItemSchema),
        incompleteCustomOffboardingTasks: z.array(vantaNamedItemSchema),
      })
      .strict(),
    completeTrainings: z
      .object({
        ...vantaPersonTaskBaseSchema,
        completedTrainings: z.array(vantaNamedItemSchema),
        incompleteTrainings: z.array(vantaNamedItemSchema),
      })
      .strict(),
    installDeviceMonitoring: z.object({ ...vantaPersonTaskBaseSchema }).strict(),
  })
  .strict();

/**
 * One personnel record. `tasksSummary` is the whole onboarding/offboarding surface — policy acceptance,
 * background checks, security training and device monitoring — which is why it is spelled out rather than
 * held as an opaque blob: a turn has to be able to ask who has not completed their training.
 */
export const vantaPersonDtoSchema = z
  .object({
    emailAddress: z.string(),
    employment: z
      .object({
        endDate: z.string().nullable(),
        jobTitle: z.string().nullable(),
        startDate: z.string(),
        status: z.string(),
      })
      .strict(),
    groupIds: z.array(z.string()),
    id: z.string(),
    /** A `null` `endDate` is indefinite leave, in the pinned document's own words. */
    leaveInfo: z
      .object({ endDate: z.string().nullable(), startDate: z.string(), status: z.string() })
      .strict()
      .nullable(),
    name: z.object({ display: z.string(), first: z.string().nullable(), last: z.string().nullable() }).strict(),
    /**
     * Optional in the document Vanta serves, newer than the pin; no live person carried
     * it. Read rather than refused, so the day Vanta starts sending it is not a refused page.
     */
    programScopeIds: z.array(z.string()).optional(),
    sources: z
      .object({
        emailAddress: vantaPersonSourceRefSchema,
        employment: z.object({ endDate: vantaPersonSourceRefSchema, startDate: vantaPersonSourceRefSchema }).strict(),
      })
      .strict(),
    tasksSummary: z
      .object({
        completionDate: z.string().nullable(),
        details: vantaPersonTasksDetailsSchema,
        dueDate: z.string().nullable(),
        status: z.string(),
      })
      .strict(),
    userId: z.string().nullable(),
  })
  .strict();

export type VantaPersonDto = z.infer<typeof vantaPersonDtoSchema>;
