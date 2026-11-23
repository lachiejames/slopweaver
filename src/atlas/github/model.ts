/**
 * The GitHub atlas's own vocabulary: what it holds, the three surfaces it holds it from, and the one line
 * that separates it from the corpus next door.
 *
 * ## This atlas is a SURFACE MAP, and that is a ruling rather than a scoping choice
 *
 * The owner's per-platform criterion: **where something better suited already holds the
 * entities — the corpus — the atlas holds the SURFACE MAP; where nothing else holds them, the atlas holds
 * everything reachable.** Slack was the first platform on the near side of that line and GitHub is the
 * second. So a pull request, an issue, a discussion, a review, a comment or a commit is `src/corpus/github`'s
 * and must never be copied here. What is here is the shape of the place those things live in: which
 * operations exist, which settings pages exist, and what every one of those settings is currently SET TO.
 *
 * Enumerating `GET /repos/{owner}/{repo}/issues` as a {@link GITHUB_KINDS} `rest-operation` is this atlas's
 * job. Storing the issues it returns is the corpus's, and doing it here would be the failure the criterion
 * exists to prevent.
 *
 * ## Three surfaces, because GitHub answers in three places
 *
 * `rest-openapi` is COMPILED — GitHub's own OpenAPI description, which ships with the client this
 * repository already calls, read offline. `rest-live` is the API proper: a closed inventory of read-only
 * calls that fetch what each setting is set to. `github-web` is the browser: the owner's real Chrome, driven
 * through the Playwright relay, walking the admin pages and photographing each.
 *
 * A fourth, `graphql-schema`, is DECLARED and not filled by this build. The kit's rule is that a
 * declared-but-unfilled surface is a state an atlas says about itself rather than a silence, and GraphQL is
 * a genuinely separate reachable API here — so omitting it would let a reader take the REST surfaces for
 * the whole of what GitHub can be asked.
 *
 * They are surfaces of ONE platform. `kit/contract.ts` makes that a type, and a platform appearing twice in
 * the catalogue is exactly the failure that type prevents.
 *
 * ## Why the web surface has two kinds rather than one
 *
 * `admin-page` is a place a human can be sent — one row per settings destination, carrying the exact URL a
 * screenshot was taken at. `web-request` is what GitHub's own first-party client ASKED FOR while that page
 * rendered, reduced to method, path shape and response field names. They answer different questions, and
 * the second is where the unknown unknowns live: MEASURED through this repository's own
 * transport, `github.com/settings/profile` called `/_filter/organizations`, `/_side-panels/user.json` and
 * `/in-product-messaging/organization-new-tasks-indicator.json` — none of which appears anywhere in
 * GitHub's published OpenAPI description. A browser-observed call is evidence GitHub HOLDS something,
 * never that an ordinary token may ask for it; {@link GITHUB_CALLABILITY} is where that distinction is kept.
 */
import { KIT_GAP_CONDITIONS } from "../kit/gaps.js";

/** Schema version of every GitHub kind file and manifest. A bump forces an archive-and-resync. */
export const GITHUB_SCHEMA_VERSION = 2;

/** The platform name, used by the registry, the store paths and every coverage cell. */
export const GITHUB_PLATFORM = "github";

/**
 * Every kind this atlas stores. Closed, and the same tuple the descriptor, the store spec and the read
 * adapter must all agree on — nothing in the kit checks that alignment, so a test does.
 *
 * The set answers the owner's own enumeration — "org and repo settings, security and code-scanning
 * configuration, apps and integrations, every reachable admin page plus the API surface" — with one kind
 * per thing GitHub gives an independent address, an identifier and a lifecycle. Where GitHub models
 * something as one composite resource, it is FIELDS of one kind rather than a kind per toggle:
 * `code-security-configuration` is the clearest case, because GitHub's own
 * `/orgs/{org}/code-security/configurations` returns Advanced Security, dependency graph, Dependabot,
 * code scanning and secret scanning as one document, and splitting it here would attribute five sources to
 * one call.
 */
export const GITHUB_KINDS = [
  "rest-operation",
  "organization-settings",
  "repository-settings",
  "actions-policy",
  "code-security-configuration",
  "repository-security-settings",
  "code-scanning-default-setup",
  "ruleset",
  "webhook",
  "secret-name",
  "variable-name",
  "environment",
  "deploy-key",
  "custom-property-definition",
  "custom-repository-role",
  "github-app-installation",
  "repository-label",
  "admin-page",
  "web-request",
] as const;

export type GithubKind = (typeof GITHUB_KINDS)[number];

/**
 * The three surfaces, named as the descriptor names them.
 *
 * `rest-openapi` is GitHub's own published description read offline; `rest-live` is the scoped token
 * reading what each setting is set to; `github-web` is the owner's real Chrome driven through the Playwright
 * relay. Surfaces of one platform, never three atlases.
 */
export const GITHUB_SURFACES = ["rest-openapi", "rest-live", "graphql-schema", "github-web"] as const;

export type GithubSurface = (typeof GITHUB_SURFACES)[number];

/**
 * Whether an observation names something this installation can go and ask for again.
 *
 * The distinction exists because GitHub's web client calls endpoints no public description declares —
 * measured, `/_filter/organizations` and `/_side-panels/user.json` among them. Recording that
 * traffic is the point of the browser half; implying the bot can invoke it would be a capability this
 * atlas never established. Only `executable` may back a capability a router offers.
 *
 * @internal
 */
export const GITHUB_CALLABILITY = ["executable", "browser-observed-only"] as const;

/**
 * @internal
 */
export type GithubCallability = (typeof GITHUB_CALLABILITY)[number];

/**
 * Where a settings fact sits in GitHub's own hierarchy.
 *
 * Recorded on every configuration entity because the same setting name means different things at different
 * levels — an Actions policy at org scope and at repo scope are different facts about different objects,
 * and a reader joining them without the scope would silently merge them.
 */
export const GITHUB_SCOPE_LEVELS = ["organization", "repository", "environment"] as const;

export type GithubScopeLevel = (typeof GITHUB_SCOPE_LEVELS)[number];

/**
 * Every condition a GitHub gap can carry. Closed, so a recheck can match a stored gap exactly.
 *
 * Three members carry the reasoning that is this platform's own. `browser-denominator-unproven` is
 * permanent rather than a bug: GitHub publishes no authenticated settings sitemap — searched
 * across its REST description, its GraphQL schema documentation and its API root and none was found — so
 * unlike Falcon this walk is judged against the navigation GitHub RENDERED to this principal, which is a
 * frontier and not a manifest. `graphql-surface-unfilled` is the same honesty about a surface this build
 * declares and does not yet acquire. `scope-refused` records a working token that may not see something,
 * which on GitHub is the ordinary case rather than an error — a fine-grained token, an unaccepted SSO
 * authorisation and a non-admin role all produce it.
 */
export const GITHUB_GAP_CONDITIONS = [
  "scope-refused",
  "route-absent",
  "incomplete-read",
  "auth-failed",
  "transport-exhausted",
  "schema-drift",
  "deep-link-unverified",
  "browser-denominator-unproven",
  "admin-page-unreachable",
  "admin-page-unphotographed",
  "web-response-body-lost",
  "web-response-cap-reached",
  "graphql-surface-unfilled",
  // Kit-owned: corroboration between surfaces is part of what an atlas is, so every atlas raises these in
  // the same words.
  ...KIT_GAP_CONDITIONS,
] as const;

export type GithubGapCondition = (typeof GITHUB_GAP_CONDITIONS)[number];

/**
 * The kinds a successful `sync` must produce, and the ones it legitimately may not.
 *
 * This exists because the kit's own `hasUsableCoverage` is EXISTENTIAL — `cells.some(...)`, so a run in
 * which every family but one failed reports success and publishes. The owner's bar is
 * universal. A GitHub atlas cannot fix the kit from here, so it states its own mandatory set and requires
 * every member of it, which is what `sync` exits on.
 *
 * `admin-page` and `web-request` are absent deliberately: they are the browser half's, filled by `walk`,
 * and requiring them of an API sync would make one surface's failure the other's.
 *
 * @param kind the kind to judge
 * @returns whether a successful API sync must have produced coverage for it
 */
export function isMandatoryApiKind({ kind }: { kind: GithubKind }): boolean {
  return kind !== "admin-page" && kind !== "web-request";
}

/**
 * The web origin that pairs with an API host, derived rather than configured.
 *
 * GitHub's two hosts differ by exactly one label — `api.github.com` against `github.com` — and every
 * resource this atlas reads carries an `html_url` on the second, which is what confirms the derivation
 * rather than a guess. Deriving it means the host is configured ONCE rather than in two places that can
 * disagree, which matters for an Enterprise Server install where neither is `github.com`.
 *
 * @param apiHost the normalised API origin, `https://api.github.com` or an Enterprise `.../api/v3` host
 * @returns the matching web origin, or `null` when the host is not shaped like a GitHub API host
 *
 * @internal
 */
export function githubWebOrigin({ apiHost }: { apiHost: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(apiHost);
  } catch {
    return null;
  }
  if (parsed.hostname === "api.github.com") {
    return "https://github.com";
  }
  if (parsed.pathname.startsWith("/api/v3")) {
    return parsed.origin;
  }
  return null;
}

/**
 * The file each kind's records are written to, inside the atlas's own directory.
 *
 * The atlas owns these names rather than `stateHome.ts` inferring them, because the mapping is not
 * derivable: most kinds pluralise with a bare `s`, `actions-policy` takes `-ies`, and the three
 * `*-settings` kinds are already plural and must not gain a second one. A rule with three exceptions is
 * a table pretending to be a rule, so this is the table.
 *
 * @returns every kind's own file name, one entry per {@link GITHUB_KINDS} member
 */
export const GITHUB_KIND_FILES: Readonly<Record<GithubKind, string>> = {
  "actions-policy": "actions-policies.jsonl",
  "admin-page": "admin-pages.jsonl",
  "code-scanning-default-setup": "code-scanning-default-setups.jsonl",
  "code-security-configuration": "code-security-configurations.jsonl",
  "custom-property-definition": "custom-property-definitions.jsonl",
  "custom-repository-role": "custom-repository-roles.jsonl",
  "deploy-key": "deploy-keys.jsonl",
  environment: "environments.jsonl",
  "github-app-installation": "github-app-installations.jsonl",
  "organization-settings": "organization-settings.jsonl",
  "repository-label": "repository-labels.jsonl",
  "repository-security-settings": "repository-security-settings.jsonl",
  "repository-settings": "repository-settings.jsonl",
  "rest-operation": "rest-operations.jsonl",
  ruleset: "rulesets.jsonl",
  "secret-name": "secret-names.jsonl",
  "variable-name": "variable-names.jsonl",
  "web-request": "web-requests.jsonl",
  webhook: "webhooks.jsonl",
} as const;
