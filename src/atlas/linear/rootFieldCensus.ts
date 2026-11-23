/**
 * Every root field the schema declares, classified — so a root field Linear adds next month cannot vanish
 * from this atlas silently. PURE.
 *
 * ## The lie this file exists to prevent
 *
 * `settingSurfaces.ts` is a hand-picked list of twenty-one configuration reads. A hand-picked list is a fine way to
 * decide what to READ and a terrible way to describe what EXISTS: a root field nobody classified is simply
 * absent, and absent looks exactly like "Linear has no such thing". The JumpCloud atlas keeps its excluded
 * operations inventoried for the same reason — an exclusion a reader can see is a decision, an exclusion
 * nobody wrote down is a hole.
 *
 * So this module classifies the WHOLE root surface against the live schema, and anything it cannot place
 * becomes an `unclassified-root-field` gap rather than a silence. On the schema measured the
 * residue is empty; the mechanism exists for the day it is not.
 *
 * ## Why `admitted` is computed rather than listed
 *
 * The admitted set is derived from `settingSurfaces.ts`'s own inventory, so the two cannot drift apart. Listing
 * them twice would create exactly the class of stale second copy this file is about.
 */
import { LINEAR_SETTING_SURFACES } from "./settingSurfaces.js";

/**
 * What one root field is, as far as this atlas is concerned.
 * @internal
 */
export type RootFieldClassification =
  /** Read into the `setting` kind by `settings.ts`. */
  | "admitted-configuration"
  /** Deliberately not read: the world model's corpus holds this, not the atlas. */
  | "excluded-corpus"
  /** Deliberately not read: a singular reader of rows an admitted plural already returns. */
  | "excluded-singular"
  /** Deliberately not read: a search or suggestion endpoint, which answers about a query rather than shape. */
  | "excluded-query-shaped"
  /** Deliberately not called: reading it makes Linear do something — probe, verify, send, resolve. */
  | "excluded-side-effecting"
  /** Deliberately not read: session, credential or invitation state. */
  | "excluded-sensitive"
  /** Deliberately not read: voluminous event telemetry, per the owner's own audit-log boundary. */
  | "excluded-voluminous"
  /** Deliberately not read: the schema itself marks it deprecated. */
  | "excluded-deprecated"
  /** Never read by this atlas: every mutation, because it only ever reads. */
  | "mutation-not-called"
  /** Catalogued but never opened: a subscription's transport is unverified here. */
  | "subscription-not-opened"
  /** Nothing placed it. This is the state that becomes a gap. */
  | "unclassified";

/**
 * One classified root field.
 * @internal
 */
export interface ClassifiedRootField {
  readonly providerId: string;
  readonly classification: RootFieldClassification;
  readonly reason: string;
}

/** One deliberate exclusion group: the names it covers, and the single reason they share. */
interface ExclusionGroup {
  readonly classification: RootFieldClassification;
  readonly reason: string;
  readonly names: readonly string[];
}

/**
 * Every deliberate exclusion, grouped by the reason it shares.
 *
 * A group rather than a per-field reason because the reasons genuinely repeat: there is one reason the
 * corpus holds issues and it is the same reason it holds comments. What must never be shared is the
 * membership — a name appears in exactly one group, and `rootFieldCensus`'s own duplicate check refuses a
 * table where one does not.
 */
const EXCLUSIONS: readonly ExclusionGroup[] = [
  {
    classification: "excluded-corpus",
    names: [
      "agentActivities",
      "agentActivity",
      "agentSessionSandbox",
      "agentSessions",
      "agentSession",
      "agentSkill",
      "agentSkills",
      "attachment",
      "attachments",
      "comment",
      "comments",
      "customView",
      "customViews",
      "customer",
      "customerNeed",
      "customerNeeds",
      "customers",
      "cycle",
      "cycles",
      "diff",
      "document",
      "documentContentHistory",
      "documentContentHistoryEntries",
      "documentContentHistoryTimeline",
      "documents",
      "emailIntakeAddress",
      "entityExternalLink",
      "externalUser",
      "externalUsers",
      "favorite",
      "favorites",
      "initiative",
      "initiativeRelation",
      "initiativeRelations",
      "initiativeToProject",
      "initiativeToProjects",
      "initiativeUpdate",
      "initiativeUpdates",
      "initiatives",
      "issue",
      "issueRelation",
      "issueRelations",
      "issueToRelease",
      "issueToReleases",
      "issues",
      "projectMilestone",
      "projectMilestones",
      "projectRelation",
      "projectRelations",
      "projectUpdate",
      "projectUpdates",
      "project",
      "projects",
      "release",
      "releaseNote",
      "releaseNotes",
      "releaseStage",
      "releaseStages",
      "releases",
      "teamMembership",
      "teamMemberships",
      "user",
      "users",
      "viewer",
      "inboxNotifications",
      "notification",
      "notifications",
      "notificationSubscription",
      "notificationSubscriptions",
      "notificationsUnreadCount",
      "integrationTemplate",
      "integrationTemplates",
      "projectStatusProjectCount",
      "usageAlert",
      "usageAlerts",
      "customerNeed",
    ],
    reason:
      "the world model's corpus holds this, and the owner's per-platform ruling is that a platform whose entities the corpus holds gets a SURFACE MAP rather than a second copy of them",
  },
  {
    classification: "excluded-singular",
    names: [
      "administrableTeams",
      "archivedIntegrations",
      "archivedTeams",
      "customerStatus",
      "customerTier",
      "emoji",
      "initiativeLabel",
      "integration",
      "integrationsSettings",
      "issueLabel",
      "oauthApplication",
      "projectLabel",
      "projectStatus",
      "releasePipeline",
      "releasePipelineByAccessKey",
      "team",
      "template",
      "timeSchedule",
      "triageResponsibility",
      "webhook",
      "workflowState",
    ],
    reason:
      "a singular or narrowed reader of rows an admitted plural already returns in full — reading it would add a record this atlas already holds under the same provider id",
  },
  {
    classification: "excluded-query-shaped",
    names: [
      "attachmentsForURL",
      "customViewDetailsSuggestion",
      "customViewHasSubscribers",
      "initiativeFilterSuggestion",
      "initiativeLeadTeamChangeImpact",
      "issueFigmaFileKeySearch",
      "issueFilterSuggestion",
      "issueRepositorySuggestions",
      "issueSearch",
      "issueTitleSuggestionFromCustomerRequest",
      "issueVcsBranchSearch",
      "projectFilterSuggestion",
      "releaseSearch",
      "searchDocuments",
      "searchIssues",
      "searchProjects",
      "semanticSearch",
      "templateSearch",
      "templatesForIntegration",
      "attachmentIssue",
    ],
    reason:
      "answers a QUERY rather than describing the platform's shape — its result depends on what was asked, so storing one is storing a question somebody happened to ask",
  },
  {
    classification: "excluded-side-effecting",
    names: [
      "applicationInfo",
      "attachmentSources",
      "availableUsers",
      "integrationHasScopes",
      "integrationJiraProjectStatuses",
      "issueImportCheckCSV",
      "issueImportCheckSync",
      "issueImportJqlCheck",
      "latestReleaseByAccessKey",
      "microsoftTeamsChannels",
      "organizationDomainClaimRequest",
      "organizationExists",
      "organizationInviteDetails",
      "organizationMeta",
      "partnerOfferDetails",
      "partnerOfferWorkspaces",
      "partnerProgramPartners",
      "pushSubscriptionTest",
      "recentReleasesByAccessKey",
      "ssoUrlFromEmail",
      "verifyGitHubEnterpriseServerInstallation",
    ],
    reason:
      "reading it makes Linear DO something — probe a third party, send a notification, resolve an invitation, or answer about an account this workspace does not own. An atlas that only ever reads may not call it",
  },
  {
    classification: "excluded-sensitive",
    names: ["authenticationSessions", "organizationInvite", "organizationInvites", "userSessions"],
    reason:
      "session, credential or invitation state. A map of what exists does not need to hold who is currently signed in from where, and holding it would make this atlas worth stealing",
  },
  {
    classification: "excluded-voluminous",
    names: ["auditEntries", "auditEntryTypes", "auditLogWebhookFailureEvents", "failuresForOauthWebhooks"],
    reason:
      "event telemetry. The owner's own boundary for the small atlases was everything reachable EXCEPT the highly voluminous logs, and that boundary applies here for the same reason",
  },
  {
    classification: "excluded-deprecated",
    names: ["roadmap", "roadmapToProject", "roadmapToProjects", "roadmaps"],
    reason:
      "the schema itself marks this deprecated. It stays catalogued in the `operation` kind — that is what the schema census is for — and is not read into configuration",
  },
];

/** Which root fields the `settingSurfaces.ts` inventory actually reads, derived from it rather than restated. */
function admittedNames(): ReadonlySet<string> {
  return new Set(LINEAR_SETTING_SURFACES.map((surface) => surface.shape.field));
}

/**
 * Classify every root field the schema declares.
 *
 * @param operationProviderIds every `<rootKind>.<name>` key `introspection.ts` produced
 * @returns one classification per root field, ordered by provider key
 */
export function classifyRootFields({
  operationProviderIds,
}: {
  operationProviderIds: readonly string[];
}): readonly ClassifiedRootField[] {
  const admitted = admittedNames();
  const byName = new Map<string, ExclusionGroup>();
  for (const group of EXCLUSIONS) {
    for (const name of group.names) {
      byName.set(name, group);
    }
  }
  return operationProviderIds
    .map((providerId): ClassifiedRootField => {
      const separator = providerId.indexOf(".");
      const rootKind = providerId.slice(0, separator);
      const name = providerId.slice(separator + 1);
      if (rootKind === "mutation") {
        return {
          classification: "mutation-not-called",
          providerId,
          reason: "this atlas only ever reads; no mutation is called on any surface",
        };
      }
      if (rootKind === "subscription") {
        return {
          classification: "subscription-not-opened",
          providerId,
          reason:
            "catalogued from the schema and never opened — the subscription TRANSPORT is unverified here, and a declaration catalogued is not a capability measured",
        };
      }
      if (admitted.has(name)) {
        return {
          classification: "admitted-configuration",
          providerId,
          reason: "read into the `setting` kind by the closed inventory in settingSurfaces.ts",
        };
      }
      const group = byName.get(name);
      if (group !== undefined) {
        return { classification: group.classification, providerId, reason: group.reason };
      }
      return {
        classification: "unclassified",
        providerId,
        reason:
          "no rule in rootFieldCensus.ts places this root field, so it is neither read nor deliberately excluded — a decision is owed",
      };
    })
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * The root fields nothing placed — the residue that must be a gap rather than a silence.
 *
 * @param classified every classified root field
 * @returns their provider keys, sorted; empty when the whole root surface is accounted for
 */
export function unclassifiedRootFields({
  classified,
}: {
  classified: readonly ClassifiedRootField[];
}): readonly string[] {
  return classified.filter((field) => field.classification === "unclassified").map((field) => field.providerId);
}
