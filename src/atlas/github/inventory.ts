/**
 * The CLOSED inventory of GitHub calls this atlas may make, and why read-only is a property of the code
 * rather than only of the token.
 *
 * ## Why the HTTP verb decides nothing, and why here it very nearly does
 *
 * The obvious rule — "only GET" — is close to right on this platform and is still the wrong rule to write
 * down. GitHub reads are overwhelmingly GETs, so a GET-only gate would pass today and would admit any
 * write that happened to be spelled as one; the sibling CrowdStrike inventory makes the same argument from
 * the other direction, where legitimate reads are POSTs. What actually holds the property is that
 * {@link GITHUB_CALLS} below is the ONLY source of a request in this atlas: no caller supplies a method or
 * a path, so there is no argument that reaches an endpoint this table does not list.
 *
 * Absent by construction rather than by omission: every `POST`, `PUT`, `PATCH` and `DELETE`; every settings
 * mutation; every secret or variable write; every ruleset, webhook, environment, deploy-key and app-install
 * change; every alert dismissal; and the token-minting endpoints entirely.
 *
 * ## One family of reads is absent for a different reason worth stating
 *
 * GitHub's `GET /orgs/{org}/actions/variables` and its repository sibling return each variable's VALUE.
 * They ARE in this table, because the variable's NAME and scope are the surface-map fact the atlas is
 * commissioned to hold — and `projection.ts` drops the value at the boundary, and `entities.ts` has no
 * field one could be written into. Refusing the call outright was considered and rejected: it would have
 * cost the atlas the whole `variable-name` kind to avoid a field the projection already cannot store.
 *
 * ## `whyRead` is the field a reviewer reads
 *
 * Each row states, in its own words, what surface-map question the call answers. A row that cannot answer
 * that does not belong here — and in particular a row whose honest answer is "it returns entities the
 * corpus already holds" belongs in `src/corpus/github`, not in this table.
 */
import type { GithubCall, GithubCallLevel } from "./inventoryShape.js";

/**
 * Every GitHub call this atlas may make. A closed list — see this file's header.
 *
 * Read it as the answer to "what could this thing possibly do to our GitHub": a closed list of GETs over
 * configuration, and nothing that changes a byte of it.
 *
 * @internal
 */
export const GITHUB_CALLS = [
  {
    expectedRefusals: [],
    id: "account-organisations",
    kind: "organization-settings",
    level: "account",
    method: "GET",
    paging: "page",
    path: "/user/orgs",
    whyRead:
      "which organisations this token can see at all — the DISCOVERY call that decides what the rest of this table is run against. It projects no entity of its own; what it produces is the scope list",
  },
  {
    expectedRefusals: [],
    id: "org-repositories",
    kind: "repository-settings",
    level: "organization",
    method: "GET",
    paging: "page",
    path: "/orgs/{org}/repos",
    whyRead:
      "every repository in one organisation — the DISCOVERY call the repository half of this table is run against. It projects no entity of its own; the repository SETTINGS come from `repo-settings`",
  },
  {
    expectedRefusals: [],
    id: "org-settings",
    kind: "organization-settings",
    level: "organization",
    method: "GET",
    paging: "none",
    path: "/orgs/{org}",
    whyRead:
      "the organisation's own settings document — member privileges, base repository permission, two-factor requirement and the security defaults applied to new repositories",
  },
  {
    expectedRefusals: [403],
    id: "org-actions-policy",
    kind: "actions-policy",
    level: "organization",
    method: "GET",
    paging: "none",
    path: "/orgs/{org}/actions/permissions",
    whyRead: "which repositories may run Actions at all, and which actions they are allowed to run",
  },
  {
    expectedRefusals: [403],
    id: "org-actions-workflow-defaults",
    kind: "actions-policy",
    level: "organization",
    method: "GET",
    paging: "none",
    path: "/orgs/{org}/actions/permissions/workflow",
    whyRead: "what the default GITHUB_TOKEN may do, and whether a workflow may approve a pull request review",
  },
  {
    expectedRefusals: [403, 404],
    id: "org-code-security-configurations",
    kind: "code-security-configuration",
    level: "organization",
    method: "GET",
    paging: "page",
    path: "/orgs/{org}/code-security/configurations",
    whyRead:
      "GitHub's own composite security configuration — Advanced Security, dependency graph, Dependabot, code scanning and secret scanning, as one document per configuration",
  },
  {
    expectedRefusals: [403],
    id: "org-rulesets",
    kind: "ruleset",
    level: "organization",
    method: "GET",
    notFoundWhenUnpermitted: true,
    paging: "page",
    path: "/orgs/{org}/rulesets",
    whyRead: "which rules are enforced across the organisation's repositories, and who may bypass them",
  },
  {
    expectedRefusals: [403],
    id: "org-webhooks",
    kind: "webhook",
    level: "organization",
    method: "GET",
    notFoundWhenUnpermitted: true,
    paging: "page",
    path: "/orgs/{org}/hooks",
    whyRead: "what receives a copy of organisation activity, and on which events",
  },
  {
    expectedRefusals: [403],
    id: "org-secrets",
    kind: "secret-name",
    level: "organization",
    method: "GET",
    paging: "page",
    path: "/orgs/{org}/actions/secrets",
    whyRead:
      "which organisation secrets exist and which repositories may use them — NAMES and scope only; GitHub never returns a value here and no field exists to hold one",
  },
  {
    expectedRefusals: [403],
    id: "org-variables",
    kind: "variable-name",
    level: "organization",
    method: "GET",
    paging: "page",
    path: "/orgs/{org}/actions/variables",
    whyRead:
      "which organisation variables exist and which repositories may use them. GitHub DOES return each value here and the projection drops it — see this file's header",
  },
  {
    expectedRefusals: [403],
    id: "org-custom-properties",
    kind: "custom-property-definition",
    level: "organization",
    method: "GET",
    paging: "none",
    path: "/orgs/{org}/properties/schema",
    whyRead: "the property schema rulesets and governance are written against",
  },
  {
    expectedRefusals: [403, 404],
    id: "org-custom-repository-roles",
    kind: "custom-repository-role",
    level: "organization",
    method: "GET",
    paging: "page",
    path: "/orgs/{org}/custom-repository-roles",
    whyRead: "which non-standard repository roles exist and what each one grants",
  },
  {
    expectedRefusals: [403],
    id: "org-app-installations",
    kind: "github-app-installation",
    level: "organization",
    method: "GET",
    notFoundWhenUnpermitted: true,
    paging: "page",
    path: "/orgs/{org}/installations",
    whyRead:
      "what can reach the code that is not a person — every installed GitHub App, exactly what it was granted, and whether it covers every repository or a named set",
  },
  {
    expectedRefusals: [],
    id: "repo-settings",
    kind: "repository-settings",
    level: "repository",
    method: "GET",
    paging: "none",
    path: "/repos/{owner}/{repo}",
    whyRead:
      "the repository's administrative switches — which merges are allowed, what is archived, which features are on — plus its description and topic names. Deliberately not the corpus's repository record, which holds the repository as an object people work in",
  },
  {
    expectedRefusals: [403],
    id: "repo-security-settings",
    kind: "repository-security-settings",
    level: "repository",
    method: "GET",
    paging: "none",
    path: "/repos/{owner}/{repo}",
    whyRead:
      "the repository's own security-and-analysis switches, which GitHub returns on the repository document rather than at a route of their own",
  },
  {
    expectedRefusals: [403, 404],
    id: "repo-code-scanning-default-setup",
    kind: "code-scanning-default-setup",
    level: "repository",
    method: "GET",
    paging: "none",
    path: "/repos/{owner}/{repo}/code-scanning/default-setup",
    whyRead: "whether code scanning is configured on this repository, on which languages and on what schedule",
  },
  {
    expectedRefusals: [403],
    id: "repo-actions-policy",
    kind: "actions-policy",
    level: "repository",
    method: "GET",
    notFoundWhenUnpermitted: true,
    paging: "none",
    path: "/repos/{owner}/{repo}/actions/permissions",
    whyRead: "whether this repository may run Actions, and which actions it is allowed to run",
  },
  {
    expectedRefusals: [403],
    id: "repo-actions-workflow-defaults",
    kind: "actions-policy",
    level: "repository",
    method: "GET",
    notFoundWhenUnpermitted: true,
    paging: "none",
    path: "/repos/{owner}/{repo}/actions/permissions/workflow",
    whyRead:
      "what this repository's default GITHUB_TOKEN may do, and whether a workflow may approve a pull request review",
  },
  {
    expectedRefusals: [403],
    id: "repo-rulesets",
    kind: "ruleset",
    level: "repository",
    method: "GET",
    paging: "page",
    path: "/repos/{owner}/{repo}/rulesets",
    whyRead: "which rules this repository enforces on its own branches and tags, and who may bypass them",
  },
  {
    expectedRefusals: [403],
    id: "repo-webhooks",
    kind: "webhook",
    level: "repository",
    method: "GET",
    notFoundWhenUnpermitted: true,
    paging: "page",
    path: "/repos/{owner}/{repo}/hooks",
    whyRead: "what receives a copy of this repository's activity, and on which events",
  },
  {
    expectedRefusals: [403],
    id: "repo-secrets",
    kind: "secret-name",
    level: "repository",
    method: "GET",
    notFoundWhenUnpermitted: true,
    paging: "page",
    path: "/repos/{owner}/{repo}/actions/secrets",
    whyRead: "which repository secrets exist — NAMES only, for the same reason as the organisation row",
  },
  {
    expectedRefusals: [403],
    id: "repo-variables",
    kind: "variable-name",
    level: "repository",
    method: "GET",
    notFoundWhenUnpermitted: true,
    paging: "page",
    path: "/repos/{owner}/{repo}/actions/variables",
    whyRead: "which repository variables exist. The value GitHub returns is dropped at the projection",
  },
  {
    expectedRefusals: [403],
    id: "repo-environments",
    kind: "environment",
    level: "repository",
    method: "GET",
    paging: "page",
    path: "/repos/{owner}/{repo}/environments",
    whyRead: "which deployment environments exist and what gates each one — reviewers, wait timers, branch policies",
  },
  {
    expectedRefusals: [403],
    id: "repo-deploy-keys",
    kind: "deploy-key",
    level: "repository",
    method: "GET",
    notFoundWhenUnpermitted: true,
    paging: "page",
    path: "/repos/{owner}/{repo}/keys",
    whyRead:
      "which non-human credentials can reach this repository and whether each may write. The key material is reduced to a fingerprint at the projection",
  },
  {
    expectedRefusals: [],
    id: "repo-labels",
    kind: "repository-label",
    level: "repository",
    method: "GET",
    paging: "page",
    path: "/repos/{owner}/{repo}/labels",
    whyRead:
      "which labels this repository defines — name, colour and description, what a new repository must be given to reproduce them. No actor field is kept",
  },
] as const satisfies readonly GithubCall[];

/**
 * The id of every admitted call — closed, so a misspelled id fails to compile.
 *
 * @internal
 */
export type GithubCallId = (typeof GITHUB_CALLS)[number]["id"];

/**
 * The two DISCOVERY calls, which find the scopes the rest of the table is run against.
 *
 * Named rather than inferred, because they are the calls that must NOT be folded into a kind: they produce
 * a scope list, and a projection for them would mint an entity out of an enumeration.
 */
export const GITHUB_DISCOVERY_CALL_IDS = [
  "account-organisations",
  "org-repositories",
] as const satisfies readonly GithubCallId[];

/**
 * The id of one discovery call.
 *
 * @internal
 */
export type GithubDiscoveryCallId = (typeof GITHUB_DISCOVERY_CALL_IDS)[number];

/**
 * The id of every call whose records are projected into a kind — every admitted call but discovery.
 *
 * @internal
 */
export type GithubProjectedCallId = Exclude<GithubCallId, GithubDiscoveryCallId>;

/**
 * Whether a call id names one of the two discovery calls, narrowing it to that closed pair.
 *
 * @param id any call's id, admitted or not
 * @returns true for a discovery call
 */
export function isGithubDiscoveryCallId(id: string): id is GithubDiscoveryCallId {
  return (GITHUB_DISCOVERY_CALL_IDS as readonly string[]).includes(id);
}

/**
 * One admitted call, by its id.
 *
 * @param id the call's own id, closed over the table's ids — so an id the table does not carry is refused
 * at compile time rather than answered with an absence a caller must remember to check
 * @returns the call
 */
export function githubCallById({ id }: { id: GithubCallId }): GithubCall {
  // Total: `GithubCallId` is derived from this very table's `id` fields, so every value it admits names a row.
  return GITHUB_CALLS.find((call) => call.id === id)!;
}

/**
 * Every call made at one level, excluding the discovery calls.
 *
 * The sync iterates this, so a discovery call is never run as part of a scope's own read — it has already
 * run, which is how that scope came to be in the list.
 *
 * @param level which level of GitHub's hierarchy
 * @returns the admitted calls for it, in table order
 */
export function githubCallsAt({ level }: { level: GithubCallLevel }): readonly GithubCall[] {
  return GITHUB_CALLS.filter((call) => call.level === level && !isGithubDiscoveryCallId(call.id));
}
