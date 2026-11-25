/**
 * Every page of the Twilio console this atlas declares, and the region substitution that keeps the
 * declaration free of an installation identifier.
 *
 * ## The denominator is DECLARED and its provenance is checkable
 *
 * A crawler cannot prove its own completeness — "we visited everything we found" is a claim about the
 * crawler. So a walk is judged against {@link TWILIO_CONSOLE_ROUTES}, a list it did not choose. What is
 * Twilio's own problem is that it publishes no authenticated console sitemap and renders its navigation in
 * a single-page application rather than in HTML, so the list cannot be read off the product the way the
 * Falcon one is.
 *
 * The answer is that every declared route was HARVESTED from Twilio's own documentation and carries the
 * doc page that named it — `generated/consoleRoutes.ts` holds the rows and the reproduction command. A
 * route list written from memory would look exactly the same and be unfalsifiable.
 *
 * **It is a FLOOR rather than a ceiling, and this atlas says so rather than implying otherwise.** Twilio's
 * documentation names these routes; the console certainly has more, and a signed-in walk is the only thing
 * that can find them. `walk.ts` therefore expands the declared list with the navigation each landed page
 * renders, so the floor rises as pages are reached, and the two numbers are reported separately.
 *
 * ## Why the routes carry a placeholder rather than a region
 *
 * Most console routes are prefixed with the account's home region — `console.twilio.com/us1/...` — and the
 * region an account lives in is an installation fact this repository does not carry. So a declared route
 * holds `{region}` and the walk substitutes what it discovers at run time from where the console settles.
 *
 * ## What is declared, and what deliberately is not
 *
 * `docs/atlas-intent/05-browser-proof.md` and `docs/atlas-intent/06-holdings.md` draw the line: every settings and
 * admin page is declared and photographed, every list surface is declared as ONE page rather than one page per row, and
 * no record gets a route of its own. A walk never pilots a browser to photograph every message ever sent; that is the
 * Slack form of the same rule; a Twilio message log entry is that message, and the two harvested routes naming one
 * marketplace add-on by SID are dropped for the same reason.
 */
import { TWILIO_CONSOLE_ROUTES } from "./generated/consoleRoutes.js";

/** Where the Twilio console lives. A route settling on any other origin has not been reached. */
export const TWILIO_CONSOLE_ORIGIN = "https://console.twilio.com";

/** The placeholder a declared route carries where the account's home region goes. */
export const TWILIO_REGION_PLACEHOLDER = "{region}";

/**
 * The region assumed when a walk has not yet discovered the account's own.
 *
 * `us1` because it is Twilio's default home region and the one its documentation writes by default. A walk
 * that lands anywhere else records the region it actually settled on, so this is a starting guess rather
 * than a claim — and a walk that had to use it says so.
 */
export const TWILIO_DEFAULT_REGION = "us1";

/**
 * One page this atlas declares the console has.
 * @internal
 */
export interface TwilioConsoleRoute {
  /** The documentation pages that named this route — its provenance, and what makes the list checkable. */
  readonly citedBy: readonly string[];
  /** The path, with `{region}` where the home region goes. Also this page's provider id. */
  readonly route: string;
  /** Twilio's own top-level grouping — `develop`, `monitor`, `account`, `organization`, `user`. */
  readonly section: string;
}

/**
 * Every declared page, sorted by route.
 *
 * Generated rather than hand-written; see this file's header and the generated module's own.
 */
export const TWILIO_BROWSER_PAGES: readonly TwilioConsoleRoute[] = TWILIO_CONSOLE_ROUTES;

/**
 * The absolute URL one declared route resolves to for a given home region.
 *
 * @param route the declared route, `{region}` placeholder intact
 * @param region the account's home region, as the walk discovered it
 * @returns the absolute console URL to visit
 */
export function twilioConsoleUrl({ route, region }: { route: string; region: string }): string {
  return `${TWILIO_CONSOLE_ORIGIN}${route.replace(TWILIO_REGION_PLACEHOLDER, region)}`;
}

/**
 * Whether one path is a console surface this atlas would declare, so a walk can judge a rendered link.
 *
 * A path is in scope when it is not the root and carries at least one segment past any region prefix. The
 * test is deliberately shallow: the walk's job is to notice what the console's own navigation offers, and a
 * narrower filter here would silently shrink the frontier that exists to widen the floor.
 *
 * @param path the path to judge, leading slash included
 * @returns whether a walk should treat it as a console page
 */
export function isConsolePath({ path }: { path: string }): boolean {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.length > 0;
}

/**
 * The declared route one absolute or relative console path corresponds to, region folded back out.
 *
 * @param path the path a page rendered, leading slash included
 * @returns the path with its region prefix replaced by the placeholder
 */
export function toDeclaredRoute({ path }: { path: string }): string {
  const match = /^\/(us|ie|au|jp|br|sg|de)\d\//.exec(path);
  if (match === null) {
    return path;
  }
  return `/${TWILIO_REGION_PLACEHOLDER}/${path.slice(match[0].length)}`;
}
