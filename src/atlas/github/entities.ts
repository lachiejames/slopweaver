/**
 * The strict on-disk shape of every GitHub atlas entity.
 *
 * ## Strict, so a provider field nobody reviewed cannot arrive by accident
 *
 * Every schema here is `.strict()`. A field GitHub adds next month is not stored because a projection chose
 * it and not stored because nobody excluded it — it fails to parse, loudly, and somebody decides. That is
 * the second of three boundaries: `inventory.ts` closes which calls may be made, `privacy.ts` names which
 * fields are admitted, and this file refuses anything that got past both.
 *
 * ## A configuration entity says WHAT A SETTING IS SET TO, and nothing about the objects it names
 *
 * Every kind below carries `scopeLevel` and `scopeRef` — which organisation or repository the setting
 * belongs to — because the same setting name means different things at different levels, and a reader
 * joining an org Actions policy to a repo one without the scope would silently merge two different facts.
 * Where a setting REFERS to a member, a team or a repository, only the opaque reference is stored. A
 * ruleset's bypass actors are ids; an environment's reviewers are ids; an app installation's selected
 * repositories are ids. Their names, profiles and payloads belong to `src/corpus/github` and copying them
 * here is the exact failure the surface-map criterion exists to prevent.
 *
 * ## Two names that look like values and are not
 *
 * `secret-name` and `variable-name` are named for what they hold: the NAME of a secret or a variable, its
 * scope and its timestamps. Neither schema has a field a value could be written into, which is a stronger
 * statement than a redaction pass — there is nowhere to put one. GitHub's own API never returns a secret's
 * value, and a variable's value is deliberately dropped at the projection rather than stored because a
 * variable is routinely used to hold something an operator would not want in a local ground truth.
 *
 * The kind files and manifest that hold these entities are built in `kindFiles.ts`.
 */
import { z } from "zod";

import { atlasArtifactRefSchema, atlasSourceSchema } from "../kit/contract.js";

import { GITHUB_SCOPE_LEVELS } from "./model.js";

export const isoSchema = z.iso.datetime();

/** Whether this run's complete read still returned the entity. See this file's header. */
const entityStateSchema = z.enum(["observed", "stale"]);

/** Fields every stored entity carries, whatever kind it is. */
const baseEntitySchema = z.object({
  /** When this entity was first observed by any surface, so age survives a re-sync. */
  firstSeenAt: isoSchema,
  /** The kit's stable, derived entity id — never the provider's own id. */
  id: z.string().min(1),
  /** GitHub's own id, kept as a field so a human can paste it into the web client. */
  providerId: z.string().min(1),
  source: atlasSourceSchema,
  state: entityStateSchema,
});

/** Fields every CONFIGURATION entity carries: which object in GitHub's hierarchy this setting belongs to. */
const scopedEntitySchema = baseEntitySchema.extend({
  scopeLevel: z.enum(GITHUB_SCOPE_LEVELS),
  /** The org login, `owner/repo`, or `owner/repo/environment` this setting belongs to. */
  scopeRef: z.string().min(1),
});

/**
 * One operation GitHub's own OpenAPI description declares.
 *
 * The API surface's whole point, and the only kind produced with no network call at all. `mutating` is
 * recorded and the operation is never invoked: an atlas must know a write exists — that is part of "the set
 * of all possible places you can find information" — and must never perform one.
 *
 * `sdkMethod` is what makes this more than a copy of the description: it says whether the Octokit this
 * build installs exposes the operation as a named method, so an operation GitHub declares and the installed
 * client does not is visible rather than assumed reachable.
 */
export const githubRestOperationSchema = baseEntitySchema
  .extend({
    documentationUrl: z.url().nullable(),
    method: z.string().min(1),
    mutating: z.boolean(),
    operationId: z.string().min(1),
    pathParams: z.array(z.string()),
    pathTemplate: z.string().min(1),
    queryParams: z.array(z.string()),
    responseFields: z.array(z.string()),
    responseSchema: z.string().nullable(),
    /** The installed Octokit's dotted method name, or `null` when it declares none for this route. */
    sdkMethod: z.string().nullable(),
    summary: z.string(),
  })
  .strict();

export type GithubRestOperation = z.infer<typeof githubRestOperationSchema>;

/**
 * One organisation's settings document.
 *
 * Every field is nullable because GitHub returns the administrative half only to an owner, and a token that
 * is not one gets a smaller object rather than an error. A `null` here therefore means "this token did not
 * see it", which is why the coverage cell beside it carries the visibility scope that explains why.
 */
export const githubOrganizationSettingsSchema = scopedEntitySchema
  .extend({
    advancedSecurityEnabledForNewRepositories: z.boolean().nullable(),
    defaultRepositoryPermission: z.string().nullable(),
    dependabotAlertsEnabledForNewRepositories: z.boolean().nullable(),
    dependabotSecurityUpdatesEnabledForNewRepositories: z.boolean().nullable(),
    dependencyGraphEnabledForNewRepositories: z.boolean().nullable(),
    login: z.string().min(1),
    membersCanCreateInternalRepositories: z.boolean().nullable(),
    membersCanCreatePages: z.boolean().nullable(),
    membersCanCreatePrivateRepositories: z.boolean().nullable(),
    membersCanCreatePublicRepositories: z.boolean().nullable(),
    membersCanCreateRepositories: z.boolean().nullable(),
    membersCanForkPrivateRepositories: z.boolean().nullable(),
    secretScanningEnabledForNewRepositories: z.boolean().nullable(),
    secretScanningPushProtectionEnabledForNewRepositories: z.boolean().nullable(),
    twoFactorRequirementEnabled: z.boolean().nullable(),
    webCommitSignoffRequired: z.boolean().nullable(),
  })
  .strict();

export type GithubOrganizationSettings = z.infer<typeof githubOrganizationSettingsSchema>;

/**
 * One repository's administrative configuration.
 *
 * Deliberately NOT the corpus's repository record. That one carries the repository as an object people work
 * in, with its activity; `src/corpus/github/org.ts` owns it and must stay the only writer of it. This one
 * carries what a NEW repository would have to be given to reproduce this one: the switches (what merges are
 * allowed, what is archived, what is enabled) plus the description and topic names, which are configuration
 * a repository is created with rather than activity in it.
 */
export const githubRepositorySettingsSchema = scopedEntitySchema
  .extend({
    description: z.string().nullable(),
    /** Topic names, sorted and deduplicated. */
    topics: z.array(z.string()),
    allowAutoMerge: z.boolean().nullable(),
    allowForking: z.boolean().nullable(),
    allowMergeCommit: z.boolean().nullable(),
    allowRebaseMerge: z.boolean().nullable(),
    allowSquashMerge: z.boolean().nullable(),
    allowUpdateBranch: z.boolean().nullable(),
    archived: z.boolean(),
    defaultBranch: z.string().nullable(),
    deleteBranchOnMerge: z.boolean().nullable(),
    disabled: z.boolean(),
    hasDiscussions: z.boolean().nullable(),
    hasIssues: z.boolean().nullable(),
    hasPages: z.boolean().nullable(),
    hasProjects: z.boolean().nullable(),
    hasWiki: z.boolean().nullable(),
    isTemplate: z.boolean().nullable(),
    mergeCommitMessage: z.string().nullable(),
    mergeCommitTitle: z.string().nullable(),
    squashMergeCommitMessage: z.string().nullable(),
    squashMergeCommitTitle: z.string().nullable(),
    visibility: z.string().nullable(),
    webCommitSignoffRequired: z.boolean().nullable(),
  })
  .strict();

export type GithubRepositorySettings = z.infer<typeof githubRepositorySettingsSchema>;

/** The Actions execution policy at one scope: what may run, and what the default token may do. */
export const githubActionsPolicySchema = scopedEntitySchema
  .extend({
    allowedActions: z.string().nullable(),
    canApprovePullRequestReviews: z.boolean().nullable(),
    defaultWorkflowPermissions: z.string().nullable(),
    enabled: z.boolean().nullable(),
    enabledRepositories: z.string().nullable(),
    githubOwnedAllowed: z.boolean().nullable(),
    patternsAllowed: z.array(z.string()),
    verifiedAllowed: z.boolean().nullable(),
  })
  .strict();

export type GithubActionsPolicy = z.infer<typeof githubActionsPolicySchema>;

/**
 * One code security configuration, as GitHub's own composite resource.
 *
 * One kind rather than one per toggle because `/orgs/{org}/code-security/configurations` returns all of it
 * as a single document — measured against GitHub's published description, 28 top-level fields on
 * `code-security-configuration`. Splitting it would attribute a dozen sources to one call, which is exactly
 * the false provenance `AtlasSource`'s single `endpoint` field would then be asserting.
 */
export const githubCodeSecurityConfigurationSchema = scopedEntitySchema
  .extend({
    advancedSecurity: z.string().nullable(),
    codeScanningDefaultSetup: z.string().nullable(),
    dependabotAlerts: z.string().nullable(),
    dependabotSecurityUpdates: z.string().nullable(),
    dependencyGraph: z.string().nullable(),
    dependencyGraphAutosubmitAction: z.string().nullable(),
    description: z.string().nullable(),
    enforcement: z.string().nullable(),
    name: z.string().min(1),
    privateVulnerabilityReporting: z.string().nullable(),
    secretScanning: z.string().nullable(),
    secretScanningNonProviderPatterns: z.string().nullable(),
    secretScanningPushProtection: z.string().nullable(),
    secretScanningValidityChecks: z.string().nullable(),
    targetType: z.string().nullable(),
  })
  .strict();

export type GithubCodeSecurityConfiguration = z.infer<typeof githubCodeSecurityConfigurationSchema>;

/** One repository's effective security-and-analysis switches. Alerts and advisories are never nested here. */
export const githubRepositorySecuritySettingsSchema = scopedEntitySchema
  .extend({
    advancedSecurity: z.string().nullable(),
    dependabotSecurityUpdates: z.string().nullable(),
    secretScanning: z.string().nullable(),
    secretScanningNonProviderPatterns: z.string().nullable(),
    secretScanningPushProtection: z.string().nullable(),
    secretScanningValidityChecks: z.string().nullable(),
  })
  .strict();

export type GithubRepositorySecuritySettings = z.infer<typeof githubRepositorySecuritySettingsSchema>;

/** One repository's code-scanning default setup, from GitHub's own endpoint for it. */
export const githubCodeScanningDefaultSetupSchema = scopedEntitySchema
  .extend({
    languages: z.array(z.string()),
    querySuite: z.string().nullable(),
    runnerLabel: z.string().nullable(),
    runnerType: z.string().nullable(),
    schedule: z.string().nullable(),
    state: z.string().min(1),
    updatedAt: isoSchema.nullable(),
  })
  .strict();

export type GithubCodeScanningDefaultSetup = z.infer<typeof githubCodeScanningDefaultSetupSchema>;

/**
 * One ruleset at org or repo scope.
 *
 * `rules` and `conditions` are kept as their own field NAMES and types rather than the whole payload, and
 * `bypassActorIds` holds ids only: which team may bypass a ruleset is configuration, and who is in that
 * team is the corpus's.
 */
export const githubRulesetSchema = scopedEntitySchema
  .extend({
    bypassActorIds: z.array(z.string()),
    conditionKeys: z.array(z.string()),
    enforcement: z.string().min(1),
    name: z.string().min(1),
    ruleTypes: z.array(z.string()),
    target: z.string().nullable(),
    updatedAt: isoSchema.nullable(),
  })
  .strict();

export type GithubRuleset = z.infer<typeof githubRulesetSchema>;

/**
 * One webhook at org or repo scope.
 *
 * The destination is reduced to an ORIGIN and a DIGEST of its path before it is stored. A webhook URL
 * routinely carries its own credential in the path or the query — that is how several providers
 * authenticate one — so keeping the whole URL, or even a redacted shape of it, would put a secret in a
 * local ground truth by accident. The secret GitHub signs with is never returned by the API at all, and
 * there is no field here to hold one.
 */
export const githubWebhookSchema = scopedEntitySchema
  .extend({
    active: z.boolean(),
    contentType: z.string().nullable(),
    /** The destination's scheme and host only — never its path, query or user-info. */
    destinationOrigin: z.string().nullable(),
    /**
     * A digest of the destination's path and query, so two hooks pointing at the same place are joinable
     * without the path itself being stored. See `privacy.ts` on why no part of the path survives: a hook
     * path token that happens to look like a route word is indistinguishable from one.
     */
    destinationPathDigest: z.string().nullable(),
    events: z.array(z.string()),
    insecureSsl: z.boolean().nullable(),
    updatedAt: isoSchema.nullable(),
  })
  .strict();

export type GithubWebhook = z.infer<typeof githubWebhookSchema>;

/** One secret's NAME and scope. There is deliberately no field a value could be written into. */
export const githubSecretNameSchema = scopedEntitySchema
  .extend({
    createdAt: isoSchema.nullable(),
    name: z.string().min(1),
    selectedRepositoryIds: z.array(z.string()),
    updatedAt: isoSchema.nullable(),
    visibility: z.string().nullable(),
  })
  .strict();

export type GithubSecretName = z.infer<typeof githubSecretNameSchema>;

/**
 * One variable's NAME and scope.
 *
 * GitHub DOES return a variable's value, and this schema drops it. A variable is the field an operator
 * reaches for when a secret felt like overkill, so it routinely holds an endpoint, an account id or a
 * tenant name — and an atlas whose subject is the surface has no question that its value answers.
 */
export const githubVariableNameSchema = scopedEntitySchema
  .extend({
    createdAt: isoSchema.nullable(),
    name: z.string().min(1),
    selectedRepositoryIds: z.array(z.string()),
    updatedAt: isoSchema.nullable(),
    visibility: z.string().nullable(),
  })
  .strict();

export type GithubVariableName = z.infer<typeof githubVariableNameSchema>;

/** One deployment environment and the protection rules that gate it. Deployments themselves are excluded. */
export const githubEnvironmentSchema = scopedEntitySchema
  .extend({
    canAdminsBypass: z.boolean().nullable(),
    deploymentBranchPolicy: z.string().nullable(),
    name: z.string().min(1),
    preventSelfReview: z.boolean().nullable(),
    protectionRuleTypes: z.array(z.string()),
    reviewerIds: z.array(z.string()),
    waitTimerMinutes: z.number().int().nullable(),
  })
  .strict();

export type GithubEnvironment = z.infer<typeof githubEnvironmentSchema>;

/**
 * One deploy key, by FINGERPRINT rather than by key.
 *
 * A deploy key's public half is not a secret, and it is still not stored: the question this atlas answers
 * is "what write access exists on this repository and who added it", which a fingerprint answers exactly.
 * Keeping the key material would mean holding a credential's public half for no question at all.
 */
export const githubDeployKeySchema = scopedEntitySchema
  .extend({
    addedBy: z.string().nullable(),
    createdAt: isoSchema.nullable(),
    lastUsedAt: isoSchema.nullable(),
    readOnly: z.boolean(),
    title: z.string().nullable(),
    /** A digest of the public key, so two repositories sharing one key are joinable without holding it. */
    publicKeyFingerprint: z.string().min(1),
  })
  .strict();

export type GithubDeployKey = z.infer<typeof githubDeployKeySchema>;

/**
 * One label a repository defines: its name, colour and description, which is everything a new repository
 * must be given to reproduce it. No actor, URL or archive field is held, because nothing about who made a
 * label is configuration.
 */
export const githubRepositoryLabelSchema = scopedEntitySchema
  .extend({
    /** GitHub's own spelling: a six-digit hex colour with no leading `#`. */
    color: z.string().min(1),
    description: z.string().nullable(),
    name: z.string().min(1),
  })
  .strict();

export type GithubRepositoryLabel = z.infer<typeof githubRepositoryLabelSchema>;

/**
 * One custom property definition — the org-owned schema rulesets and governance are written against.
 *
 * There is deliberately NO field for the property's DEFAULT VALUE, for the same reason a variable has none:
 * a default is a value an operator authored, and this atlas's subject is the shape. It was stored in a
 * first version and a review found the hole — a custom property whose default happened to be a token would
 * have been published verbatim, in a field nobody would think to look at. `allowedValues` survives because
 * an enumerated domain IS the schema, and it is screened for credential-shaped entries at the projection.
 */
export const githubCustomPropertyDefinitionSchema = scopedEntitySchema
  .extend({
    allowedValues: z.array(z.string()),
    description: z.string().nullable(),
    propertyName: z.string().min(1),
    required: z.boolean().nullable(),
    valuesEditableBy: z.string().nullable(),
    valueType: z.string().min(1),
  })
  .strict();

export type GithubCustomPropertyDefinition = z.infer<typeof githubCustomPropertyDefinitionSchema>;

/** One custom repository role. Who holds it is a corpus relation, never this payload. */
export const githubCustomRepositoryRoleSchema = scopedEntitySchema
  .extend({
    baseRole: z.string().nullable(),
    description: z.string().nullable(),
    name: z.string().min(1),
    permissions: z.array(z.string()),
  })
  .strict();

export type GithubCustomRepositoryRole = z.infer<typeof githubCustomRepositoryRoleSchema>;

/**
 * One installed GitHub App, and exactly what it was granted.
 *
 * The kind that answers "what can reach our code that is not a person" — the permissions, the events and
 * whether the installation covers every repository or a named set. The selected set is ids: which
 * repositories exist is the corpus's.
 */
export const githubAppInstallationSchema = scopedEntitySchema
  .extend({
    appSlug: z.string().min(1),
    createdAt: isoSchema.nullable(),
    events: z.array(z.string()),
    /** Permission name to the level granted, e.g. `contents` → `write`. The whole point of the kind. */
    permissions: z.record(z.string(), z.string()),
    repositorySelection: z.string().nullable(),
    selectedRepositoryIds: z.array(z.string()),
    suspendedAt: isoSchema.nullable(),
    updatedAt: isoSchema.nullable(),
  })
  .strict();

export type GithubAppInstallation = z.infer<typeof githubAppInstallationSchema>;

/**
 * One admin page the walk visited, and what happened.
 *
 * `discoveredFrom` is what makes the browser half's coverage claim readable: GitHub publishes no
 * authenticated settings sitemap, so every page here is either a SEED — a destination GitHub's own product
 * structure guarantees, such as an organisation's settings root — or a link GitHub RENDERED on a page
 * already visited. Recording which is which is the difference between an honest frontier and a claim of
 * completeness this atlas cannot make.
 */
export const githubAdminPageSchema = scopedEntitySchema
  .extend({
    /** The page this one's link was found on, or `null` when it is a seed. */
    discoveredFrom: z.string().nullable(),
    finalUrl: z.string().nullable(),
    /** Same-origin settings links this page itself rendered — the next round's frontier. */
    linksRendered: z.array(z.string()),
    outcome: z.enum(["landed", "redirected", "unavailable", "failed", "not-attempted"]),
    /** The canonical same-origin path, query sorted and fragment dropped. This page's identity. */
    path: z.string().min(1),
    artifacts: z.array(atlasArtifactRefSchema),
    statusCode: z.number().int().nullable(),
    title: z.string().nullable(),
  })
  .strict();

export type GithubAdminPage = z.infer<typeof githubAdminPageSchema>;

/**
 * One call GitHub's own first-party web client made, reduced to shape.
 *
 * `callability` is a stored field rather than an implied one: a reader — human or router — must not
 * conclude from a recorded request that Slopweaver can make it. MEASURED, the settings pages
 * called `/_filter/organizations`, `/_side-panels/user.json` and `/in-product-messaging/*.json`, none of
 * which GitHub's published description declares. `declaredInOpenApi` is where that comparison is kept, so
 * the browser-only surface is a number a reader can check rather than an impression.
 */
export const githubWebRequestSchema = baseEntitySchema
  .extend({
    callability: z.literal("browser-observed-only"),
    /** Whether GitHub's own OpenAPI description declares a matching operation. */
    declaredInOpenApi: z.boolean(),
    method: z.string().min(1),
    observedOnPages: z.array(z.string()),
    paramNames: z.array(z.string()),
    /** Path with volatile id segments replaced by a placeholder, so one endpoint is one entity. */
    pathShape: z.string().min(1),
    responseFieldPaths: z.array(z.string()),
    statusCodes: z.array(z.number().int()),
  })
  .strict();

export type GithubWebRequest = z.infer<typeof githubWebRequestSchema>;
