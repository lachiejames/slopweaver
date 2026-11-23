/**
 * What the atlas keeps from one page of each list — an ALLOWLIST per family, never the item itself.
 *
 * Every reader here parses the page through its endpoint's strict boundary first, then copies the named
 * fields it keeps into a fresh object. Nothing is spread from the wire, so a field nobody chose cannot reach
 * the store by riding along: a feed's settings (where its source keeps a credential) contribute the NAME of
 * the one settings key present and nothing else, a data table contributes its column names and never a row,
 * and a dashboard contributes its name and type and never its charts or their queries.
 *
 * Proto3 JSON omits a field holding its default, so an absent list is an empty one, an absent boolean is
 * `false` and an absent count is zero; an absent string is kept as `null` rather than invented.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { BoundaryError } from "#lib/boundary.js";
import type { Result } from "#lib/result.js";
import {
  LIST_ALL_FINDINGS_REFINEMENT_DEPLOYMENTS,
  LIST_DATA_TABLES,
  LIST_FEATURED_DASHBOARDS,
  LIST_FEEDS,
  LIST_FINDINGS_REFINEMENTS,
  LIST_NATIVE_DASHBOARDS,
} from "./boundaries.js";
import { FEED_SETTINGS_JSON_FIELDS } from "./feedSettingsFields.js";

/** One item a list answered, reduced to what the atlas keeps. */
export interface SecopsProjectedItem {
  /** The resource's own name, `projects/.../instances/<uuid>/<collection>/<id>`. */
  readonly providerId: string;
  /** The allowlisted fields, never the wire item. */
  readonly detail: Readonly<Record<string, unknown>>;
}

/** One page of one list, projected. */
export interface SecopsProjectedPage {
  readonly items: readonly SecopsProjectedItem[];
  /** Where the next page starts, or `null` on the last one. */
  readonly nextPageToken: string | null;
}

/** How many entries a repeated field holds: proto3 JSON omits an empty one, so absence IS zero entries. */
function repeatedCount({ list }: { list: readonly string[] | undefined }): number {
  if (list === undefined) {
    return 0;
  }
  return list.length;
}

/** A `bool`: proto3 JSON omits `false`. */
function protoBool({ value }: { value: boolean | undefined }): boolean {
  return value === true;
}

/** An `int32` count: proto3 JSON omits zero. */
function protoCount({ value }: { value: number | undefined }): number {
  if (value === undefined) {
    return 0;
  }
  return value;
}

/** A `next_page_token`: proto3 JSON omits the empty one that marks the last page. */
function nextToken({ token }: { token: string | undefined }): string | null {
  if (token === undefined || token === "") {
    return null;
  }
  return token;
}

/**
 * One page of `ListDataTables`: name, description, columns by NAME, size and rule count — never a row.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal naming the field that drifted
 */
export function projectDataTablesPage({ body }: { body: unknown }): Result<SecopsProjectedPage, BoundaryError> {
  return LIST_DATA_TABLES.parse({ value: body }).map(({ dataTables = [], nextPageToken }) => ({
    items: dataTables.map(({ columnInfo = [], ...table }) => ({
      detail: {
        approximateRowCount: unsetFieldAsNull({ key: "approximateRowCount", record: table }),
        columns: columnInfo.map((column) => unsetFieldAsNull({ key: "originalColumn", record: column })),
        description: unsetFieldAsNull({ key: "description", record: table }),
        displayName: unsetFieldAsNull({ key: "displayName", record: table }),
        family: "data-table",
        ruleAssociations: protoCount({ value: table.ruleAssociationsCount }),
        updateTime: unsetFieldAsNull({ key: "updateTime", record: table }),
      },
      providerId: table.name,
    })),
    nextPageToken: nextToken({ token: nextPageToken }),
  }));
}

/**
 * One page of `ListNativeDashboards`: name, type and access — never the definition.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal naming the field that drifted
 */
export function projectNativeDashboardsPage({ body }: { body: unknown }): Result<SecopsProjectedPage, BoundaryError> {
  return LIST_NATIVE_DASHBOARDS.parse({ value: body }).map(({ nativeDashboards = [], nextPageToken }) => ({
    items: nativeDashboards.map((dashboard) => ({
      detail: {
        access: unsetFieldAsNull({ key: "access", record: dashboard }),
        description: unsetFieldAsNull({ key: "description", record: dashboard }),
        displayName: unsetFieldAsNull({ key: "displayName", record: dashboard }),
        family: "native-dashboard",
        type: unsetFieldAsNull({ key: "type", record: dashboard }),
        updateTime: unsetFieldAsNull({ key: "updateTime", record: dashboard }),
      },
      providerId: dashboard.name,
    })),
    nextPageToken: nextToken({ token: nextPageToken }),
  }));
}

/**
 * One page of `ListFeaturedContentNativeDashboards`: the content hub's own metadata — never the content.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal naming the field that drifted
 */
export function projectFeaturedDashboardsPage({ body }: { body: unknown }): Result<SecopsProjectedPage, BoundaryError> {
  return LIST_FEATURED_DASHBOARDS.parse({ value: body }).map(
    ({ featuredContentNativeDashboards = [], nextPageToken }) => ({
      items: featuredContentNativeDashboards.map((featured) => {
        const metadata = unsetFieldAsNull({ key: "contentMetadata", record: featured });
        return {
          detail: {
            author: unsetFieldAsNull({ key: "author", record: metadata }),
            categories: metadata?.categories === undefined ? [] : [...metadata.categories],
            certified: protoBool({ value: metadata?.certified }),
            displayName: unsetFieldAsNull({ key: "displayName", record: metadata }),
            family: "featured-dashboard",
            sourceType: unsetFieldAsNull({ key: "sourceType", record: metadata }),
            version: unsetFieldAsNull({ key: "version", record: metadata }),
          },
          providerId: featured.name,
        };
      }),
      nextPageToken: nextToken({ token: nextPageToken }),
    }),
  );
}

/**
 * The settings key a feed's details carry — its source type's own settings message — by NAME.
 *
 * @param details the feed's parsed details, keyed by JSON field name
 * @returns the one settings key present, or `null` when the feed carries none
 */
function settingsFieldOf({ details }: { details: Readonly<Record<string, unknown>> | null }): string | null {
  if (details === null) {
    return null;
  }
  const present = FEED_SETTINGS_JSON_FIELDS.filter((field) => details[field] !== undefined);
  return present.length === 0 ? null : present.join(",");
}

/**
 * One page of `ListFeeds`: name, state, log type, source type, the NAME of its settings key and Google's
 * error code — never a settings value, which is where a source's credential lives.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal naming the field that drifted
 */
export function projectFeedsPage({ body }: { body: unknown }): Result<SecopsProjectedPage, BoundaryError> {
  return LIST_FEEDS.parse({ value: body }).map(({ feeds = [], nextPageToken }) => ({
    items: feeds.map((feed) => {
      const details = unsetFieldAsNull({ key: "details", record: feed });
      const failure = unsetFieldAsNull({ key: "failureDetails", record: feed });
      return {
        detail: {
          displayName: unsetFieldAsNull({ key: "displayName", record: feed }),
          errorCode: unsetFieldAsNull({ key: "errorCode", record: failure }),
          family: "feed",
          feedSourceType: unsetFieldAsNull({ key: "feedSourceType", record: details }),
          logType: unsetFieldAsNull({ key: "logType", record: details }),
          settingsField: settingsFieldOf({ details }),
          state: unsetFieldAsNull({ key: "state", record: feed }),
        },
        providerId: feed.name,
      };
    }),
    nextPageToken: nextToken({ token: nextPageToken }),
  }));
}

/**
 * One page of `ListFindingsRefinements`: name, type and update time — never the query or its filters.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal naming the field that drifted
 */
export function projectFindingsRefinementsPage({
  body,
}: {
  body: unknown;
}): Result<SecopsProjectedPage, BoundaryError> {
  return LIST_FINDINGS_REFINEMENTS.parse({ value: body }).map(({ findingsRefinements = [], nextPageToken }) => ({
    items: findingsRefinements.map((refinement) => ({
      detail: {
        displayName: unsetFieldAsNull({ key: "displayName", record: refinement }),
        family: "findings-refinement",
        type: unsetFieldAsNull({ key: "type", record: refinement }),
        updateTime: unsetFieldAsNull({ key: "updateTime", record: refinement }),
      },
      providerId: refinement.name,
    })),
    nextPageToken: nextToken({ token: nextPageToken }),
  }));
}

/**
 * One page of `ListAllFindingsRefinementDeployments`: whether each refinement is live, and how many
 * detectors it applies to — counted, not named.
 *
 * @param body the response body, untyped until the boundary reads it
 * @returns the projected page, or the boundary's refusal naming the field that drifted
 */
export function projectFindingsRefinementDeploymentsPage({
  body,
}: {
  body: unknown;
}): Result<SecopsProjectedPage, BoundaryError> {
  return LIST_ALL_FINDINGS_REFINEMENT_DEPLOYMENTS.parse({ value: body }).map(
    ({ allFindingsRefinementDeployments = [], nextPageToken }) => ({
      items: allFindingsRefinementDeployments.map((deployment) => {
        const applied = unsetFieldAsNull({ key: "detectionExclusionApplication", record: deployment });
        return {
          detail: {
            appliesTo: {
              curatedRuleSets: repeatedCount({ list: applied?.curatedRuleSets }),
              curatedRules: repeatedCount({ list: applied?.curatedRules }),
              deletedCuratedRuleSets: repeatedCount({ list: applied?.deletedCuratedRuleSets }),
              rules: repeatedCount({ list: applied?.rules }),
            },
            archived: protoBool({ value: deployment.archived }),
            enabled: protoBool({ value: deployment.enabled }),
            family: "findings-refinement-deployment",
            updateTime: unsetFieldAsNull({ key: "updateTime", record: deployment }),
          },
          providerId: deployment.name,
        };
      }),
      nextPageToken: nextToken({ token: nextPageToken }),
    }),
  );
}
