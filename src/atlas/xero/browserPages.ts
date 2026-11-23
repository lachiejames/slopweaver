/**
 * Xero's web navigation surface, and the four rules a walk of it must obey.
 *
 * ## The list is CANDIDATES, and the generation is what says which of them are real
 *
 * Xero publishes no manifest of its own web routes, and its client has migrated in stages — some surfaces
 * are still the original `go.xero.com/<Area>/<Page>.aspx` shape, some moved under
 * `go.xero.com/app/!<short code>/…`, reporting moved to its own origin, and the account and organisation
 * hub moved to another. So this file declares each surface at the roots it plausibly hangs off and the walk
 * PUBLISHES which of them resolved, exactly as the Notion atlas's own inventory does. A form that does not
 * resolve becomes a recorded gap on its own row, which is a fact worth holding: the next session does not
 * have to re-measure it.
 *
 * That is a deliberate design, not a shortcut. A crawler that reported "everything I found" would be making
 * a claim about the crawler; a declared denominator is the only thing that lets a walk say a page is
 * MISSING. `browserGaps.ts` files a standing, never-closing gap saying the denominator is a hand list.
 *
 * ## The organisation's short code is never written down
 *
 * A modern Xero URL is `go.xero.com/app/!<short code>/<page>`, and that segment identifies the organisation
 * — a private identifier this repository may not carry, in source or in a fixture. So every page below is a
 * path relative to one of four roots, and the app root itself is learned at run time from where the client
 * lands. {@link appRootFromFinalUrl} is that inference, and it is the only place the short code exists.
 *
 * ## Landing on the sign-in origin is a LOST SESSION, never a page failure
 *
 * Xero sends a signed-out browser to `login.xero.com`. Without that distinction one sign-out becomes forty
 * false page gaps that have nothing to do with the pages, so {@link isSignInOrigin} is checked before
 * anything else and the walk stops on it.
 *
 * ## No declared route may DO anything
 *
 * The transport navigates and observes; it performs no click and no form submission. That makes a walk
 * read-only by construction, and this list is the other half of the same property: a route is admissible
 * here only if visiting it is a read. Nothing that signs out, deletes, voids, approves, pays, exports,
 * invites or starts a purchase belongs in this file, however interesting its page would be to photograph.
 */

import { XERO_BOOKKEEPING_PAGES, type XeroBrowserPage } from "./browserPageEntries.js";

/** The origin the Xero web client is served from. */
export const XERO_WEB_ORIGIN = "https://go.xero.com";

/** The origin Xero's own account and organisation hub is served from. */
export const XERO_ACCOUNT_ORIGIN = "https://my.xero.com";

/** The origin Xero's reporting client moved to. A settle here from `go.xero.com` is a real finding. */
export const XERO_REPORTING_ORIGIN = "https://reporting.xero.com";

/**
 * The origin Xero sends a signed-out browser to.
 *
 * Checked before every other reachability rule, because a sign-in wall is a SUCCESSFUL navigation and would
 * otherwise be graded as forty independent page failures.
 *
 * @internal
 */
export const XERO_LOGIN_ORIGIN = "https://login.xero.com";

/**
 * The path segment every modern app route hangs off, before the organisation's own short code.
 *
 * @internal
 */
export const XERO_APP_PREFIX = "app";

/**
 * The bare path a walk asks for FIRST, purely to learn the app root from where the client sends it.
 *
 * The origin root rather than a named page, because a signed-in client redirects it to whatever it last
 * showed — and whatever that is, it carries the short-code segment this atlas needs and must not store.
 */
export const XERO_APP_PROBE_PATH = "/";

/**
 * Whether the browser settled on Xero's sign-in origin, whatever it was asked for.
 *
 * @param finalUrl where the browser actually settled
 * @returns whether this session is signed out
 */
export function isSignInOrigin({ finalUrl }: { finalUrl: string }): boolean {
  try {
    return new URL(finalUrl).origin === XERO_LOGIN_ORIGIN;
  } catch {
    return false;
  }
}

/** A Xero organisation short code as the client writes one: a `!` and then an opaque token. */
const SHORT_CODE_SEGMENT = /^![A-Za-z0-9_-]+$/;

/**
 * Whether a URL segment is an organisation short code rather than an ordinary path name.
 *
 * Getting this wrong in the permissive direction would make the atlas treat a page name as the short code
 * and address every declared app page beneath it.
 *
 * @param segment one path segment
 * @returns whether it addresses an organisation
 */
export function isShortCodeSegment({ segment }: { segment: string }): boolean {
  return SHORT_CODE_SEGMENT.test(segment);
}

/**
 * Infer the app root from where the bare origin actually landed.
 *
 * A signed-in client sends `/` to `go.xero.com/app/!<short code>/<page>`, so the root is the first two
 * segments — and the second of them is the private identifier this function exists to keep inside the
 * process.
 *
 * @param finalUrl the URL the browser settled on after asking for {@link XERO_APP_PROBE_PATH}
 * @returns the app root, e.g. `https://go.xero.com/app/!<code>`, or `null` when the client landed somewhere
 *   with no short-code segment — the legacy dashboard, the organisation chooser, or a sign-in wall
 */
export function appRootFromFinalUrl({ finalUrl }: { finalUrl: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== XERO_WEB_ORIGIN) {
    return null;
  }
  const [marker, shortCode] = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (marker !== XERO_APP_PREFIX || shortCode === undefined || !isShortCodeSegment({ segment: shortCode })) {
    return null;
  }
  return `${XERO_WEB_ORIGIN}/${XERO_APP_PREFIX}/${shortCode}`;
}

/**
 * The absolute URL for one declared page.
 *
 * @param appRoot the root the probe learned, or `null` when there is none
 * @param page the page to address
 * @returns the absolute URL, query state included, or `null` when the page needs an app root there is none of
 */
export function xeroPageUrl({ appRoot, page }: { appRoot: string | null; page: XeroBrowserPage }): string | null {
  const base = pageBase({ appRoot, page });
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
function pageBase({ page, appRoot }: { page: XeroBrowserPage; appRoot: string | null }): string | null {
  if (page.root === "origin") {
    return XERO_WEB_ORIGIN;
  }
  if (page.root === "account") {
    return XERO_ACCOUNT_ORIGIN;
  }
  if (page.root === "reporting") {
    return XERO_REPORTING_ORIGIN;
  }
  return appRoot;
}

/**
 * The origin one declared page is addressed at, before the app root is known.
 *
 * @param page the declared page
 * @returns the absolute origin it hangs off
 */
export function xeroPageOrigin({ page }: { page: XeroBrowserPage }): string {
  if (page.root === "account") {
    return XERO_ACCOUNT_ORIGIN;
  }
  if (page.root === "reporting") {
    return XERO_REPORTING_ORIGIN;
  }
  return XERO_WEB_ORIGIN;
}

const XERO_SETTINGS_AND_ACCOUNT_PAGES: readonly XeroBrowserPage[] = [
  {
    description: "the organisation settings hub at the original web root",
    family: "api.xro/2.0:Organisation",
    path: "Settings",
    query: {},
    root: "origin",
    surface: "settings",
  },
  {
    description: "the organisation settings hub at the form the client migrated to",
    family: "api.xro/2.0:Organisation",
    path: "organisationsettings",
    query: {},
    root: "origin",
    surface: "organisation-settings",
  },
  {
    description: "the organisation's own details — name, address, financial year, tax registration",
    family: "api.xro/2.0:Organisation",
    path: "Settings/Organisation.aspx",
    query: {},
    root: "origin",
    surface: "organisation-details",
  },
  {
    description: "the user list and each user's role — who can see and change these books",
    family: "api.xro/2.0:Users",
    path: "Settings/Users.aspx",
    query: {},
    root: "origin",
    surface: "settings-users",
  },
  {
    description: "the tax rates these books post against, and their component tax components",
    family: "api.xro/2.0:TaxRates",
    path: "Settings/TaxRates.aspx",
    query: {},
    root: "origin",
    surface: "settings-tax-rates",
  },
  {
    description: "tracking categories, which are how these books split spend by team or site",
    family: "api.xro/2.0:TrackingCategories",
    path: "Settings/Tracking.aspx",
    query: {},
    root: "origin",
    surface: "settings-tracking",
  },
  {
    description: "currencies enabled on this organisation",
    family: "api.xro/2.0:Currencies",
    path: "Settings/Currencies.aspx",
    query: {},
    root: "origin",
    surface: "settings-currencies",
  },
  {
    description: "invoice branding themes",
    family: "api.xro/2.0:BrandingThemes",
    path: "Settings/BrandingThemes.aspx",
    query: {},
    root: "origin",
    surface: "settings-branding",
  },
  {
    description: "payment services configured for online invoice payment",
    family: "api.xro/2.0:PaymentServices",
    path: "Settings/PaymentServices.aspx",
    query: {},
    root: "origin",
    surface: "settings-payment-services",
  },
  {
    description: "the connected-apps list — every third-party application with access to these books",
    family: null,
    path: "Settings/ConnectedApps.aspx",
    query: {},
    root: "origin",
    surface: "settings-connected-apps",
  },
  {
    description: "the connected-apps list on Xero's own app hub, which is where the client now sends it",
    family: null,
    path: "connected-apps",
    query: {},
    root: "account",
    surface: "account-connected-apps",
  },
  {
    description:
      "the subscription and billing surface — which plan these books are on, which is a spend fact about Xero itself",
    family: null,
    path: "subscriptions",
    query: {},
    root: "account",
    surface: "account-subscriptions",
  },
  {
    description: "the organisation chooser — every organisation this login can switch to, which bounds the atlas",
    family: null,
    path: "organisations",
    query: {},
    root: "account",
    surface: "account-organisations",
  },
  {
    description: "the signed-in account's own profile at the account hub",
    family: null,
    path: "profile",
    query: {},
    root: "account",
    surface: "account-profile",
  },
  {
    description: "the account hub's own landing page, which lists what the login itself can reach",
    family: null,
    path: "",
    query: {},
    root: "account",
    surface: "account-home",
  },
];

/**
 * Every page the browser channel walks.
 *
 * Ordered by area rather than by root, so a reader scanning the published generation sees the product
 * rather than the URL migration. Each row names the family it shows where it shows one, which is the join
 * `families.ts` needs to answer "and where do I go to look at it".
 */
export const XERO_BROWSER_PAGES: readonly XeroBrowserPage[] = [
  ...XERO_BOOKKEEPING_PAGES,
  ...XERO_SETTINGS_AND_ACCOUNT_PAGES,
];

/*
 * Three surfaces deliberately absent, stated rather than silently omitted.
 *
 * `login.xero.com/identity/user/security` is a real page and is not declared, because that origin is this
 * walk's LOST-SESSION signal (`isSignInOrigin`) and a declared page on it would make the signal ambiguous —
 * a page that legitimately settles there is indistinguishable from a session that ended. Account security
 * is reachable from the account hub, which `account-profile` covers.
 *
 * `/logout` ends the session the walk is using and every route after it, which makes it an ACTION rather
 * than a page.
 *
 * The plan-upgrade funnel is a purchase flow: visiting it is a read today, but a route whose whole purpose
 * is to start a transaction is exactly the kind this file's fourth rule exists to keep out, and
 * `account-subscriptions` already carries what the atlas wants to know about the commercial state. If the
 * owner wants it photographed, it belongs here with that decision recorded, not added quietly.
 */
