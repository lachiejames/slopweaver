/**
 * What each list the fill calls is allowed to answer — one strict boundary per endpoint, built from the
 * response messages in the pinned protos (`generated/protoLock.ts`).
 *
 * Every field the proto declares is declared here, because a strict object refuses a key it was not told
 * about and that refusal is the point: a field Google adds, renames or retypes fails that one call with the
 * field named, instead of reading as success. A field the fill never reads is declared `unread`, so the key
 * set stays known without the value being trusted or kept.
 *
 * Proto3's JSON mapping decides three things the protos do not say outright: a field holding its default
 * (an empty string, `false`, zero, an empty list) is OMITTED, so every field is optional; an `int64` arrives
 * as a decimal STRING; and an enum arrives as its value's NAME. Enums are read as `z.string()` rather than as
 * the pinned value set, so a value Google adds after the pin does not sink a whole list.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";
import { FEED_SETTINGS_JSON_FIELDS } from "./feedSettingsFields.js";

/** A declared key whose value the fill never reads. */
const unread = z.unknown().optional();

/** `DataTableColumnInfo` — only the column's name is read. */
const dataTableColumnWire = z.strictObject({
  columnIndex: unread,
  columnType: unread,
  keyColumn: unread,
  mappedColumnPath: unread,
  originalColumn: z.string().optional(),
  repeatedValues: unread,
});

/** `DataTable`. Its rows are a separate collection the fill never lists. */
const dataTableWire = z.strictObject({
  approximateRowCount: z.string().optional(),
  columnInfo: z.array(dataTableColumnWire).optional(),
  createTime: unread,
  dataTableUuid: unread,
  description: z.string().optional(),
  displayName: z.string().optional(),
  name: z.string(),
  ruleAssociationsCount: z.number().optional(),
  rowTimeToLive: unread,
  rowTimeToLiveUpdateTime: unread,
  rules: unread,
  scopeInfo: unread,
  updateSource: unread,
  updateTime: z.string().optional(),
});

/** `ListDataTablesResponse`. */
export const LIST_DATA_TABLES = defineBoundary({
  endpoint: "GET chronicle v1 ListDataTables",
  schema: z.strictObject({
    dataTables: z.array(dataTableWire).optional(),
    nextPageToken: z.string().optional(),
  }),
});

/** `NativeDashboard`. Its `definition` — the charts and their queries — is declared and never read. */
const nativeDashboardWire = z.strictObject({
  access: z.string().optional(),
  createTime: unread,
  createUserId: unread,
  dashboardUserData: unread,
  definition: unread,
  description: z.string().optional(),
  displayName: z.string().optional(),
  etag: unread,
  name: z.string(),
  type: z.string().optional(),
  updateTime: z.string().optional(),
  updateUserId: unread,
});

/** `ListNativeDashboardsResponse`. */
export const LIST_NATIVE_DASHBOARDS = defineBoundary({
  endpoint: "GET chronicle v1 ListNativeDashboards",
  schema: z.strictObject({
    nativeDashboards: z.array(nativeDashboardWire).optional(),
    nextPageToken: z.string().optional(),
  }),
});

/** `FeaturedContentMetadata`. */
const featuredContentMetadataWire = z.strictObject({
  author: z.string().optional(),
  categories: z.array(z.string()).optional(),
  certified: z.boolean().optional(),
  createTime: unread,
  description: unread,
  displayName: z.string().optional(),
  id: unread,
  sourceType: z.string().optional(),
  updateTime: unread,
  verified: unread,
  version: z.string().optional(),
});

/** `FeaturedContentNativeDashboard`. Its `dashboardContent` is declared and never read. */
const featuredDashboardWire = z.strictObject({
  contentMetadata: featuredContentMetadataWire.optional(),
  dashboardContent: unread,
  name: z.string(),
});

/** `ListFeaturedContentNativeDashboardsResponse`. */
export const LIST_FEATURED_DASHBOARDS = defineBoundary({
  endpoint: "GET chronicle v1 ListFeaturedContentNativeDashboards",
  schema: z.strictObject({
    featuredContentNativeDashboards: z.array(featuredDashboardWire).optional(),
    nextPageToken: z.string().optional(),
  }),
});

/**
 * `FeedDetails`: six metadata fields, then the `details` oneof — every settings key declared and none read,
 * because a settings message is where a feed's source keeps its credential (`feedSettingsFields.ts`).
 */
const feedDetailsWire = z.strictObject({
  ...Object.fromEntries(FEED_SETTINGS_JSON_FIELDS.map((field) => [field, unread])),
  assetNamespace: unread,
  feedSourceType: z.string().optional(),
  labels: unread,
  lastV2MigrationAttemptTime: unread,
  logType: z.string().optional(),
  stsMigrationReadiness: unread,
});

/** `FeedFailureDetails` — only Google's error code is read. */
const feedFailureDetailsWire = z.strictObject({
  errorAction: unread,
  errorCause: unread,
  errorCode: z.string().optional(),
  httpErrorCode: unread,
});

/** `Feed`. */
const feedWire = z.strictObject({
  details: feedDetailsWire.optional(),
  displayName: z.string().optional(),
  failureDetails: feedFailureDetailsWire.optional(),
  failureMsg: unread,
  lastFeedInitiationTime: unread,
  name: z.string(),
  readOnly: unread,
  referenceId: unread,
  state: z.string().optional(),
  uid: unread,
});

/** `ListFeedsResponse`. */
export const LIST_FEEDS = defineBoundary({
  endpoint: "GET chronicle v1 ListFeeds",
  schema: z.strictObject({
    feeds: z.array(feedWire).optional(),
    nextPageToken: z.string().optional(),
  }),
});

/** `FindingsRefinement`. Its `query` and `outcomeFilters` are declared and never read. */
const findingsRefinementWire = z.strictObject({
  createTime: unread,
  displayName: z.string().optional(),
  name: z.string(),
  outcomeFilters: unread,
  query: unread,
  type: z.string().optional(),
  updateTime: z.string().optional(),
});

/** `ListFindingsRefinementsResponse`. */
export const LIST_FINDINGS_REFINEMENTS = defineBoundary({
  endpoint: "GET chronicle v1 ListFindingsRefinements",
  schema: z.strictObject({
    findingsRefinements: z.array(findingsRefinementWire).optional(),
    nextPageToken: z.string().optional(),
  }),
});

/** `DetectionExclusionApplication` — the detectors an exclusion applies to, counted rather than kept. */
const detectionExclusionApplicationWire = z.strictObject({
  curatedRuleSets: z.array(z.string()).optional(),
  curatedRules: z.array(z.string()).optional(),
  deletedCuratedRuleSets: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
});

/** `FindingsRefinementDeployment`. */
const findingsRefinementDeploymentWire = z.strictObject({
  archived: z.boolean().optional(),
  detectionExclusionApplication: detectionExclusionApplicationWire.optional(),
  enabled: z.boolean().optional(),
  name: z.string(),
  updateTime: z.string().optional(),
});

/** `ListAllFindingsRefinementDeploymentsResponse`. */
export const LIST_ALL_FINDINGS_REFINEMENT_DEPLOYMENTS = defineBoundary({
  endpoint: "GET chronicle v1 ListAllFindingsRefinementDeployments",
  schema: z.strictObject({
    allFindingsRefinementDeployments: z.array(findingsRefinementDeploymentWire).optional(),
    nextPageToken: z.string().optional(),
  }),
});
