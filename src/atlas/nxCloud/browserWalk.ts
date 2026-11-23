/**
 * Walk every route `inventory.ts` declares, photograph each, and record what the Nx Cloud client asked for.
 *
 * ## Declared, attempted, reached and PHOTOGRAPHED are four different things
 *
 * Each is recorded separately. A reached page with no verified PNG carries
 * {@link NxCloudRouteObservation.screenshotMissingBecause}, raises its own gap, and stops the coverage cell
 * being `synced` — the Notion walk's rule, adopted here rather than the Vanta and CrowdStrike behaviour of
 * dropping an unwritten screenshot silently.
 *
 * ## The walk also harvests the client's OWN route table
 *
 * Every navigation makes the client fetch `/__manifest`, whose response declares the routes it has just
 * learned. `browserReduction.ts` reads those out of the capture the walk already has, so the atlas's page
 * denominator is the platform's own declaration rather than the list in this repository — and a route the
 * client declares that the walk never opened becomes a recorded row instead of an absence.
 *
 * ## Everything here is written against a seam
 *
 * `browser/pageTransport.ts` is the whole contract — `visit` and `release` — so the walk, the reduction, the
 * artifact writing and every one of their tests run against a deterministic fake.
 */
import { createHash } from "node:crypto";

import {
  type BrowserPageTransport,
  type BrowserTransportError,
  type CapturedResponse,
  isCaptureComplete,
  isWalkStoppingError,
  type PageCapture,
  type ResponseAccounting,
} from "../../browser/pageTransport.js";
import { ok, type Result } from "../../lib/result.js";
import { isUnrenderedScreenshot, UNRENDERED_SCREENSHOT_BECAUSE, visitPhotographed } from "../kit/browserWalk.js";
import type { AtlasArtifactRef } from "../kit/contract.js";

import {
  markIndistinguishableRoutes,
  type NxCloudBrowserWalkResult,
  type NxCloudRouteObservation,
  nxCloudRouteOutcome,
} from "./browserObservation.js";
import {
  declaredRoutesFrom,
  foldDeclaredRoutes,
  type NxCloudDeclaredRoute,
  reduceNxCloudCalls,
} from "./browserReduction.js";
import { decodeSingleFetch } from "./dataRoute.js";
import { NX_CLOUD_ORIGIN, NX_CLOUD_WALK_ROUTES, nxCloudPath } from "./inventory.js";
import { nxCloudPageArtifactPath } from "./store.js";
import type { NxCloudScope } from "./webData.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * MEASURED against the live console: this window covers every walked page finishing its own `__manifest`
 * and `.data` calls with headroom, and the analytics pages take the longest.
 *
 * @internal
 */
export const NX_CLOUD_PAGE_SETTLE_MS = 4_000;

/**
 * Write a page's screenshot and PROVE it landed.
 *
 * Injected so the walk itself performs no I/O. An implementation must verify what it wrote — the byte
 * length and the digest — rather than reporting success from the write call alone, because the whole point
 * of the artifact is that a reader can trust the bytes are the ones that were seen.
 *
 * @internal
 */
export type NxCloudArtifactWriter = (input: {
  relativePath: string;
  bytes: Uint8Array;
  sha256: string;
}) => Result<null>;

/** An accounting that claims nothing, for a visit that never happened. */
const NO_ACCOUNTING: ResponseAccounting = { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 };

/**
 * The artifact reference for one page screenshot, addressed by the digest of its own bytes.
 *
 * @param bytes the PNG bytes
 * @returns the reference, whose `relativePath` is relative to the atlas's own directory
 */
export function nxCloudScreenshotArtifact({ bytes }: { bytes: Uint8Array }): AtlasArtifactRef {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    byteLength: bytes.byteLength,
    kind: "page-png",
    mediaType: "image/png",
    relativePath: nxCloudPageArtifactPath({ sha256 }),
    sha256,
  };
}

/**
 * Why a visit failed, in words that carry no URL.
 *
 * The transport's own message interpolates the address it was given, and an Nx Cloud URL carries the
 * organisation and workspace ids. The `code` says what kind of failure it was, which is what a reader acts
 * on, and the transport's `reason` half is deliberately dropped rather than parsed out.
 *
 * @param error the transport's typed failure
 * @returns the reason to record, carrying no address
 */
function transportReason({ error }: { error: BrowserTransportError }): string {
  if (error.code === "SESSION_LOST") {
    return "the browser session was lost — sign in to Nx Cloud in your own Chrome and run the walk again";
  }
  if (error.code === "TRANSPORT_UNAVAILABLE") {
    return "no browser transport was attached, so this page was never asked for";
  }
  if (error.code === "NAVIGATION_FAILED") {
    // The transport says which mechanism it was, in its own URL-free words — `browser/clientKill.ts`.
    return error.because;
  }
  return "the browser could not navigate to this page's address";
}

/**
 * Decode every turbo-stream body a capture carries, so the reduction sees objects rather than strings.
 *
 * ## Why this exists at all
 *
 * A React Router application answers its own data requests with `text/x-script`, and the capture snippet has
 * no decoder — it hands such a body back as raw TEXT. MEASURED: without this step a walk of the declared
 * pages contributed only the route manifest and the web app manifest to the atlas, because every `.data`
 * call reduced to a string with no field names in it.
 *
 * A body that will not decode is left as it is rather than dropped: the operation was still CALLED, which is
 * the half of the observation that matters most, and a string simply contributes no field paths.
 *
 * @param responses the capture's own responses
 * @returns the same responses with every decodable turbo-stream body replaced by its value
 *
 * @internal
 */
export async function decodeCapturedBodies({
  responses,
}: {
  responses: readonly CapturedResponse[];
}): Promise<readonly CapturedResponse[]> {
  const decoded: CapturedResponse[] = [];
  for (const response of responses) {
    if (typeof response.body !== "string") {
      decoded.push(response);
      continue;
    }
    const parsed = await decodeSingleFetch({ call: response.url, text: response.body });
    decoded.push(parsed.isOk() ? { ...response, body: parsed.value } : response);
  }
  return decoded;
}

/** A row for a declared route the walk never completed, whether it was addressed or not. */
function incompleteRoute({
  pathPattern,
  attempted,
  why,
  requestedUrl,
}: {
  pathPattern: string;
  attempted: boolean;
  why: string;
  requestedUrl: string;
}): NxCloudRouteObservation {
  return {
    artifacts: [],
    attempted,
    calls: [],
    captureComplete: false,
    finalUrl: "",
    observedAt: "",
    pathPattern,
    redirected: false,
    requestedUrl,
    responseAccounting: NO_ACCOUNTING,
    screenshotMissingBecause: "the page was never photographed, because the visit did not complete",
    statusCode: null,
    title: "",
    unreachableBecause: why,
  };
}

/** Write one page's screenshot; a missing or unwritten PNG is a recorded incompleteness, never a silence. */
function writeScreenshot({ capture, writeArtifact }: { capture: PageCapture; writeArtifact: NxCloudArtifactWriter }): {
  artifacts: readonly AtlasArtifactRef[];
  missingBecause: string | null;
} {
  if (capture.screenshotPng === null) {
    return { artifacts: [], missingBecause: "the page was reached but the browser returned no screenshot for it" };
  }
  if (isUnrenderedScreenshot({ bytes: capture.screenshotPng })) {
    return { artifacts: [], missingBecause: UNRENDERED_SCREENSHOT_BECAUSE };
  }
  const ref = nxCloudScreenshotArtifact({ bytes: capture.screenshotPng });
  const written = writeArtifact({ bytes: capture.screenshotPng, relativePath: ref.relativePath, sha256: ref.sha256 });
  if (written.isErr()) {
    return { artifacts: [], missingBecause: `the screenshot could not be stored: ${written.error.join("; ")}` };
  }
  return { artifacts: [ref], missingBecause: null };
}

/**
 * Visit one declared route, photograph it and reduce what it asked for.
 *
 * @param pathPattern the declared route pattern
 * @param scope the organisation and workspace to substitute into it
 * @param transport the bound page transport
 * @param writeArtifact where the screenshot is written
 * @param origin the origin to address
 * @returns the observation, the routes the client declared while it rendered, and whether the session was lost
 */
async function visitRoute({
  pathPattern,
  scope,
  transport,
  writeArtifact,
  origin,
}: {
  pathPattern: string;
  scope: NxCloudScope;
  transport: BrowserPageTransport;
  writeArtifact: NxCloudArtifactWriter;
  origin: string;
}): Promise<{
  observation: NxCloudRouteObservation;
  declaredRoutes: readonly NxCloudDeclaredRoute[];
  sessionLost: boolean;
}> {
  const requestedUrl = `${origin}${nxCloudPath({ orgId: scope.orgId, template: pathPattern, workspaceId: scope.workspaceId })}`;
  const visited = await visitPhotographed({ settleMs: NX_CLOUD_PAGE_SETTLE_MS, transport, url: requestedUrl });
  if (visited.isErr()) {
    const lost = isWalkStoppingError({ error: visited.error });
    return {
      declaredRoutes: [],
      observation: incompleteRoute({
        attempted: true,
        pathPattern,
        requestedUrl,
        why: transportReason({ error: visited.error }),
      }),
      sessionLost: lost,
    };
  }
  const capture = visited.value;
  const outcome = nxCloudRouteOutcome({ capture, requestedUrl });
  const shot = writeScreenshot({ capture, writeArtifact });
  const responses = await decodeCapturedBodies({ responses: capture.responses });
  return {
    declaredRoutes: declaredRoutesFrom({ responses }),
    observation: {
      artifacts: shot.artifacts,
      attempted: true,
      calls: reduceNxCloudCalls({ origin, responses }),
      captureComplete: isCaptureComplete({ capture }),
      finalUrl: capture.finalUrl,
      observedAt: capture.observedAt,
      pathPattern,
      redirected: outcome.redirected,
      requestedUrl,
      responseAccounting: capture.responseAccounting,
      screenshotMissingBecause: shot.missingBecause,
      statusCode: capture.statusCode,
      title: capture.title,
      unreachableBecause: outcome.unreachableBecause,
    },
    sessionLost: false,
  };
}

/**
 * Walk every declared Nx Cloud route.
 *
 * Strictly sequential, one page at a time: it drives the owner's own browser, so two pages at once would
 * fight over the tab the owner is looking at.
 *
 * @param transport the bound page transport, released by the caller rather than here
 * @param scope the organisation and workspace whose pages are walked
 * @param writeArtifact where each page's screenshot is written and verified
 * @param origin the origin to address; omitted takes Nx Cloud's own
 * @param routes the routes to walk; omitted takes the declared list
 * @param progress where a line of progress goes; omitted discards it. It is given the route PATTERN and
 *   never a URL, because an Nx Cloud URL carries the organisation and workspace ids
 * @returns every declared route's observation and the client's own route table
 */
export async function walkNxCloudBrowser({
  transport,
  scope,
  writeArtifact,
  origin = NX_CLOUD_ORIGIN,
  routes = NX_CLOUD_WALK_ROUTES,
  progress,
}: {
  transport: BrowserPageTransport;
  scope: NxCloudScope;
  writeArtifact: NxCloudArtifactWriter;
  origin?: string;
  routes?: readonly string[];
  progress?: (input: { line: string }) => void;
}): Promise<Result<NxCloudBrowserWalkResult>> {
  const observations: NxCloudRouteObservation[] = [];
  const declared: NxCloudDeclaredRoute[] = [];
  let sessionLost = false;
  for (const [index, pathPattern] of routes.entries()) {
    if (sessionLost) {
      observations.push(
        incompleteRoute({
          attempted: false,
          pathPattern,
          requestedUrl: "",
          why: "the walk stopped before this route: the browser session was lost part-way through",
        }),
      );
      continue;
    }
    progress?.({ line: `nx-cloud browser: ${String(index + 1)}/${String(routes.length)} ${pathPattern}` });
    const visited = await visitRoute({ origin, pathPattern, scope, transport, writeArtifact });
    observations.push(visited.observation);
    declared.push(...visited.declaredRoutes);
    sessionLost = visited.sessionLost;
  }
  return ok({
    declaredRoutes: foldDeclaredRoutes({ routes: declared }),
    routes: markIndistinguishableRoutes({ routes: observations }),
    sessionLost,
  });
}
