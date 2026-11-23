/**
 * Which same-origin links count as GitHub ADMIN pages, and what the walk's denominator honestly is.
 *
 * ## The hard fact this file exists to state
 *
 * A crawl cannot prove its own completeness: it finds what it finds, and "we visited everything we found"
 * is a claim about the crawler rather than about the platform. CrowdStrike's walk escapes that because
 * Falcon publishes `/content/sitemap-v2/index.json`, so the denominator is a list the vendor chose.
 *
 * **GitHub publishes no equivalent.** Searched across its REST OpenAPI description, its GraphQL
 * schema documentation and its API root; none was found, and that is a scoped negative finding rather than
 * proof none exists. MEASURED separately through this repository's own transport,
 * every first-party JSON response `github.com/settings/profile` and `/settings/security` emitted was read,
 * and NOT ONE was a navigation document — so there is nothing to fetch and parse the way `readSitemap` does.
 *
 * What GitHub does do is RENDER its settings navigation into every settings page it serves. So the
 * denominator here is the navigation GitHub showed THIS principal at THIS moment, expanded to a fixed
 * point: start from the seeds its own product structure guarantees, keep every same-origin settings link
 * each landed page rendered, and stop when a whole round discovers nothing new.
 *
 * That is a FRONTIER, not a manifest, and the difference is the whole reason this comment is long. A
 * frontier can prove "every link GitHub rendered to me was attempted". It cannot prove "every admin page
 * exists in this list", because a page reachable only by a direct URL, gated behind a feature flag, or
 * shown to an owner and not to a member never appears in it. The atlas says so through a permanently open
 * `browser-denominator-unproven` gap rather than letting a coverage fraction imply otherwise.
 *
 * ## The seeds are structural, not a page list
 *
 * {@link githubSettingsSeeds} returns roots GitHub's own product structure guarantees exist for any
 * organisation and repository — the account settings root, the org settings root, each repository's
 * settings root. It is deliberately NOT a list of settings pages: a committed page list would be the
 * self-chosen denominator `crowdstrike/sitemap.ts` warns about, and would go stale the first time GitHub
 * shipped a settings tab. Every page beyond a root is discovered from what GitHub rendered.
 */

import { canonicaliseSameOriginHref, expandRenderedFrontier } from "../kit/frontier.js";

/**
 * Path prefixes that make a same-origin link an ADMIN page rather than ordinary product navigation.
 *
 * Prefix matching on the PATH, because GitHub's settings routes are stable in their first segments and
 * volatile below them. `/settings` covers the signed-in account's own settings; `/organizations/<org>/settings`
 * the organisation's; `/enterprises/<slug>/settings` an enterprise's; and a repository's own settings sit
 * under `/<owner>/<repo>/settings`, which cannot be matched by a fixed prefix and is matched by SHAPE
 * instead — see {@link isRepositorySettingsPath}.
 *
 * `/settings/billing` is admitted like any other: what a plan includes decides what security features are
 * even available, which is a settings fact the atlas is commissioned to hold. What is never admitted is a
 * page that RENDERS a credential, and that is enforced at {@link isCredentialRevealPath} rather than here.
 */
const ADMIN_PATH_PREFIXES = ["/settings", "/organizations/", "/enterprises/"] as const;

/**
 * Paths the walk must never open, because opening one renders a credential into a screenshot.
 *
 * Not a privacy nicety: a screenshot is this atlas's proof and is kept, so a page that displays a token, a
 * key or a recovery code would put a working secret into the generation as an IMAGE, where no field-level
 * denial can reach it. Every entry is a page whose whole purpose is to reveal or mint something.
 *
 * `new` and `regenerate` routes are refused for a second reason: they are the pages where a stray
 * interaction creates a credential. The walk never clicks anything, so this is defence in depth rather than
 * the primary control — but it is the layer that survives a mistake in the layer above.
 */
const CREDENTIAL_REVEAL_SEGMENTS = [
  "/tokens/new",
  "/tokens/regenerate",
  "/personal-access-tokens/new",
  "/keys/new",
  "/ssh/new",
  "/gpg/new",
  "/recovery-codes",
  "/two_factor/config",
  "/two_factor/setup",
  "/applications/new",
  "/apps/new",
  "/oauth_apps/new",
  "/secrets/new",
  "/installations/new",
] as const;

/** How many rounds of link expansion the frontier runs before it stops. See {@link expandFrontier}. */
export const MAX_FRONTIER_ROUNDS = 6;

/**
 * Whether a path is a repository's own settings page.
 *
 * Matched by shape rather than by prefix because a repository settings path begins with the owner and the
 * repository name, neither of which is a constant. Three or more segments, the third being `settings`, is
 * the shape GitHub uses and nothing else on the origin shares it.
 *
 * @param path the canonical same-origin path
 * @returns whether it is a repository settings page
 */
export function isRepositorySettingsPath({ path }: { path: string }): boolean {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.length >= 3 && segments[2] === "settings";
}

/**
 * Whether opening a path would render a credential.
 *
 * @param path the canonical same-origin path
 * @returns whether the walk must refuse it
 */
export function isCredentialRevealPath({ path }: { path: string }): boolean {
  return CREDENTIAL_REVEAL_SEGMENTS.some((segment) => path.includes(segment));
}

/**
 * Whether a path is an admin page this walk is commissioned to visit.
 *
 * @param path the canonical same-origin path
 * @returns whether to admit it to the frontier
 */
export function isAdminPath({ path }: { path: string }): boolean {
  if (isCredentialRevealPath({ path })) {
    return false;
  }
  return ADMIN_PATH_PREFIXES.some((prefix) => path.startsWith(prefix)) || isRepositorySettingsPath({ path });
}

/**
 * Canonicalise a link into a same-origin path: query sorted, fragment removed.
 *
 * A fragment is a position on a page rather than a different page, and two links differing only by query
 * order are the same destination. Both would otherwise inflate the frontier with duplicates the walk would
 * then dutifully visit twice.
 *
 * @param href the raw href as rendered
 * @param origin the web origin every admitted path must belong to
 * @returns the canonical path, or `null` when the href is off-origin or unparseable
 */
export function canonicaliseGithubHref({ href, origin }: { href: string; origin: string }): string | null {
  return canonicaliseSameOriginHref({ href, origin });
}

/**
 * The structural roots every walk starts from.
 *
 * Roots rather than pages, on purpose. GitHub's own product structure guarantees an account settings root,
 * an organisation settings root per organisation and a settings root per repository; everything below them
 * is discovered from what GitHub rendered. A committed list of settings PAGES would be exactly the
 * self-chosen denominator this design refuses, and it would go stale the first time GitHub shipped a tab.
 *
 * @param organisations the organisation logins in scope
 * @param repositories the `owner/repo` coordinates in scope
 * @returns the seed paths, sorted and de-duplicated
 */
export function githubSettingsSeeds({
  organisations,
  repositories,
}: {
  organisations: readonly string[];
  repositories: readonly string[];
}): readonly string[] {
  const seeds = new Set<string>(["/settings/profile"]);
  for (const login of organisations) {
    seeds.add(`/organizations/${login}/settings/profile`);
  }
  for (const coordinate of repositories) {
    seeds.add(`/${coordinate}/settings`);
  }
  return [...seeds].toSorted();
}

/**
 * The next round's frontier: admin paths GitHub rendered that have not been visited yet.
 *
 * @param rendered every same-origin link the landed pages of the previous round rendered
 * @param visited every path already attempted
 * @param origin the web origin, used to reject off-origin links
 * @returns the paths to visit next, sorted
 */
export function expandFrontier({
  rendered,
  visited,
  origin,
}: {
  rendered: readonly string[];
  visited: ReadonlySet<string>;
  origin: string;
}): readonly string[] {
  return expandRenderedFrontier({ admits: isAdminPath, origin, rendered, visited });
}
