/**
 * The strict boundary each of `inventory.ts`'s first-party calls is admitted by, paired with the call itself.
 *
 * MEASURED against the live tenant, every key and its kind across every record each call answered: the
 * application inventory over every page, the end-user catalogue, roles, and the AI alert history and budgets.
 * Reproduce with a key census over `client.call` against a throwaway `--home`.
 *
 * A key the projections read is declared with its type, required where every measured record carried it; every
 * other measured key is declared unread, so the method map's census view keeps its name and none of its value —
 * an inventory record's `app`, `customerVendor` and `appImportDetails` are whole provider documents, and nothing
 * under them is this atlas's to hold.
 */
import { z } from "zod";

import { trelicaPageSchema, unreadTrelicaKeys } from "./boundaryShapes.js";
import { TRELICA_CALLS, type TrelicaCall } from "./inventory.js";
import { defineTrelicaBoundary, type TrelicaBoundary } from "./trelicaBoundary.js";

/** An owner or contact an application records, as `fields.ts` reads one. */
const internalContactSchema = z.strictObject({
  contact: z.strictObject({
    email: z.string(),
    name: z.string(),
    ...unreadTrelicaKeys({ keys: ["id", "personType"] }),
  }),
  isOwner: z.boolean(),
  roleId: z.string(),
  terminated: z.boolean(),
  ...unreadTrelicaKeys({ keys: ["accessLevel", "contractAccessLevel", "spendAccessLevel"] }),
});

/** One application in the organisation-wide inventory. */
const inventoryItemSchema = z.strictObject({
  appDiscoveredBy: z.string(),
  appDiscoveredByProviderId: z.string().optional(),
  customerLicensePlans: z.array(
    z.strictObject({
      // A plan's name is localised, keyed by locale — MEASURED `en-US`, and `en-GB` on the catalogue's own plans.
      name: z.record(z.string(), z.string()),
      ...unreadTrelicaKeys({
        keys: [
          "applicableLicenseTypeIds",
          "excludeFromLicenseRollup",
          "hidden",
          "id",
          "lastModifiedDtm",
          "pricingModel",
        ],
      }),
    }),
  ),
  displayName: z.string(),
  id: z.string(),
  internalContacts: z.array(internalContactSchema),
  lastYearSpend: z.number(),
  name: z.string(),
  riskScore: z.number(),
  status: z.string(),
  userCount: z.number(),
  vendorName: z.string(),
  ...unreadTrelicaKeys({
    keys: [
      "accessLevels",
      "accessPolicies",
      "activeProviders",
      "additiveAccessLevels",
      "app",
      "appFieldValues",
      "appHubRequests",
      "appImportDetails",
      "appImportDetailsProviderDtos",
      "applicationId",
      "applicationUrl",
      "assetCount",
      "auditLogSas",
      "canDeprovision",
      "canProvision",
      "canSetUserLicense",
      "canTakeOwnership",
      "canTrackAIUsage",
      "contractDocuments",
      "contractFields",
      "createdByUser",
      "createdDtm",
      "customerAccreditations",
      "customerId",
      "customerVendor",
      "defaultUserFilter",
      "description",
      "dismissedActions",
      "earliestLogonDataDate",
      "engagedUserCount",
      "epmSharedUsersDetectedCount",
      "epmUsersDetectedCount",
      "epmUsersPendingCount",
      "epmUsersProtectedCount",
      "epmUsersReadyCount",
      "gSuiteIds",
      "hasLicenseData",
      "hasUsageData",
      "hasUserFileImports",
      "homepage",
      "ignoreProvider",
      "inactiveProviders",
      "inheritInternalContacts",
      "inheritVendorContacts",
      "instanceName",
      "integrationStatus",
      "inUseLicensePlanIds",
      "involvedOrganisationsByTypeId",
      "isEditable",
      "isOwner",
      "isPrimary",
      "isRequested",
      "lastModifiedByUser",
      "lastModifiedDtm",
      "lastYearAPSpend",
      "lastYearExpensedSpend",
      "licenseGroups",
      "licenseOptimizationUnengagedUserCount",
      "licenses",
      "loginMethods",
      "loginMethodsByProviderId",
      "logoUrl",
      "newAndWithIssuesAppResourceCountByType",
      "offboardPolicy",
      "openAppAccessRequests",
      "overallCustomerRiskLevel",
      "overallRiskLevel",
      "privacyStatementUrl",
      "riskLevel",
      "sharedUserCount",
      "showInAppHub",
      "signOnUrl",
      "sourceQualityOptions",
      "statusChangeReason",
      "teamInternalContacts",
      "terminatedOrUnknownWithAccessCount",
      "termsOfServiceUrl",
      "totalAccessIssueCount",
      "totalAppAccessRequests",
      "unengagedUserCount",
      "userCountsByUsageLevel",
      "userLicenses",
      "userSetSignOnUrl",
      "utilization",
      "vendorContacts",
      "vendorId",
    ],
  }),
});

/** One application staff can request from the end-user catalogue. */
const catalogItemSchema = z.strictObject({
  id: z.string(),
  internalContacts: z.array(internalContactSchema),
  name: z.string(),
  userCount: z.number(),
  vendorName: z.string(),
  ...unreadTrelicaKeys({
    keys: [
      "accessLevels",
      "accessPolicies",
      "additiveAccessLevels",
      "appFieldValues",
      "appInCatalog",
      "applicationUrl",
      "canRequestRemoval",
      "description",
      "domains",
      "existingAccounts",
      "hasOpenTemporaryRequest",
      "isGlobal",
      "licenses",
      "links",
      "logoUrl",
      "mainCategory",
      "otherCategories",
      "requestable",
      "requestedAccessLevels",
      "signOnEmail",
      "signOnUrl",
      "teamInternalContacts",
      "userHasApp",
      "vendorId",
      "waitingToProvision",
    ],
  }),
});

/** One alert the AI spend monitor raised, every field of which `aiProjection.ts` holds but the logo. */
const alertItemSchema = z.strictObject({
  baselineMedian: z.number(),
  customerAppId: z.string(),
  customerAppName: z.string(),
  date: z.string(),
  evalDaySpend: z.number(),
  id: z.string(),
  status: z.string(),
  subType: z.string(),
  trend: z.array(z.strictObject({ date: z.string(), spend: z.number() })),
  type: z.string(),
  ...unreadTrelicaKeys({ keys: ["customerAppLogoUrl"] }),
});

/** One of the tenant's own admin roles. */
const roleItemSchema = z.strictObject({
  id: z.string(),
  isSystemRole: z.boolean(),
  name: z.string(),
  ...unreadTrelicaKeys({ keys: ["concurrencyStamp", "normalizedName"] }),
});

/** The page every first-party call answers, as the client walks it. */
export interface TrelicaFirstPartyPage {
  readonly items: readonly unknown[];
  readonly total: number;
}

/** One first-party call and the boundary its every page is admitted by. */
export interface TrelicaFirstPartyRead {
  readonly call: TrelicaCall;
  readonly boundary: TrelicaBoundary<TrelicaFirstPartyPage>;
}

/** One call and the boundary bound to it, so the two cannot be paired apart. */
function firstPartyRead({
  call,
  schema,
}: {
  call: TrelicaCall;
  schema: z.ZodType<TrelicaFirstPartyPage>;
}): TrelicaFirstPartyRead {
  return {
    boundary: defineTrelicaBoundary({ callId: call.id, endpoint: `${call.httpMethod} ${call.path}`, schema }),
    call,
  };
}

/**
 * Every first-party call with its boundary, in `inventory.ts`'s order. The alert history answers the same record
 * for a spike alert and a budget alert, and each call still gets its own boundary.
 *
 * AI budgets declares an item with NO keys: MEASURED, no read has yet answered a budget, so the first budget anyone creates
 * is refused and named key by key rather than read as a shape nobody has seen.
 *
 * @internal
 */
export const TRELICA_FIRST_PARTY_READS: readonly TrelicaFirstPartyRead[] = [
  firstPartyRead({ call: TRELICA_CALLS.aiAlertsSpike, schema: trelicaPageSchema({ item: alertItemSchema }) }),
  firstPartyRead({ call: TRELICA_CALLS.aiAlertsBudget, schema: trelicaPageSchema({ item: alertItemSchema }) }),
  firstPartyRead({ call: TRELICA_CALLS.aiBudgets, schema: trelicaPageSchema({ item: z.strictObject({}) }) }),
  firstPartyRead({ call: TRELICA_CALLS.appInventory, schema: trelicaPageSchema({ item: inventoryItemSchema }) }),
  firstPartyRead({ call: TRELICA_CALLS.appCatalog, schema: trelicaPageSchema({ item: catalogItemSchema }) }),
  // Roles is an unpaged list, and alone among these it answers no truncation flag.
  firstPartyRead({
    call: TRELICA_CALLS.roles,
    schema: z.strictObject({ items: z.array(roleItemSchema), total: z.number() }),
  }),
];
