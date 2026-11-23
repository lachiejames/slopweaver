/*
 * The one schema-valid GitHub entity per declared kind that the read-adapter test files share, each carrying
 * provenance named for its own kind and its own scope. Nothing here touches disk. It moved here when
 * `readAdapter.test.ts` was split by behaviour.
 */
import type { GithubEntity } from "../../../../../atlas/github/kindFiles.js";
import type { GithubKind } from "../../../../../atlas/github/model.js";

export const SEEN = "2026-10-01T00:00:00.000Z";

const ORG = { scopeLevel: "organization", scopeRef: "example-org" } as const;
const REPO = { scopeLevel: "repository", scopeRef: "example-org/example-repo" } as const;
const ENVIRONMENT = { scopeLevel: "environment", scopeRef: "example-org/example-repo/production" } as const;

/**
 * The surface each kind's entity names as its own producer.
 *
 * @returns `rest-openapi` for the REST operation, `github-web` for the two browser kinds, `rest-live` for the rest
 */
export function surfaceFor({ kind }: { kind: GithubKind }): "github-web" | "rest-live" | "rest-openapi" {
  if (kind === "rest-operation") {
    return "rest-openapi";
  }
  if (kind === "admin-page" || kind === "web-request") {
    return "github-web";
  }
  return "rest-live";
}

export const SCREENSHOT = {
  byteLength: 4096,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/admin-page.png",
  sha256: "b".repeat(64),
} as const;

/** Provenance for one stored entity; the admin page carries a screenshot and a discovered link. */
function sourceFor({ kind }: { kind: GithubKind }): GithubEntity["source"] {
  const isAdminPage = kind === "admin-page";
  return {
    artifacts: isAdminPage ? [SCREENSHOT] : [],
    deepLink: `https://github.example.test/${kind}`,
    deepLinkStatus: isAdminPage ? "browser-discovered" : "provider-provided",
    endpoint: `/example/${kind}`,
    observedAt: SEEN,
    surface: surfaceFor({ kind }),
  };
}

/** The fields every stored entity carries, with an id and provider id derived from the kind. */
function baseFor({ kind }: { kind: GithubKind }): {
  firstSeenAt: string;
  id: string;
  providerId: string;
  source: GithubEntity["source"];
  state: "observed";
} {
  return {
    firstSeenAt: SEEN,
    id: `${kind}-id`,
    providerId: `${kind}-provider`,
    source: sourceFor({ kind }),
    state: "observed",
  };
}

/** One schema-valid entity per declared kind. */
export const ENTITIES: Readonly<Record<GithubKind, GithubEntity>> = {
  "rest-operation": {
    ...baseFor({ kind: "rest-operation" }),
    documentationUrl: "https://docs.github.example.test/rest/repos",
    method: "GET",
    mutating: false,
    operationId: "repos/get",
    pathParams: ["owner", "repo"],
    pathTemplate: "/repos/{owner}/{repo}",
    queryParams: [],
    responseFields: ["id", "name"],
    responseSchema: "repository",
    sdkMethod: "repos.get",
    summary: "Get a repository",
  },
  "organization-settings": {
    ...baseFor({ kind: "organization-settings" }),
    ...ORG,
    advancedSecurityEnabledForNewRepositories: true,
    defaultRepositoryPermission: "read",
    dependabotAlertsEnabledForNewRepositories: true,
    dependabotSecurityUpdatesEnabledForNewRepositories: null,
    dependencyGraphEnabledForNewRepositories: true,
    login: "example-org",
    membersCanCreateInternalRepositories: false,
    membersCanCreatePages: false,
    membersCanCreatePrivateRepositories: false,
    membersCanCreatePublicRepositories: false,
    membersCanCreateRepositories: false,
    membersCanForkPrivateRepositories: false,
    secretScanningEnabledForNewRepositories: true,
    secretScanningPushProtectionEnabledForNewRepositories: true,
    twoFactorRequirementEnabled: true,
    webCommitSignoffRequired: false,
  },
  "repository-settings": {
    ...baseFor({ kind: "repository-settings" }),
    ...REPO,
    allowAutoMerge: true,
    allowForking: false,
    allowMergeCommit: false,
    allowRebaseMerge: false,
    allowSquashMerge: true,
    allowUpdateBranch: true,
    archived: false,
    defaultBranch: "main",
    deleteBranchOnMerge: true,
    description: "Example repository",
    disabled: false,
    hasDiscussions: false,
    hasIssues: true,
    hasPages: false,
    hasProjects: false,
    hasWiki: false,
    isTemplate: false,
    mergeCommitMessage: null,
    mergeCommitTitle: null,
    squashMergeCommitMessage: "PR_BODY",
    squashMergeCommitTitle: "PR_TITLE",
    topics: ["example-topic"],
    visibility: "private",
    webCommitSignoffRequired: false,
  },
  "actions-policy": {
    ...baseFor({ kind: "actions-policy" }),
    ...ORG,
    allowedActions: "selected",
    canApprovePullRequestReviews: false,
    defaultWorkflowPermissions: "read",
    enabled: true,
    enabledRepositories: "all",
    githubOwnedAllowed: true,
    patternsAllowed: ["example-org/*"],
    verifiedAllowed: false,
  },
  "code-security-configuration": {
    ...baseFor({ kind: "code-security-configuration" }),
    ...ORG,
    advancedSecurity: "enabled",
    codeScanningDefaultSetup: "enabled",
    dependabotAlerts: "enabled",
    dependabotSecurityUpdates: "enabled",
    dependencyGraph: "enabled",
    dependencyGraphAutosubmitAction: "disabled",
    description: "Default configuration",
    enforcement: "enforced",
    name: "Default",
    privateVulnerabilityReporting: "enabled",
    secretScanning: "enabled",
    secretScanningNonProviderPatterns: "disabled",
    secretScanningPushProtection: "enabled",
    secretScanningValidityChecks: "disabled",
    targetType: "organization",
  },
  "repository-security-settings": {
    ...baseFor({ kind: "repository-security-settings" }),
    ...REPO,
    advancedSecurity: "enabled",
    dependabotSecurityUpdates: "enabled",
    secretScanning: "enabled",
    secretScanningNonProviderPatterns: "disabled",
    secretScanningPushProtection: "enabled",
    secretScanningValidityChecks: "disabled",
  },
  "code-scanning-default-setup": {
    ...baseFor({ kind: "code-scanning-default-setup" }),
    ...REPO,
    languages: ["javascript-typescript"],
    querySuite: "default",
    runnerLabel: null,
    runnerType: "standard",
    schedule: null,
    // This kind's own `state` is the provider's setup state, which replaces the observed/stale flag in the schema.
    state: "configured",
    updatedAt: SEEN,
  },
  ruleset: {
    ...baseFor({ kind: "ruleset" }),
    ...ORG,
    bypassActorIds: ["team-1"],
    conditionKeys: ["ref_name"],
    enforcement: "active",
    name: "Protect main",
    ruleTypes: ["pull_request"],
    target: "branch",
    updatedAt: null,
  },
  webhook: {
    ...baseFor({ kind: "webhook" }),
    ...ORG,
    active: true,
    contentType: "json",
    destinationOrigin: "https://hooks.example.test",
    destinationPathDigest: "0".repeat(64),
    events: ["push"],
    insecureSsl: false,
    updatedAt: null,
  },
  "secret-name": {
    ...baseFor({ kind: "secret-name" }),
    ...ORG,
    createdAt: SEEN,
    name: "EXAMPLE_SECRET",
    selectedRepositoryIds: [],
    updatedAt: null,
    visibility: "all",
  },
  "variable-name": {
    ...baseFor({ kind: "variable-name" }),
    ...REPO,
    createdAt: SEEN,
    name: "EXAMPLE_VARIABLE",
    selectedRepositoryIds: [],
    updatedAt: null,
    visibility: null,
  },
  environment: {
    ...baseFor({ kind: "environment" }),
    ...ENVIRONMENT,
    canAdminsBypass: false,
    deploymentBranchPolicy: "protected_branches",
    name: "production",
    preventSelfReview: true,
    protectionRuleTypes: ["required_reviewers"],
    reviewerIds: ["team-1"],
    waitTimerMinutes: 5,
  },
  "deploy-key": {
    ...baseFor({ kind: "deploy-key" }),
    ...REPO,
    addedBy: "example.person",
    createdAt: SEEN,
    lastUsedAt: null,
    publicKeyFingerprint: "SHA256:examplefingerprint",
    readOnly: true,
    title: "ci",
  },
  "custom-property-definition": {
    ...baseFor({ kind: "custom-property-definition" }),
    ...ORG,
    allowedValues: ["prod", "dev"],
    description: "Environment tier",
    propertyName: "tier",
    required: false,
    valuesEditableBy: "org_actors",
    valueType: "single_select",
  },
  "custom-repository-role": {
    ...baseFor({ kind: "custom-repository-role" }),
    ...ORG,
    baseRole: "write",
    description: "Release manager",
    name: "release-manager",
    permissions: ["push_protected_branch"],
  },
  "github-app-installation": {
    ...baseFor({ kind: "github-app-installation" }),
    ...ORG,
    appSlug: "example-app",
    createdAt: SEEN,
    events: ["push"],
    permissions: { contents: "read", metadata: "read" },
    repositorySelection: "selected",
    selectedRepositoryIds: ["repo-1"],
    suspendedAt: null,
    updatedAt: null,
  },
  "repository-label": {
    ...baseFor({ kind: "repository-label" }),
    ...REPO,
    color: "a2eeef",
    description: null,
    name: "kind: feature",
  },
  "admin-page": {
    ...baseFor({ kind: "admin-page" }),
    ...ORG,
    artifacts: [SCREENSHOT],
    discoveredFrom: null,
    finalUrl: "https://github.example.test/organizations/example-org/settings/profile",
    linksRendered: ["/organizations/example-org/settings/security"],
    outcome: "landed",
    path: "/organizations/example-org/settings/profile",
    statusCode: 200,
    title: "Settings",
  },
  "web-request": {
    ...baseFor({ kind: "web-request" }),
    callability: "browser-observed-only",
    declaredInOpenApi: false,
    method: "GET",
    observedOnPages: ["/organizations/example-org/settings/profile"],
    paramNames: [],
    pathShape: "/_side-panels/user.json",
    responseFieldPaths: ["login"],
    statusCodes: [200],
  },
};
