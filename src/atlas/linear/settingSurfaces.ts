/**
 * The closed INVENTORY of Linear configuration this atlas may read: the row shape, the page bounds a
 * connection read walks, and every row in the order a sync walks them.
 *
 * Pure data and a leaf: it imports nothing from this atlas. The projection that turns each answer into
 * `setting` entities is `settings.ts`, and so is the rationale these rows honour — why the selection IS the
 * allowlist, and the deny-list of fields deliberately NOT selected. A row below that says "see this file's
 * header" means that header in `settings.ts`.
 */

import { LinearDocument } from "@linear/sdk";

/** How one inventory row's answer is shaped, so ONE projector can walk every row. */
type SettingShape =
  /** `data.<field>` is one object: the whole workspace's own configuration. */
  | { readonly kind: "single"; readonly field: string }
  /** `data.<field>` is a plain list. */
  | { readonly kind: "list"; readonly field: string }
  /** `data.<field>.nodes` is a page of a connection. */
  | { readonly kind: "connection"; readonly field: string };

/** One thing this atlas may read from Linear's configuration surface. */
export interface LinearSettingSurface {
  /** The `setting` group this row fills — also the first half of every record's provider key. */
  readonly group: string;
  /** Why reading this is configuration rather than corpus. A reviewer checks the row against it. */
  readonly whyRead: string;
  /** The exact document sent. No caller may supply one. */
  readonly document: string;
  readonly shape: SettingShape;
  /** Which selected field carries the human label, when one exists. */
  readonly labelField: string | null;
  /**
   * Which selected field names the team this configuration belongs to, when it is team-scoped. A row
   * without one is workspace-scoped, and its records say `workspace`.
   */
  readonly teamKeyPath: readonly string[] | null;
  /**
   * Whether this row's document takes a `$teamId` and must therefore be run once per team.
   *
   * A fan-out rather than a filter because Linear declares some configuration only through a team-scoped
   * root field — `slaConfigurations(teamId:)` has no workspace-wide sibling — and leaving it out because
   * the inventory shape was awkward is how a hole gets called a decision. A fanned-out row's records take
   * their scope from the team they were read for, not from a field in the answer.
   */
  readonly perTeam: boolean;
}

/**
 * How many rows one connection page asks for.
 *
 * A page size, NOT a cap: every connection row below carries a cursor variable and `pageInfo`, and the
 * reader follows `hasNextPage` to the end. That is the data-integrity ruling applied to a page boundary —
 * measured, a single-page read of a live workspace returned exactly one full page of issue labels and
 * exactly one full page of custom emoji, which is what a truncated read looks like from the inside and is indistinguishable
 * from a complete one. 250 is Linear's own maximum page size.
 */
export const SETTINGS_PAGE_SIZE = 250;

/**
 * The most pages one connection surface may take before the read is refused as unbounded.
 *
 * A bound is needed because `hasNextPage` comes from the provider, and a loop that trusts it without limit
 * is a loop a provider bug can run forever. At {@link SETTINGS_PAGE_SIZE} rows a page this admits 25,000
 * rows of one configuration kind, a bound a well-behaved provider's paging never needs to approach — so
 * reaching it is a finding rather than a routine truncation, and `coverage.ts` raises it as one.
 */
export const SETTINGS_MAX_PAGES = 100;

const ORGANIZATION_FIELDS = `
  id name urlKey createdAt
  gitBranchFormat gitLinkbackMessagesEnabled gitPublicLinkbackMessagesEnabled gitLinkbackDescriptionsEnabled
  roadmapEnabled releasesEnabled customersEnabled feedEnabled codeIntelligenceEnabled initiativeUpdateRemindersDay
  projectUpdateReminderFrequencyInWeeks projectUpdateRemindersDay projectUpdateRemindersHour
  initiativeUpdateReminderFrequencyInWeeks initiativeUpdateRemindersHour
  fiscalYearStartMonth workingDays defaultHomeView releaseChannel
  samlEnabled scimEnabled hipaaComplianceEnabled restrictAgentInvocationToMembers
  allowedFileUploadContentTypes previousUrlKeys
  aiAddonEnabled agentAutomationEnabled generatedUpdatesEnabled aiTelemetryEnabled
  aiThreadSummariesEnabled aiDiscussionSummariesEnabled linearAgentEnabled codingAgentEnabled
  slackProjectChannelsEnabled slackAutoCreateProjectChannel slackProjectChannelPrefix
  userCount trialEndsAt`;

const TEAM_FIELDS = `
  id key name description icon color private timezone visibility
  cyclesEnabled cycleStartDay cycleDuration cycleCooldownTime cycleLockToActive upcomingCycleCount
  cycleIssueAutoAssignStarted cycleIssueAutoAssignCompleted
  inheritWorkflowStatuses inheritProjectStatuses inheritIssueEstimation initiativesEnabled
  issueEstimationType issueEstimationAllowZero issueEstimationExtended defaultIssueEstimate
  setIssueSortOrderOnStateChange triageEnabled requirePriorityToLeaveTriage
  allMembersCanJoin joinByDefault scimManaged scimGroupName
  autoClosePeriod autoCloseStateId autoArchivePeriod autoCloseParentIssues autoCloseChildIssues
  aiThreadSummariesEnabled aiDiscussionSummariesEnabled
  defaultIssueState { id name } triageIssueState { id name }
  integrationsSettings {
    id contextViewType
    slackIssueNewComment slackIssueStatusChangedDone slackIssueStatusChangedAll slackIssueAddedToView
    slackIssueAddedToTriage slackIssueSlaHighRisk slackIssueSlaBreached
    slackProjectUpdateCreated slackProjectUpdateCreatedToTeam slackProjectUpdateCreatedToWorkspace
    slackInitiativeUpdateCreated microsoftTeamsProjectUpdateCreated
  }`;

/**
 * Every configuration surface this atlas reads, in the order a sync walks them.
 *
 * Closed by construction: a caller names nothing, and there is no variant of any row that writes. The
 * whole table is the review surface, which is why each row carries `whyRead` in its own words.
 */
export const LINEAR_SETTING_SURFACES: readonly LinearSettingSurface[] = [
  {
    // The SDK's pinned v92 Organization fragment is NARROWER than the live schema. Measured:
    // eleven of the 42 fields this atlas reads are absent from it — the whole AI/agent block
    // (aiAddonEnabled, agentAutomationEnabled, aiTelemetryEnabled, linearAgentEnabled, codingAgentEnabled,
    // restrictAgentInvocationToMembers) plus codeIntelligenceEnabled, workingDays, generatedUpdatesEnabled,
    // slackProjectChannelsEnabled and slackAutoCreateProjectChannel. All eleven are in the schema our own
    // introspection read, so this is the SDK's snapshot lagging rather than Linear not exposing
    // them. Reproduce: `yarn tsx -e 'import{LinearDocument as d}from"@linear/sdk";
    // console.log(String(d.OrganizationDocument).includes("aiAddonEnabled"))'`
    // linear-sdk-documents-exempt: v92's Organization fragment omits 11 fields the live schema has
    document: `query LinearAtlasOrganization { organization {${ORGANIZATION_FIELDS} } }`,
    group: "organization",
    labelField: "name",
    shape: { field: "organization", kind: "single" },
    perTeam: false,
    teamKeyPath: null,
    whyRead: "the workspace's own settings — the first thing the owner named, and the root of every other scope",
  },
  {
    // Same narrowing as the organization row: an atlas that silently stops recording a setting is the
    // "hole called a decision" this file's own header warns about.
    // linear-sdk-documents-exempt: v92's Team fragment omits inheritProjectStatuses and joinByDefault
    document: `query LinearAtlasTeams($after: String) { teams(first: ${String(SETTINGS_PAGE_SIZE)}, after: $after) { nodes {${TEAM_FIELDS} } pageInfo { hasNextPage endCursor } } }`,
    group: "team",
    labelField: "name",
    shape: { field: "teams", kind: "connection" },
    perTeam: false,
    teamKeyPath: ["key"],
    whyRead: "per-team settings, including the Slack and Microsoft Teams notification configuration each team carries",
  },
  {
    document: String(LinearDocument.WorkflowStatesDocument),
    group: "workflow-state",
    labelField: "name",
    shape: { field: "workflowStates", kind: "connection" },
    perTeam: false,
    teamKeyPath: ["team", "key"],
    whyRead: "the workflow states the owner named explicitly — how issues are allowed to move, per team",
  },
  {
    document: String(LinearDocument.IntegrationsDocument),
    group: "integration",
    labelField: "service",
    shape: { field: "integrations", kind: "connection" },
    perTeam: false,
    teamKeyPath: ["team", "key"],
    whyRead: "the integrations the owner named — which third parties this workspace is wired to",
  },
  {
    document: String(LinearDocument.IssueLabelsDocument),
    group: "issue-label",
    labelField: "name",
    shape: { field: "issueLabels", kind: "connection" },
    perTeam: false,
    teamKeyPath: ["team", "key"],
    whyRead: "the label taxonomy issues are classified with — configuration, not the issues themselves",
  },
  {
    document: String(LinearDocument.ProjectLabelsDocument),
    group: "project-label",
    labelField: "name",
    shape: { field: "projectLabels", kind: "connection" },
    perTeam: false,
    teamKeyPath: null,
    whyRead: "the project label taxonomy, the workspace-scoped sibling of the issue labels above",
  },
  {
    document: String(LinearDocument.InitiativeLabelsDocument),
    group: "initiative-label",
    labelField: "name",
    shape: { field: "initiativeLabels", kind: "connection" },
    perTeam: false,
    teamKeyPath: null,
    whyRead: "the initiative label taxonomy, completing the three label scopes Linear declares",
  },
  {
    document: String(LinearDocument.ProjectStatusesDocument),
    group: "project-status",
    labelField: "name",
    shape: { field: "projectStatuses", kind: "connection" },
    perTeam: false,
    teamKeyPath: null,
    whyRead: "the project status scheme — the project-level counterpart of the workflow states",
  },
  {
    document: String(LinearDocument.TemplatesDocument),
    group: "template",
    labelField: "name",
    shape: { field: "templates", kind: "list" },
    perTeam: false,
    teamKeyPath: null,
    whyRead:
      "the issue, project and document templates the workspace offers. `templateData` and `content` are deliberately NOT selected: a template body is authored prose and belongs to the corpus",
  },
  {
    // The SDK's Webhook fragment selects `secret` — the webhook SIGNING SECRET. This atlas has a deny-list
    // precisely so a configuration read never pulls a credential into a stored artifact, and a generated
    // fragment has no such discipline. Measured; `UserSettingsDocument` selects `calendarHash`
    // and `OrganizationDocument` selects `authSettings` the same way.
    // linear-sdk-documents-exempt: v92's Webhook fragment selects the signing secret; we must not receive it
    document: `query LinearAtlasWebhooks($after: String) { webhooks(first: ${String(SETTINGS_PAGE_SIZE)}, after: $after) { nodes { id label url enabled resourceTypes createdAt updatedAt team { key } } pageInfo { hasNextPage endCursor } } }`,
    group: "webhook",
    labelField: "label",
    shape: { field: "webhooks", kind: "connection" },
    perTeam: false,
    teamKeyPath: null,
    whyRead:
      "which outbound webhooks exist, where they point and what they are subscribed to. `secret` is NOT selected — see this file's header",
  },
  {
    document: `query LinearAtlasOauthApplications { oauthApplications { id clientId name description developer developerUrl redirectUris distribution webhookUrl webhookEnabled webhookResourceTypes createdAt } }`,
    group: "oauth-application",
    labelField: "name",
    shape: { field: "oauthApplications", kind: "list" },
    perTeam: false,
    teamKeyPath: null,
    whyRead: "the OAuth applications this workspace has authorised — the other half of the integration surface",
  },
  {
    document: String(LinearDocument.TriageResponsibilitiesDocument),
    group: "triage-responsibility",
    labelField: null,
    shape: { field: "triageResponsibilities", kind: "connection" },
    perTeam: false,
    teamKeyPath: ["team", "key"],
    whyRead: "how each team routes triage — operational configuration, and it is per team",
  },
  {
    document: String(LinearDocument.TimeSchedulesDocument),
    group: "time-schedule",
    labelField: "name",
    shape: { field: "timeSchedules", kind: "connection" },
    perTeam: false,
    teamKeyPath: null,
    whyRead:
      "the on-call schedules triage responsibilities point at. `externalUrl` is NOT selected: it addresses the third-party schedule and can carry a token in its query string — a Codex review pass found exactly that hole here",
  },
  {
    document: String(LinearDocument.CustomerStatusesDocument),
    group: "customer-status",
    labelField: "name",
    shape: { field: "customerStatuses", kind: "connection" },
    perTeam: false,
    teamKeyPath: null,
    whyRead: "the customer status scheme, when the customers feature is enabled — a taxonomy, never a customer",
  },
  {
    document: String(LinearDocument.CustomerTiersDocument),
    group: "customer-tier",
    labelField: "name",
    shape: { field: "customerTiers", kind: "connection" },
    perTeam: false,
    teamKeyPath: null,
    whyRead: "the customer tier scheme, the sibling taxonomy of the statuses above",
  },
  {
    document: String(LinearDocument.ReleasePipelinesDocument),
    group: "release-pipeline",
    labelField: "name",
    shape: { field: "releasePipelines", kind: "connection" },
    perTeam: false,
    teamKeyPath: null,
    whyRead: "how releases are configured, when the releases feature is enabled. The releases themselves are corpus",
  },
  {
    document: String(LinearDocument.EmojisDocument),
    group: "custom-emoji",
    labelField: "name",
    shape: { field: "emojis", kind: "connection" },
    perTeam: false,
    teamKeyPath: null,
    whyRead:
      "the workspace's custom emoji, which are workspace configuration. `url` is not selected: it is a CDN asset",
  },
  {
    // linear-sdk-documents-exempt: v92's UserSettings fragment selects calendarHash, a calendar URL token
    document: `query LinearAtlasUserSettings { userSettings { id notificationDeliveryPreferences { mobile { notificationsDisabled } desktop { notificationsDisabled } } unsubscribedFrom autoAssignToSelf showFullUserNames } }`,
    group: "account-setting",
    labelField: null,
    shape: { field: "userSettings", kind: "single" },
    perTeam: false,
    teamKeyPath: null,
    whyRead:
      "this member's OWN account settings — the Slack atlas's precedent, where the owner said the account settings page absolutely belongs in the atlas. `calendarHash` is NOT selected",
  },
  {
    document: String(LinearDocument.IssuePriorityValuesDocument),
    group: "issue-priority",
    labelField: "label",
    perTeam: false,
    shape: { field: "issuePriorityValues", kind: "list" },
    teamKeyPath: null,
    whyRead: "the priority scheme issues are ranked on — a workspace-wide taxonomy, and the last unclassified read",
  },
  {
    document: String(LinearDocument.SlaConfigurationsDocument),
    group: "sla-configuration",
    labelField: "name",
    perTeam: true,
    shape: { field: "slaConfigurations", kind: "list" },
    teamKeyPath: null,
    whyRead:
      "each team's SLA configuration. Linear declares this only through a team-scoped root field, so it is the one row that fans out per team rather than reading the workspace at once",
  },
  {
    document: String(LinearDocument.RateLimitStatusDocument),
    group: "rate-limit",
    labelField: null,
    shape: { field: "rateLimitStatus", kind: "single" },
    perTeam: false,
    teamKeyPath: null,
    whyRead:
      "the budgets this API actually enforces on this credential — the fact every future reader of this atlas needs before planning a crawl",
  },
];
