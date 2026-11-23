/**
 * Walk every page `browserPages.ts` declares, photograph each, and record what the client asked for.
 *
 * ## Declared, attempted, reached and PHOTOGRAPHED are four different things
 *
 * Each is recorded separately. A reached page with no verified PNG carries
 * {@link TrelicaPageObservation.screenshotMissingBecause}, raises its own gap, and stops the coverage cell
 * being `synced` — the owner asked for the screenshots by name, and a walk that quietly returns none has
 * not done what it says it did.
 *
 * ## A lost session stops the walk rather than failing every page after it
 *
 * A sign-in wall is a successful navigation, so without this one sign-out becomes eight false page gaps
 * that have nothing to do with the pages. Everything after the loss is recorded as `not-attempted`, which
 * is a different fact from `unreachable` and is kept as one. The vendor's sign-in origin and the tenant's own
 * sign-in path are CONSTANTS (`tenant.ts`), so landing on either is recognised rather than guessed at — by
 * `heldAddress.ts`, the one test the hand recheck asks too.
 *
 * ## An empty shell is not a reached page
 *
 * MEASURED: this is a single-page application and a route it does not have answers HTTP 200 with
 * the bare product title and no first-party call at all. Grading on status alone counted four such routes
 * as covered. `browserPages.ts`'s `isTrelicaEmptyShell` is the test, and it needs the call count, which is
 * why the reduction runs BEFORE the outcome is graded rather than after.
 *
 * ## Everything here is written against a seam
 *
 * `browser/pageTransport.ts` is the whole contract — `visit` and `release` — so the walk, the reduction and
 * the artifact writing all run against a deterministic fake in tests. A redirect, a lost body, a lost
 * session, an empty shell and a missing screenshot are settled by unit tests rather than by luck in a live
 * run.
 */
import { createHash } from "node:crypto";

import {
  type BrowserPageTransport,
  isCaptureComplete,
  type PageCapture,
  type ResponseAccounting,
} from "../../browser/pageTransport.js";
import { ok, type Result } from "../../lib/result.js";
import { isUnrenderedScreenshot, UNRENDERED_SCREENSHOT_BECAUSE, visitPhotographed } from "../kit/browserWalk.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { addressDisagreement } from "../kit/pageWalk.js";

import {
  isTrelicaEmptyShell,
  TRELICA_BROWSER_PAGES,
  type TrelicaBrowserPage,
  trelicaDeclaredPath,
  trelicaPageUrl,
} from "./browserPages.js";
import { reduceTrelicaCalls, type TrelicaObservedCall } from "./browserReduction.js";
import { isTrelicaSignInLanding, parseTrelicaAddress, trelicaHeldFinalUrl, trelicaHeldTitle } from "./heldAddress.js";
import { trelicaPageArtifactPath } from "./store.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * MEASURED: at a shorter settle the spend page photographed a loading spinner and its own aggregate
 * call had not returned; at this one it rendered and the call was captured. Reproduce with
 * `slopweaver atlas trelica walk` and compare the stored `callCount` for the `spend` page.
 *
 * @internal
 */
export const TRELICA_PAGE_SETTLE_MS = 9_000;

/**
 * Write a page's screenshot and PROVE it landed.
 *
 * Injected so the walk itself performs no I/O. An implementation must verify what it wrote — the byte
 * length and the digest — rather than reporting success from the write call alone, because the whole point
 * of the artifact is that a reader can trust the bytes are the ones that were seen.
 */
export type TrelicaArtifactWriter = (input: {
  relativePath: string;
  bytes: Uint8Array;
  sha256: string;
}) => Result<null>;

/** What one declared page's visit came to. */
export interface TrelicaPageObservation {
  readonly surface: string;
  /** Whether the walk got as far as asking for this page at all. `false` after a lost session. */
  readonly attempted: boolean;
  /** The URL asked for, or `""` when the page was never addressed. It carries the tenant label. */
  readonly requestedUrl: string;
  /** Where the page settled, in the closed form {@link trelicaHeldFinalUrl} returns, or `""` when never visited. */
  readonly finalUrl: string;
  readonly statusCode: number | null;
  /** The page's title in the closed form {@link trelicaHeldTitle} returns, or `""` when never visited. */
  readonly title: string;
  readonly observedAt: string;
  /** Whether the client sent this page somewhere other than where it was asked to go. */
  readonly redirected: boolean;
  /** Whether every eligible response body was read; false means the walk saw less than it looks like. */
  readonly captureComplete: boolean;
  /**
   * What the page's capture actually accounted for. Carried rather than reduced to the boolean above,
   * because "not complete" is a silence and "eligible 14, kept 12, lost 2" is a number somebody can act on.
   */
  readonly responseAccounting: ResponseAccounting;
  /** Why this declared page is not held, or `null` when it is. */
  readonly unreachableBecause: string | null;
  /**
   * Why this page has no proof screenshot, or `null` when it has one. A reached page that is not
   * photographed is an incomplete observation rather than a complete one missing a nicety.
   */
  readonly screenshotMissingBecause: string | null;
  readonly calls: readonly TrelicaObservedCall[];
  /** The proof screenshot, or an empty list when there is none — see {@link screenshotMissingBecause}. */
  readonly artifacts: readonly AtlasArtifactRef[];
}

/**
 * What the walk produced.
 *
 * @internal
 */
export interface TrelicaBrowserWalkResult {
  readonly pages: readonly TrelicaPageObservation[];
  /** Whether the walk stopped early because the session was lost. */
  readonly sessionLost: boolean;
}

/** An accounting that claims nothing, for a visit that never happened. */
const NO_ACCOUNTING: ResponseAccounting = { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 };

/**
 * The artifact reference for one page screenshot, addressed by the digest of its own bytes.
 *
 * Addressed by digest rather than by page name so the same bytes are the same artifact, and so a proof
 * cannot be swapped for a different picture under the same path.
 *
 * @param bytes the PNG bytes
 * @returns the reference, whose `relativePath` is relative to the atlas's own directory
 *
 * @internal
 */
export function trelicaScreenshotArtifact({ bytes }: { bytes: Uint8Array }): AtlasArtifactRef {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    byteLength: bytes.byteLength,
    kind: "page-png",
    mediaType: "image/png",
    relativePath: trelicaPageArtifactPath({ sha256 }),
    sha256,
  };
}

/**
 * How one visited page's reachability is graded.
 *
 * A page counts as reached only when the browser settled where it was asked — the kit's
 * {@link addressDisagreement}, which is the same origin, the same path, and every query parameter this
 * atlas's own declaration named — AND the page is not the application's empty shell. A parameter the CLIENT
 * appends is tolerated, because it is the client restoring its own view state and that is a different fact
 * from having been sent elsewhere.
 *
 * @param requestedUrl the URL the walk asked for
 * @param capture what the transport returned
 * @param firstPartyCallCount how many of the tenant's own calls the page made — the empty-shell test
 * @returns whether the page was redirected, and why it is not held when it is not. A reason never carries the settled
 *   address as the client wrote it, only the closed form {@link trelicaHeldFinalUrl} and {@link trelicaDeclaredPath}
 *   hold.
 *
 * @internal
 */
export function trelicaPageOutcome({
  requestedUrl,
  capture,
  firstPartyCallCount,
}: {
  requestedUrl: string;
  capture: PageCapture;
  firstPartyCallCount: number;
}): { redirected: boolean; unreachableBecause: string | null } {
  const settled = parseTrelicaAddress({ url: capture.finalUrl });
  const disagreement = addressDisagreement({ finalUrl: capture.finalUrl, requestedUrl });
  if (settled === null || disagreement === "unreadable") {
    return { redirected: false, unreachableBecause: "the walk could not read the address it settled on" };
  }
  if (disagreement === "origin") {
    // An origin disagreement means both addresses parsed, so the requested one is a URL here.
    const tenantOrigin = parseTrelicaAddress({ url: requestedUrl })!.origin;
    const where = trelicaHeldFinalUrl({ finalUrl: capture.finalUrl, tenantOrigin });
    return { redirected: true, unreachableBecause: `the client settled on ${where}` };
  }
  if (disagreement === "path") {
    return {
      redirected: true,
      unreachableBecause: `the client sent this page to ${trelicaDeclaredPath({ pathname: settled.pathname })} instead`,
    };
  }
  if (disagreement === "query") {
    return {
      redirected: true,
      unreachableBecause:
        "the client kept this page's path and dropped or changed a query parameter this atlas asked for, so what it rendered is not the view that was declared",
    };
  }
  if (isTrelicaEmptyShell({ firstPartyCallCount, title: capture.title })) {
    return {
      redirected: false,
      unreachableBecause:
        "the address answered with the application's empty shell — its bare product title and not one first-party call — which is how this single-page client renders a route it does not have",
    };
  }
  return { redirected: false, unreachableBecause: null };
}

/** The observation for a page the walk never got to. */
function notAttempted({ page, at }: { page: TrelicaBrowserPage; at: string }): TrelicaPageObservation {
  return {
    artifacts: [],
    attempted: false,
    calls: [],
    captureComplete: false,
    finalUrl: "",
    observedAt: at,
    redirected: false,
    requestedUrl: "",
    responseAccounting: NO_ACCOUNTING,
    screenshotMissingBecause: "the page was never visited",
    statusCode: null,
    surface: page.name,
    title: "",
    unreachableBecause: null,
  };
}

/**
 * Store one page's screenshot, returning the artifact when the bytes were verified on disk. Only a page that
 * settled where it was declared is photographed: a redirect can land on a page that renders provider-written text
 * (`TRELICA_UNPHOTOGRAPHED_PAGES`), so a page not held as declared keeps no pixels at all.
 */
function storeScreenshot({
  capture,
  notHeldBecause,
  writeArtifact,
}: {
  capture: PageCapture;
  /** Why the page is not held as declared, or `null` when it is. */
  notHeldBecause: string | null;
  writeArtifact: TrelicaArtifactWriter;
}): {
  artifacts: readonly AtlasArtifactRef[];
  missingBecause: string | null;
} {
  if (notHeldBecause !== null) {
    return {
      artifacts: [],
      missingBecause: `not photographed, because the page is not held as declared: ${notHeldBecause}`,
    };
  }
  if (capture.screenshotPng === null) {
    return { artifacts: [], missingBecause: "the browser reached this page and could not photograph it" };
  }
  if (isUnrenderedScreenshot({ bytes: capture.screenshotPng })) {
    return { artifacts: [], missingBecause: UNRENDERED_SCREENSHOT_BECAUSE };
  }
  const artifact = trelicaScreenshotArtifact({ bytes: capture.screenshotPng });
  const written = writeArtifact({
    bytes: capture.screenshotPng,
    relativePath: artifact.relativePath,
    sha256: artifact.sha256,
  });
  if (written.isErr()) {
    return { artifacts: [], missingBecause: `the screenshot could not be stored: ${written.error.join("; ")}` };
  }
  return { artifacts: [artifact], missingBecause: null };
}

/**
 * Walk every declared page in the owner's own browser.
 *
 * @param transport the attached browser seam
 * @param tenantOrigin this installation's tenant origin
 * @param writeArtifact how to store a screenshot and prove it landed
 * @param nowIso the clock, injected so the walk stays testable
 * @param progress an optional line sink, so a long walk is visible while it runs
 * @param pages which pages to walk; omitted takes the whole declared inventory
 * @returns every declared page's observation, and whether the session was lost part-way
 */
export async function walkTrelicaWebApp({
  transport,
  tenantOrigin,
  writeArtifact,
  nowIso,
  progress,
  pages = TRELICA_BROWSER_PAGES,
}: {
  transport: BrowserPageTransport;
  tenantOrigin: string;
  writeArtifact: TrelicaArtifactWriter;
  nowIso: () => string;
  progress?: (input: { line: string }) => void;
  pages?: readonly TrelicaBrowserPage[];
}): Promise<Result<TrelicaBrowserWalkResult>> {
  const observations: TrelicaPageObservation[] = [];
  let sessionLost = false;
  for (const page of pages) {
    if (sessionLost) {
      observations.push(notAttempted({ at: nowIso(), page }));
      continue;
    }
    const observed = await visitOne({ nowIso, page, tenantOrigin, transport, writeArtifact });
    sessionLost = observed.sessionLost;
    observations.push(observed.observation);
    progress?.({
      line: `  ${page.name}: ${observed.observation.unreachableBecause === null ? "reached" : "not held"}, ${String(observed.observation.calls.length)} first-party call(s)`,
    });
  }
  return ok({ pages: observations, sessionLost });
}

/** The observation for a page whose visit landed on a sign-in page instead. */
function signInObservation({
  capture,
  page,
  url,
  tenantOrigin,
}: {
  capture: PageCapture;
  page: TrelicaBrowserPage;
  url: string;
  tenantOrigin: string;
}): TrelicaPageObservation {
  const where = trelicaHeldFinalUrl({ finalUrl: capture.finalUrl, tenantOrigin });
  return {
    ...notAttempted({ at: capture.observedAt, page }),
    attempted: true,
    finalUrl: where,
    requestedUrl: url,
    unreachableBecause: `the client sent this page to the sign-in page at ${where} — the session is gone, so the rest of the walk was not attempted`,
  };
}

/** Visit one declared page and grade what came back, including whether the session survived it. */
async function visitOne({
  transport,
  tenantOrigin,
  writeArtifact,
  nowIso,
  page,
}: {
  transport: BrowserPageTransport;
  tenantOrigin: string;
  writeArtifact: TrelicaArtifactWriter;
  nowIso: () => string;
  page: TrelicaBrowserPage;
}): Promise<{ observation: TrelicaPageObservation; sessionLost: boolean }> {
  const url = trelicaPageUrl({ page, tenantOrigin });
  const visited = await visitPhotographed({ settleMs: TRELICA_PAGE_SETTLE_MS, transport, url });
  if (visited.isErr()) {
    return {
      observation: {
        ...notAttempted({ at: nowIso(), page }),
        attempted: true,
        requestedUrl: url,
        unreachableBecause: visited.error.message,
      },
      sessionLost: false,
    };
  }
  const capture = visited.value;
  if (isTrelicaSignInLanding({ finalUrl: capture.finalUrl })) {
    return { observation: signInObservation({ capture, page, tenantOrigin, url }), sessionLost: true };
  }
  const calls = reduceTrelicaCalls({ responses: capture.responses, tenantOrigin });
  const outcome = trelicaPageOutcome({ capture, firstPartyCallCount: calls.length, requestedUrl: url });
  const shot = storeScreenshot({ capture, notHeldBecause: outcome.unreachableBecause, writeArtifact });
  return {
    observation: {
      artifacts: shot.artifacts,
      attempted: true,
      calls,
      captureComplete: isCaptureComplete({ capture }),
      finalUrl: trelicaHeldFinalUrl({ finalUrl: capture.finalUrl, tenantOrigin }),
      observedAt: capture.observedAt,
      redirected: outcome.redirected,
      requestedUrl: url,
      responseAccounting: capture.responseAccounting,
      screenshotMissingBecause: shot.missingBecause,
      statusCode: capture.statusCode,
      surface: page.name,
      title: trelicaHeldTitle({ title: capture.title }),
      unreachableBecause: outcome.unreachableBecause,
    },
    sessionLost: false,
  };
}
