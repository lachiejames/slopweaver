/**
 * Reading back the part of a held `person`, `workflow` and `workflow-run` detail the offboarding evidence
 * needs. A kind file stores `detail` as `unknown` (`model.ts`), so a reader parses what it relies on rather
 * than trusting a cast; this is our own record, so a partial read that ignores extra fields, not a boundary.
 */
import { z } from "zod";

import type { TrelicaAtlasKindFile } from "./model.js";
import { heldTrelicaProviderText, heldTrelicaState } from "./providerText.js";
import { heldTrelicaStepSettingsSchema } from "./stepSettings.js";

const heldPersonSchema = z.object({
  accounts: z.array(
    z.object({
      deleted: z.boolean().nullable(),
      organizationalUnit: z.string().nullable(),
      providerType: z.string(),
      source: z.string().nullable(),
      suspended: z.boolean().nullable(),
    }),
  ),
  email: z.string().nullable(),
  leaver: z.boolean(),
  leavingDate: z.string().nullable(),
  name: z.string(),
  removedDate: z.string().nullable(),
  status: z.string(),
});

/** A held person, as far as the offboarding evidence reads one. */
export type HeldTrelicaPerson = z.infer<typeof heldPersonSchema> & { readonly id: string };

const heldWorkflowSchema = z.object({
  archived: z.boolean(),
  enabled: z.boolean(),
  flowType: z.string(),
  // The list's own `version` reads 0 for every workflow; the steps it carries are the latest published version's.
  latestPublishedVersion: z.number(),
  name: z.string(),
  steps: z.array(
    z.object({
      action: z.string().nullable(),
      activityType: z.string(),
      continueOnError: z.boolean(),
      id: z.string(),
      name: z.string(),
      provider: z.string().nullable(),
      removeAllGroups: z.boolean().nullable(),
      settings: heldTrelicaStepSettingsSchema,
    }),
  ),
  trigger: z.object({
    activityType: z.string(),
    leavingDateDaysOffset: z.number().nullable(),
    name: z.string(),
    personTypes: z.array(z.string()),
    requireApproval: z.boolean().nullable(),
  }),
});

/** A held workflow, as far as the offboarding evidence reads one. */
export type HeldTrelicaWorkflow = z.infer<typeof heldWorkflowSchema> & { readonly id: string };

const heldRunSchema = z.object({
  createdAt: z.string(),
  currentStep: z.string(),
  manuallyTriggered: z.boolean(),
  person: z.object({ email: z.string(), id: z.string(), name: z.string() }).nullable(),
  startedBy: z.string(),
  // States are re-held on the way out too, so a report never prints one an older generation held unclosed.
  status: z.string().transform((state) => heldTrelicaState({ state })),
  steps: z
    .array(
      z.object({
        failureCount: z.number(),
        // Re-held on the way out as well as in, so a report never prints what an older generation's rule let in.
        failureMessage: z
          .string()
          .nullable()
          .transform((text) => heldTrelicaProviderText({ text })),
        name: z.string().nullable(),
        status: z.string().transform((state) => heldTrelicaState({ state })),
        stepId: z.string(),
      }),
    )
    .nullable(),
  terminatedBy: z.string().nullable(),
  uiStatus: z.string().transform((state) => heldTrelicaState({ state })),
  version: z.number(),
  workflowId: z.string(),
});

/** A held run, as far as the offboarding evidence reads one. */
export type HeldTrelicaRun = z.infer<typeof heldRunSchema> & { readonly id: string };

/** Every entity in a file whose first-party detail parses, and how many did not. */
function heldOf<T>({ file, schema }: { file: TrelicaAtlasKindFile | null; schema: z.ZodType<T> }): {
  held: (T & { readonly id: string })[];
  unreadable: number;
} {
  const held: (T & { readonly id: string })[] = [];
  let unreadable = 0;
  for (const entity of file === null ? [] : file.entities) {
    const view = entity.channels["first-party-api"];
    if (view?.state !== "observed") {
      continue;
    }
    const parsed = schema.safeParse(view.detail);
    if (!parsed.success) {
      unreadable += 1;
      continue;
    }
    held.push({ ...parsed.data, id: entity.providerId });
  }
  return { held, unreadable };
}

/** The three kinds the offboarding evidence reads, each as held entities. */
export interface HeldTrelicaOffboardingInput {
  readonly people: readonly HeldTrelicaPerson[];
  readonly workflows: readonly HeldTrelicaWorkflow[];
  readonly runs: readonly HeldTrelicaRun[];
  /** Observed entities whose detail did not parse — a held shape this reader no longer matches. */
  readonly unreadable: number;
}

/**
 * Read the three kinds the offboarding evidence needs out of their kind files. A stale entity — one the last
 * sync did not observe — is left out, because it is no longer what Trelica says.
 *
 * @param people the `person` kind file, or `null` when none is published
 * @param workflows the `workflow` kind file, or `null`
 * @param runs the `workflow-run` kind file, or `null`
 * @returns the held entities and how many could not be read
 */
export function heldTrelicaOffboardingInput({
  people,
  workflows,
  runs,
}: {
  people: TrelicaAtlasKindFile | null;
  workflows: TrelicaAtlasKindFile | null;
  runs: TrelicaAtlasKindFile | null;
}): HeldTrelicaOffboardingInput {
  const heldPeople = heldOf({ file: people, schema: heldPersonSchema });
  const heldWorkflows = heldOf({ file: workflows, schema: heldWorkflowSchema });
  const heldRuns = heldOf({ file: runs, schema: heldRunSchema });
  return {
    people: heldPeople.held,
    runs: heldRuns.held,
    unreadable: heldPeople.unreadable + heldWorkflows.unreadable + heldRuns.unreadable,
    workflows: heldWorkflows.held,
  };
}
