/**
 * Walk every page the Falcon console declares, photograph each, and record what the console asked for.
 *
 * ## The denominator is the console's own, which is what makes the coverage claim checkable
 *
 * A crawler cannot prove its own completeness — "we visited everything we found" is a claim about the
 * crawler. Falcon publishes `/content/sitemap-v2/index.json`, measured at 606 internal hrefs across 79
 * modules, so the walk is judged against a list it did not choose. A declared page never visited is a GAP
 * this atlas can name; a page a crawler never noticed is not.
 *
 * ## Declared, reachable and openable are three different things
 *
 * A declared page may 404, may redirect, or may be gated behind a feature flag or a permission the signed-in
 * account lacks. Every one of those is a COMPLETED attempt against a real declaration, recorded on the page's own
 * row — never a walk failure, and never a page silently credited to wherever it landed. The distinction is
 * exactly what the owner's bar tests: anything findable in the browser that the atlas cannot return.
 *
 * ## Everything here is written against a seam
 *
 * `browserTransport.ts` is the whole contract: `visit` and `release`. The walk, the reduction, the artifact
 * writing and every one of their tests run against a deterministic fake, so a redirect, a lost body, a lost
 * session and a missing screenshot are settled by unit tests rather than by luck in a live run.
 */

import {
  type BrowserPageTransport,
  isCaptureComplete,
  isRedirected,
  isWalkStoppingError,
  type PageCapture,
} from "../../browser/pageTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import { isUnrenderedScreenshot, screenshotArtifact, visitPhotographed } from "../kit/browserWalk.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { walkTicker } from "../kit/walkProgress.js";
import { CrowdstrikeAtlasErrors, crowdstrikeAtlasErrorLines } from "./atlasErrors.js";
import { isRecordableResponse, type ObservedConsoleCall, reduceConsoleCalls } from "./consoleReduction.js";
import type { ConsolePageObservation, ConsoleRequestObservation } from "./projectConsole.js";
import type { FalconRouteDeclaration } from "./sitemap.js";

export { isRecordableResponse };

/** How long to keep observing one page after it settles, so its own deferred calls are caught. */
export const PAGE_SETTLE_MS = 2_500;

/** Where a screenshot is written, injected so the walk itself performs no I/O. */
export type ArtifactWriter = (input: { relativePath: string; bytes: Uint8Array }) => Result<null>;

/** What the walk produced. */
export interface ConsoleWalkResult {
  readonly pages: readonly ConsolePageObservation[];
  readonly requests: readonly ConsoleRequestObservation[];
  /** Pages whose response bodies were not all captured — the walk saw less than it looked like it did. */
  readonly incompletePages: readonly string[];
  /** Declared routes the walk never attempted, because the session was lost part-way. */
  readonly notAttempted: readonly string[];
  /** Pages that were reached but whose capture was still a loading frame, so nothing was photographed. */
  readonly unrenderedPages: readonly string[];
  readonly artifactsWritten: number;
}

/**
 * Where a line of progress goes.
 *
 * @internal
 */
export type ConsoleWalkProgress = (input: { line: string }) => void;

/**
 * How one visited page's outcome is graded.
 *
 * A redirect is its own outcome rather than a success at a different address, because "this page exists and
 * sends you elsewhere" and "this page rendered" are different answers to the owner's own question.
 *
 * @param capture what the transport returned
 * @returns the outcome to record on the page's row
 */
export function outcomeOf({ capture }: { capture: PageCapture }): ConsolePageObservation["outcome"] {
  if (capture.statusCode !== null && capture.statusCode >= 400) {
    return "unavailable";
  }
  return isRedirected({ capture }) ? "redirected" : "landed";
}

/** One page's visit, folded into an observation plus whatever calls it produced. */
function foldVisit({
  route,
  capture,
  origin,
  artifacts,
}: {
  route: FalconRouteDeclaration;
  capture: PageCapture;
  origin: string;
  artifacts: readonly AtlasArtifactRef[];
}): { page: ConsolePageObservation; calls: readonly ObservedConsoleCall[] } {
  const calls = capture.responses
    .filter((response) => isRecordableResponse({ origin, response }))
    .map((response) => ({
      body: response.body,
      method: response.method,
      onPage: route.href,
      statusCode: response.statusCode,
      url: response.url,
    }));
  return {
    calls,
    page: {
      appName: route.appName,
      artifacts,
      featureFlags: route.featureFlags,
      finalUrl: capture.finalUrl,
      href: route.href,
      outcome: outcomeOf({ capture }),
      permissions: route.permissions,
      statusCode: capture.statusCode,
      title: capture.title,
    },
  };
}

/** A row for a route that could not be visited at all. */
function unvisitedPage({
  route,
  outcome,
}: {
  route: FalconRouteDeclaration;
  outcome: ConsolePageObservation["outcome"];
}): ConsolePageObservation {
  return {
    appName: route.appName,
    artifacts: [],
    featureFlags: route.featureFlags,
    finalUrl: null,
    href: route.href,
    outcome,
    permissions: route.permissions,
    statusCode: null,
    title: null,
  };
}

/** The walk's running accumulators, so one landed capture folds in through a single call. */
interface WalkState {
  readonly pages: ConsolePageObservation[];
  readonly calls: ObservedConsoleCall[];
  readonly incompletePages: string[];
  readonly unrenderedPages: string[];
  artifactsWritten: number;
}

/**
 * Fold one landed capture into the walk's running state — its picture, its row, its calls, and the two ways
 * it can be less than it looks (a lost response body, a capture taken mid-load).
 *
 * @param state the walk's accumulators
 * @param capture what the transport returned
 * @param route the declaration it answers
 * @param origin the console origin, for deciding which responses are first-party
 * @param writeArtifact where a screenshot is written
 */
function recordVisit({
  state,
  capture,
  route,
  origin,
  writeArtifact,
}: {
  state: WalkState;
  capture: PageCapture;
  route: FalconRouteDeclaration;
  origin: string;
  writeArtifact: ArtifactWriter;
}): void {
  const artifacts = writeScreenshot({ capture, writeArtifact });
  state.artifactsWritten += artifacts.written;
  if (artifacts.unrendered) {
    state.unrenderedPages.push(route.href);
  }
  const folded = foldVisit({ artifacts: artifacts.refs, capture, origin, route });
  state.pages.push(folded.page);
  state.calls.push(...folded.calls);
  if (!isCaptureComplete({ capture })) {
    state.incompletePages.push(route.href);
  }
}

/**
 * Visit every declared route, in order, and accumulate what each one showed.
 *
 * A visit that fails is recorded as `failed` and the walk continues — one gated page must not end a walk of
 * 606. A LOST SESSION is different and stops the walk: every route after it would be recorded as failed for
 * a reason that has nothing to do with the page, which would turn one sign-out into a false gap for every remaining route. Those
 * routes are returned as `notAttempted`, so the difference is visible rather than inferred.
 *
 * @param routes every route the console's own sitemap declares
 * @param transport the browser seam
 * @param origin the console origin, used to decide which responses are first-party
 * @param writeArtifact where a screenshot is written
 * @param progress where a line of progress goes; omitted discards it
 * @returns what the walk saw, or the reason it could not start
 */
export async function walkFalconConsole({
  routes,
  transport,
  origin,
  writeArtifact,
  progress,
}: {
  routes: readonly FalconRouteDeclaration[];
  transport: BrowserPageTransport;
  origin: string;
  writeArtifact: ArtifactWriter;
  progress?: ConsoleWalkProgress;
}): Promise<Result<ConsoleWalkResult>> {
  if (routes.length === 0) {
    return err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.routesUndeclared() }));
  }
  const state: WalkState = {
    artifactsWritten: 0,
    calls: [],
    incompletePages: [],
    pages: [],
    unrenderedPages: [],
  };
  let sessionLostAt: number | null = null;
  const tick = walkTicker({ label: "crowdstrike console", progress, total: routes.length });

  for (const [index, route] of routes.entries()) {
    if (sessionLostAt !== null) {
      state.pages.push(unvisitedPage({ outcome: "not-attempted", route }));
      continue;
    }
    tick({ page: route.href, position: index + 1 });
    const visited = await visitPhotographed({ settleMs: PAGE_SETTLE_MS, transport, url: `${origin}${route.href}` });
    if (visited.isErr()) {
      const lost = isWalkStoppingError({ error: visited.error });
      sessionLostAt = lost ? index : sessionLostAt;
      state.pages.push(unvisitedPage({ outcome: lost ? "not-attempted" : "failed", route }));
      continue;
    }
    recordVisit({ capture: visited.value, origin, route, state, writeArtifact });
  }

  await transport.release();
  return ok({
    artifactsWritten: state.artifactsWritten,
    incompletePages: state.incompletePages,
    notAttempted: state.pages.filter((page) => page.outcome === "not-attempted").map((page) => page.href),
    pages: state.pages,
    requests: reduceConsoleCalls({ calls: state.calls }),
    unrenderedPages: state.unrenderedPages,
  });
}

/**
 * Write one page's screenshot, if it has one; a write that fails costs the artifact, never the page.
 *
 * A capture that is a picture of the console mid-load is graded out here rather than written, so it is
 * counted as a page nobody photographed instead of as a written artifact. A walk's stored captures included
 * that spinner frame before the grade existed — see `isUnrenderedScreenshot`.
 */
function writeScreenshot({ capture, writeArtifact }: { capture: PageCapture; writeArtifact: ArtifactWriter }): {
  refs: readonly AtlasArtifactRef[];
  written: number;
  unrendered: boolean;
} {
  if (capture.screenshotPng === null) {
    return { refs: [], unrendered: false, written: 0 };
  }
  if (isUnrenderedScreenshot({ bytes: capture.screenshotPng })) {
    return { refs: [], unrendered: true, written: 0 };
  }
  const ref = screenshotArtifact({ bytes: capture.screenshotPng, directory: "artifacts/console" });
  const written = writeArtifact({ bytes: capture.screenshotPng, relativePath: ref.relativePath });
  return written.isErr() ? { refs: [], unrendered: false, written: 0 } : { refs: [ref], unrendered: false, written: 1 };
}
