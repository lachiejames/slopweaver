/**
 * The BROWSER surface's declared page map: every console route this atlas expects to exist, as a template.
 *
 * ## Why a template and not a URL
 *
 * Every interesting Hive console page is scoped by an organisation, project or target SLUG, and those
 * slugs are this organisation's own names — private identifiers this repository may not carry at any
 * depth ([the partition](../../../docs/constraints/partition.md)). So the committed table holds
 * `{organizationSlug}` placeholders and nothing else, and a concrete address is only ever produced at
 * runtime by {@link expandConsoleRoute} against the registry entities the API channel already synced into
 * `$SLOPWEAVER_HOME`. A page row therefore exists for every (route × scope) pair the registry actually
 * holds, which is what makes "every page and sub page and settings page" a countable claim rather than a
 * list somebody typed.
 *
 * ## Every row here is DECLARED, never witnessed
 *
 * This table is an expectation compiled from the console's own navigation structure. Nothing in it is
 * evidence: a row becomes a witnessed address only when a walk lands on it, which is what flips its
 * `deepLinkStatus` from `unverified` to `browser-discovered` and writes a `reachedAt`. A route that turns
 * out not to exist is recorded as a page with `unreachableBecause` set — a finding — rather than quietly
 * dropped, because a declared page that 404s is exactly the kind of divergence between the two surfaces
 * this atlas exists to surface (`docs/atlas-intent/02-both-surfaces.md`, `docs/atlas-intent/04-corroboration.md`).
 *
 * ## `needsAdmin` is a bound, not an excuse
 *
 * The owner reaches Hive through an SSO assignment, and an SSO assignment says nothing about which
 * organisation role it lands on. A row marked `needsAdmin` that a walk cannot open becomes a declared GAP
 * naming the role, so the atlas stays honest about what its credential could not reach rather than
 * reporting the page as absent — the same treatment `docs/atlas-intent/06-holdings.md` gives Slack's admin-only settings.
 */

/**
 * Which slug scope a route hangs off, and therefore how many concrete pages it expands into.
 *
 * @internal
 */
export const HIVE_CONSOLE_SCOPES = ["root", "organization", "project", "target"] as const;

/**
 * Which slug scope a route hangs off.
 *
 * @internal
 */
export type HiveConsoleScope = (typeof HIVE_CONSOLE_SCOPES)[number];

/**
 * One declared console route: what it is, where it lives, and what reaching it costs.
 *
 * @internal
 */
export interface HiveConsoleRoute {
  /** The route template, with `{organizationSlug}`-style placeholders and no real slug ever. */
  readonly template: string;
  /** Which slug scope the template's placeholders come from. */
  readonly scope: HiveConsoleScope;
  /** What this page is for, in one line. Written here rather than scraped, so it is stable. */
  readonly purpose: string;
  /** Whether reaching it is expected to need an organisation admin role. */
  readonly needsAdmin: boolean;
}

/** The console's own origin. The registry API is a different host — see `client.ts`. */
export const HIVE_CONSOLE_ORIGIN = "https://app.graphql-hive.com";

/**
 * Every console route this atlas declares, in the order a reader walks them: root first, then widening
 * outward through organisation, project and target.
 */
export const HIVE_CONSOLE_ROUTES: readonly HiveConsoleRoute[] = [
  {
    needsAdmin: false,
    purpose: "the signed-in landing page — which organisations this account can open at all",
    scope: "root",
    template: "/",
  },
  {
    needsAdmin: false,
    purpose: "this account's own profile and preferences",
    scope: "root",
    template: "/settings",
  },
  {
    needsAdmin: false,
    purpose: "an organisation's overview — its projects and recent registry activity",
    scope: "organization",
    template: "/{organizationSlug}",
  },
  {
    needsAdmin: false,
    purpose: "who is in the organisation, and which role each of them holds",
    scope: "organization",
    template: "/{organizationSlug}/view/members",
  },
  {
    needsAdmin: true,
    purpose: "the organisation-wide schema policy every project inherits",
    scope: "organization",
    template: "/{organizationSlug}/view/policy",
  },
  {
    needsAdmin: true,
    purpose: "organisation settings, including the OIDC integration this account signs in through",
    scope: "organization",
    template: "/{organizationSlug}/view/settings",
  },
  {
    needsAdmin: true,
    purpose: "the plan, the operation quota and what has been consumed against it",
    scope: "organization",
    template: "/{organizationSlug}/view/subscription",
  },
  {
    needsAdmin: false,
    purpose: "a project's overview — its targets and their current schema state",
    scope: "project",
    template: "/{organizationSlug}/{projectSlug}",
  },
  {
    needsAdmin: false,
    purpose: "the project's alert channels and where a schema change is announced",
    scope: "project",
    template: "/{organizationSlug}/{projectSlug}/view/alerts",
  },
  {
    needsAdmin: false,
    purpose: "the project's own schema policy, layered over the organisation's",
    scope: "project",
    template: "/{organizationSlug}/{projectSlug}/view/policy",
  },
  {
    needsAdmin: true,
    purpose: "project settings — the model, the base schema and who may change them",
    scope: "project",
    template: "/{organizationSlug}/{projectSlug}/view/settings",
  },
  {
    needsAdmin: false,
    purpose: "a target's overview — the composed schema as the registry currently holds it",
    scope: "target",
    template: "/{organizationSlug}/{projectSlug}/{targetSlug}",
  },
  {
    needsAdmin: false,
    purpose: "the schema explorer — every type and field, as the console renders them",
    scope: "target",
    template: "/{organizationSlug}/{projectSlug}/{targetSlug}/explorer",
  },
  {
    needsAdmin: false,
    purpose: "schema checks — what was proposed against this target and whether it was allowed",
    scope: "target",
    template: "/{organizationSlug}/{projectSlug}/{targetSlug}/checks",
  },
  {
    needsAdmin: false,
    purpose: "the published schema version history for this target",
    scope: "target",
    template: "/{organizationSlug}/{projectSlug}/{targetSlug}/history",
  },
  {
    needsAdmin: false,
    purpose: "usage insights — which operations are actually called, and how often",
    scope: "target",
    template: "/{organizationSlug}/{projectSlug}/{targetSlug}/insights",
  },
  {
    needsAdmin: false,
    purpose: "the laboratory — the console's own GraphQL client against this target",
    scope: "target",
    template: "/{organizationSlug}/{projectSlug}/{targetSlug}/laboratory",
  },
  {
    needsAdmin: false,
    purpose: "app deployments — which client builds are registered against this target",
    scope: "target",
    template: "/{organizationSlug}/{projectSlug}/{targetSlug}/apps",
  },
  {
    needsAdmin: true,
    purpose: "target settings, including the registry and CDN access tokens issued for it",
    scope: "target",
    template: "/{organizationSlug}/{projectSlug}/{targetSlug}/settings",
  },
];

/** The slug values one concrete page is addressed by. A scope needs exactly the slugs above it. */
export interface HiveConsoleSlugs {
  readonly organizationSlug: string | null;
  readonly projectSlug: string | null;
  readonly targetSlug: string | null;
}

/**
 * Expand one route template against a concrete set of slugs.
 *
 * @param route the declared template
 * @param slugs the registry slugs to substitute; a placeholder with no slug makes this expansion impossible
 * @returns the absolute console URL, or `null` when the slugs do not reach this route's scope
 */
export function expandConsoleRoute({
  route,
  slugs,
}: {
  route: HiveConsoleRoute;
  slugs: HiveConsoleSlugs;
}): string | null {
  const substitutions: readonly (readonly [string, string | null])[] = [
    ["{organizationSlug}", slugs.organizationSlug],
    ["{projectSlug}", slugs.projectSlug],
    ["{targetSlug}", slugs.targetSlug],
  ];
  let path = route.template;
  for (const [placeholder, value] of substitutions) {
    if (!path.includes(placeholder)) {
      continue;
    }
    if (value === null || value.length === 0) {
      return null;
    }
    path = path.split(placeholder).join(encodeURIComponent(value));
  }
  return `${HIVE_CONSOLE_ORIGIN}${path}`;
}

/**
 * The provider key one declared page is tracked under — the route template plus the slug path it was
 * expanded for, so two targets' settings pages are two rows rather than one.
 *
 * @param route the declared template
 * @param slugs the registry slugs this expansion used
 * @returns the key, stable across walks and independent of the console's own redirects
 */
export function consolePageProviderId({ route, slugs }: { route: HiveConsoleRoute; slugs: HiveConsoleSlugs }): string {
  const path = [slugs.organizationSlug, slugs.projectSlug, slugs.targetSlug].filter((slug) => slug !== null).join("/");
  return path.length === 0 ? route.template : `${route.template}#${path}`;
}
