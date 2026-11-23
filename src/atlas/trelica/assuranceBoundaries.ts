/**
 * The strict boundaries for the reads an assurance review leans on: devices, access-review schedules and
 * assessments. Kept apart from `estateBoundaries.ts` (integrations and contracts) along the line of what each
 * read is for, so neither file outgrows a reviewer.
 *
 * Key sets MEASURED over every device, access-review schedule and assessment the tenant answered, with a one-off
 * read that printed key paths and types and no values. Re-measure by running `slopweaver atlas trelica sync`: a
 * drifted key is refused by name (`src/lib/boundary.ts`) and the kind keeps what it held.
 *
 * Declared and never read: a device source's `externalId`.
 */
import { z } from "zod";

import { trelicaEmbeddedPersonSchema, trelicaPageSchema, unreadTrelicaKeys } from "./boundaryShapes.js";
import { TRELICA_ENTITY_CALLS } from "./entityInventory.js";
import { defineTrelicaBoundary } from "./trelicaBoundary.js";

/** One device, merged across every source that reported it. */
const trelicaDeviceSchema = z.strictObject({
  assetTypeName: z.strictObject({ "en-US": z.string() }),
  assignedTo: trelicaEmbeddedPersonSchema.optional(),
  deviceName: z.string().optional(),
  disposalDate: z.string().optional(),
  enrolledDtm: z.string().optional(),
  id: z.string(),
  isEncrypted: z.boolean(),
  lastSyncDtm: z.string(),
  manufacturerVendorName: z.string(),
  modelName: z.string(),
  osVersion: z.string().optional(),
  platform: z.string().optional(),
  providers: z.array(
    z.strictObject({
      lastSyncDtm: z.string().optional(),
      providerName: z.string().optional(),
      status: z.string().optional(),
      ...unreadTrelicaKeys({
        keys: [
          "assetTag",
          "assignedTo",
          "customFieldValues",
          "deleted",
          "deviceName",
          "disposalDate",
          "enrolledDtm",
          "externalId",
          "integrationId",
          "osVersion",
          "platform",
          "providerId",
          "providerLogoUrl",
          "serialNumber",
          "statusType",
          "updateSerial",
        ],
      }),
    }),
  ),
  serialNumber: z.string().optional(),
  status: z.string(),
  ...unreadTrelicaKeys({
    keys: [
      "appCount",
      "assetTag",
      "assetTypeId",
      "auditLogSas",
      "canTakeOwnership",
      "createdByUser",
      "createdDtm",
      "customFieldValues",
      "customerId",
      "defaultModelNetPrice",
      "defaultTypeNetPrice",
      "fieldSources",
      "isEditable",
      "isOwner",
      "lastModifiedByUser",
      "lastModifiedDtm",
      "lifespanDuration",
      "manufacturerVendorId",
      "modelId",
      "netPrice",
      "orderedProviders",
      "overriddenFieldSources",
      "pictureUrl",
      "programCount",
      "providerIds",
      "statusType",
      "trelicaProvider",
      "warrantyDuration",
    ],
  }),
});

/** `POST /AppsApi/Assets/Asset/FilterItems` — every device. */
export const trelicaDevicesBoundary = defineTrelicaBoundary({
  callId: TRELICA_ENTITY_CALLS.devices.id,
  endpoint: "POST /AppsApi/Assets/Asset/FilterItems",
  schema: trelicaPageSchema({ item: trelicaDeviceSchema }),
});

/** One device, as the boundary admits it. */
export type TrelicaDeviceRecord = z.infer<typeof trelicaDeviceSchema>;

/** One access-review schedule and every snapshot it has taken. */
const trelicaAccessReviewSchema = z.strictObject({
  allSnapshots: z.array(
    z.strictObject({
      completedAppCount: z.number(),
      draftAppCount: z.number(),
      dueDtm: z.string(),
      openAppCount: z.number(),
      snapshotDtm: z.string(),
      status: z.string(),
      totalAppCount: z.number(),
      ...unreadTrelicaKeys({ keys: ["canTakeOwnership", "id", "isOwner", "scheduleId"] }),
    }),
  ),
  dueWorkingDays: z.number(),
  enrollmentStatus: z.string(),
  enrollmentType: z.string(),
  frequency: z.string(),
  id: z.string(),
  name: z.string(),
  startDate: z.string(),
  status: z.string(),
  ...unreadTrelicaKeys({
    keys: [
      "canTakeOwnership",
      "createdByUser",
      "createdDtm",
      "customerId",
      "enrolledApps",
      "isEditable",
      "isOwner",
      "lastModifiedByUser",
      "lastModifiedDtm",
      "orderByDate",
      "reviewerRoleId",
    ],
  }),
});

/** `GET /AppsApi/AccessReviewSchedule/GetMany` — every access-review schedule. */
export const trelicaAccessReviewsBoundary = defineTrelicaBoundary({
  callId: TRELICA_ENTITY_CALLS.accessReviews.id,
  endpoint: "GET /AppsApi/AccessReviewSchedule/GetMany",
  schema: trelicaPageSchema({ item: trelicaAccessReviewSchema }),
});

/** One access-review schedule, as the boundary admits it. */
export type TrelicaAccessReviewRecord = z.infer<typeof trelicaAccessReviewSchema>;

/** One assessment sent about an application. */
const trelicaAssessmentSchema = z.strictObject({
  answeredQuestions: z.number(),
  applicationName: z.string(),
  assignedToPerson: z.strictObject({
    email: z.string(),
    name: z.string(),
    ...unreadTrelicaKeys({ keys: ["id", "personType"] }),
  }),
  dueDtm: z.string(),
  id: z.string(),
  isOverdue: z.boolean(),
  status: z.string(),
  surveyName: z.strictObject({ "en-US": z.string() }),
  totalQuestions: z.number(),
  type: z.string(),
  ...unreadTrelicaKeys({
    keys: [
      "applicationId",
      "applicationLogoUrl",
      "approvers",
      "canTakeOwnership",
      "collectionId",
      "createdByUser",
      "createdDtm",
      "customerAppId",
      "customerId",
      "editableBy",
      "formId",
      "involvedOrganisationsByTypeId",
      "involvedPeople",
      "involvedPeopleByTypeId",
      "isOwner",
      "lastModifiedByUser",
      "lastModifiedDtm",
      "sortIndex",
      "surveyId",
      "viewableBy",
    ],
  }),
});

/** `GET /SurveysApi/SurveyResponses/GetMany` — every assessment. */
export const trelicaAssessmentsBoundary = defineTrelicaBoundary({
  callId: TRELICA_ENTITY_CALLS.assessments.id,
  endpoint: "GET /SurveysApi/SurveyResponses/GetMany",
  schema: trelicaPageSchema({ item: trelicaAssessmentSchema }),
});

/** One assessment, as the boundary admits it. */
export type TrelicaAssessmentRecord = z.infer<typeof trelicaAssessmentSchema>;
