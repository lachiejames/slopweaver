/**
 * The strict boundaries for the workflow reads: definitions, tag names, runs, one run's steps, and the
 * definition version a run executed.
 *
 * Key sets MEASURED with a one-off read of every workflow, step, tag, run, run detail and definition version
 * that printed key paths and types and no values. A key
 * present on every record measured is required; one present on some is `.optional()`. Re-measure by running
 * `slopweaver atlas trelica sync`: a drifted key is refused by name (`src/lib/boundary.ts`) and lands as a
 * `first-party-row-unread` gap.
 *
 * ## What is declared and deliberately never read
 *
 * A run's `baseScope.variables` — which can carry a password, a variable named `<id>_password` being the
 * shape — and every run
 * step's `apiRequestLog`, `eventLog`, `outputs` and `scope`, which carry what each call sent and received. The
 * step definitions' own secret-bearing keys are listed in `workflowStepSchemas.ts`. They are declared so the
 * key set is known, and no projection reads them, so no generation can hold one.
 */
import { z } from "zod";

import { trelicaEmbeddedPersonSchema, trelicaPageSchema, unreadTrelicaKeys } from "./boundaryShapes.js";
import {
  TRELICA_ENTITY_CALLS,
  TRELICA_RUN_DETAIL_CALL_ID,
  TRELICA_WORKFLOW_VERSION_CALL_ID,
} from "./entityInventory.js";
import { defineTrelicaBoundary } from "./trelicaBoundary.js";
import { trelicaStepSchema, trelicaTriggerSchema, trelicaVersionStepSchema } from "./workflowStepSchemas.js";

/** The definition keys no projection reads, on both the current definition and a historical version. */
const TRELICA_DEFINITION_UNREAD_KEYS = [
  "auditLogSas",
  "autoPublish",
  "canTakeOwnership",
  "canTriggerManually",
  "createdByUser",
  "customerId",
  "exceededThreshold",
  "hasSchedule",
  "hasUnpublishedChanges",
  "isEditable",
  "isLatestVersion",
  "isOwner",
  "isValid",
  "lastModifiedByUser",
  "loadedForEditor",
  "lookupTablesInUse",
  "manageRuns",
  "roles",
  "variables",
  "versionReplacedDtm",
] as const;

/** One workflow definition, at its latest version. */
const trelicaWorkflowSchema = z.strictObject({
  activeItemCount: z.number(),
  activities: z.array(trelicaStepSchema),
  archived: z.boolean(),
  completedItemCount: z.number(),
  completedWithErrorsItemCount: z.number(),
  createdDtm: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
  failedItemCount: z.number(),
  flowType: z.string(),
  id: z.strictObject({ id: z.string(), version: z.number() }),
  itemCount: z.number(),
  lastModifiedDtm: z.string(),
  latestPublishedVersion: z.number(),
  name: z.string(),
  needsInputItemCount: z.number(),
  owners: z.array(trelicaEmbeddedPersonSchema).optional(),
  terminatedItemCount: z.number(),
  trigger: trelicaTriggerSchema,
  waitingForUserItemCount: z.number(),
  workflowTagId: z.string().optional(),
  ...unreadTrelicaKeys({ keys: TRELICA_DEFINITION_UNREAD_KEYS }),
});

/** `POST /FlowApi/Flow/GetMany` — every workflow, with the tenant-wide run counts beside the page. */
export const trelicaWorkflowsBoundary = defineTrelicaBoundary({
  callId: TRELICA_ENTITY_CALLS.workflows.id,
  endpoint: "POST /FlowApi/Flow/GetMany",
  schema: trelicaPageSchema({ item: trelicaWorkflowSchema }).extend({
    counts: z.strictObject({
      ...unreadTrelicaKeys({
        keys: [
          "active",
          "completed",
          "completedWithErrors",
          "failed",
          "needsInput",
          "terminated",
          "total",
          "waitingForUser",
        ],
      }),
    }),
  }),
});

/** One workflow definition, as the boundary admits it. */
export type TrelicaWorkflowRecord = z.infer<typeof trelicaWorkflowSchema>;

/** `GET /FlowApi/CustomerSettings/WorkflowTags` — a bare list of tag names. */
export const trelicaWorkflowTagsBoundary = defineTrelicaBoundary({
  callId: TRELICA_ENTITY_CALLS.workflowTags.id,
  endpoint: "GET /FlowApi/CustomerSettings/WorkflowTags",
  schema: z.array(z.strictObject({ id: z.string(), isStandardTag: z.boolean(), label: z.string() })),
});

/** Who started or stopped a run. */
const trelicaRunActorSchema = z.strictObject({ name: z.string(), ...unreadTrelicaKeys({ keys: ["email", "userId"] }) });

/** The run keys no list projection reads. `states` is read only off the one-run detail below. */
const TRELICA_RUN_UNREAD_KEYS = [
  "blockedUntil",
  "canTakeOwnership",
  "currentStates",
  "customerId",
  "customerName",
  "firedSignals",
  "isEditable",
  "isOwner",
  "isProvisioning",
  "jobClass",
  "lastModifiedByUser",
  "lastRunSerial",
  "lastTriggeredSerial",
  "runCount",
  "triggerDepth",
  "unacknowledgedCount",
] as const;

/** One run of one workflow. */
const trelicaRunSchema = z.strictObject({
  baseScope: z.strictObject({
    app: z.strictObject({ id: z.string(), name: z.string(), ...unreadTrelicaKeys({ keys: ["logoUrl"] }) }).optional(),
    person: z
      .strictObject({
        email: z.string(),
        id: z.string(),
        leavingDate: z.string().optional(),
        name: z.string(),
        ...unreadTrelicaKeys({
          keys: [
            "customFields",
            "employeeId",
            "firstName",
            "jobTitle",
            "lastName",
            "lineManager",
            "location",
            "personalEmail",
            "startDate",
            "team",
            "teamIds",
          ],
        }),
      })
      .optional(),
    ...unreadTrelicaKeys({ keys: ["variables", "workflowRunUrl"] }),
  }),
  blockedReason: z.string().optional(),
  completedDtm: z.string().optional(),
  createdByUser: trelicaRunActorSchema,
  createdDtm: z.string(),
  currentStateName: z.string(),
  errorCount: z.number(),
  failedAndContinuedCount: z.number(),
  firedErrors: z.array(
    z.strictObject({
      firedAt: z.string(),
      message: z.string(),
      ...unreadTrelicaKeys({ keys: ["activityId", "iterationId"] }),
    }),
  ),
  flowId: z.string(),
  flowName: z.string(),
  flowVersion: z.number(),
  id: z.string(),
  itemName: z.string().optional(),
  lastModifiedDtm: z.string(),
  manuallyTriggered: z.boolean(),
  status: z.string(),
  terminatedByUser: trelicaRunActorSchema.optional(),
  terminatedDtm: z.string().optional(),
  uiStatus: z.string(),
  ...unreadTrelicaKeys({ keys: [...TRELICA_RUN_UNREAD_KEYS, "states"] }),
});

/** `POST /FlowApi/FlowItem/FilterItems` — every run of every workflow. */
export const trelicaWorkflowRunsBoundary = defineTrelicaBoundary({
  callId: TRELICA_ENTITY_CALLS.workflowRuns.id,
  endpoint: "POST /FlowApi/FlowItem/FilterItems",
  schema: trelicaPageSchema({ item: trelicaRunSchema }),
});

/** One workflow run, as the boundary admits it. */
export type TrelicaWorkflowRunRecord = z.infer<typeof trelicaRunSchema>;

/** One step's state inside one run. Only its identity, status and outcome are read. */
const trelicaRunStateSchema = z.strictObject({
  activityId: z.string(),
  failureCount: z.number(),
  result: z
    .strictObject({
      failureMessage: z.string().optional(),
      resultDtm: z.string(),
      type: z.string(),
      ...unreadTrelicaKeys({
        keys: ["blockedReason", "blockedUntil", "jobId", "newScope", "nextStepIds", "transitions"],
      }),
    })
    .optional(),
  status: z.string(),
  ...unreadTrelicaKeys({
    keys: [
      "acknowledged",
      "acknowledgedByUser",
      "acknowledgedDtm",
      "apiRequestLog",
      "createdDtm",
      "eventLog",
      "extraState",
      "integrationLogMessages",
      "iterationId",
      "outputs",
      "previousJobIds",
      "returned",
      "scope",
    ],
  }),
});

/**
 * One run with its per-step states. The list row's keys are all present again and are read off the list, so
 * here only what names the run and its steps is read.
 */
const trelicaRunDetailSchema = z.strictObject({
  flowId: z.string(),
  flowVersion: z.number(),
  id: z.string(),
  states: z.array(trelicaRunStateSchema),
  ...unreadTrelicaKeys({
    keys: [
      ...TRELICA_RUN_UNREAD_KEYS,
      "baseScope",
      "blockedReason",
      "completedDtm",
      "createdByUser",
      "createdDtm",
      "currentStateName",
      "errorCount",
      "failedAndContinuedCount",
      "firedErrors",
      "flowName",
      "itemName",
      "lastModifiedDtm",
      "manuallyTriggered",
      "runData",
      "status",
      "terminatedByUser",
      "terminatedDtm",
      "uiStatus",
    ],
  }),
});

/** `GET /FlowApi/FlowItem/{id}` — one run with its per-step states. */
export const trelicaRunDetailBoundary = defineTrelicaBoundary({
  callId: TRELICA_RUN_DETAIL_CALL_ID,
  endpoint: "GET /FlowApi/FlowItem/{id}",
  schema: trelicaRunDetailSchema,
});

/** One run's per-step states, as the boundary admits them. */
export type TrelicaRunDetailRecord = z.infer<typeof trelicaRunDetailSchema>;

/**
 * The definition a run executed. A run names its steps only by id, and a step a later version removed is named
 * by nothing else, so only the step names are read.
 */
const trelicaWorkflowVersionSchema = z.strictObject({
  activities: z.array(trelicaVersionStepSchema),
  id: z.strictObject({ id: z.string(), version: z.number() }),
  name: z.string(),
  workflowTagLabel: z.string().optional(),
  ...unreadTrelicaKeys({
    keys: [
      ...TRELICA_DEFINITION_UNREAD_KEYS,
      "activeItemCount",
      "archived",
      "completedItemCount",
      "completedWithErrorsItemCount",
      "createdDtm",
      "description",
      "enabled",
      "failedItemCount",
      "flowType",
      "itemCount",
      "lastModifiedDtm",
      "latestPublishedVersion",
      "needsInputItemCount",
      "owners",
      "terminatedItemCount",
      "trigger",
      "waitingForUserItemCount",
      "workflowTagId",
    ],
  }),
});

/** `GET /FlowApi/Flow/{id}/{version}` — one historical definition version. */
export const trelicaWorkflowVersionBoundary = defineTrelicaBoundary({
  callId: TRELICA_WORKFLOW_VERSION_CALL_ID,
  endpoint: "GET /FlowApi/Flow/{id}/{version}",
  schema: trelicaWorkflowVersionSchema,
});

/** One historical definition version, as the boundary admits it. */
export type TrelicaWorkflowVersionRecord = z.infer<typeof trelicaWorkflowVersionSchema>;
