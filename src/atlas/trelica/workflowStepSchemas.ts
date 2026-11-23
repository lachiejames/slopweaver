/**
 * The two polymorphic halves of a workflow definition: its steps and its trigger.
 *
 * Kept apart from `workflowBoundaries.ts` because one step schema spans every activity type this tenant uses,
 * so its declared-and-unread key list is longer than the rest of the workflow reads put together. Key sets
 * MEASURED over every workflow and step the tenant answered; `workflowBoundaries.ts`'s header says how to re-measure.
 *
 * A step's secret-bearing keys (`TRELICA_STEP_SECRET_KEYS`) are declared and never read, so no projection can
 * carry one into a generation. The settings that say what a step does are typed in `stepSettings.ts`.
 */
import { z } from "zod";

import { unreadTrelicaKeys } from "./boundaryShapes.js";
import { TRELICA_STEP_SETTING_KEYS, TRELICA_STEP_SETTING_SHAPES } from "./stepSettings.js";

/**
 * The step keys whose contents are a secret or carry one: the request a step makes, the message it sends, a fixed
 * password, an integration's input values. Declared unread here, and every one is in `TRELICA_SECRET_BEARING_KEYS`
 * too, so a reused record that somehow carried one is pruned on the way into a generation — a test holds both.
 */
export const TRELICA_STEP_SECRET_KEYS = [
  "body",
  "credentials",
  "fixedPassword",
  "headers",
  "inputParameterValues",
  "messageBody",
  "method",
  "url",
] as const;

/**
 * Every other step key a definition carries that no projection reads. Shared by the current definitions and the
 * historical versions, whose step key set is a subset of this one — MEASURED over every historical version the
 * runs reference.
 */
const TRELICA_STEP_UNREAD_KEYS = [
  ...TRELICA_STEP_SECRET_KEYS,
  "acceptsObjectTypes",
  "activityDescription",
  "allowDateChange",
  "allowProceed",
  "assignToRoleIds",
  "assignToUsers",
  "assignedToAppRoles",
  "assignedToPeople",
  "assignedToRecipientTypes",
  "assignedToScopePerson",
  "attachAppExport",
  "attachAppUserExport",
  "attachAppUserExportCsv",
  "attachAssetExport",
  "attachAttachments",
  "attachPersonExport",
  "backupRoleIds",
  "backupUsers",
  "bodyType",
  "ccAppRoles",
  "ccCustomFields",
  "ccEmailAddresses",
  "ccPeople",
  "ccRecipientTypes",
  "ccVariables",
  "clauses",
  "conditionType",
  "customerAppId",
  "customerAppLogoUrl",
  "customerAppName",
  "customerIntegrationId",
  "delayUntilAdjustByDays",
  "delayUntilTimeOfDay",
  "delayUntilVariable",
  "delayUntilVariableId",
  "description",
  "dueDtmLookup",
  "email",
  "employeeType",
  "featureEnabled",
  "filter",
  "firstName",
  "groupLookup",
  "groupsSupported",
  "inputParameterFields",
  "integrationDisabled",
  "integrationMissingFeature",
  "integrationNotFound",
  "integrationPipelineNotFound",
  "isDangerous",
  "jobTitle",
  "languageTemplates",
  "lastName",
  "lineManagerLookup",
  "logoUrl",
  "messageTitle",
  "newActivityId",
  "newLicensePlanIds",
  "newRoles",
  "newSignalActivityId",
  "newUserName",
  "noEnabledIntegrationsFound",
  "noEnabledMessagingIntegrationsFound",
  "notifyUsers",
  "numberOfTimesToRepeat",
  "outputFields",
  "outputVariables",
  "outputs",
  "ownerPerson",
  "passwordLinkExpiryHours",
  "passwordLinkMaxViews",
  "passwordType",
  "personTypeLookup",
  "personalEmail",
  "phoneNumber",
  "pipelineDescription",
  "pipelineSummary",
  "pipelineTitle",
  "providerApplicationId",
  "providerApplicationName",
  "providerId",
  "providerPasswordType",
  "provisionableLicenses",
  "requiredFeatureSets",
  "responseFormat",
  "rolesSupported",
  "showVariables",
  "skipMissingValues",
  "startDateLookup",
  "tags",
  "taskDescription",
  "taskPriority",
  "taskTitle",
  "taskType",
  "teamIdsLookup",
  "timezoneType",
  "toAppRoles",
  "toCustomFields",
  "toEmailAddresses",
  "toStateId",
  "toVariables",
  "transformation",
  "usesSignal",
  "usesSignalLinks",
] as const;

/** One step of a workflow, as its current definition lists it. */
export const trelicaStepSchema = z.strictObject({
  actionType: z.string().optional(),
  activityCategory: z.string(),
  activityType: z.string(),
  continueOnError: z.boolean(),
  customName: z.string().optional(),
  id: z.string(),
  name: z.string().optional(),
  providerName: z.string().optional(),
  removeAllGroups: z.boolean().optional(),
  ...TRELICA_STEP_SETTING_SHAPES,
  ...unreadTrelicaKeys({ keys: TRELICA_STEP_UNREAD_KEYS }),
});

/**
 * One step as a historical definition VERSION lists it: only what names it is read, so a version that predates a
 * setting the current definitions carry still parses.
 */
export const trelicaVersionStepSchema = z.strictObject({
  activityType: z.string(),
  customName: z.string().optional(),
  id: z.string(),
  name: z.string().optional(),
  ...unreadTrelicaKeys({
    keys: [
      ...TRELICA_STEP_UNREAD_KEYS,
      ...TRELICA_STEP_SETTING_KEYS,
      "actionType",
      "activityCategory",
      "continueOnError",
      "providerName",
      "removeAllGroups",
    ],
  }),
});

/** What starts a workflow. */
export const trelicaTriggerSchema = z.strictObject({
  activityType: z.string(),
  hour: z.number().optional(),
  leavingDateDaysOffset: z.number().optional(),
  name: z.string(),
  period: z.string().optional(),
  personTypes: z.array(z.string()).optional(),
  requireApproval: z.boolean().optional(),
  timezoneType: z.string().optional(),
  ...unreadTrelicaKeys({
    keys: [
      "acceptsObjectTypes",
      "activityCategory",
      "continueOnError",
      "customerAppId",
      "customerAppName",
      "defaultInactivityDays",
      "deprovisionSupported",
      "everyNPeriods",
      "excludeExistingMatches",
      "expireMatchesAfterNDays",
      "fields",
      "filter",
      "hasMetricCondition",
      "id",
      "inactivityDays",
      "includeTerminatedUsers",
      "licensePlanIds",
      "licenseTypeIds",
      "logoUrl",
      "outputs",
      "provisionableLicenses",
      "startDateDaysOffset",
      "startDtm",
      "useSingleOutput",
      "validateHeaderHasValue",
      "validateRequest",
      "validationType",
      "variableIdsToCollect",
      "webhookId",
      "workingDays",
    ],
  }),
});
