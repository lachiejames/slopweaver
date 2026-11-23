/**
 * Notion's web-client navigation surface, and the three rules a walk of it must obey.
 *
 * ## Everything here is MEASURED, and inference alone gets it wrong
 *
 * The first version of this file addressed `www.notion.so` and hung its settings routes off the workspace
 * segment. A live walk reported declared pages unreached, and the published generation said why:
 * **the client now lives at `app.notion.com`**, `www.notion.so/<page>` 302s to it, the account and
 * workspace settings sit under `/space/<name>`, and a workspace document is `/p/<workspace>/<Title>-<id>`.
 * Two routes did something worse than fail — `/search` and `/templates` landed on Notion's PUBLIC marketing
 * site at `notion.com`, and one of those was graded "reached" because its path happened to match. Reproduce
 * any of it with `slopweaver atlas notion walk` and read `atlas/notion/pages.json`.
 *
 * That is why the reachability rule below checks the ORIGIN as well as the path: on this client, landing on
 * the marketing site is the shape a route-that-does-not-exist takes, and it answers HTTP 200 with a real
 * title while doing it.
 *
 * ## The workspace slug is never written down
 *
 * A Notion workspace document is `app.notion.com/p/<workspace>/<Title>-<id>`, and that segment is the
 * organisation's own name — a private identifier this repository may not carry, in source or in a fixture.
 * So every page below is a path relative to one of three roots, and the workspace root itself is learned at
 * run time from where the client lands. {@link workspaceRootFromFinalUrl} is that inference, and it is the
 * only place the slug exists.
 *
 * ## No declared route may DO anything
 *
 * The transport navigates and observes; it performs no click and no form submission. That makes a walk
 * read-only by construction, and this list is the other half of the same property: a route is admissible
 * here only if visiting it is a read. Nothing that signs out, deletes, duplicates, exports, invites or
 * starts a purchase belongs in this file, however interesting its page would be to photograph.
 */

/** The origin the Notion web client now lives at. MEASURED — see this file's header. */
export const NOTION_WEB_ORIGIN = "https://app.notion.com";

/**
 * The document title Notion's client renders for a route it does not have.
 *
 * MEASURED, and it is the reason reachability cannot be judged on the URL alone: the client is a
 * single-page app, so a route it has never heard of KEEPS the address it was asked for and still answers
 * HTTP 200. A walk grading on the settled path therefore marked every non-existent `/space/<name>`
 * route as reached, photographed a byte-identical copy of the "This page couldn't be found" shell for
 * each, and reported them as a filled settings surface. Every real page carries its own name before the
 * suffix — `Home | Notion`, sometimes behind an unread-count prefix — so the bare product name is the marker.
 *
 * @internal
 */
export const NOTION_NOT_FOUND_TITLE = "Notion";

/**
 * Whether a visited page is the client's own not-found shell.
 *
 * @param title the document title the browser settled on
 * @returns whether Notion rendered its not-found page
 */
export function isNotionNotFound({ title }: { title: string }): boolean {
  return title.trim() === NOTION_NOT_FOUND_TITLE;
}

/**
 * The origin the client used to live at, and still 302s from.
 *
 * Kept because it is the atlas's evidence for the migration: every page a walk that addressed it failed to
 * reach failed on this redirect. It is never used to ADDRESS anything.
 *
 * @internal
 */
export const NOTION_SO_WEB_ORIGIN = "https://www.notion.so";

/**
 * Notion's public marketing site.
 *
 * A route the app does not have lands here rather than on a not-found page, answering HTTP 200 with a real
 * title — so this constant is what stops a marketing page being counted as a reached settings surface.
 */
export const NOTION_MARKETING_ORIGIN = "https://www.notion.com";

/**
 * The path segment every account- and workspace-settings surface hangs off. MEASURED: `/my-account`
 * resolves to `/space/my-account`, and so does every sibling that resolves at all.
 *
 * @internal
 */
export const NOTION_SPACE_PREFIX = "space";

/**
 * The path segment a workspace document hangs off, and the segment before the workspace slug.
 *
 * @internal
 */
export const NOTION_WORKSPACE_PREFIX = "p";

/**
 * The bare path a walk asks for FIRST, purely to learn the workspace root from where the client sends it.
 *
 * The origin root rather than a named page, because a signed-in client redirects it to whatever it last
 * showed — and whatever that is, it carries the workspace segment this atlas needs and must not store.
 */
export const NOTION_WORKSPACE_PROBE_PATH = "/";

/**
 * Where a declared path hangs off.
 *
 * - `origin` — `app.notion.com/<path>`
 * - `space` — `app.notion.com/space/<path>`, which is where the settings surface actually lives
 * - `workspace` — `app.notion.com/p/<workspace>/<path>`, learned at run time and never written down
 */
type NotionPageRoot = "origin" | "space" | "workspace";

/** One page of the Notion web client this atlas walks. */
export interface NotionBrowserPage {
  /** The surface name its coverage cell and its entity are reported under. Unique across this list. */
  readonly surface: string;
  /** Which root {@link path} hangs off. */
  readonly root: NotionPageRoot;
  /** The path beneath that root, with no leading slash. */
  readonly path: string;
  /**
   * Query state that overrides whatever the client last left on this page.
   *
   * A value here must be NON-EMPTY to have any effect: an empty string is not a way to clear a filter, it is
   * a way to believe you cleared one. Where no overriding value is known, leave this empty and let
   * `redirected` record honestly that the client chose the view.
   */
  readonly query: Readonly<Record<string, string>>;
  readonly description: string;
}

/** A page id as Notion writes one at the end of a URL: 32 hexadecimal characters. */
const PAGE_ID_SUFFIX = /^[0-9a-f]{32}$/;

/**
 * Whether a URL segment is a page address rather than a workspace name.
 *
 * Notion writes a document as `<Title-With-Dashes>-<32 hex>` or as the bare id. Getting this wrong in the
 * permissive direction would make the atlas treat somebody's page title as the workspace root and address
 * every declared settings page beneath it.
 *
 * @param segment one path segment
 * @returns whether it addresses a page
 */
export function isPageSegment({ segment }: { segment: string }): boolean {
  const tail = segment.slice(segment.lastIndexOf("-") + 1);
  return PAGE_ID_SUFFIX.test(tail.toLowerCase());
}

/**
 * Infer the workspace root from where the bare origin actually landed.
 *
 * MEASURED: a signed-in client sends `/` to `app.notion.com/p/<workspace>/<Title>-<id>`, so the root is the
 * first two segments — and the second of them is the private identifier this function exists to keep inside
 * the process.
 *
 * @param finalUrl the URL the browser settled on after asking for {@link NOTION_WORKSPACE_PROBE_PATH}
 * @returns the workspace root, e.g. `https://app.notion.com/p/<workspace>`, or `null` when the client landed
 *   somewhere with no workspace segment — a personal space, the marketing site, or a sign-in wall
 */
export function workspaceRootFromFinalUrl({ finalUrl }: { finalUrl: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== NOTION_WEB_ORIGIN) {
    return null;
  }
  const [marker, workspace] = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (marker !== NOTION_WORKSPACE_PREFIX || workspace === undefined || isPageSegment({ segment: workspace })) {
    return null;
  }
  return `${NOTION_WEB_ORIGIN}/${NOTION_WORKSPACE_PREFIX}/${workspace}`;
}

/**
 * The absolute URL for one declared page.
 *
 * @param workspaceRoot the root the probe learned, or `null` when there is none
 * @param page the page to address
 * @returns the absolute URL, query state included, or `null` when the page needs a workspace root there is none of
 */
export function notionPageUrl({
  workspaceRoot,
  page,
}: {
  workspaceRoot: string | null;
  page: NotionBrowserPage;
}): string | null {
  const base = pageBase({ page, workspaceRoot });
  if (base === null) {
    return null;
  }
  const url = new URL(`${base}/${page.path}`);
  for (const [key, value] of Object.entries(page.query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** The absolute prefix one declared page hangs off, or `null` when it needs a root there is none of. */
function pageBase({ page, workspaceRoot }: { page: NotionBrowserPage; workspaceRoot: string | null }): string | null {
  if (page.root === "origin") {
    return NOTION_WEB_ORIGIN;
  }
  if (page.root === "space") {
    return `${NOTION_WEB_ORIGIN}/${NOTION_SPACE_PREFIX}`;
  }
  return workspaceRoot;
}

/**
 * Every page the browser channel walks.
 *
 * The list is the atlas's own claim about what the web client contains, so a page Notion adds is a gap this
 * atlas does not know it has until someone adds it here — the same closed-inventory property every atlas in
 * this repository holds, and the reason a walk cannot discover its own scope. A crawler that reported
 * "everything I found" would be making a claim about the crawler, and `browserGaps.ts` files a standing,
 * never-closing gap saying exactly that.
 *
 * ## Three roots, because which one addresses a surface is a MEASUREMENT
 *
 * `/space/<name>` is where the settings surface was measured to live. The last five rows deliberately
 * address the same few names under the OTHER two roots: Notion's own help pages describe settings as
 * something you reach from the sidebar and document no URL scheme at all, so the atlas tests each form and
 * publishes what it found rather than asserting one. A form that does not resolve becomes a recorded gap on
 * its own row, which is a fact worth holding — the next session does not have to re-measure it.
 */
export const NOTION_BROWSER_PAGES: readonly NotionBrowserPage[] = [
  {
    description: "the signed-in account's own profile — name, photo, email and account security",
    path: "my-account",
    query: {},
    root: "space",
    surface: "account-profile",
  },
  {
    description: "the account's preferences — appearance, language and time, privacy, desktop app",
    path: "my-settings",
    query: {},
    root: "space",
    surface: "account-preferences",
  },
  {
    description: "the account's notification settings",
    path: "my-notifications",
    query: {},
    root: "space",
    surface: "account-notifications",
  },
  {
    description: "the account's own connected apps, as distinct from the workspace's",
    path: "my-connections",
    query: {},
    root: "space",
    surface: "account-connections",
  },
  {
    description: "the settings surface addressed directly, rather than through one of its named tabs",
    path: "settings",
    query: {},
    root: "space",
    surface: "space-settings",
  },
  {
    description: "workspace general settings — name, icon, allowed email domains, export",
    path: "general",
    query: {},
    root: "space",
    surface: "space-general",
  },
  {
    description: "the member list and each member's role",
    path: "members",
    query: {},
    root: "space",
    surface: "space-members",
  },
  {
    description: "the people directory, which Notion names separately from members",
    path: "people",
    query: {},
    root: "space",
    surface: "space-people",
  },
  {
    description: "member groups, which permissions are granted to",
    path: "groups",
    query: {},
    root: "space",
    surface: "space-groups",
  },
  {
    description:
      "workspace security — access requests, invitations, publishing restrictions, export controls, trash retention",
    path: "security",
    query: {},
    root: "space",
    surface: "space-security",
  },
  {
    description: "identity — domain verification and SAML SSO configuration",
    path: "identity",
    query: {},
    root: "space",
    surface: "space-identity",
  },
  {
    description: "custom emoji management",
    path: "emoji",
    query: {},
    root: "space",
    surface: "space-emoji",
  },
  {
    description: "the workspace's own connected apps",
    path: "connections",
    query: {},
    root: "space",
    surface: "space-connections",
  },
  {
    description: "installed integrations, as distinct from connections",
    path: "integrations",
    query: {},
    root: "space",
    surface: "space-integrations",
  },
  {
    description: "the import surface — reading it lists the sources, and importing needs a click this walk never makes",
    path: "import",
    query: {},
    root: "space",
    surface: "space-import",
  },
  {
    description: "teamspaces and their membership",
    path: "teamspaces",
    query: {},
    root: "space",
    surface: "space-teamspaces",
  },
  {
    description: "published sites",
    path: "sites",
    query: {},
    root: "space",
    surface: "space-sites",
  },
  {
    description: "workspace analytics",
    path: "analytics",
    query: {},
    root: "space",
    surface: "space-analytics",
  },
  {
    description: "the audit log — the surface this atlas most wants to know the existence and address of",
    path: "audit-log",
    query: {},
    root: "space",
    surface: "space-audit-log",
  },
  {
    description: "billing",
    path: "billing",
    query: {},
    root: "space",
    surface: "space-billing",
  },
  {
    description: "the plan the workspace is on",
    path: "plans",
    query: {},
    root: "space",
    surface: "space-plans",
  },
  {
    description: "the notification inbox",
    path: "notifications",
    query: {},
    root: "space",
    surface: "space-notifications",
  },
  {
    description: "trash",
    path: "trash",
    query: {},
    root: "space",
    surface: "space-trash",
  },
  {
    description: "the workspace's own templates, as distinct from Notion's public gallery",
    path: "templates",
    query: {},
    root: "space",
    surface: "space-templates",
  },
  {
    description: "the workspace home",
    path: "home",
    query: {},
    root: "space",
    surface: "space-home",
  },
  {
    description: "the inbox",
    path: "inbox",
    query: {},
    root: "space",
    surface: "space-inbox",
  },
  {
    description: "search",
    path: "search",
    query: {},
    root: "space",
    surface: "space-search",
  },
  {
    description: "home addressed at the origin, without the space segment",
    path: "home",
    query: {},
    root: "origin",
    surface: "origin-home",
  },
  {
    description: "settings addressed at the origin, which the measured client sends to a document instead",
    path: "settings",
    query: {},
    root: "origin",
    surface: "origin-settings",
  },
  {
    description: "trash addressed at the origin, without the space segment",
    path: "trash",
    query: {},
    root: "origin",
    surface: "origin-trash",
  },
  {
    description: "settings addressed beneath the workspace root, the form Notion's help pages describe",
    path: "settings",
    query: {},
    root: "workspace",
    surface: "workspace-settings",
  },
  {
    description: "the member list addressed beneath the workspace root",
    path: "members",
    query: {},
    root: "workspace",
    surface: "workspace-members",
  },
];

/*
 * Two routes deliberately absent, stated rather than silently omitted.
 *
 * `/logout` and `/upgrade` are both reachable and neither is here. The first ends the session the walk is
 * using and every route after it, which makes it an ACTION rather than a page. The second is a purchase
 * funnel: visiting it is a read today, but a route whose whole purpose is to start a transaction is exactly
 * the kind this file's third rule exists to keep out, and `billing` and `plans` already carry what the atlas
 * wants to know about the workspace's commercial state. If the owner wants the upgrade funnel photographed,
 * it belongs here with that decision recorded, not added quietly.
 */
