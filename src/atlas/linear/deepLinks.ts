/**
 * Which settings page SHOWS one piece of Linear configuration — the exact URL a proof screenshot is taken
 * at. PURE.
 *
 * Split out of `projection.ts` because it is a lookup table with one function over it, and because
 * `docs/atlas-intent/05-browser-proof.md` makes this a first-class requirement rather than a detail: proof here is a
 * screenshot, so the atlas has to know the address to open. Keeping it beside the projection made that
 * table look like an implementation aside.
 */
import { LINEAR_ROUTE_TEMPLATES } from "./routes.js";

/**
 * The settings page that SHOWS one piece of configuration, as an address a human can open.
 *
 * `docs/atlas-intent/05-browser-proof.md` makes this a first-class requirement rather than a nicety: proof here is a
 * screenshot, so the atlas has to know the exact URL to open. A team-scoped record resolves to that TEAM's
 * own settings page, which is the whole reason `settingScope` exists — pointing every team's workflow
 * states at one workspace page would be a link that is technically valid and useless.
 *
 * Every path returned is checked against `routes.ts`'s own table, so a link is only ever emitted for a page
 * the walk actually tries to open. A group with no page keeps a `null` link and an `unavailable` status,
 * which says "Linear renders this nowhere we know of" rather than "nobody looked".
 */
const WORKSPACE_ROUTE_BY_GROUP: Readonly<Record<string, string>> = {
  "account-setting": "/settings/account/preferences",
  "custom-emoji": "/settings/emoji",
  "customer-status": "/settings/customers",
  "customer-tier": "/settings/customers",
  "initiative-label": "/settings/initiatives",
  integration: "/settings/integrations",
  "issue-label": "/settings/labels",
  "oauth-application": "/settings/api",
  organization: "/settings/workspace",
  "project-label": "/settings/labels",
  "project-status": "/settings/projects",
  "release-pipeline": "/settings/releases",
  team: "/settings/teams",
  template: "/settings/templates",
  webhook: "/settings/api",
};

/** The per-team settings page each team-scoped group is rendered on. */
const TEAM_ROUTE_BY_GROUP: Readonly<Record<string, string>> = {
  integration: "/settings/teams/{team}/integrations",
  "issue-label": "/settings/teams/{team}/labels",
  "sla-configuration": "/settings/teams/{team}/sla",
  team: "/settings/teams/{team}",
  template: "/settings/teams/{team}/templates",
  "triage-responsibility": "/settings/teams/{team}/triage",
  "workflow-state": "/settings/teams/{team}/workflow",
};

/** Whether `routes.ts` actually declares a template with this path shape. */
function isDeclaredRoute({ path }: { path: string }): boolean {
  return LINEAR_ROUTE_TEMPLATES.some((route) => route.path === path);
}

/**
 * The address that shows one configuration record, or `null` when nothing here knows of one.
 *
 * @param group the configuration group
 * @param scope the team key this record configures, or `workspace`
 * @param urlBase the workspace's own settings root; `null` when the workspace is not known
 * @returns the absolute address, or `null`
 */
export function settingsDeepLink({
  group,
  scope,
  urlBase,
}: {
  group: string;
  scope: string;
  urlBase: string | null;
}): string | null {
  if (urlBase === null) {
    return null;
  }
  const teamTemplate = TEAM_ROUTE_BY_GROUP[group];
  if (scope !== "workspace" && teamTemplate !== undefined && isDeclaredRoute({ path: teamTemplate })) {
    return `${urlBase}${teamTemplate.replace("{team}", scope)}`;
  }
  const workspaceRoute = WORKSPACE_ROUTE_BY_GROUP[group];
  return workspaceRoute !== undefined && isDeclaredRoute({ path: workspaceRoute })
    ? `${urlBase}${workspaceRoute}`
    : null;
}
