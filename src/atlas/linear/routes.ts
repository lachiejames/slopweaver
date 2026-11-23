/**
 * The browser surface's DENOMINATOR: a closed table of Linear settings route templates, expanded against
 * the workspace's own team list. PURE.
 *
 * ## Where this denominator comes from, stated rather than implied
 *
 * The CrowdStrike atlas walks a list the console itself publishes, so its denominator is the platform's own
 * claim about what exists. Linear publishes no equivalent sitemap, and its settings navigation is rendered
 * by a single-page client, so the list below is DECLARED here instead. That is a weaker provenance and it
 * is named as a gap (`page-inventory-is-declared`) rather than presented as a census.
 *
 * What keeps a declared list honest is that the walk tests every row: a template this workspace cannot open
 * answers by moving the browser somewhere else, and `walk.ts` records the redirect rather than the
 * destination. So a row that is wrong shows up as an unreached page with the address it actually landed on,
 * which is exactly the shape a reader needs to correct this table. A row that is MISSING is the failure
 * this provenance cannot detect, which is why the gap says so in as many words.
 *
 * ## Team routes are expanded, workspace routes are not
 *
 * Every team-scoped template is instantiated once per team the API reported, so the page count is a
 * property of the workspace rather than of this file. That is also the atlas's own cross-surface check: the
 * API says how many teams exist, and the walk reports how many of their settings pages actually opened.
 */

/**
 * One settings route this atlas tries to open.
 * @internal
 */
export interface LinearRouteTemplate {
  /** The path under the workspace root, with `{team}` where a team key belongs. */
  readonly path: string;
  /** Which scope this route configures — also how the page entity is grouped. */
  readonly area: string;
  /** Whether this route needs a team key substituted into it. */
  readonly perTeam: boolean;
  /** Why this page belongs in a surface map. A reviewer checks the row against it. */
  readonly whyWalk: string;
}

/** One route, resolved against a workspace and a team. */
export interface LinearPlannedPage {
  /** The absolute address to open. */
  readonly url: string;
  /** The provider key this page is stored under: the path, with the team key in place. */
  readonly providerId: string;
  readonly area: string;
  /** The team key this page configures, or `workspace`. */
  readonly pageScope: string;
}

/** Linear's own web origin. Not configurable: a second origin would be a different product. */
export const LINEAR_WEB_ORIGIN = "https://linear.app";

/**
 * Every settings route this atlas walks.
 *
 * Ordered account-first, then workspace, then per-team, because that is the order of increasing entitlement
 * — so a `--limit`ed run proves the lane on the pages this member is most certainly allowed to open.
 */
export const LINEAR_ROUTE_TEMPLATES: readonly LinearRouteTemplate[] = [
  {
    area: "account",
    path: "/settings/account/preferences",
    perTeam: false,
    whyWalk: "this member's own preferences — the Slack atlas's precedent for the account settings page",
  },
  { area: "account", path: "/settings/account/profile", perTeam: false, whyWalk: "the profile this member presents" },
  {
    area: "account",
    path: "/settings/account/notifications",
    perTeam: false,
    whyWalk: "how this member is notified, which the API's userSettings does not fully describe",
  },
  {
    area: "account",
    path: "/settings/account/security",
    perTeam: false,
    whyWalk: "this member's own sessions and second factor",
  },
  {
    area: "workspace",
    path: "/settings/workspace",
    perTeam: false,
    whyWalk: "the workspace's general settings — the browser half of the organisation configuration read",
  },
  { area: "workspace", path: "/settings/members", perTeam: false, whyWalk: "who is in the workspace and at what role" },
  {
    area: "workspace",
    path: "/settings/teams",
    perTeam: false,
    whyWalk: "the team list as the admin surface renders it",
  },
  { area: "workspace", path: "/settings/labels", perTeam: false, whyWalk: "the workspace label taxonomy" },
  { area: "workspace", path: "/settings/templates", perTeam: false, whyWalk: "the workspace templates" },
  {
    area: "workspace",
    path: "/settings/integrations",
    perTeam: false,
    whyWalk: "the integrations directory — the owner named integrations explicitly",
  },
  {
    area: "workspace",
    path: "/settings/api",
    perTeam: false,
    whyWalk: "the API surface as Linear presents it to an operator: keys, applications and webhooks",
  },
  { area: "workspace", path: "/settings/security", perTeam: false, whyWalk: "workspace security and authentication" },
  {
    area: "workspace",
    path: "/settings/audit",
    perTeam: false,
    whyWalk: "whether an audit log exists and is reachable",
  },
  {
    area: "workspace",
    path: "/settings/import-export",
    perTeam: false,
    whyWalk: "what this workspace can be imported from and exported to",
  },
  { area: "workspace", path: "/settings/billing", perTeam: false, whyWalk: "the plan this workspace is on" },
  {
    area: "workspace",
    path: "/settings/emoji",
    perTeam: false,
    whyWalk: "the custom emoji, the browser half of that configuration read",
  },
  { area: "workspace", path: "/settings/projects", perTeam: false, whyWalk: "the project status scheme" },
  { area: "workspace", path: "/settings/initiatives", perTeam: false, whyWalk: "the initiative configuration" },
  { area: "workspace", path: "/settings/customers", perTeam: false, whyWalk: "the customers feature's configuration" },
  { area: "workspace", path: "/settings/releases", perTeam: false, whyWalk: "the release pipeline configuration" },
  {
    area: "workspace",
    path: "/settings/asks",
    perTeam: false,
    whyWalk: "the Asks configuration, when the feature is enabled",
  },
  { area: "team", path: "/settings/teams/{team}", perTeam: true, whyWalk: "one team's general settings" },
  {
    area: "team",
    path: "/settings/teams/{team}/members",
    perTeam: true,
    whyWalk: "one team's membership configuration",
  },
  {
    area: "team",
    path: "/settings/teams/{team}/workflow",
    perTeam: true,
    whyWalk: "one team's workflow states — the owner named workflow states explicitly",
  },
  { area: "team", path: "/settings/teams/{team}/labels", perTeam: true, whyWalk: "one team's own labels" },
  { area: "team", path: "/settings/teams/{team}/templates", perTeam: true, whyWalk: "one team's own templates" },
  { area: "team", path: "/settings/teams/{team}/triage", perTeam: true, whyWalk: "one team's triage configuration" },
  { area: "team", path: "/settings/teams/{team}/estimates", perTeam: true, whyWalk: "one team's estimation scheme" },
  { area: "team", path: "/settings/teams/{team}/cycles", perTeam: true, whyWalk: "one team's cycle configuration" },
  {
    area: "team",
    path: "/settings/teams/{team}/integrations",
    perTeam: true,
    whyWalk: "one team's integration settings",
  },
  { area: "team", path: "/settings/teams/{team}/sla", perTeam: true, whyWalk: "one team's SLA configuration" },
];

/**
 * Resolve every template against one workspace and its teams.
 *
 * @param urlKey the workspace's own URL key, which is what Linear puts in the first path segment
 * @param teamKeys every team key the API reported, in the order it reported them
 * @returns one planned page per template, per applicable scope, in template order
 */
export function planLinearPages({
  urlKey,
  teamKeys,
}: {
  urlKey: string;
  teamKeys: readonly string[];
}): readonly LinearPlannedPage[] {
  const planned: LinearPlannedPage[] = [];
  for (const template of LINEAR_ROUTE_TEMPLATES) {
    const scopes = template.perTeam ? teamKeys : ["workspace"];
    for (const scope of scopes) {
      const path = template.perTeam ? template.path.replace("{team}", scope) : template.path;
      planned.push({
        area: template.area,
        pageScope: scope,
        providerId: path,
        url: `${LINEAR_WEB_ORIGIN}/${urlKey}${path}`,
      });
    }
  }
  return planned;
}
