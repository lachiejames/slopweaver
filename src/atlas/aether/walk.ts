/**
 * Walk every route the Aether portal registry declares, photograph each, and keep the response bodies the
 * reduction turns into findings.
 *
 * ## Declared, reachable and openable are three different things
 *
 * A declared route may 404, may redirect to the sign-in form, or may render a shell that fetches nothing.
 * Every one of those is a COMPLETED attempt against a real declaration, recorded on the route's own row —
 * never a walk failure, and never a page silently credited to wherever it landed. A redirect to the portal
 * sign-in is the signed-out case, and {@link outcomeOf} grades it as its own outcome so the reducer never
 * treats a login page as data.
 *
 * ## The bodies are kept, because THIS atlas holds values, not just a map
 *
 * A console walk that maps an interface keeps only the endpoint SHAPE of each response. Aether is different: the
 * findings ARE the point, and they live in the portal's own JSON responses, so this walk carries every
 * first-party response body forward to `reduction.ts`. What is stored is the reduced finding, never the raw
 * body — see `entities.ts` and `descriptor.ts`'s `payload-not-map`.
 *
 * ## Everything here is written against a seam
 *
 * `browser/pageTransport.ts` is the whole contract: `visit` and `release`, and the screenshot writer is
 * `kit/artifactWriter.ts`, which reads back what it wrote before answering `ok`. The walk, the reduction and
 * every one of their tests run against a deterministic fake, so a redirect, a lost body, a lost session and
 * a missing screenshot are settled by unit tests rather than by luck in a live run.
 */
import { createHash } from "node:crypto";

import {
  type BrowserPageTransport,
  isCaptureComplete,
  isRedirected,
  isWalkStoppingError,
  type PageCapture,
} from "../../browser/pageTransport.js";
import { noteSignInWall } from "../../browser/signInWalls.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasArtifactWriter } from "../kit/artifactWriter.js";
import { isUnrenderedScreenshot, visitPhotographed } from "../kit/browserWalk.js";
import type { AtlasArtifactRef } from "../kit/contract.js";

import type { AetherPortalRoute } from "./pages.js";

/**
 * How long to keep observing one page after it settles, so its own deferred XHRs are caught.
 *
 * The portal is a single-page app that fetches its data after first paint, so a too-short settle records a
 * rendered shell with no findings in it. Measured generous rather than tight for that reason.
 *
 * @internal
 */
export const AETHER_PAGE_SETTLE_MS = 3_000;

/** How one visited route's outcome is graded. */
export type AetherPageOutcome =
  "landed" | "redirected" | "login-wall" | "not-found" | "unavailable" | "not-attempted" | "failed";

/** One route the walk visited (or could not), folded into an observation. */
export interface AetherPageObservation {
  readonly href: string;
  readonly section: string;
  readonly finalUrl: string | null;
  readonly outcome: AetherPageOutcome;
  readonly statusCode: number | null;
  readonly title: string | null;
  readonly rendered: boolean;
  readonly responseCount: number;
  readonly artifacts: readonly AtlasArtifactRef[];
}

/** One first-party response a page produced, carried to the reduction with its body. */
export interface CapturedPortalResponse {
  /** The route the response was seen on, so a reduced entity can name where it came from. */
  readonly onPage: string;
  readonly url: string;
  readonly method: string;
  readonly statusCode: number;
  readonly body: unknown;
}

/** What the walk produced. */
export interface AetherWalkResult {
  readonly pages: readonly AetherPageObservation[];
  /** Every first-party JSON response body, in visit order — the reduction's input. */
  readonly responses: readonly CapturedPortalResponse[];
  /** Pages whose response bodies were not all captured — the walk saw less than it looked like it did. */
  readonly incompletePages: readonly string[];
  /** Pages reached but whose capture was still a loading frame, so nothing was photographed. */
  readonly unrenderedPages: readonly string[];
  /** Pages that redirected to the portal sign-in — the signed-out case. */
  readonly loginWallPages: readonly string[];
  /** Declared routes the walk never attempted, because the session was lost part-way. */
  readonly notAttempted: readonly string[];
  /** Every URL a visit actually settled on, so the registry can be checked against evidence. */
  readonly finalUrls: readonly string[];
  readonly artifactsWritten: number;
}

/**
 * Where a line of progress goes.
 *
 * @internal
 */
export type AetherWalkProgress = (input: { line: string }) => void;

/**
 * The artifact reference for one page screenshot, addressed by the digest of its own bytes.
 *
 * @param bytes the PNG bytes
 * @returns the reference, whose `relativePath` is relative to the atlas's own directory
 */
function screenshotArtifact({ bytes }: { bytes: Uint8Array }): AtlasArtifactRef {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    byteLength: bytes.byteLength,
    kind: "page-png",
    mediaType: "image/png",
    relativePath: `artifacts/pages/${sha256}.png`,
    sha256,
  };
}

/**
 * Whether a captured response is a first-party JSON body worth reducing.
 *
 * First-party by the portal origin, so a Cloudflare or analytics call is dropped; JSON-shaped by its body
 * being an object or array, so an HTML document or an image is dropped. A response the reduction cannot use
 * is never carried, which keeps the reduction's input the portal's own data.
 *
 * @param origin the portal origin, e.g. `https://app.tryaether.ai`
 * @param response the captured response to judge
 * @returns whether to carry it to the reduction
 */
export function isReducibleResponse({
  origin,
  response,
}: {
  origin: string;
  response: { url: string; body: unknown };
}): boolean {
  if (!response.url.startsWith(`${origin}/`)) {
    return false;
  }
  return typeof response.body === "object" && response.body !== null;
}

/**
 * How one visited page's outcome is graded.
 *
 * A redirect to the portal sign-in is `login-wall` — the signed-out case, which the reducer must never treat
 * as data. Any other redirect is `redirected`. A 404 is split from other 4xx because on a hand-written
 * registry it means this file named a route the portal does not have.
 *
 * @param capture what the transport returned
 * @returns the outcome to record on the page's row
 */
export function outcomeOf({ capture }: { capture: PageCapture }): AetherPageOutcome {
  if (/\/(login|signin|sign-in|auth)/i.test(capture.finalUrl)) {
    return "login-wall";
  }
  if (capture.statusCode === 404) {
    return "not-found";
  }
  if (capture.statusCode !== null && capture.statusCode >= 400) {
    return "unavailable";
  }
  return isRedirected({ capture }) ? "redirected" : "landed";
}

/** One page's visit, folded into an observation plus the first-party responses it produced. */
function foldVisit({
  route,
  capture,
  origin,
  artifacts,
  rendered,
}: {
  route: AetherPortalRoute;
  capture: PageCapture;
  origin: string;
  artifacts: readonly AtlasArtifactRef[];
  rendered: boolean;
}): { page: AetherPageObservation; responses: readonly CapturedPortalResponse[] } {
  const responses = capture.responses
    .filter((response) => isReducibleResponse({ origin, response }))
    .map((response): CapturedPortalResponse => ({
      body: response.body,
      method: response.method,
      onPage: route.href,
      statusCode: response.statusCode,
      url: response.url,
    }));
  return {
    page: {
      artifacts: [...artifacts],
      finalUrl: capture.finalUrl,
      href: route.href,
      outcome: outcomeOf({ capture }),
      rendered,
      responseCount: responses.length,
      section: route.section,
      statusCode: capture.statusCode,
      title: capture.title,
    },
    responses,
  };
}

/** A row for a route that could not be visited at all. */
function unvisitedPage({
  route,
  outcome,
}: {
  route: AetherPortalRoute;
  outcome: AetherPageOutcome;
}): AetherPageObservation {
  return {
    artifacts: [],
    finalUrl: null,
    href: route.href,
    outcome,
    rendered: false,
    responseCount: 0,
    section: route.section,
    statusCode: null,
    title: null,
  };
}

/** The outcome of crediting one page's screenshot: its artifact (if kept), and why it was not. */
interface ScreenshotCredit {
  readonly refs: readonly AtlasArtifactRef[];
  readonly written: number;
  readonly unrendered: boolean;
}

/**
 * Credit one page's screenshot, if it has one that is a picture rather than a loading frame.
 *
 * A capture with no PNG is `written: 0` and not unrendered; a PNG that fails the unrendered-frame grade is
 * `unrendered: true` and not credited; a good PNG whose disk write fails costs the artifact but never the
 * page. The write goes through the kit's verified writer, which reads its bytes back before answering `ok`.
 */
function creditScreenshot({
  capture,
  writeArtifact,
}: {
  capture: PageCapture;
  writeArtifact: AtlasArtifactWriter;
}): ScreenshotCredit {
  const png = capture.screenshotPng;
  if (png === null) {
    return { refs: [], unrendered: false, written: 0 };
  }
  if (isUnrenderedScreenshot({ bytes: png })) {
    return { refs: [], unrendered: true, written: 0 };
  }
  const ref = screenshotArtifact({ bytes: png });
  const stored = writeArtifact({ bytes: png, relativePath: ref.relativePath, sha256: ref.sha256 });
  return stored.isErr() ? { refs: [], unrendered: false, written: 0 } : { refs: [ref], unrendered: false, written: 1 };
}

/** The walk's running accumulators, so one landed capture folds in through a single call. */
interface WalkState {
  readonly pages: AetherPageObservation[];
  readonly responses: CapturedPortalResponse[];
  readonly incompletePages: string[];
  readonly unrenderedPages: string[];
  readonly loginWallPages: string[];
  readonly finalUrls: string[];
  artifactsWritten: number;
}

/** Fold one landed capture into the walk's running state. */
function recordVisit({
  state,
  capture,
  route,
  origin,
  writeArtifact,
}: {
  state: WalkState;
  capture: PageCapture;
  route: AetherPortalRoute;
  origin: string;
  writeArtifact: AtlasArtifactWriter;
}): void {
  const shot = creditScreenshot({ capture, writeArtifact });
  state.artifactsWritten += shot.written;
  if (shot.unrendered) {
    state.unrenderedPages.push(route.href);
  }
  const folded = foldVisit({ artifacts: shot.refs, capture, origin, rendered: shot.written > 0, route });
  state.pages.push(folded.page);
  if (folded.page.outcome === "login-wall") {
    state.loginWallPages.push(route.href);
  } else {
    state.responses.push(...folded.responses);
  }
  state.finalUrls.push(capture.finalUrl);
  if (!isCaptureComplete({ capture })) {
    state.incompletePages.push(route.href);
  }
}

/**
 * Note the portal's sign-in wall when the walk as a whole was signed out.
 *
 * The verb exits 3 on a signed-out walk, and without a noted wall a scheduled resync could only record
 * `exited 3`: a failure hold and a finding, never the owner's sign-in card (`browser/signInWalls.ts`). Noted from the WALK's verdict, as hex does, and only when a page actually met
 * the wall: "no page landed" alone is relay contention, and a card then would
 * send the owner to sign in to a session that was live.
 */
function noteWallIfSignedOut({ state, origin }: { state: WalkState; origin: string }): void {
  const signedOut = state.loginWallPages.length > 0 && !state.pages.some((page) => page.outcome === "landed");
  if (signedOut) {
    noteSignInWall({ origin });
  }
}

/**
 * Visit every declared route, in order, and accumulate what each one showed.
 *
 * A visit that fails is recorded as `failed` and the walk continues — one gated page must not end the walk.
 * A LOST SESSION is different and stops it: every route after a sign-out would be recorded as failed for a
 * reason that has nothing to do with the page. Those routes are returned as `notAttempted`, so the
 * difference is visible rather than inferred.
 *
 * @param routes every route the registry declares
 * @param transport the browser seam
 * @param origin the portal origin, used to build each URL and to decide which responses are first-party
 * @param writeArtifact where a screenshot is written
 * @param progress where a line of progress goes; omitted discards it
 * @returns what the walk saw, or the reason it could not start
 */
export async function walkAetherPortal({
  routes,
  transport,
  origin,
  writeArtifact,
  progress,
}: {
  routes: readonly AetherPortalRoute[];
  transport: BrowserPageTransport;
  origin: string;
  writeArtifact: AtlasArtifactWriter;
  progress?: AetherWalkProgress;
}): Promise<Result<AetherWalkResult>> {
  if (routes.length === 0) {
    return err(["the Aether portal registry declared no routes, so a walk would report full coverage over nothing"]);
  }
  const state: WalkState = {
    artifactsWritten: 0,
    finalUrls: [],
    incompletePages: [],
    loginWallPages: [],
    pages: [],
    responses: [],
    unrenderedPages: [],
  };
  let sessionLost = false;

  for (const [index, route] of routes.entries()) {
    if (sessionLost) {
      state.pages.push(unvisitedPage({ outcome: "not-attempted", route }));
      continue;
    }
    progress?.({ line: `aether portal: ${String(index + 1)}/${String(routes.length)} ${route.href}` });
    const visited = await visitPhotographed({
      settleMs: AETHER_PAGE_SETTLE_MS,
      transport,
      url: `${origin}${route.href}`,
    });
    if (visited.isErr()) {
      sessionLost = isWalkStoppingError({ error: visited.error });
      progress?.({ line: `aether portal: ${route.href} failed — ${visited.error.code}: ${visited.error.message}` });
      state.pages.push(unvisitedPage({ outcome: sessionLost ? "not-attempted" : "failed", route }));
      continue;
    }
    recordVisit({ capture: visited.value, origin, route, state, writeArtifact });
  }

  await transport.release();
  noteWallIfSignedOut({ origin, state });
  return ok({
    artifactsWritten: state.artifactsWritten,
    finalUrls: state.finalUrls,
    incompletePages: state.incompletePages,
    loginWallPages: state.loginWallPages,
    notAttempted: state.pages.filter((page) => page.outcome === "not-attempted").map((page) => page.href),
    pages: state.pages,
    responses: state.responses,
    unrenderedPages: state.unrenderedPages,
  });
}
