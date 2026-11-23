/**
 * The Slack SURFACE MAP: every page a signed-in member can reach, declared as a table rather than discovered by a
 * crawl. Pure — nothing here opens a browser or makes a call.
 *
 * ## Why this file exists at all
 *
 * Owner ruling (`docs/atlas-intent/06-holdings.md`): the Slack atlas holds the surface map and NOT the
 * entities, because the corpus already holds Slack's channels, people, usergroups and messages. The floor
 * for that half is existence: the atlas must at least know every page that exists. A walk alone cannot
 * meet it — a walk reports where it went, and a page nobody thought to visit leaves no trace, which is the
 * exact invisibility `slack.ts` was written to remove one level down. So the denominator is DECLARED here
 * and the walk is judged against it, the same way `kit/pageWalk.ts` describes and `graphqlHive/consolePages.ts`
 * already does.
 *
 * ## Every row is DECLARED, never witnessed
 *
 * A row is an expectation compiled from Slack's own navigation, read in the owner's signed-in
 * client. Nothing in it is evidence. A row becomes witnessed only when a walk lands on it, which is what
 * writes the `browser` channel beside the declared `api` one; a row a walk cannot open becomes a page
 * carrying `unreachableBecause` — a finding — rather than being dropped.
 *
 * ## The screenshot policy is the owner's, per page, and it is three-valued on purpose
 *
 * The owner worked it out by opening Slack and naming pages, so the values are not a taste call:
 *
 * - `required` — the settings pages. Account settings belong, with its notifications and profile tabs;
 *   the integrations page is in as a page, with no screenshot of every installed app, which is why there
 *   is no row per installed app.
 * - `permitted` — Today. A screenshot is allowed and not worth much, so a run that returns none has still
 *   done what it said it would.
 * - `refused` — anything that renders the workspace's own messages. The walk never pilots a browser to
 *   photograph every message ever sent. The refusal is enforced
 *   before the write rather than by clearing a reference afterwards, for the reason `kit/pageWalk.ts`
 *   records: clearing one left the bytes on disk on another atlas while every count read clean.
 *
 * **`refused` is a PER-PAGE declaration because a destination list is not a guard.** MEASURED:
 * a walk that asked for nine navigation surfaces had Slack redirect every one of them onto the last-open
 * channel, and page records were published naming a `/browse-*` surface while holding a photograph of
 * a real conversation, message content and all. The retired walk answered that with a path predicate; this
 * table answers it by never marking a message-bearing view photographable in the first place, which also
 * covers the case a path check cannot see — the activity inbox is not a conversation by any address and
 * renders message previews, member names and channel names inside its own chrome.
 *
 * ## `contentsHeldBy` is the corpus, and saying so is the point
 *
 * Today, Home and Files have their EXISTENCE recorded here and their CONTENTS nowhere near this atlas —
 * the owner's ruling is that message-shaped contents belong in the corpus, not the atlas. A row names the holder
 * rather than leaving the reader to infer one, which is the same obligation `held-elsewhere` carries in
 * `kit/contract.ts`: a state that cannot say WHERE is an unfalsifiable claim.
 *
 * ## `needsAdmin` is the current bound, not a permanent one
 *
 * A walk reaches what the signed-in member's own role opens, and Slack shows a workspace or organisation
 * admin settings pages a member without that role never sees. So an admin-only page is DECLARED and becomes a gap naming the entitlement it wanted, rather than being silently absent — the
 * atlas stays honest about what its credential could not reach.
 *
 * ## No private identifier is ever written here
 *
 * The workspace's own subdomain is the organisation's name, and this repository may not carry one at any
 * depth ([the partition](../../../docs/constraints/partition.md)). So every row is a path under a HOST
 * ROLE, the concrete address is only ever assembled at runtime by {@link surfacePageUrl} against a host
 * resolved from the local structure store, and the stored provider key keeps a `<workspace>` placeholder
 * exactly as the client rows keep `<team>`.
 */
import type { StructureBronzeRow } from "../../corpus/structures/types.js";
import { newestOrgRowWithUrl } from "./clientRoots.js";

/**
 * Which of Slack's FIVE signed-in web roots a page hangs off.
 *
 * ## Five roots is a MEASUREMENT, and each one past the first cost a refused read to find
 *
 * Walking with only the client root declared: `<workspace>.slack.com/apps/manage`
 * redirects to `app.slack.com/apps-manage/<team>`, `<workspace>.slack.com/stats` redirects to
 * `app.slack.com/manage/<org>/<team>/analytics`, and `<workspace>.slack.com/pricing` redirects to
 * `app.slack.com/plans/<team>` — three applications sharing one origin with the client and reached only
 * from the workspace's own subdomain. The (since retired) Claude-in-Chrome door guard refused the read on
 * arrival at each, which is how they were found; the owner's ruling puts the integrations page in the atlas
 * by name.
 *
 * Roots rather than hosts, because what a walk needs is a base to hang a path off and what the store needs
 * is a placeholdered key — and both differ per root even where the ORIGIN does not.
 */
export const SLACK_SURFACE_ROOT_IDS = ["client", "apps", "manage", "plans", "workspace"] as const;

/** Which of Slack's five signed-in web roots a page hangs off.
 * @internal
 */
export type SlackSurfaceRootId = (typeof SLACK_SURFACE_ROOT_IDS)[number];

/**
 * One root: how to address it, and how to key a page under it.
 *
 * `template` and `keyPrefix` are the same shape with the live ids swapped for placeholders, which is what
 * makes a stored key readable and workspace-independent — an atlas rebuilt against a different workspace
 * merges onto the same `page` entities rather than doubling them.
 */
export interface SlackSurfaceRoot {
  readonly id: SlackSurfaceRootId;
  /** `{origin}`, `{org}` and `{team}` are substituted by {@link surfacePageUrl}. */
  readonly template: string;
  /** What a stored provider key under this root starts with, live ids already placeholdered. */
  readonly keyPrefix: string;
}

/** The Slack web client's own origin, shared by four of the five roots. */
export const SLACK_CLIENT_ORIGIN = "https://app.slack.com";

/**
 * Every root, in the order a walk works through them.
 *
 * The `client` row's `keyPrefix` is exactly what the retired walk table produced, so a page already
 * published under it — `activity-inbox` is the one that was — merges onto its own entity instead of being
 * republished beside itself.
 */
export const SLACK_SURFACE_ROOTS: readonly SlackSurfaceRoot[] = [
  {
    id: "client",
    keyPrefix: "/client/<team>",
    template: `${SLACK_CLIENT_ORIGIN}/client/{org}`,
  },
  {
    id: "apps",
    keyPrefix: "/apps-manage/<team>",
    template: `${SLACK_CLIENT_ORIGIN}/apps-manage/{team}`,
  },
  {
    id: "manage",
    keyPrefix: "/manage/<org>/<team>",
    template: `${SLACK_CLIENT_ORIGIN}/manage/{org}/{team}`,
  },
  {
    id: "plans",
    keyPrefix: "/plans/<team>",
    template: `${SLACK_CLIENT_ORIGIN}/plans/{team}`,
  },
  { id: "workspace", keyPrefix: "/<workspace>", template: "{origin}" },
];

/**
 * Whether this page's picture may be written, and whether it must be.
 *
 * Three-valued because the owner's ruling is three-valued — see this file's header for the reason behind
 * each. A two-valued policy would have to promote Today to required or demote the settings pages to
 * optional, and both misreport what the owner asked for.
 * @internal
 */
export const SLACK_SCREENSHOT_POLICIES = ["required", "permitted", "refused"] as const;

/** Whether this page's picture may be written, and whether it must be.
 * @internal
 */
export type SlackScreenshotPolicy = (typeof SLACK_SCREENSHOT_POLICIES)[number];

/** One page the surface map declares. */
export interface SlackSurfacePage {
  /** The path under its root — `/account/settings`, `/today`. `""` is the root itself. */
  readonly path: string;
  readonly root: SlackSurfaceRootId;
  /** What this page is for, in one line. Written here rather than scraped, so it is stable. */
  readonly purpose: string;
  /** Whether reaching it is expected to need a workspace or organisation admin entitlement. */
  readonly needsAdmin: boolean;
  readonly screenshot: SlackScreenshotPolicy;
  /**
   * Why a walk must NOT navigate to this page, or `null` when it may.
   *
   * Two unrelated causes share this field because they have the same consequence — declared, never
   * attempted — and a reader needs the WORDS rather than the boolean:
   *
   *  - **Addressing it IS the write.** `/account/reset` signs every other session out. Not going there at
   *    all is the strongest form of this atlas's `read-before-write` policy.
   *  - **It has no address.** MEASURED: the grid client's Threads, Huddles, Recap, Drafts and
   *    Directories are rail panes with no URL — `/threads`, `/huddles`, `/recap` and `/directories` all
   *    leave the browser on whatever view it was already showing. They EXIST, which is the owner's floor,
   *    and no walk can stand on one.
   */
  readonly notNavigableBecause: string | null;
  /**
   * The store that holds this page's CONTENTS, when it is not this atlas. `null` means the page's contents
   * are the surface map's own business — which for a settings page is the page itself.
   */
  readonly contentsHeldBy: string | null;
}

/**
 * Where the roots hang, for one installation.
 *
 * Three ids rather than one origin because the roots take different ones: the client settles on the
 * ENTERPRISE org on a grid workspace (`E…`) while the app-management and plans consoles take the TEAM
 * (`T…`) and the organisation console takes BOTH, in that order. Getting it backwards is a redirect rather
 * than an error, and it has already cost a whole sign-in: MEASURED, the first signed-in run
 * here landed on `/client/E…` while the matcher accepted `T…` only, so the verb polled for a sign-in that
 * had happened two minutes earlier and told the owner to do again what was already done.
 *
 * The `manage` root's two-id shape is MEASURED on a grid workspace, and is unverified anywhere
 * else: a plain workspace has no enterprise org, so `clientWorkspaceId` and `teamId` are the same value
 * there and the address this composes is a guess until somebody walks one. Said rather than left for a
 * reader to discover, because a declared route that silently fails off-grid would read as a platform finding.
 */
export interface SlackSurfaceRoots {
  /** The id the client settles on — the enterprise org on a grid workspace, the team otherwise. */
  readonly clientWorkspaceId: string;
  /** The team id, which is what the app-management and plans consoles address even on a grid. */
  readonly teamId: string;
  /** The workspace's own origin, with no trailing slash. */
  readonly workspaceOrigin: string;
}

/**
 * The root one declared page hangs off.
 *
 * @param page the declared page
 * @returns the root row
 */
function rootFor({ page }: { page: SlackSurfacePage }): SlackSurfaceRoot {
  // Every id in `SlackSurfaceRootId` has a row in `SLACK_SURFACE_ROOTS`, and `unit/atlas/slackApi/
  // surfacePages.test.ts` asserts it — an honest assertion rather than a fallback, because a synthesised
  // root would publish a page entity addressed at nowhere.
  return SLACK_SURFACE_ROOTS.find((root) => root.id === page.root)!;
}

/**
 * The stable provider key one declared page is stored under.
 *
 * @param page the declared page
 * @returns the provider key, with every live id already a placeholder
 */
export function surfacePageKey({ page }: { page: SlackSurfacePage }): string {
  return `${rootFor({ page }).keyPrefix}${page.path}`;
}

/**
 * The concrete address one declared page resolves to, for this installation.
 *
 * @param page the declared page
 * @param roots where the roots hang for this installation
 * @returns the absolute address to navigate to
 */
export function surfacePageUrl({ page, roots }: { page: SlackSurfacePage; roots: SlackSurfaceRoots }): string {
  const base = rootFor({ page })
    .template.replace("{origin}", roots.workspaceOrigin)
    .replace("{org}", roots.clientWorkspaceId)
    .replace("{team}", roots.teamId);
  return `${base}${page.path}`;
}

/**
 * The workspace's own origin and team id, read off the `org` structure row `refresh` already wrote.
 *
 * Read from the local corpus rather than asked of Slack, for two reasons that are both the point: `plan`
 * makes no network call, and both values are private identifiers, so resolving them at runtime from a file
 * under `$SLOPWEAVER_HOME` is what keeps them out of this repository entirely.
 *
 * The NEWEST row wins, matching the structure store's own doctrine that rows accumulate and a measurement
 * describes the last look — `fetchedAtIso` is ISO-8601 and so sorts lexicographically.
 *
 * @param rows the Slack structure rows, as `refresh` wrote them
 * @returns the origin and team id, or `null` when no row carries a workspace URL
 */
export function workspaceRootsFromStructures({
  rows,
}: {
  rows: readonly StructureBronzeRow[];
}): { readonly workspaceOrigin: string; readonly teamId: string } | null {
  const newest = newestOrgRowWithUrl({ rows });
  if (newest?.identity.url === undefined) {
    return null;
  }
  return { teamId: newest.identity.nativeId, workspaceOrigin: newest.identity.url.replace(/\/+$/, "") };
}

/** The corpus is what holds Slack's messages, channels, people and files — named, never implied. */
export const SLACK_CORPUS_HOLDER = "the Slack corpus (`slopweaver refresh --source slack`, then `store read`)";

/**
 * Later — the member's own saved-for-later list.
 *
 * Exported because `slack saved` opens exactly this page and no other: a verb that spelled its own `/later`
 * route could drift from the row the atlas judges its walk against. MEASURED through `slack probe
 * --method stars.list`: the published API returns only STARRED CHANNELS (every row it answered was `type: channel`), so
 * the client's own internal `saved.list` call, observed as this page loads, is the only reader of the list.
 */
export const SLACK_LATER_SURFACE_PAGE: SlackSurfacePage = {
  contentsHeldBy: SLACK_CORPUS_HOLDER,
  needsAdmin: false,
  notNavigableBecause: null,
  path: "/later",
  purpose: "Later — the per-member saved-items index; no published API reads it, `slack saved` observes it",
  root: "client",
  screenshot: "refused",
};

/**
 * Why a rail pane is declared and never walked. One sentence, shared by the five that have no address.
 *
 * MEASURED: `/threads`, `/huddles`, `/recap` and `/directories` each left the browser on
 * whatever view it was already showing, which is this client's way of saying a route does not exist.
 */
const NO_ADDRESS =
  "it is a rail pane with no URL of its own — navigating to its obvious route leaves the client on" +
  " whatever view it was already showing, so it EXISTS and no walk can stand on it";

/**
 * Why the organisation console's two collapsed sections are declared and never walked.
 *
 * MEASURED: both bare routes answer the client's own "Slack couldn't load" page, and their
 * children are reachable only by expanding a menu — which is a CLICK, and this walk takes none.
 */
const NO_BARE_ROUTE =
  "its children are reachable only by expanding a menu, which is a click this read-only walk does not take;" +
  " the bare route itself answers the client's own failed-to-load page";

/**
 * The client's rail and sidebar panes: surfaces that exist and cannot be addressed.
 *
 * Recorded because the owner's floor is existence — _"we should at least know all the pages that exist"_ —
 * and left un-walked because there is nowhere to walk to. Their contents are all message-shaped, so the
 * corpus is the holder in every case.
 */
const CLIENT_PANES: readonly SlackSurfacePage[] = (
  [
    ["#threads", "the Threads pane — every thread this member is following"],
    ["#huddles", "the Huddles pane — recorded calls and their notes"],
    ["#recap", "the Recap pane — the client's own catch-up summary"],
    ["#drafts-and-sent", "the Drafts & sent pane"],
    ["#directories", "the Directories pane — the client's way into people and channels"],
    ["#files", "the Files rail button — this member's own files"],
  ] as const
).map(([path, purpose]) => ({
  contentsHeldBy: SLACK_CORPUS_HOLDER,
  needsAdmin: false,
  notNavigableBecause: NO_ADDRESS,
  path,
  purpose,
  root: "client" as const,
  screenshot: "refused" as const,
}));

/**
 * Every page the Slack surface map declares, grouped by root in the order a walk works through them.
 *
 * The shape of the list is the owner's, worked out by opening Slack and naming pages
 * (`docs/atlas-intent/06-holdings.md`). Every row was then verified in a signed-in walk, and the two
 * findings that walk produced are in the table rather than in a comment: a grid client addresses almost
 * nothing by URL, and three of the workspace subdomain's own pages are redirects into consoles on a
 * different root.
 *
 * Reproduce the denominator with `slopweaver atlas slack-drive plan`.
 */
export const SLACK_SURFACE_PAGES: readonly SlackSurfacePage[] = [
  // ---- the single-page client. MEASURED: a grid client addresses almost nothing by URL. Of the
  // nine routes the retired walk list guessed, every one redirected; `/browse-channels`, `/browse-people`
  // and `/saved` all left the browser on whatever view it was already showing. What survives is here.
  {
    contentsHeldBy: SLACK_CORPUS_HOLDER,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "",
    purpose: "the client boot payload — what the web client fetches before a human does anything",
    root: "client",
    screenshot: "refused",
  },
  {
    contentsHeldBy: SLACK_CORPUS_HOLDER,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/activity-inbox",
    purpose: "the activity feed — what the client asks for unread and mention state",
    root: "client",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: SLACK_CORPUS_HOLDER,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/today",
    purpose: "Today — the client's own daily digest of what is waiting",
    root: "client",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: SLACK_CORPUS_HOLDER,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/dms",
    purpose: "the direct-message pane, which opens on the most recent conversation",
    root: "client",
    screenshot: "refused",
  },
  SLACK_LATER_SURFACE_PAGE,
  ...CLIENT_PANES,
  // ---- the app-management console, which is where the owner's "integrations" page actually lives.
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/integrations/installed",
    purpose: "installed apps — the integrations page, as a page and not one shot per app",
    root: "apps",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/integrations/resolution/",
    purpose: "app approval requests awaiting a decision",
    root: "apps",
    screenshot: "required",
  },
  // ---- the organisation console. Its analytics section is member-reachable; its integrations and settings
  // sections are collapsed menus whose children have no address of their own — MEASURED, both bare routes
  // answer the client's own "Slack couldn’t load" page.
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/analytics",
    purpose: "organisation analytics overview",
    root: "manage",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: SLACK_CORPUS_HOLDER,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/analytics/members",
    purpose: "per-member analytics — who is active, and how",
    root: "manage",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: SLACK_CORPUS_HOLDER,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/analytics/channels",
    purpose: "per-channel analytics — which conversations carry the traffic",
    root: "manage",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/analytics/apps",
    purpose: "per-app analytics — which integrations are actually used",
    root: "manage",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: NO_BARE_ROUTE,
    path: "/integrations",
    purpose: "the organisation console's integrations section",
    root: "manage",
    screenshot: "refused",
  },
  {
    contentsHeldBy: null,
    needsAdmin: true,
    notNavigableBecause: NO_BARE_ROUTE,
    path: "/settings",
    purpose: "the organisation console's settings section",
    root: "manage",
    screenshot: "refused",
  },
  // ---- the plans console, reached from the workspace subdomain's own /pricing link.
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "",
    purpose: "the workspace's plan and what changing it would cost",
    root: "plans",
    screenshot: "permitted",
  },
  // ---- the workspace subdomain: the account, customisation and app-directory pages, plus the three
  // redirects that revealed the consoles above.
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/home",
    purpose: "the workspace home page, which links every settings surface a member can open",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/account/settings",
    purpose: "account settings — email, time zone, language, session control",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/account/notifications",
    purpose: "the notifications tab of account settings",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/account/profile",
    purpose: "the profile tab of account settings, which hands off to the desktop app rather than rendering",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/account/logs",
    purpose: "access logs — every sign-in the signed-in member has made, with its device and address",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause:
      "addressing it IS the write — this URL signs every other session out. Its existence is the fact worth" +
      " holding; opening it is not a read this atlas is allowed to take",
    path: "/account/reset",
    purpose: "sign out of all other sessions",
    root: "workspace",
    screenshot: "refused",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/customize",
    purpose: "the customisation index, which redirects onto its own emoji tab",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/customize/emoji",
    purpose: "the workspace's custom emoji",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/customize/automated-messages",
    purpose: "the workspace's automated welcome and join messages",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/customize/channels",
    purpose: "channel-name prefixes the workspace has standardised on",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/apps",
    purpose: "the Slack Marketplace as this workspace sees it",
    root: "workspace",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/apps/manage",
    purpose: "the app-management entry point, which redirects onto the `apps` root",
    root: "workspace",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/apps/manage/custom-integrations",
    purpose: "the workspace's custom integrations — webhooks, bots and slash commands",
    root: "workspace",
    screenshot: "required",
  },
  {
    // MEASURED, and the reason this row's `needsAdmin` is not a guess: the walk landed on
    // "Only [the workspace]'s workspace admins can view this page". Its four siblings under the same prefix
    // opened fine, so the entitlement is per page rather than per section.
    contentsHeldBy: null,
    needsAdmin: true,
    notNavigableBecause: null,
    path: "/apps/manage/deactivated",
    purpose: "apps that were installed and have since been turned off",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/apps/manage/connections",
    purpose: "third-party accounts this member has connected to Slack apps",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/apps/manage/mutes",
    purpose: "apps this member has muted",
    root: "workspace",
    screenshot: "required",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/stats",
    purpose: "workspace statistics, which redirects onto the organisation console's analytics",
    root: "workspace",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/pricing",
    purpose: "the plan page, which redirects onto the `plans` root",
    root: "workspace",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: null,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/downloads",
    purpose: "the desktop and mobile clients this workspace offers",
    root: "workspace",
    screenshot: "permitted",
  },
  {
    contentsHeldBy: SLACK_CORPUS_HOLDER,
    needsAdmin: false,
    notNavigableBecause: null,
    path: "/messages",
    purpose: "the workspace subdomain's own way into the client, which redirects onto the `client` root",
    root: "workspace",
    screenshot: "refused",
  },
  {
    contentsHeldBy: null,
    needsAdmin: true,
    notNavigableBecause: null,
    path: "/admin",
    purpose: "workspace administration — members, permissions and workspace settings",
    root: "workspace",
    screenshot: "required",
  },
];
