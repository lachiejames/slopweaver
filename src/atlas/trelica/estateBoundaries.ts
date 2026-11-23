/**
 * The strict boundaries for the reads about what the organisation runs and pays for: integrations and contracts.
 * Devices, access reviews and assessments are `assuranceBoundaries.ts`.
 *
 * Key sets MEASURED over the several-hundred-provider integration catalogue and every connection and contract the tenant
 * answered, with a one-off read that printed key paths and types and no values. Re-measure by running `slopweaver atlas trelica sync`: a
 * drifted key is refused by name (`src/lib/boundary.ts`) and the kind keeps what it held.
 *
 * Declared and never read: an integration's `parameters`, `clients`, `pipelineInputParameters` and
 * `postConnectFormData` (connection configuration), and a contract's `documents` (download links).
 */
import { z } from "zod";

import { trelicaEmbeddedPersonSchema, trelicaPageSchema, unreadTrelicaKeys } from "./boundaryShapes.js";
import { TRELICA_ENTITY_CALLS } from "./entityInventory.js";
import { defineTrelicaBoundary } from "./trelicaBoundary.js";

/** The counts one connection's last sync reported. */
const trelicaSyncResultSchema = z.strictObject({
  failedAppCount: z.number(),
  failedAssetCount: z.number(),
  failedUserCount: z.number(),
  newUserCount: z.number(),
  sourceAppCount: z.number(),
  sourceAssetCount: z.number(),
  sourceUserCount: z.number(),
  ...unreadTrelicaKeys({
    keys: [
      // MEASURED: the live integrations catalogue started answering this, and the boundary refused it.
      "aiUsageRecordCount",
      "appCount",
      "appResourceAssigneeCount",
      "appResourceCount",
      "failedAppResourceAssigneeCount",
      "failedAppResourceCount",
      "failedContractCount",
      "failedGroupCount",
      "failedPaymentCount",
      "groupCount",
      "hasUsageData",
      "highRiskAppCount",
      "importedAssetCount",
      "importedContractCount",
      "importedPaymentCount",
      "newAppCount",
      "newAppResourceAssigneeCount",
      "newAppResourceCount",
      "newGroupCount",
      "sourceAppResourceAssigneeCount",
      "sourceAppResourceCount",
      "sourceContractCount",
      "sourceGroupCount",
      "sourcePaymentCount",
      "statusMessage",
      "stickyMessages",
      "userCount",
      "warnedAppCount",
      "warnedAssetCount",
      "warnedContractCount",
      "warnedGroupCount",
      "warnedPaymentCount",
      "warnedUserCount",
    ],
  }),
});

/** One connection this tenant holds to one provider. */
const trelicaConnectionSchema = z.strictObject({
  app: z.strictObject({ name: z.string(), ...unreadTrelicaKeys({ keys: ["customerAppId", "globalAppId", "url"] }) }),
  authorisedUserInfo: z.strictObject({
    email: z.string().optional(),
    name: z.string().optional(),
    ...unreadTrelicaKeys({ keys: ["userId"] }),
  }),
  enabled: z.boolean(),
  id: z.string(),
  issueCount: z.number(),
  lastErrorFriendlyMessage: z.string().optional(),
  lastResult: trelicaSyncResultSchema,
  lastSyncDate: z.string(),
  needsReconnect: z.boolean(),
  status: z.string(),
  ...unreadTrelicaKeys({
    keys: [
      "authenticationMethod",
      "canSendMessage",
      "featureSets",
      "lastErrorJobId",
      "outputsByPipelineName",
      "parameters",
      "pipelineInputParameters",
      "postConnectFormData",
      "reconnectTaskId",
      "spendConfiguration",
    ],
  }),
});

/** One integration provider in the catalogue, with whatever connections this tenant holds to it. */
const trelicaIntegrationProviderSchema = z.strictObject({
  applicationName: z.string(),
  integrations: z.array(trelicaConnectionSchema).optional(),
  supportsDeprovision: z.boolean(),
  supportsProvisioning: z.boolean(),
  supportsRevoke: z.boolean(),
  ...unreadTrelicaKeys({
    keys: [
      "applicationId",
      "applicationLogoUrl",
      "authPickerSelectionMethod",
      "authenticationMethod",
      "authenticationMethods",
      "beta",
      "clients",
      "documentationUrl",
      "featureSets",
      "featureSetsDescription",
      "features",
      "featuresDescription",
      "hasAddToGroupPipeline",
      "hasChangelog",
      "hasConfiguredClients",
      "hasPersonFields",
      "hasPostConnectForm",
      "hasRemoveFromGroupPipeline",
      "hasSpendConnectForm",
      "id",
      "logoBackgroundColour",
      "logoUrl",
      "messages",
      "parameters",
      "pipelines",
      "provisionHideGroups",
      "provisionHideRoles",
      "provisionPasswordType",
      "requirements",
      "requirementsDescription",
      "scopes",
      "title",
      "type",
      "vendorProfileUrl",
    ],
  }),
});

/** `POST /IntegrationsApi/Providers/FilterItems` — the integration catalogue and this tenant's connections. */
export const trelicaIntegrationsBoundary = defineTrelicaBoundary({
  callId: TRELICA_ENTITY_CALLS.integrations.id,
  endpoint: "POST /IntegrationsApi/Providers/FilterItems",
  schema: trelicaPageSchema({ item: trelicaIntegrationProviderSchema }),
});

/** One integration provider, as the boundary admits it. */
export type TrelicaIntegrationProviderRecord = z.infer<typeof trelicaIntegrationProviderSchema>;

/** One contract recorded against an application. */
const trelicaContractSchema = z.strictObject({
  agreementDate: z.string(),
  annualContractValue: z.number(),
  automaticRenewal: z.boolean().optional(),
  currencyCode: z.string().optional(),
  id: z.string(),
  isCurrent: z.boolean(),
  isOverdue: z.boolean(),
  isRolling: z.boolean(),
  mainCustomerAppName: z.string(),
  name: z.string(),
  noticeDays: z.number(),
  noticeDeadline: z.string().optional(),
  owners: z.array(trelicaEmbeddedPersonSchema),
  paymentMethod: z.string(),
  renewalDate: z.string().optional(),
  renewalDecision: z.string().optional(),
  startDate: z.string(),
  status: z.string(),
  totalContractValue: z.number(),
  vendorName: z.string(),
  ...unreadTrelicaKeys({
    keys: [
      "annualContractValueByCustomerAppId",
      "annualEnteredContractValue",
      "auditLogSas",
      "autoGeneratedName",
      "baseCurrencyCode",
      "calculatedNoticeDeadline",
      "canTakeOwnership",
      "contractFieldValues",
      "contractId",
      "conversionAsOfDate",
      "createdByUser",
      "createdDtm",
      "customerId",
      "documents",
      "enteredTotal",
      "ignoreVendorOnExclude",
      "importFileIds",
      "isEditable",
      "isOwner",
      "lastModifiedByUser",
      "lastModifiedDtm",
      "licenses",
      "lineItems",
      "mainCustomerApp",
      "mainCustomerAppId",
      "moduleVersion",
      "nextContractIds",
      "notes",
      "ownerRoleIds",
      "previousContractIds",
      "processedByAI",
      "relatedContracts",
      "removedExternalLineItems",
      "renewalCompletedDtm",
      "sentReminders",
      "source",
      "statusLastModifiedDtm",
      "total",
      "totalContractValueByCustomerAppId",
      "totalEnteredContractValue",
      "type",
      "updateSerial",
      "vendor",
      "vendorId",
      "yearsSpanned",
    ],
  }),
});

/** `POST /AppsApi/Contract/FilterItems` — every contract. */
export const trelicaContractsBoundary = defineTrelicaBoundary({
  callId: TRELICA_ENTITY_CALLS.contracts.id,
  endpoint: "POST /AppsApi/Contract/FilterItems",
  schema: trelicaPageSchema({ item: trelicaContractSchema }),
});

/** One contract, as the boundary admits it. */
export type TrelicaContractRecord = z.infer<typeof trelicaContractSchema>;
