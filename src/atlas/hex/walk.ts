/**
 * Walk the Hex web app in the owner's own Chrome, photograph each page, and record what its client asked for.
 *
 * ## The denominator is the product's own router, and it is a CEILING rather than a floor
 *
 * `browserPages.ts` carries the long version: the declared pages are the static route templates compiled
 * out of the JavaScript Hex serves, so the walk is judged against a list it did not choose and could not
 * have grown by crawling. This is the opposite of the sibling Twilio atlas, whose documentation-harvested
 * route list is explicitly a floor. A route this walk finds rendered that is NOT in the compiled list is
 * therefore a real finding — the shipped client grew a page between the last generation and this walk — so
 * the frontier is still followed and each discovered route records which page's link found it.
 *
 * ## Declared, reachable and openable are three different things
 *
 * A declared page may 404, may bounce to the sign-in wall, or may be gated behind a role this account does
 * not hold. Every one of those is a COMPLETED attempt against a real route, recorded on the page's own row
 * — never a walk failure, and never a page silently credited to wherever it landed.
 *
 * ## The sign-in wall is on the SAME ORIGIN as every page, which no sibling walk has to handle
 *
 * Twilio's console bounces a signed-out visitor to `www.twilio.com/login`, a different host, so its walk
 * can grade the wall by origin. Hex serves the wall at `app.hex.tech/login` — the same origin as every
 * declared page, and `/login` is itself one of the declared routes. So an origin test cannot see it, and a
 * path test that did not know which route was ASKED FOR would grade a deliberate visit to `/login` as
 * proof that nobody is signed in. {@link isSignInWall} therefore takes the requested route as well as the
 * capture: landing on `/login` having asked for `/login` is a page that landed; landing on it having asked
 * for anything else is the wall.
 *
 * A walk that hits the wall STOPS rather than driving the owner's visible browser to the same login page forty
 * times to establish one fact. The remaining routes are recorded `not-attempted`, which is honest about
 * what was and was not tried, and the short-circuit is falsifiable in the obvious way: if a later route
 * WOULD have landed, the session was not uniformly signed out, and {@link isSignedOut} — which requires
 * that no page was reached — would not be set.
 *
 * ## A page without its screenshot is NOT credited
 *
 * `docs/atlas-intent/05-browser-proof.md` makes the stored screenshot load-bearing — the atlas holds the image so an
 * agent can look at a page without piloting a browser to it. A row that says a page landed while holding no
 * picture of it is a claim the atlas cannot back, so the outcome becomes `unphotographed` and the shortfall
 * is a named gap.
 *
 * ## Everything here is written against a seam
 *
 * `browser/pageTransport.ts` is the whole contract: `visit` and `release`. The walk and the artifact
 * writing run against a deterministic fake in tests, so a redirect, a sign-in wall, a lost body and a
 * missing screenshot are settled by unit tests rather than by luck in a live run.
 */
import { type BrowserPageTransport, isRedirected, type PageCapture } from "../../browser/pageTransport.js";
import { noteSignInWall } from "../../browser/signInWalls.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasArtifactWriter } from "../kit/artifactWriter.js";
import type { FrontierPageObservation, FrontierPageOutcome, FrontierWalkResult } from "../kit/frontierContract.js";
import { runFrontierWalk, wasReached } from "../kit/frontierWalk.js";

import { HEX_APP_ORIGIN, hexAppUrl, hexDeclaredPages, isHexAppPath } from "./browserPages.js";
import { isFirstPartyHexResponse } from "./webReduction.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * @internal
 */
export const PAGE_SETTLE_MS = 2_500;

/**
 * The route the app serves its sign-in wall at, and one of its own declared pages.
 *
 * @internal
 */
export const HEX_SIGN_IN_ROUTE = "/login";

/**
 * How many frontier rounds a walk runs, the compiled route list being the first.
 *
 * Three, which is what it takes to reach a leaf from a section landing page in an app two levels deep, and
 * low enough that a walk cannot silently become a crawl of the whole product.
 *
 * @internal
 */
export const MAX_FRONTIER_ROUNDS = 3;

/**
 * How many CONSECUTIVE lost sessions end the walk, rather than one.
 *
 * Two, and the reason is a property of this product rather than a tolerance. MEASURED twice on
 * the owner's signed-in app: the walk died at `/login-success` both times, at the same route, having landed
 * pages either side of it — the transport reported `Target page, context or browser has been closed`. That
 * route is an OAuth completion page, and a completion page closes its own tab. A page that closes the
 * browser is a property of the PAGE; the owner closing Chrome is a property of the SESSION, and a single
 * `SESSION_LOST` cannot tell them apart.
 *
 * Aborting on the first one cost every declared route after it on both runs, recorded `not-attempted` — a real
 * coverage hole caused by one page. So the walk takes ONE more route before deciding, and a visit that
 * succeeds resets the count.
 *
 * **MEASURED on the third run, and it did NOT recover — stated because a rule whose effect nobody checked
 * is the failure this file's other measurements exist to prevent.** The second attempt failed with the
 * identical message, still naming `/login-success`: the transport made the first `SESSION_LOST` sticky, so
 * the extra route bought nothing, and every scheduled `automation resync --atlas hex` failed on it until the extra route was dropped.
 * The transport now recovers the page itself (`browser/selfClosedGrade.ts`'s `selfClosedTabRecovery`): a page that
 * closes a freshly attached tab too is graded `failed` on its own row and the walk continues in a new tab, so
 * `/login-success` no longer reaches this count at all. The rule stays for what still does — a relay that
 * will not come back — and {@link HexWalkResult.sessionEndedAt} still names the route that reported it, so
 * the remaining `not-attempted` routes have a cause rather than a silence.
 *
 * @internal
 */
export const MAX_CONSECUTIVE_SESSION_LOSSES = 2;

/**
 * How one visited app page's outcome is graded. Kit-owned and closed — see `kit/frontierContract.ts`.
 *
 * @internal
 */
export type HexPageOutcome = FrontierPageOutcome;

/**
 * What one app page's visit came to. Kit-owned — see `kit/frontierContract.ts`.
 *
 * @internal
 */
export type HexPageObservation = FrontierPageObservation;

/** One first-party call the app made while a page rendered. */
export interface ObservedHexCall {
  readonly body: unknown;
  readonly method: string;
  /** The declared route that was open when this call was made. */
  readonly onPage: string;
  readonly statusCode: number;
  readonly url: string;
}

/** What the walk produced: the kit's own accounting plus the one verdict that is Hex's. */
export interface HexWalkResult extends FrontierWalkResult<ObservedHexCall> {
  /**
   * Whether the app is signed out: at least one route settled on the wall and NO route landed.
   *
   * Not "every page hit the wall", because the walk stops at the first one — with the short-circuit, that
   * predicate would be trivially true of a one-page walk and could never distinguish a signed-out app from
   * a walk that visited one page and failed differently.
   */
  readonly signedOut: boolean;
}

/**
 * Where a line of progress goes.
 *
 * @internal
 */
export type HexWalkProgress = (input: { line: string }) => void;

/**
 * Whether the browser settled on the app origin the walk asked for.
 *
 * Checked separately from {@link isRedirected} because a status code cannot answer it: a single-page
 * application asked for a route it does not have can land elsewhere and answer HTTP 200 with a real title.
 *
 * @param capture what the transport returned
 * @returns whether the final URL is still on the app origin
 */
export function settledOnApp({ capture }: { capture: PageCapture }): boolean {
  try {
    return new URL(capture.finalUrl).origin === new URL(HEX_APP_ORIGIN).origin;
  } catch {
    return false;
  }
}

/**
 * Whether a capture is Hex's sign-in wall rather than the page that was asked for.
 *
 * Takes the requested ROUTE as well as the capture, and that is the whole point — see this file's header.
 * The wall lives on the same origin as every declared page and at a route this atlas declares, so a test
 * that looked only at where the browser landed would report the owner signed out every time the walk
 * visited `/login` on purpose.
 *
 * @param capture what the transport returned
 * @param route the declared route that was asked for
 * @returns whether the browser ended on the sign-in wall having asked for something else
 */
export function isSignInWall({ capture, route }: { capture: PageCapture; route: string }): boolean {
  if (route === HEX_SIGN_IN_ROUTE) {
    return false;
  }
  try {
    const parsed = new URL(capture.finalUrl);
    // The path must BE the wall, not merely start with it. `/login-success` is a declared route of its own
    // and a prefix test grades it as the wall — which, because the walk stops at the first wall, aborts the
    // whole run and records every remaining route `not-attempted`. MEASURED against the owner's
    // signed-in app: a prefix test ended a live walk partway through, on a page that had loaded fine.
    return (
      settledOnApp({ capture }) &&
      (parsed.pathname === HEX_SIGN_IN_ROUTE || parsed.pathname.startsWith(`${HEX_SIGN_IN_ROUTE}/`))
    );
  } catch {
    return false;
  }
}

/**
 * How one visited page's outcome is graded.
 *
 * The sign-in wall is checked FIRST and before the redirect test, because it IS a redirect and grading it
 * as one would bury the single fact a reader needs under forty rows.
 *
 * @param capture what the transport returned
 * @param route the declared route that was asked for
 * @returns the outcome to record on the page's row
 */
export function outcomeOf({ capture, route }: { capture: PageCapture; route: string }): HexPageOutcome {
  if (isSignInWall({ capture, route })) {
    return "signed-out";
  }
  if (capture.statusCode !== null && capture.statusCode >= 400) {
    return "unavailable";
  }
  if (!settledOnApp({ capture }) || isRedirected({ capture })) {
    return "redirected";
  }
  return capture.screenshotPng === null ? "unphotographed" : "landed";
}

/**
 * Whether the app is signed out: at least one route hit the wall and none was reached. An `unphotographed`
 * page counts as reached — it rendered behind the session and only lost its picture.
 *
 * @param pages every page the walk observed
 * @returns whether this walk establishes that nobody is signed in
 */
export function isSignedOut({ pages }: { pages: readonly HexPageObservation[] }): boolean {
  return pages.some((page) => page.outcome === "signed-out") && !pages.some((page) => wasReached(page));
}

/**
 * Walk the compiled static routes, then whatever the landed pages themselves rendered.
 *
 * Everything mechanical — the rounds, the seen set, the screenshot verification, the accounting and the
 * lost-session stop — is `kit/frontierWalk.ts`. What is passed in below is exactly what is Hex's: how a
 * route becomes a URL, how a settled page is graded, which responses are Hex answering, and that the
 * sign-in wall ends the walk.
 *
 * @param transport the browser seam — Playwright over the owner's own Chrome in production, a deterministic
 *   fake in tests
 * @param writeArtifact where a screenshot's bytes are written
 * @param progress where a line per page goes
 * @returns everything the walk observed, or the reason it could not start
 */
export async function walkHexApp({
  transport,
  writeArtifact,
  progress,
}: {
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  progress: HexWalkProgress;
}): Promise<Result<HexWalkResult>> {
  const walked = await runFrontierWalk<ObservedHexCall>({
    spec: {
      artifactDirectory: "artifacts/pages",
      callFrom: ({ response, route }) => ({
        body: response.body,
        method: response.method,
        onPage: route,
        statusCode: response.statusCode,
        url: response.url,
      }),
      declaredRoutes: hexDeclaredPages(),
      gradeOutcome: ({ capture, route }) => outcomeOf({ capture, route }),
      isFirstParty: ({ response }) => isFirstPartyHexResponse({ response }),
      maxConsecutiveSessionLosses: MAX_CONSECUTIVE_SESSION_LOSSES,
      maxRounds: MAX_FRONTIER_ROUNDS,
      progress,
      routesRenderedBy: ({ capture }) => renderedRoutes({ capture }),
      settleMs: PAGE_SETTLE_MS,
      urlFor: ({ route }) => hexAppUrl({ route }),
    },
    // The wall ends the walk rather than costing one page: driving the owner's visible browser to the same login
    // page forty times establishes one fact forty times. The short-circuit is falsifiable in the obvious
    // way — if a later route WOULD have landed, `isSignedOut` would not be set.
    stopAfter: ({ page }) => page.outcome === "signed-out",
    transport,
    writeArtifact,
  });
  if (walked.isErr()) {
    return err(walked.error);
  }
  const signedOut = isSignedOut({ pages: walked.value.pages });
  // The verb still publishes the gap and exits 0, so the wall is the only thing a scheduled resync can fail
  // the attempt on and card the owner's sign-in from (`browser/signInWalls.ts`). Noted from the WALK's verdict rather
  // than per capture, so a partly signed-out walk that landed pages is never carded as signed out.
  if (signedOut) {
    noteSignInWall({ origin: HEX_APP_ORIGIN });
  }
  return ok({ ...walked.value, signedOut });
}

/**
 * Every app route one page's rendered links point at.
 *
 * @param capture what the transport returned
 * @returns the routes, sorted
 */
function renderedRoutes({ capture }: { capture: PageCapture }): readonly string[] {
  const routes = new Set<string>();
  for (const href of capture.links) {
    try {
      const parsed = new URL(href, HEX_APP_ORIGIN);
      if (parsed.origin === new URL(HEX_APP_ORIGIN).origin && isHexAppPath({ path: parsed.pathname })) {
        routes.add(parsed.pathname);
      }
    } catch {
      continue;
    }
  }
  return [...routes].toSorted();
}
