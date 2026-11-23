/**
 * Where the Clerk dashboard lives, how one declared page's address is built, and how a landing address or a
 * page's own traffic yields the instance root a walk hangs its instance pages off.
 *
 * The rules this module enforces — the identifiers are never written down, and landing on the sign-in origin
 * is a lost session rather than a page failure — are stated once, in `browserPages.ts`'s header, beside the
 * declared page list they govern. This module imports nothing, so that list can import its page type from here.
 */

/** The origin the Clerk dashboard is served from. */
export const CLERK_DASHBOARD_ORIGIN = "https://dashboard.clerk.com";

/**
 * The bare path a walk asks for FIRST, purely to learn the instance root from where the client sends it.
 *
 * The origin root rather than a named page, because a signed-in dashboard redirects it to whatever
 * application and instance it last showed — and whatever that is, it carries the two segments this atlas
 * needs and must not store.
 */
export const CLERK_INSTANCE_PROBE_PATH = "/";

/**
 * The host Clerk sends a signed-out dashboard browser to.
 *
 * Checked before every other reachability rule, because a sign-in wall is a SUCCESSFUL navigation and would
 * otherwise be graded as forty independent page failures.
 *
 * @internal
 */
export const CLERK_SIGN_IN_HOST_SUFFIX = ".accounts.dev";

/**
 * The path prefix a dashboard sign-in route carries on the dashboard's own origin.
 *
 * Clerk fronts the dashboard's sign-in with its own account portal, which may settle either on a separate
 * accounts host or on `dashboard.clerk.com/sign-in`. Both are the same fact — this session is signed out —
 * so both are tested.
 *
 * @internal
 */
export const CLERK_SIGN_IN_PATH_PREFIX = "/sign-in";

/**
 * Where a declared path hangs off.
 *
 * - `account` — `dashboard.clerk.com/<path>`: the shell that spans every application, which needs no root
 *   and is therefore reachable even when the instance probe finds nothing.
 * - `instance` — `dashboard.clerk.com/apps/<application>/instances/<instance>/<path>`, learned at run time
 *   and never written down.
 */
type ClerkPageRoot = "account" | "instance";

/** One page of the Clerk dashboard this atlas walks. */
export interface ClerkBrowserPage {
  /** The surface name its coverage cell and its entity are reported under. Unique across this list. */
  readonly surface: string;
  /** Which root {@link path} hangs off. */
  readonly root: ClerkPageRoot;
  /** The path beneath that root, with no leading slash. */
  readonly path: string;
  /**
   * Which API family this page is the human face of, or `null` when it shows none.
   *
   * This is the join that makes an operation row able to say WHERE a human goes to see it —
   * `docs/atlas-intent/05-browser-proof.md`'s whole point, and the thing that turns "instance settings" from an endpoint
   * into an address somebody can open and screenshot.
   */
  readonly showsPathPrefix: string | null;
  readonly description: string;
}

/**
 * Whether the browser settled on a Clerk sign-in wall, whatever it was asked for.
 *
 * @param finalUrl where the browser actually settled
 * @returns whether this session is signed out
 */
export function isClerkSignInUrl({ finalUrl }: { finalUrl: string }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return false;
  }
  if (parsed.hostname.toLowerCase().endsWith(CLERK_SIGN_IN_HOST_SUFFIX)) {
    return true;
  }
  return parsed.pathname.startsWith(CLERK_SIGN_IN_PATH_PREFIX);
}

/**
 * The instance root a signed-in dashboard landed on: `/apps/<application>/instances/<instance>`.
 *
 * The ONLY place either identifier exists in this process, and it never leaves the walk: the root is used
 * to build a URL to visit, and `kit/pageWalk.ts` deliberately does not carry it out of the walk for exactly
 * this reason.
 *
 * @param finalUrl where the client sent the bare origin
 * @returns the root path with no trailing slash, or `null` when the landing URL carries no instance
 */
export function clerkInstanceRootFromFinalUrl({ finalUrl }: { finalUrl: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return null;
  }
  const matched = /^\/apps\/[^/]+\/instances\/[^/]+/.exec(parsed.pathname);
  return matched === null ? null : matched[0];
}

/**
 * The account-level page the root probe falls back to when the bare origin lands nowhere useful.
 *
 * The application list always exists for a signed-in account, and it renders itself from the dashboard's
 * own API — so its traffic carries the two identifiers the origin redirect only sometimes does.
 *
 * @internal
 */
export const CLERK_APPLICATIONS_PROBE_PATH = "/apps";

/** A Clerk application identifier, as it appears in a URL or in the dashboard API's own response body. */
const APPLICATION_ID = /\bapp_[A-Za-z0-9]{16,}\b/;

/** A Clerk instance identifier, in the same two places. */
const INSTANCE_ID = /\bins_[A-Za-z0-9]{16,}\b/;

/**
 * How deep a body scan descends before it stops, so a pathological payload cannot walk forever.
 *
 * @internal
 */
export const CLERK_ROOT_SCAN_DEPTH = 6;

/**
 * The instance root, recovered from what the application-list page ASKED FOR and what came back.
 *
 * MEASURED on the first real walk, and this exists because of it: the bare origin redirects to
 * whichever page the dashboard was last left on, so a session that last looked at the application list gets
 * sent back to the application list — and the declared pages hanging off the instance root were recorded as
 * having no root to hang off, which is a true statement about the probe and a false one about the account. A probe whose answer
 * depends on where somebody's browser was last pointed is not a probe.
 *
 * The identifiers are read, used to build a URL, and never stored: they identify the organisation's own
 * Clerk application, which `browserPages.ts` may not carry. That is the same posture
 * {@link clerkInstanceRootFromFinalUrl} has, applied to a second source.
 *
 * @param urls every URL the page's own client asked for
 * @param bodies every response body it got back
 * @returns the root path, or `null` when neither identifier could be found
 */
export function clerkInstanceRootFromTraffic({
  urls,
  bodies,
}: {
  urls: readonly string[];
  bodies: readonly unknown[];
}): string | null {
  const haystack = [...urls, ...bodies.flatMap((body) => scanStrings({ depth: CLERK_ROOT_SCAN_DEPTH, value: body }))];
  const application = haystack.map((text) => APPLICATION_ID.exec(text)?.[0]).find((found) => found !== undefined);
  const instance = haystack.map((text) => INSTANCE_ID.exec(text)?.[0]).find((found) => found !== undefined);
  if (application === undefined || instance === undefined) {
    return null;
  }
  return `/apps/${application}/instances/${instance}`;
}

/**
 * Every string a parsed body carries, to a bounded depth.
 *
 * Generic rather than keyed on Clerk's own response shape, deliberately: the shape of the application list
 * is not documented anywhere this atlas pins, so a reader written against today's field names would be a
 * silent dependency on an undocumented payload. A scan for the identifier PATTERN depends on nothing but
 * the prefix Clerk puts on every object it mints.
 */
function scanStrings({ value, depth }: { value: unknown; depth: number }): readonly string[] {
  if (depth <= 0) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => scanStrings({ depth: depth - 1, value: entry }));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((entry) => scanStrings({ depth: depth - 1, value: entry }));
  }
  return [];
}

/**
 * The absolute URL for one declared page.
 *
 * @param page the declared page
 * @param instanceRoot the root learned at run time, or `null` when the probe found none
 * @returns the URL to visit, or `null` when this page needs a root there is none of
 */
export function clerkPageUrl({
  page,
  instanceRoot,
}: {
  page: ClerkBrowserPage;
  instanceRoot: string | null;
}): string | null {
  if (page.root === "account") {
    return `${CLERK_DASHBOARD_ORIGIN}/${page.path}`;
  }
  if (instanceRoot === null) {
    return null;
  }
  return `${CLERK_DASHBOARD_ORIGIN}${instanceRoot}/${page.path}`;
}
