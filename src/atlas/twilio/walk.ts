/**
 * Walk Twilio's console in the owner's own Chrome, photograph each page, and record what its client asked
 * for.
 *
 * ## The denominator is a declared FLOOR that this walk raises
 *
 * `browserPages.ts` carries the long version: Twilio publishes no authenticated console sitemap and renders
 * its navigation in a single-page application, so the declared routes are harvested from Twilio's own
 * documentation. That list is checkable and it is a floor rather than a ceiling. This walk starts from it
 * and keeps every console link each landed page RENDERED, so pages Twilio's documentation never mentions
 * become reachable once a page has actually been seen. Each page records which page its link came from, so
 * the frontier is reconstructable from the generation rather than being a property of a run nobody kept.
 *
 * ## Declared, reachable and openable are three different things
 *
 * A declared page may 404, may redirect to the sign-in wall, or may be gated behind a role this account
 * does not hold. Every one of those is a COMPLETED attempt against a real route, recorded on the page's own
 * row — never a walk failure, and never a page silently credited to wherever it landed.
 *
 * **The sign-in wall is its own outcome, and it is no longer the expected one.** MEASURED,
 * `console.twilio.com` in the owner's own work Chrome redirected to `www.twilio.com/login` with an empty
 * email field; MEASURED AGAIN after the owner signed in, the same walk landed and photographed pages
 * in region `us1` from the declared routes plus those the rendered navigation discovered. The
 * `signed-out` grade stays because a session can be lost again and the third state — looked, reached
 * nothing — is not derivable from the other two. A walk in that state raises ONE gap naming the wall rather
 * than eighty rows each claiming a different reason for the same fact. Grading those as `redirected` would
 * be true and useless: a reader would see eighty redirects and have to work out for themselves that they
 * are one sign-in.
 *
 * ## A first-party call is judged by Twilio's DOMAIN, never by the console's origin
 *
 * The console renders its pages out of thirty-eight Twilio hosts, so origin-equality — which is the kit's
 * default and is exact on a single-host console — discards almost everything this walk sees.
 * `webReduction.ts`'s `isFirstPartyTwilioResponse` carries the measurement that settles it: the signed-in walk
 * captured the JSON bodies its pages' clients fetched, and the origin test admitted only those served from
 * the console's own host, collapsing the observed surface to whatever that one host happens to answer.
 *
 * **And it STOPS on the first one.** A sign-in wall is a property of the SESSION rather than of a route, so
 * the second route through it carries no information the first did not — and the cost is not abstract: this
 * walk drives the owner's real, visible browser, so eighty navigations to a login page is eighty seconds of
 * the owner's window being taken over to establish one fact. The remaining routes are recorded `not-attempted`,
 * which is the same vocabulary a lost session uses and is honest about what was and was not tried. The
 * short-circuit is falsifiable in the obvious way: if a later route WOULD have landed, the session was not
 * uniformly signed out, and `signedOut` — which requires that no page landed — would not be set.
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

import { absentAsNull } from "#lib/absent.js";
import { type BrowserPageTransport, isRedirected, type PageCapture } from "../../browser/pageTransport.js";
import { noteSignInWall } from "../../browser/signInWalls.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasArtifactWriter } from "../kit/artifactWriter.js";
import type { FrontierPageObservation, FrontierPageOutcome, FrontierWalkResult } from "../kit/frontierContract.js";
import { runFrontierWalk, wasReached } from "../kit/frontierWalk.js";
import {
  isConsolePath,
  TWILIO_BROWSER_PAGES,
  TWILIO_CONSOLE_ORIGIN,
  TWILIO_DEFAULT_REGION,
  toDeclaredRoute,
  twilioConsoleUrl,
} from "./browserPages.js";
import { isFirstPartyTwilioResponse, TWILIO_REGISTRABLE_DOMAIN } from "./webReduction.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * @internal
 */
export const PAGE_SETTLE_MS = 2_500;

/**
 * How many frontier rounds a walk runs, the declared floor being the first.
 *
 * Three, which is what it takes to reach a leaf from a section landing page in a console two levels deep,
 * and low enough that a walk cannot silently become a crawl of the whole product.
 *
 * @internal
 */
export const MAX_FRONTIER_ROUNDS = 3;

/**
 * How one visited console page's outcome is graded. Kit-owned and closed — see `kit/frontierContract.ts`.
 *
 * @internal
 */
export type ConsolePageOutcome = FrontierPageOutcome;

/**
 * What one console page's visit came to. Kit-owned — see `kit/frontierContract.ts`.
 *
 * @internal
 */
export type ConsolePageObservation = FrontierPageObservation;

/** One first-party call the console made while a page rendered. */
export interface ObservedConsoleCall {
  readonly body: unknown;
  readonly method: string;
  /** The declared route that was open when this call was made. */
  readonly onPage: string;
  readonly statusCode: number;
  readonly url: string;
}

/** What the walk produced: the kit's own accounting plus the two facts that are Twilio's. */
export interface TwilioWalkResult extends FrontierWalkResult<ObservedConsoleCall> {
  /** The home region the walk actually settled in, or the default when nothing said otherwise. */
  readonly region: string;
  /**
   * Whether the console is signed out: at least one route settled on the wall and NO route landed.
   *
   * Not "every page hit the wall", because the walk stops at the first one — with the short-circuit, that
   * predicate would be trivially true of a one-page walk and could never distinguish a signed-out console
   * from a walk that visited one page and failed differently.
   */
  readonly signedOut: boolean;
}

/**
 * Where a line of progress goes.
 *
 * @internal
 */
export type TwilioWalkProgress = (input: { line: string }) => void;

/**
 * Whether the browser settled on the console origin the walk asked for.
 *
 * Checked separately from {@link isRedirected} because a status code cannot answer it. A single-page
 * application asked for a route it does not have can land on the vendor's PUBLIC site and answer HTTP 200
 * with a real page title — which is exactly what Twilio does, since the sign-in wall lives on
 * `www.twilio.com` rather than on the console origin.
 *
 * @param capture what the transport returned
 * @returns whether the final URL is still on the console origin
 */
export function settledOnConsole({ capture }: { capture: PageCapture }): boolean {
  try {
    return new URL(capture.finalUrl).origin === new URL(TWILIO_CONSOLE_ORIGIN).origin;
  } catch {
    return false;
  }
}

/**
 * Whether a capture is the Twilio sign-in wall rather than the page that was asked for.
 *
 * Matched on the login PATH rather than on a title or a body, because those are localised and change with
 * every marketing refresh while the address is the product's own contract. MEASURED: the console
 * sends a signed-out visitor to `https://www.twilio.com/login?g=…`.
 *
 * The host is matched at a DOT BOUNDARY rather than by suffix, and CodeQL caught the first version doing
 * the latter (`js/incomplete-url-substring-sanitization`, alert 40). `endsWith("twilio.com")` is also true
 * of `eviltwilio.com`, so a page that had landed on a lookalike host would have been graded as Twilio's own
 * sign-in wall — which on this walk means recording that the owner is signed out and stopping, on the word
 * of somebody else's domain.
 *
 * @param capture what the transport returned
 * @returns whether the browser ended on Twilio's sign-in wall
 */
export function isSignInWall({ capture }: { capture: PageCapture }): boolean {
  try {
    const parsed = new URL(capture.finalUrl);
    const onTwilio =
      parsed.hostname === TWILIO_REGISTRABLE_DOMAIN || parsed.hostname.endsWith(`.${TWILIO_REGISTRABLE_DOMAIN}`);
    return onTwilio && parsed.pathname.startsWith("/login");
  } catch {
    return false;
  }
}

/**
 * How one visited page's outcome is graded.
 *
 * The sign-in wall is checked FIRST and before the origin test, because it is a redirect and grading it as
 * one would bury the single fact a reader needs under eighty rows. See this file's header.
 *
 * @param capture what the transport returned
 * @returns the outcome to record on the page's row
 */
export function outcomeOf({ capture }: { capture: PageCapture }): ConsolePageOutcome {
  if (isSignInWall({ capture })) {
    return "signed-out";
  }
  if (capture.statusCode !== null && capture.statusCode >= 400) {
    return "unavailable";
  }
  if (!settledOnConsole({ capture }) || isRedirected({ capture })) {
    return "redirected";
  }
  return capture.screenshotPng === null ? "unphotographed" : "landed";
}

/**
 * The home region a landed console URL reveals, or `null` when it carries none.
 *
 * @param finalUrl where the browser settled
 * @returns the region segment, or `null`
 */
export function regionOf({ finalUrl }: { finalUrl: string }): string | null {
  try {
    const match = /^\/((?:us|ie|au|jp|br|sg|de)\d)\//.exec(new URL(finalUrl).pathname);
    return absentAsNull({ value: match?.[1] });
  } catch {
    return null;
  }
}

/**
 * Whether the console is signed out: at least one route hit the wall and none was reached. An
 * `unphotographed` page counts as reached — it rendered behind the session and only lost its picture.
 *
 * @param pages every page the walk observed
 * @returns whether this walk establishes that nobody is signed in
 *
 * @internal
 */
export function isSignedOut({ pages }: { pages: readonly ConsolePageObservation[] }): boolean {
  return pages.some((page) => page.outcome === "signed-out") && !pages.some((page) => wasReached(page));
}

/**
 * Every console route one page's rendered links point at, folded back to declared form.
 *
 * @param capture what the transport returned
 * @returns the declared routes, sorted
 */
function renderedRoutes({ capture }: { capture: PageCapture }): readonly string[] {
  const routes = new Set<string>();
  for (const href of capture.links) {
    try {
      const parsed = new URL(href, TWILIO_CONSOLE_ORIGIN);
      if (parsed.origin === new URL(TWILIO_CONSOLE_ORIGIN).origin && isConsolePath({ path: parsed.pathname })) {
        routes.add(toDeclaredRoute({ path: parsed.pathname }));
      }
    } catch {
      continue;
    }
  }
  return [...routes].toSorted();
}

/**
 * Walk the declared console routes, then whatever the landed pages themselves rendered.
 *
 * Everything mechanical — the rounds, the seen set, the screenshot verification, the accounting and the
 * lost-session stop — is `kit/frontierWalk.ts`. What is passed in below is exactly what is Twilio's: the
 * region the account lives in and how it is discovered, how a settled page is graded, which responses are
 * Twilio answering, and that the sign-in wall ends the walk.
 *
 * @param transport the browser seam — Playwright over the owner's own Chrome in production, a deterministic
 *   fake in tests
 * @param writeArtifact where a screenshot's bytes are written
 * @param progress where a line per page goes
 * @returns everything the walk observed, or the reason it could not start
 */
export async function walkTwilioConsole({
  transport,
  writeArtifact,
  progress,
}: {
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  progress: TwilioWalkProgress;
}): Promise<Result<TwilioWalkResult>> {
  // Mutable because it is DISCOVERED: most console routes are prefixed with the account's home region, and
  // the walk learns which one from where the first page settles. `browserPages.ts` carries why that is not
  // a constant this repository may hold.
  let region = TWILIO_DEFAULT_REGION;
  const walked = await runFrontierWalk<ObservedConsoleCall>({
    spec: {
      artifactDirectory: "artifacts/console",
      callFrom: ({ response, route }) => ({
        body: response.body,
        method: response.method,
        onPage: route,
        statusCode: response.statusCode,
        url: response.url,
      }),
      declaredRoutes: TWILIO_BROWSER_PAGES.map((page) => page.route),
      gradeOutcome: ({ capture }) => outcomeOf({ capture }),
      isFirstParty: ({ response }) => isFirstPartyTwilioResponse({ response }),
      maxConsecutiveSessionLosses: 1,
      maxRounds: MAX_FRONTIER_ROUNDS,
      observe: ({ capture }) => {
        const discovered = regionOf({ finalUrl: capture.finalUrl });
        if (discovered !== null) {
          region = discovered;
        }
      },
      progress,
      routesRenderedBy: ({ capture }) => renderedRoutes({ capture }),
      settleMs: PAGE_SETTLE_MS,
      urlFor: ({ route }) => twilioConsoleUrl({ region, route }),
    },
    // The wall ends the walk rather than costing one page: driving the owner's visible browser to the same login
    // page eighty times establishes one fact eighty times.
    stopAfter: ({ page }) => page.outcome === "signed-out",
    transport,
    writeArtifact,
  });
  if (walked.isErr()) {
    return err(walked.error);
  }
  const signedOut = isSignedOut({ pages: walked.value.pages });
  // The verb still publishes the gap and exits 0, so the wall is the only thing a scheduled resync can fail
  // the attempt on and card the owner's sign-in from (`browser/signInWalls.ts`).
  if (signedOut) {
    noteSignInWall({ origin: TWILIO_CONSOLE_ORIGIN });
  }
  return ok({ ...walked.value, region, signedOut });
}
