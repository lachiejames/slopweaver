/**
 * What the sync calls, in what order, and — for every other GET KnowBe4 publishes — why it does not.
 *
 * KnowBe4's Reporting API document publishes 24 GET path templates (`descriptor.ts` § `KNOWBE4_REPORTING_SPEC`).
 * The sync calls the eleven that list what the account holds; the other thirteen are each named below with the
 * reason it stays uncalled, so a reader can tell a deliberate omission from a forgotten one.
 * `unit/atlas/knowbe4/fillPlan.test.ts` fails the tree if the two sets stop partitioning the 24.
 *
 * The order is a dependency order, then a budget order. `/v1/account` goes first because its subscription tier is
 * what a later 403 is explained by. The two per-parent paths go LAST, after every top-level list: one request per
 * parent is what can spend the run's 250-request ceiling, and spent there it leaves the lists the nag reads —
 * enrolments, campaigns, phishing tests — already read rather than starved.
 */
import { isRecord } from "#lib/parsers.js";
import type { Result } from "#lib/result.js";
import type { Knowbe4PathTemplate } from "../../../live/knowbe4/transport.js";
import type { Knowbe4AtlasKind } from "../model.js";
import {
  projectAccount,
  projectEnrollments,
  projectGroupMembers,
  projectGroups,
  projectPhishingCampaigns,
  projectPolicies,
  projectRecipients,
  projectSecurityTests,
  projectStorePurchases,
  projectTrainingCampaigns,
  projectUsers,
} from "./project.js";
import type { Knowbe4ProjectError, Knowbe4ProjectedPage } from "./projectShapes.js";

/** One path the sync calls. */
export interface Knowbe4FillCall {
  /** The closed-list path template — also the scope a coverage cell is keyed by. */
  readonly template: Knowbe4PathTemplate;
  readonly kind: Knowbe4AtlasKind;
  /** Whether the path answers a list read with `page`/`per_page`; `/v1/account` answers one object. */
  readonly paged: boolean;
  /** The path whose answered items are this call's parents, or `null` for a top-level read. */
  readonly parent: Knowbe4PathTemplate | null;
  /**
   * How many rows this path should list under one parent, read off the parent's projected detail, where KnowBe4
   * publishes a count; `null` when it does not. A per-parent list ends on its first short page, so reading fewer
   * rows than this is a read that stopped early.
   */
  readonly expectedRows?: (input: { parent: Readonly<Record<string, unknown>> }) => number | null;
  /**
   * Which listed rows {@link expectedRows} counts, where KnowBe4's count covers fewer rows than its list returns;
   * absent, every row counts.
   */
  readonly countedRow?: (input: { detail: Readonly<Record<string, unknown>> }) => boolean;
  /** The fixed query this path is always read with, beside paging. */
  readonly query: Readonly<Record<string, string>>;
  /** Parse one page through the endpoint's strict boundary and keep only its allowlisted fields. */
  readonly page: (input: {
    body: unknown;
    parentId: string | null;
  }) => Result<Knowbe4ProjectedPage, Knowbe4ProjectError>;
}

/** One published GET the sync deliberately leaves uncalled. */
export interface Knowbe4NotCalled {
  readonly template: string;
  readonly because: string;
}

/**
 * A group's member count, as `projectGroups` kept it.
 *
 * @param parent the group's projected detail
 * @returns KnowBe4's `member_count`, or `null` when it left it unset
 */
function groupMemberCount({ parent }: { parent: Readonly<Record<string, unknown>> }): number | null {
  const count = parent["memberCount"];
  return typeof count === "number" ? count : null;
}

/**
 * Whether a group's `member_count` counts this member. It counts ACTIVE members only, while the member list also
 * returns archived ones: on the first credentialed sync every group's `member_count` equalled
 * its active rows exactly, never its active and archived rows together.
 *
 * Only a row KnowBe4 marks `active` counts: a missing or unrecognised status counted as active could make up an
 * active member the read did not get, and publish a short list as whole.
 *
 * @param detail the member's projected detail
 * @returns `true` only for a member whose status is `active`
 */
function memberCountCounts({ detail }: { detail: Readonly<Record<string, unknown>> }): boolean {
  return detail["status"] === "active";
}

/**
 * How many people a CLOSED phishing test was scheduled to — the rows its recipient list must hold. Only a
 * closed test is held to it, because an active one may not have scheduled everyone its count already names.
 *
 * @param parent the security test's projected detail
 * @returns KnowBe4's `scheduled_count` for a closed test, else `null`
 */
function closedTestScheduledCount({ parent }: { parent: Readonly<Record<string, unknown>> }): number | null {
  const counts = parent["counts"];
  if (parent["status"] !== "Closed" || !isRecord(counts)) {
    return null;
  }
  const scheduled = counts["scheduled"];
  return typeof scheduled === "number" ? scheduled : null;
}

/** The eleven paths, in the order a run calls them. */
export const KNOWBE4_FILL_CALLS: readonly Knowbe4FillCall[] = [
  { kind: "account", page: projectAccount, paged: false, parent: null, query: {}, template: "/v1/account" },
  { kind: "user", page: projectUsers, paged: true, parent: null, query: {}, template: "/v1/users" },
  { kind: "group", page: projectGroups, paged: true, parent: null, query: {}, template: "/v1/groups" },
  {
    kind: "training-campaign",
    page: projectTrainingCampaigns,
    paged: true,
    parent: null,
    // Any other value caps the list at TEN rows (KnowBe4's own parameter description).
    query: { exclude_percentages: "true" },
    template: "/v1/training/campaigns",
  },
  {
    kind: "store-purchase",
    page: projectStorePurchases,
    paged: true,
    parent: null,
    query: {},
    template: "/v1/training/store_purchases",
  },
  { kind: "policy", page: projectPolicies, paged: true, parent: null, query: {}, template: "/v1/training/policies" },
  {
    kind: "training-enrollment",
    page: projectEnrollments,
    paged: true,
    parent: null,
    // Archived people are kept: an archived person's incomplete assignment is still a fact about the control.
    query: { exclude_archived_users: "false", include_campaign_id: "true", include_store_purchase_id: "true" },
    template: "/v1/training/enrollments",
  },
  {
    kind: "phishing-campaign",
    page: projectPhishingCampaigns,
    paged: true,
    parent: null,
    query: {},
    template: "/v1/phishing/campaigns",
  },
  {
    kind: "phishing-security-test",
    page: projectSecurityTests,
    paged: true,
    parent: null,
    query: {},
    template: "/v1/phishing/security_tests",
  },
  {
    countedRow: memberCountCounts,
    expectedRows: groupMemberCount,
    kind: "group-member",
    page: projectGroupMembers,
    paged: true,
    parent: "/v1/groups",
    query: {},
    template: "/v1/groups/{id}/members",
  },
  {
    expectedRows: closedTestScheduledCount,
    kind: "phishing-recipient",
    page: projectRecipients,
    paged: true,
    parent: "/v1/phishing/security_tests",
    query: {},
    template: "/v1/phishing/security_tests/{id}/recipients",
  },
];

const SAME_AS_LIST =
  "the list already returns this row with every field the atlas keeps, so a by-id read is N calls for nothing new";
const RISK_HISTORY =
  "a longitudinal risk-score series; the atlas keeps the current score the list returns, and the training and phishing questions need nothing older";

/** The thirteen published GETs the sync does not call, each with its reason. */
export const KNOWBE4_NOT_CALLED: readonly Knowbe4NotCalled[] = [
  { because: RISK_HISTORY, template: "/v1/account/risk_score_history" },
  { because: SAME_AS_LIST, template: "/v1/users/{user_id}" },
  { because: RISK_HISTORY, template: "/v1/users/{user_id}/risk_score_history" },
  { because: SAME_AS_LIST, template: "/v1/groups/{group_id}" },
  { because: RISK_HISTORY, template: "/v1/groups/{group_id}/risk_score_history" },
  { because: SAME_AS_LIST, template: "/v1/phishing/campaigns/{campaign_id}" },
  {
    because:
      "the security-test list already returns every test with its campaign id, so a per-campaign read repeats it",
    template: "/v1/phishing/campaigns/{campaign_id}/security_tests",
  },
  { because: SAME_AS_LIST, template: "/v1/phishing/security_tests/{pst_id}" },
  { because: SAME_AS_LIST, template: "/v1/phishing/security_tests/{pst_id}/recipients/{recipient_id}" },
  { because: SAME_AS_LIST, template: "/v1/training/store_purchases/{store_purchase_id}" },
  { because: SAME_AS_LIST, template: "/v1/training/policies/{policy_id}" },
  { because: SAME_AS_LIST, template: "/v1/training/campaigns/{campaign_id}" },
  { because: SAME_AS_LIST, template: "/v1/training/enrollments/{enrollment_id}" },
];

/** A part of a called list that KnowBe4 selects by a query the sync never sends. */
export interface Knowbe4UnreadPartition {
  readonly template: Knowbe4PathTemplate;
  /** The selector, as KnowBe4's document spells it. */
  readonly query: string;
  readonly because: string;
}

const CALLBACK_UNREAD =
  "KnowBe4 documents `campaign_type=callback` as returning callback-phishing results without saying whether the plain list already holds them, so a read of both could trip the repeated-id refusal or miss nothing at all; it is declared unread until the first credentialed sync shows which";

/**
 * The query-selected parts of a called list the sync does not read, each published as an `excluded` coverage
 * cell on its kind, so a phishing kind never reads as holding callback phishing it never asked for.
 */
export const KNOWBE4_UNREAD_PARTITIONS: readonly Knowbe4UnreadPartition[] = [
  { because: CALLBACK_UNREAD, query: "campaign_type=callback", template: "/v1/phishing/security_tests" },
  {
    because: CALLBACK_UNREAD,
    query: "campaign_type=callback",
    template: "/v1/phishing/security_tests/{id}/recipients",
  },
];

/** What would open a path that answered 403 — KnowBe4's own Reporting API tier requirement. */
export const SUBSCRIPTION_UNBLOCKED_BY =
  "a KnowBe4 subscription tier that includes the Reporting API (Platinum, Diamond, SAT Foundations or SAT Advanced), or a token minted by an account admin";
