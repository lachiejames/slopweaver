/**
 * What the fill calls, and — for every other read the grant reaches — why it does not.
 *
 * `chronicle.readonly` opens 21 of the inventory's 39 GETs (`generated/surfaces.ts`). Six are the lists that
 * say what this instance is configured with, and the fill calls exactly those. The other fifteen are each
 * named below with the reason it stays uncalled, so a reader can tell a deliberate omission from a forgotten
 * one; `unit/atlas/googleSecops/fillPlan.test.ts` fails the tree if the two sets stop partitioning the 21.
 *
 * The other 18 GETs accept only `cloud-platform`, which the owner declines as wider than least
 * privilege. They fall under five kinds the fill never calls, each published `permissionBlocked` naming the
 * scope that would lift it, so a dark kind reads as dark for permissions rather than as empty.
 */
import type { BoundaryError } from "#lib/boundary.js";
import type { Result } from "#lib/result.js";
import type { GoogleSecopsAtlasKind } from "../model.js";
import {
  projectDataTablesPage,
  projectFeaturedDashboardsPage,
  projectFeedsPage,
  projectFindingsRefinementDeploymentsPage,
  projectFindingsRefinementsPage,
  projectNativeDashboardsPage,
  type SecopsProjectedPage,
} from "./project.js";

/** Which list an entity came from — two kinds hold two families each. */
export type SecopsFillFamily =
  | "data-table"
  | "featured-dashboard"
  | "feed"
  | "findings-refinement"
  | "findings-refinement-deployment"
  | "native-dashboard";

/** One list the fill calls. */
export interface SecopsFillCall {
  /** The inventory row's id, the fully qualified method. */
  readonly id: string;
  /** The bare rpc name — the scope a coverage cell is keyed by. */
  readonly rpc: string;
  /** The path under the instance, or `:verb` for a custom method on the instance itself. */
  readonly relativePath: string;
  readonly kind: GoogleSecopsAtlasKind;
  readonly family: SecopsFillFamily;
  /** Parse one page through the endpoint's strict boundary and keep only its allowlisted fields. */
  readonly page: (input: { body: unknown }) => Result<SecopsProjectedPage, BoundaryError>;
}

/** One readonly GET the fill deliberately leaves uncalled. */
export interface SecopsNotCalled {
  readonly id: string;
  readonly because: string;
}

/** The fully qualified package every inventory id sits under. */
const V1 = "google.cloud.chronicle.v1";

/** The six lists, in the order a run calls them. */
export const GOOGLE_SECOPS_FILL_CALLS: readonly SecopsFillCall[] = [
  {
    family: "data-table",
    id: `${V1}.DataTableService.ListDataTables`,
    kind: "data-table",
    page: projectDataTablesPage,
    relativePath: "dataTables",
    rpc: "ListDataTables",
  },
  {
    family: "native-dashboard",
    id: `${V1}.NativeDashboardService.ListNativeDashboards`,
    kind: "dashboard",
    page: projectNativeDashboardsPage,
    relativePath: "nativeDashboards",
    rpc: "ListNativeDashboards",
  },
  {
    family: "featured-dashboard",
    id: `${V1}.FeaturedContentNativeDashboardService.ListFeaturedContentNativeDashboards`,
    kind: "dashboard",
    page: projectFeaturedDashboardsPage,
    relativePath: "contentHub/featuredContentNativeDashboards",
    rpc: "ListFeaturedContentNativeDashboards",
  },
  {
    family: "feed",
    id: `${V1}.FeedsService.ListFeeds`,
    kind: "feed",
    page: projectFeedsPage,
    relativePath: "feeds",
    rpc: "ListFeeds",
  },
  {
    family: "findings-refinement",
    id: `${V1}.FindingsRefinementService.ListFindingsRefinements`,
    kind: "findings-refinement",
    page: projectFindingsRefinementsPage,
    relativePath: "findingsRefinements",
    rpc: "ListFindingsRefinements",
  },
  {
    family: "findings-refinement-deployment",
    id: `${V1}.FindingsRefinementService.ListAllFindingsRefinementDeployments`,
    kind: "findings-refinement",
    page: projectFindingsRefinementDeploymentsPage,
    relativePath: ":listAllFindingsRefinementDeployments",
    rpc: "ListAllFindingsRefinementDeployments",
  },
];

const SAME_AS_LIST =
  "the list already returns this resource with every field the atlas keeps, so a Get per item is N calls for nothing new";
const ROW_VALUES = "returns a data table's row VALUES, which the descriptor's names-not-values exclusion keeps out";
const CATALOGUE = "returns Google's catalogue of what COULD be ingested, not what this instance is configured with";

/** The fifteen readonly GETs the fill does not call, each with its reason. */
export const GOOGLE_SECOPS_NOT_CALLED: readonly SecopsNotCalled[] = [
  { because: SAME_AS_LIST, id: `${V1}.DataTableService.GetDataTable` },
  {
    because: "addressed by an operation id that no readonly list returns",
    id: `${V1}.DataTableService.GetDataTableOperationErrors`,
  },
  { because: ROW_VALUES, id: `${V1}.DataTableService.GetDataTableRow` },
  { because: ROW_VALUES, id: `${V1}.DataTableService.ListDataTableRows` },
  { because: SAME_AS_LIST, id: `${V1}.FeaturedContentNativeDashboardService.GetFeaturedContentNativeDashboard` },
  {
    because: "returns the instance's ingestion service account — an identity, not configuration",
    id: `${V1}.FeedsService.FetchServiceAccountForCustomer`,
  },
  { because: SAME_AS_LIST, id: `${V1}.FeedsService.GetFeed` },
  { because: CATALOGUE, id: `${V1}.FeedsService.GetFeedPack` },
  { because: CATALOGUE, id: `${V1}.FeedsService.ListFeedPacks` },
  { because: CATALOGUE, id: `${V1}.FeedsService.ListFeedSourceTypeSchemas` },
  { because: CATALOGUE, id: `${V1}.FeedsService.ListLogTypeSchemas` },
  { because: SAME_AS_LIST, id: `${V1}.FindingsRefinementService.GetFindingsRefinement` },
  { because: SAME_AS_LIST, id: `${V1}.FindingsRefinementService.GetFindingsRefinementDeployment` },
  { because: SAME_AS_LIST, id: `${V1}.NativeDashboardService.GetNativeDashboard` },
  {
    because:
      "each error names a rule this grant cannot list (ListRules accepts only cloud-platform), so stored alone it would read as the rule inventory",
    id: `${V1}.RuleExecutionErrorService.ListRuleExecutionErrors`,
  },
];

/** The kinds every GET of which accepts only `cloud-platform` — never called under this grant. */
export const GOOGLE_SECOPS_CLOUD_PLATFORM_ONLY_KINDS: readonly GoogleSecopsAtlasKind[] = [
  "data-access",
  "instance",
  "reference-list",
  "rule",
  "watchlist",
];

/** What would open a cloud-platform-only kind, stamped on its `permissionBlocked`. */
export const CLOUD_PLATFORM_UNBLOCKED_BY =
  "the `cloud-platform` OAuth scope on the SecOps client, which the owner declines as wider than least privilege";

/** What would open a list that answered 403 under a `chronicle.readonly` grant. */
export const IAM_ROLE_UNBLOCKED_BY =
  "a Chronicle API Viewer IAM role (`roles/chronicle.viewer`) for the consenting account on the instance's Cloud project";
