/**
 * Jam's own decisions about walking its application. The engine is `kit/pageWalk.ts`.
 *
 * What is genuinely this platform's, and nothing else: how to learn the team root a page hangs off, how to
 * grade where the browser settled, what a first-party call reduces to, that a settle on Jam's own sign-in
 * page means the session has ended, and how long to let a page settle. The declared/attempted/reached/
 * photographed accounting, the lost-session stop, the duplicate-picture check and the artifact addressing
 * are the kit's, because every one of them is a property a copy silently loses — and this walk was written
 * as a copy first, which is how the clone ratchet came to say so.
 *
 * ## The oracle needs TWO controls, because one compared to itself cannot fail
 *
 * A Codex review found the first cut's check was tautological: it compared the control to ITSELF, so it
 * established only that `/404` had been photographed and never that `/404` had rendered a not-found. The
 * walk now declares a second control at an invented route at the bare origin, anchors the band on THAT one
 * — it cannot become a real page — and requires the declared `/404` to fall inside it. If Jam ever starts
 * serving something real at `/404`, the two diverge and no page grading is published at all. It sat under the
 * team root until Jam began forwarding an unknown team route to `/404` itself (`browserPages.ts` has the
 * measurement), which left the control graded unreached and the resync refusing every run.
 *
 * ## Jam answers a route it does not have with HTTP 200, and does NOT rewrite the address
 *
 * That is the whole reason {@link regradeAgainstNotFoundControl} exists, and it is why the sibling Clerk
 * walk's approach does not transfer. Clerk rewrites an unrecognised route to its instance overview, so a
 * path comparison catches it. Jam renders its own not-found — "No Jam here :(" — IN PLACE, at HTTP 200,
 * with no redirect and the same `Jam` document title every real page carries. Most of the routes this
 * atlas's first walk seeded were that page, and every one was published as reached with a verified
 * screenshot.
 *
 * `notFoundControl.ts` carries the oracle and the measurement behind its band. What is here is the pass that
 * applies it, after the loop rather than inside it, because the control is one of the declared pages the
 * loop visits and a page cannot be judged against a control that has not been captured yet.
 */
import type { BrowserPageTransport, PageCapture } from "../../browser/pageTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasArtifactWriter } from "../kit/artifactWriter.js";
import {
  addressDisagreement,
  type PageObservation,
  type PageOutcome,
  type PageWalkResult,
  type PageWalkSpec,
  walkDeclaredPages,
} from "../kit/pageWalk.js";

import {
  isJamAuthPath,
  isJamFirstPartyOrigin,
  JAM_BROWSER_PAGES,
  JAM_NOT_FOUND_ROUTE,
  JAM_ROOT_PROBE_PATH,
  JAM_WEB_ORIGIN,
  type JamBrowserPage,
  jamPageUrl,
  jamRootFromFinalUrl,
} from "./browserPages.js";
import { JamAtlasErrors, type JamNotFoundControlFailure, jamAtlasErrorLines } from "./errors.js";
import { jamLooksLikeNotFound, notFoundControlBytes, notFoundControlsAgree } from "./notFoundControl.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * Six seconds, matching the Clerk and Notion walks rather than a shorter one: MEASURED, a Jam settings page
 * emits its responses in a chain rather than in one pass, so a shorter settle would report a page's
 * own traffic as smaller than it is.
 *
 * @internal
 */
export const JAM_PAGE_SETTLE_MS = 6_000;

/**
 * The declared surface name of the not-found control, which the regrade and its refusal both name.
 *
 * @internal
 */
export const JAM_NOT_FOUND_CONTROL_SURFACE = "not-found-control";

/**
 * The declared surface name of the INVENTED control, which anchors the band.
 *
 * Separate from the declared `/404` because the two prove different things: this one cannot become a real
 * page, and that is what lets the corroboration between them fail. See `notFoundControl.ts`.
 *
 * @internal
 */
export const JAM_INVENTED_CONTROL_SURFACE = "not-found-invented";

/** One first-party endpoint the application called, reduced to a method and a path shape. */
export interface JamObservedCall {
  readonly method: string;
  readonly origin: string;
  /** The path with anything that looks like an identifier replaced, so two calls to one endpoint are one row. */
  readonly pathShape: string;
}

/** What one declared Jam page's visit came to. */
export type JamPageObservation = PageObservation<JamObservedCall>;

/**
 * What a Jam walk produced, plus the one thing this platform's grading depends on.
 *
 * @internal
 */
export interface JamBrowserWalkResult extends PageWalkResult<JamObservedCall> {
  /**
   * Why the walk's not-found controls cannot be trusted this run, or `null` when both were observed and
   * corroborate each other.
   *
   * Non-null means the oracle did not work this run — Jam changed its not-found page (`band`), or a control
   * was missing, unreached or unphotographed — and a run in that state has no way to tell a real page from a
   * rendered 404. The publisher refuses rather than writing a grading nothing checked, and its remedy is
   * chosen by the typed cause. One value rather than a flag and a reason, so a failed control with no
   * recorded cause cannot be represented.
   */
  readonly controlFailure: JamNotFoundControlFailure | null;
}

/**
 * Whether one path segment is an identifier rather than a noun.
 *
 * Three rules, and the third is the one this platform needs: a Jam recording id is a SHORT mixed-case token
 * — `aEV5xcX` is seven characters — so neither a digits-only rule nor a length rule reaches it.
 *
 * What it must NOT fold is a version segment, and a looser rule did. The sibling walk this was copied from
 * folds any segment CONTAINING a digit, which turns `/v1/input/<id>` into `/{id}/input/{id}` and reports two
 * different APIs as one endpoint. Mixed case is what separates them: `v1` is not mixed, `aEV5xcX` is.
 *
 * @param segment one path segment, never empty
 * @returns whether to fold it to `{id}`
 */
function looksLikeIdentifier({ segment }: { segment: string }): boolean {
  const allDigits = /^[0-9]+$/.test(segment);
  const longOpaque = /^[A-Za-z0-9_-]{16,}$/.test(segment);
  const mixedCase = /[a-z]/.test(segment) && /[A-Z]/.test(segment);
  return allDigits || longOpaque || mixedCase;
}

/** Path segments that are identifiers rather than nouns, folded so two calls to one endpoint are one row. */
function shapePath({ path }: { path: string }): string {
  return path
    .split("/")
    .map((segment) => (segment.length > 0 && looksLikeIdentifier({ segment }) ? "{id}" : segment))
    .join("/");
}

/**
 * What one page's first-party calls reduce to: a method, an origin and a path shape, and never a body.
 *
 * THIRD-PARTY calls are dropped here rather than at the transport, and the reason is worth stating: the
 * transport's job is to report what a page did, and a page genuinely does call Stripe. What must not happen
 * is another company's endpoints entering this atlas's surface map as Jam operations.
 *
 * @param responses every response the transport captured for one page
 * @returns one row per distinct method and path shape, sorted
 *
 * @internal
 */
export function reduceJamCalls({ responses }: { responses: PageCapture["responses"] }): readonly JamObservedCall[] {
  const byKey = new Map<string, JamObservedCall>();
  for (const response of responses) {
    let parsed: URL;
    try {
      parsed = new URL(response.url);
    } catch {
      continue;
    }
    if (!isJamFirstPartyOrigin({ origin: parsed.origin })) {
      continue;
    }
    const pathShape = shapePath({ path: parsed.pathname });
    byKey.set(`${response.method} ${parsed.origin}${pathShape}`, {
      method: response.method,
      origin: parsed.origin,
      pathShape,
    });
  }
  return [...byKey.entries()].toSorted(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

/**
 * Whether a settled address is Jam's own sign-in surface.
 *
 * On this platform the check cannot be an origin comparison — MEASURED, `jam.dev/login` answers HTTP 200
 * with the application shell on the application's OWN origin — so it is the settled PATH that is read.
 *
 * @param finalUrl where the browser settled
 * @returns whether the session has been lost
 *
 * @internal
 */
export function isJamSignInUrl({ finalUrl }: { finalUrl: string }): boolean {
  try {
    return isJamAuthPath({ path: new URL(finalUrl).pathname });
  } catch {
    return false;
  }
}

/** A URL, or `null` when it cannot be read. */
function parseUrl({ url }: { url: string }): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * How one visited page's reachability is graded.
 *
 * A page counts as reached only when the browser settled where it was asked — the kit's
 * {@link addressDisagreement}, which is the same origin, the same path, and every query parameter this
 * atlas's own declaration named. A parameter the CLIENT appends is its own view state and is tolerated.
 *
 * A rendered not-found is NOT caught here, and cannot be: it settles on the address it was asked for. That
 * is {@link regradeAgainstNotFoundControl}'s job, after the loop.
 *
 * @param requestedUrl the URL the walk asked for
 * @param capture what the transport returned
 * @returns whether the page was redirected, and why it is not held when it is not
 *
 * @internal
 */
export function jamPageOutcome({ requestedUrl, capture }: { requestedUrl: string; capture: PageCapture }): PageOutcome {
  const disagreement = addressDisagreement({ finalUrl: capture.finalUrl, requestedUrl });
  const settled = parseUrl({ url: capture.finalUrl });
  if (settled === null || disagreement === "unreadable") {
    return { redirected: true, unreachableBecause: "the browser settled on an address this atlas cannot read" };
  }
  if (isJamSignInUrl({ finalUrl: capture.finalUrl })) {
    return {
      redirected: true,
      unreachableBecause: "the browser was sent to Jam's own sign-in page, so this session is no longer signed in",
    };
  }
  if (disagreement === "origin") {
    return {
      redirected: true,
      unreachableBecause: `the application sent this address to ${settled.origin}, which is not where it was asked to go`,
    };
  }
  if (disagreement !== null && settled.pathname === JAM_NOT_FOUND_ROUTE) {
    // `/404` carries no team identifier, so this one settle IS named: it is Jam saying it has no such route,
    // which is a different fact from forwarding to a sibling page.
    return {
      redirected: true,
      unreachableBecause: `the application answered ${String(capture.statusCode)} and forwarded this route to its own ${JAM_NOT_FOUND_ROUTE}, so Jam does not serve it`,
    };
  }
  if (disagreement !== null) {
    // The settled path is NOT quoted: under the application prefix it carries this workspace's own team
    // identifier. The declared page's surface name is what the caller already has.
    return {
      redirected: true,
      unreachableBecause: `the application answered ${String(capture.statusCode)} and settled on a different route of the same team`,
    };
  }
  return { redirected: false, unreachableBecause: null };
}

/**
 * Learn the team root by asking the client where it sends the bare origin.
 *
 * One probe rather than the Clerk walk's three, because Jam's answer is reliable: MEASURED, a signed-in
 * `jam.dev/` redirects to `jam.dev/s/<teamId>` every time. A landing on the sign-in page is a refusal rather
 * than a `null` root — every declared page would be rootless for one reason, and saying it once is what a
 * reader can act on.
 *
 * @param transport the bound page transport
 * @returns the team root, `null` when the client landed somewhere carrying none, or why it could not be
 *   reached at all
 */
async function resolveJamRoot({ transport }: { transport: BrowserPageTransport }): Promise<Result<string | null>> {
  const probe = await transport.visit({
    settleMs: JAM_PAGE_SETTLE_MS,
    url: `${JAM_WEB_ORIGIN}${JAM_ROOT_PROBE_PATH}`,
  });
  if (probe.isErr()) {
    // The probe asks for the bare ORIGIN, which carries no identifier, so quoting the transport's own
    // message is safe HERE and nowhere else — every declared page but the two controls is addressed under the team root.
    return err(jamAtlasErrorLines({ error: JamAtlasErrors.rootUnreachable({ detail: probe.error.message }) }));
  }
  if (isJamSignInUrl({ finalUrl: probe.value.finalUrl })) {
    return err(jamAtlasErrorLines({ error: JamAtlasErrors.signedOut() }));
  }
  return ok(jamRootFromFinalUrl({ finalUrl: probe.value.finalUrl }));
}

/**
 * Regrade every page against the application's own not-found control.
 *
 * A page the walk already recorded unreachable keeps that reason: `not-found` is a claim about a page that
 * RENDERED, and overwriting a transport failure or a redirect with it would invent a fact about a page
 * nobody saw.
 *
 * @param pages every declared page's observation
 * @returns the pages with each rendered not-found regraded, and the typed reason the controls could not be
 *   trusted — `null` when they corroborate and the regrade ran
 */
export function regradeAgainstNotFoundControl({ pages }: { pages: readonly JamPageObservation[] }): {
  /** Why the controls are unusable, typed by cause so the refusal picks the remedy; `null` when usable. */
  readonly controlFailure: JamNotFoundControlFailure | null;
  readonly pages: readonly JamPageObservation[];
} {
  const unusable = controlsUnusable({ pages });
  if (unusable !== null) {
    return { controlFailure: unusable, pages };
  }
  // Past `controlsUnusable` both controls are present, reached and photographed, and they corroborate each
  // other — so the anchor is non-null and the narrowing is the guard's, not an assertion.
  const anchorBytes = notFoundControlBytes({ controlSurface: JAM_INVENTED_CONTROL_SURFACE, pages });
  if (anchorBytes === null) {
    return {
      controlFailure: {
        because: "the invented control lost its screenshot between the two reads",
        cause: "control-unphotographed",
      },
      pages,
    };
  }
  return {
    controlFailure: null,
    pages: pages.map((page) => {
      if (page.unreachableBecause !== null || !jamLooksLikeNotFound({ controlBytes: anchorBytes, page })) {
        return page;
      }
      return {
        ...page,
        unreachableBecause:
          "the application rendered its own not-found page here — HTTP 200, no redirect, and a screenshot " +
          "within both controls' own band. This route is not one Jam serves",
      };
    }),
  };
}

/**
 * Why one control was not observed well enough to compare, and whether the walk attempted it at all.
 *
 * @param pages every declared page's observation
 * @param surface the control's declared surface name
 * @returns the failure and whether that control was attempted, or `null` when it is present, reached and
 *   photographed
 */
function controlObservationFailure({
  pages,
  surface,
}: {
  pages: readonly JamPageObservation[];
  surface: string;
}): { readonly attempted: boolean; readonly failure: JamNotFoundControlFailure } | null {
  const control = pages.find((page) => page.surface === surface);
  if (control === undefined) {
    return {
      attempted: false,
      failure: {
        because: `the walk visited no page under the control surface \`${surface}\``,
        cause: "control-missing",
      },
    };
  }
  if (control.unreachableBecause !== null) {
    return {
      attempted: control.attempted,
      failure: {
        because: `the control \`${surface}\` was not reached at all: ${control.unreachableBecause}`,
        cause: "control-unreachable",
      },
    };
  }
  if (control.artifacts.length === 0) {
    const why = control.screenshotMissingBecause === null ? "" : `: ${control.screenshotMissingBecause}`;
    return {
      attempted: control.attempted,
      failure: {
        because: `the control \`${surface}\` was reached and carries no screenshot${why}`,
        cause: "control-unphotographed",
      },
    };
  }
  return null;
}

/**
 * Why the two controls cannot be trusted this run, or `null` when they can.
 *
 * Every branch here is a way the oracle is broken rather than a way a page is missing, which is why each
 * ends the run's page grading rather than raising a gap. Only the last, `band`, is evidence about Jam's
 * not-found page; the three before it are this run failing to observe a control, so they are typed apart.
 *
 * When both controls failed to be observed, the one the walk actually ATTEMPTED is reported. The walk visits
 * `/404` before the invented route, and a run-stopping failure on `/404` leaves the invented control with the
 * kit's synthetic `attempted: false` row ("the walk stopped before this page …") — a consequence, while the
 * attempted control's transport reason is what broke.
 *
 * @param pages every declared page's observation
 * @returns the typed cause and the sentence a refusal carries, or `null`
 */
function controlsUnusable({ pages }: { pages: readonly JamPageObservation[] }): JamNotFoundControlFailure | null {
  const failures = [JAM_INVENTED_CONTROL_SURFACE, JAM_NOT_FOUND_CONTROL_SURFACE].flatMap((surface) => {
    const failed = controlObservationFailure({ pages, surface });
    return failed === null ? [] : [failed];
  });
  const first = failures[0];
  if (first !== undefined) {
    const attempted = failures.find((failed) => failed.attempted);
    return attempted === undefined ? first.failure : attempted.failure;
  }
  const anchorBytes = notFoundControlBytes({ controlSurface: JAM_INVENTED_CONTROL_SURFACE, pages });
  const declaredBytes = notFoundControlBytes({ controlSurface: JAM_NOT_FOUND_CONTROL_SURFACE, pages });
  if (anchorBytes === null || declaredBytes === null) {
    return { because: "one of the two controls carries no screenshot", cause: "control-unphotographed" };
  }
  const disagreement = notFoundControlsAgree({ anchorBytes, declaredBytes });
  return disagreement === null ? null : { because: disagreement, cause: "band" };
}

/**
 * Everything Jam contributes to a walk of its application.
 *
 * @returns the spec `kit/pageWalk.ts` drives
 *
 * @internal
 */
export function jamPageWalkSpec(): PageWalkSpec<JamBrowserPage, JamObservedCall> {
  return {
    artifactPathFor: ({ sha256 }) => `artifacts/pages/${sha256}.png`,
    gradeOutcome: ({ requestedUrl, capture }) => jamPageOutcome({ capture, requestedUrl }),
    pages: JAM_BROWSER_PAGES,
    // Every declared page IS photographed here, and that is a decision rather than a default. A walk may
    // refuse a picture of a page rendering a colleague's employment record; nothing this walk declares renders
    // a person's data — the credential tabs and the recordings are refused by `browserPages.ts` before a page
    // is ever declared, so the withholding happens at the denominator
    // rather than at the shutter. And the shutter is where this atlas most needs the bytes: its not-found
    // oracle is measured off a screenshot's own size, so a refused picture would silently disarm the one
    // check that keeps its page grading honest.
    photographPolicy: () => null,
    progressLabel: "jam application",
    reduceCalls: ({ responses }) => reduceJamCalls({ responses }),
    resolveRoot: ({ transport }) => resolveJamRoot({ transport }),
    rootMissingBecause:
      "this page hangs off a team root, and the application did not send the bare origin to one — so this " +
      "session is signed in to no team, or Jam has changed where it lands. Open jam.dev in your own Chrome " +
      "and check that it settles on an address under /s/",
    sessionLostOn: ({ capture }) => isJamSignInUrl({ finalUrl: capture.finalUrl }),
    settleMs: JAM_PAGE_SETTLE_MS,
    signedOutHint: "the browser session was lost — sign in to Jam in your own Chrome and run the walk again",
    urlFor: ({ root, page }) => jamPageUrl({ page, root }),
  };
}

/**
 * Walk every declared Jam application page, then regrade the rendered not-founds among them.
 *
 * @param transport the bound page transport, released by the caller rather than here
 * @param writeArtifact where each page's screenshot is written and verified
 * @param progress where a line of progress goes; omitted discards it
 * @returns every declared page's observation, or why the walk could not start at all
 */
export async function walkJamApplication({
  transport,
  writeArtifact,
  progress,
}: {
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  progress?: (input: { line: string }) => void;
}): Promise<Result<JamBrowserWalkResult>> {
  const walked = await walkDeclaredPages({
    spec: jamPageWalkSpec(),
    transport,
    writeArtifact,
    ...(progress === undefined ? {} : { progress }),
  });
  if (walked.isErr()) {
    return err(walked.error);
  }
  // Both controls hang off the bare origin, so a walk that learned no team root still fires them — and would
  // otherwise publish a generation in which no application page was ever addressed.
  if (!walked.value.rootFound) {
    return err(jamAtlasErrorLines({ error: JamAtlasErrors.rootMissing() }));
  }
  const regraded = regradeAgainstNotFoundControl({ pages: walked.value.pages });
  return ok({
    ...walked.value,
    controlFailure: regraded.controlFailure,
    pages: regraded.pages,
  });
}
