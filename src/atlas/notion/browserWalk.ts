/**
 * Walk every page `browserPages.ts` declares, photograph each, and record what the Notion client asked for.
 *
 * ## The denominator is DECLARED, which is what makes the coverage claim checkable
 *
 * A crawler cannot prove its own completeness — "we visited everything we found" is a claim about the
 * crawler. So the walk is judged against {@link NOTION_BROWSER_PAGES}, a list it did not choose: a declared
 * page never reached is a gap this atlas can NAME, where a page a crawler never noticed is not.
 *
 * ## Declared, attempted, reached and PHOTOGRAPHED are four different things
 *
 * Each is recorded separately, and the fourth is the one the two sibling walks get wrong. Both Vanta's and
 * CrowdStrike's drop a missing screenshot silently — no artifact ref, no failure, and coverage still stamped
 * a success — so a run that photographed nothing at all reads identically to one that photographed
 * everything. Here a reached page with no verified PNG carries {@link NotionPageObservation.screenshotMissingBecause},
 * raises its own gap, and stops the coverage cell being `synced`. The owner asked for the screenshots by
 * name; a walk that quietly returns none has not done what it says it did.
 *
 * ## A lost session stops the walk rather than failing every page after it
 *
 * A sign-in wall is a successful navigation, so without this one sign-out becomes a false page gap for
 * every declared page after it, none of which has anything to do with the pages. Everything after the loss is recorded as `not-attempted`, which is
 * a different fact from `unreachable` and is kept as one.
 *
 * ## A redirect is the whole reachability signal, and deliberately the only one for now
 *
 * Notion's client is a single-page app, so a route it does not have still answers HTTP 200 — the same trap
 * the Vanta walk hit, which it closed with a MEASURED not-found page title. No equivalent constant is
 * asserted here, because none has been measured for this client yet: {@link notionPageOutcome} grades only
 * on where the browser settled, which is checkable without one. A page whose client keeps the URL and swaps
 * the view underneath is therefore reported as reached, and that limit is stated in the run's own report
 * rather than left for a reader to discover.
 *
 * ## Everything here is written against a seam
 *
 * `browser/pageTransport.ts` is the whole contract — `visit` and `release` — so the walk, the reduction, the
 * artifact writing and every one of their tests run against a deterministic fake. A redirect, a lost body,
 * a lost session and a missing screenshot are settled by unit tests rather than by luck in a live run.
 */
import { createHash } from "node:crypto";

import {
  type BrowserPageTransport,
  type BrowserTransportError,
  isCaptureComplete,
  isWalkStoppingError,
  type PageCapture,
  type ResponseAccounting,
} from "../../browser/pageTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import { isUnrenderedScreenshot, UNRENDERED_SCREENSHOT_BECAUSE, visitPhotographed } from "../kit/browserWalk.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { addressDisagreement } from "../kit/pageWalk.js";
import type { WalkProgress } from "../kit/walkProgress.js";

import {
  isNotionNotFound,
  NOTION_BROWSER_PAGES,
  NOTION_MARKETING_ORIGIN,
  NOTION_WEB_ORIGIN,
  type NotionBrowserPage,
  notionPageUrl,
} from "./browserPages.js";
import { type NotionObservedCall, reduceNotionCalls } from "./browserReduction.js";
import { notionPageArtifactPath } from "./store.js";
import { resolveWorkspaceRoot, type WorkspaceRootResolution } from "./workspaceProbe.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * Longer than the Vanta walk's four seconds because Notion's client renders its page body from a chain of
 * its own calls rather than in one pass, so a short settle photographs a skeleton.
 *
 * @internal
 */
export const NOTION_PAGE_SETTLE_MS = 6_000;

/**
 * Write a page's screenshot and PROVE it landed.
 *
 * Injected so the walk itself performs no I/O. An implementation must verify what it wrote — the byte
 * length and the digest — rather than reporting success from the write call alone, because the whole point
 * of the artifact is that a reader can trust the bytes are the ones that were seen.
 */
export type NotionArtifactWriter = (input: { relativePath: string; bytes: Uint8Array; sha256: string }) => Result<null>;

/** What one declared page's visit came to. */
export interface NotionPageObservation {
  readonly surface: string;
  /** Whether the walk got as far as asking for this page at all. `false` after a lost session. */
  readonly attempted: boolean;
  /** The URL asked for, or `""` when the page was never addressed. Never printed — it carries the workspace slug. */
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number | null;
  readonly title: string;
  readonly observedAt: string;
  /** Whether the client sent this page somewhere other than where it was asked to go. */
  readonly redirected: boolean;
  /** Whether every eligible response body was read; false means the walk saw less than it looks like. */
  readonly captureComplete: boolean;
  /**
   * What the page's capture actually accounted for. Carried rather than reduced to the boolean above,
   * because "not complete" is a silence and "eligible <n>, kept <k>, lost <l>" is a number somebody can act on.
   */
  readonly responseAccounting: ResponseAccounting;
  /** Why this declared page is not held, or `null` when it is. */
  readonly unreachableBecause: string | null;
  /**
   * Why this page has no proof screenshot, or `null` when it has one. A reached page that is not
   * photographed is an incomplete observation rather than a complete one missing a nicety.
   */
  readonly screenshotMissingBecause: string | null;
  readonly calls: readonly NotionObservedCall[];
  /** The proof screenshot, or an empty list when there is none — see {@link screenshotMissingBecause}. */
  readonly artifacts: readonly AtlasArtifactRef[];
}

/**
 * What the walk produced.
 *
 * @internal
 */
export interface NotionBrowserWalkResult {
  /**
   * Whether the probe found a workspace segment at all. The root itself is NEVER carried out of this
   * process — it contains the organisation's own name (`browserPages.ts`).
   */
  readonly workspaceRootFound: boolean;
  readonly pages: readonly NotionPageObservation[];
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
 */
export function notionScreenshotArtifact({ bytes }: { bytes: Uint8Array }): AtlasArtifactRef {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    byteLength: bytes.byteLength,
    kind: "page-png",
    mediaType: "image/png",
    relativePath: notionPageArtifactPath({ sha256 }),
    sha256,
  };
}

/**
 * How one visited page's reachability is graded.
 *
 * A page counts as reached only when the browser settled on the same ORIGIN and the same PATH it was asked
 * for. A query-string difference is tolerated, because the client restores its own view state and that is a
 * different fact from having been sent elsewhere.
 *
 * ## The origin check is the part that was MEASURED into existence
 *
 * A route the app does not have lands on Notion's PUBLIC marketing site, answering HTTP 200 with a real page
 * title — measured, where `/templates` lands on the public template gallery and a
 * path-only rule graded it reached because the path happened to match. So a settle on another origin is the
 * honest failure signal here, and naming which origin is safe: an origin carries no workspace slug, which is
 * why it is the one part of a settled URL this reason quotes.
 *
 * @param requestedUrl the URL the walk asked for
 * @param capture what the transport returned
 * @returns whether the page was redirected, and why it is not held when it is not
 */
export function notionPageOutcome({ requestedUrl, capture }: { requestedUrl: string; capture: PageCapture }): {
  redirected: boolean;
  unreachableBecause: string | null;
} {
  const settled = parseUrl({ url: capture.finalUrl });
  const disagreement = addressDisagreement({ finalUrl: capture.finalUrl, requestedUrl });
  if (settled === null || disagreement === "unreadable") {
    return { redirected: true, unreachableBecause: "the browser settled on an address this atlas cannot read" };
  }
  if (settled.origin === NOTION_MARKETING_ORIGIN) {
    return {
      redirected: true,
      unreachableBecause: `the app has no such route — it answered ${String(capture.statusCode)} by landing on Notion's public marketing site`,
    };
  }
  if (disagreement === "origin") {
    return {
      redirected: true,
      unreachableBecause: `the client sent this address to ${settled.origin}, which is not where it was asked to go`,
    };
  }
  if (disagreement !== null) {
    // The settled path is not quoted: it can carry the workspace slug, which may not leave this process.
    return {
      redirected: true,
      unreachableBecause: `the Notion client did not keep this address — it answered ${String(capture.statusCode)} and settled on a different path`,
    };
  }
  // A single-page app KEEPS the address for a route it has never heard of, so the checks above all pass on
  // a page that does not exist. This is the one that catches it — see `NOTION_NOT_FOUND_TITLE`.
  if (isNotionNotFound({ title: capture.title })) {
    return {
      redirected: false,
      unreachableBecause: `the Notion client has no such route — it kept the address, answered ${String(capture.statusCode)} and rendered its not-found page`,
    };
  }
  return { redirected: false, unreachableBecause: null };
}

/**
 * Why a visit failed, in words that carry no URL.
 *
 * The transport's own `message` INTERPOLATES the address it was given —
 * `could not navigate to <url>: <reason>` — and a Notion URL carries the workspace slug. That message
 * therefore may not be quoted into an observation, because an observation reaches both report shapes and
 * the stored generation. A Codex review pass found this by counterexample: a declared page that times out
 * put the whole workspace-bearing URL on stdout, under a comment claiming no URL is ever printed.
 *
 * The `code` says what kind of failure it was, which is what a reader can act on, and the transport's
 * `reason` half is deliberately dropped rather than parsed out — a substring rule over somebody else's
 * message is exactly how this class comes back.
 *
 * @param error the transport's typed failure
 * @returns the reason to record, carrying no address
 */
function transportReason({ error }: { error: BrowserTransportError }): string {
  if (error.code === "SESSION_LOST") {
    return "the browser session was lost — sign in to Notion in your own Chrome and run the walk again";
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

/** A URL, or `null` when it cannot be read. */
function parseUrl({ url }: { url: string }): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** A row for a declared page the walk never completed, whether it was addressed or not. */
function incompletePage({
  page,
  attempted,
  why,
  requestedUrl,
}: {
  page: NotionBrowserPage;
  attempted: boolean;
  why: string;
  requestedUrl: string;
}): NotionPageObservation {
  return {
    artifacts: [],
    attempted,
    calls: [],
    captureComplete: false,
    finalUrl: "",
    observedAt: "",
    redirected: false,
    requestedUrl,
    responseAccounting: NO_ACCOUNTING,
    screenshotMissingBecause: "the page was never photographed, because the visit did not complete",
    statusCode: null,
    surface: page.surface,
    title: "",
    unreachableBecause: why,
  };
}

/** Write one page's screenshot; a missing or unwritten PNG is a recorded incompleteness, never a silence. */
function writeScreenshot({ capture, writeArtifact }: { capture: PageCapture; writeArtifact: NotionArtifactWriter }): {
  artifacts: readonly AtlasArtifactRef[];
  missingBecause: string | null;
} {
  if (capture.screenshotPng === null) {
    return {
      artifacts: [],
      missingBecause: "the page was reached but the browser returned no screenshot for it",
    };
  }
  if (isUnrenderedScreenshot({ bytes: capture.screenshotPng })) {
    return { artifacts: [], missingBecause: UNRENDERED_SCREENSHOT_BECAUSE };
  }
  const ref = notionScreenshotArtifact({ bytes: capture.screenshotPng });
  const written = writeArtifact({ bytes: capture.screenshotPng, relativePath: ref.relativePath, sha256: ref.sha256 });
  if (written.isErr()) {
    return { artifacts: [], missingBecause: `the screenshot could not be stored: ${written.error.join("; ")}` };
  }
  return { artifacts: [ref], missingBecause: null };
}

/**
 * Visit one declared page, photograph it and reduce what it asked for.
 *
 * @param page the declared page
 * @param workspace the root the probe learned, or why there is none
 * @param transport the bound page transport
 * @param writeArtifact where the screenshot is written
 * @returns the observation and whether the session was lost — a failed visit is a recorded row, never a
 *   thrown walk, but a lost session ends the walk
 */
async function visitPage({
  page,
  workspace,
  transport,
  writeArtifact,
}: {
  page: NotionBrowserPage;
  workspace: WorkspaceRootResolution;
  transport: BrowserPageTransport;
  writeArtifact: NotionArtifactWriter;
}): Promise<{ observation: NotionPageObservation; sessionLost: boolean }> {
  const requestedUrl = notionPageUrl({ page, workspaceRoot: workspace.root });
  if (requestedUrl === null) {
    // Only a workspace-rooted page with no root answers `null`, so the resolution carries its reason.
    return {
      observation: incompletePage({ attempted: false, page, requestedUrl: "", why: workspace.rootMissingBecause! }),
      sessionLost: false,
    };
  }
  const visited = await visitPhotographed({ settleMs: NOTION_PAGE_SETTLE_MS, transport, url: requestedUrl });
  if (visited.isErr()) {
    const lost = isWalkStoppingError({ error: visited.error });
    return {
      observation: incompletePage({
        attempted: true,
        page,
        requestedUrl,
        why: transportReason({ error: visited.error }),
      }),
      sessionLost: lost,
    };
  }
  const capture = visited.value;
  const outcome = notionPageOutcome({ capture, requestedUrl });
  const shot = writeScreenshot({ capture, writeArtifact });
  return {
    observation: {
      artifacts: shot.artifacts,
      attempted: true,
      calls: reduceNotionCalls({ origin: NOTION_WEB_ORIGIN, responses: capture.responses }),
      captureComplete: isCaptureComplete({ capture }),
      finalUrl: capture.finalUrl,
      observedAt: capture.observedAt,
      redirected: outcome.redirected,
      requestedUrl,
      responseAccounting: capture.responseAccounting,
      screenshotMissingBecause: shot.missingBecause,
      statusCode: capture.statusCode,
      surface: page.surface,
      title: capture.title,
      unreachableBecause: outcome.unreachableBecause,
    },
    sessionLost: false,
  };
}

/** A row for a declared page the walk never got to, because the session was lost before it. */
function notAttemptedPage({ page }: { page: NotionBrowserPage }): NotionPageObservation {
  return incompletePage({
    attempted: false,
    page,
    requestedUrl: "",
    why: "the walk stopped before this page: the browser session was lost part-way through",
  });
}

/**
 * Whether one observation is fully held — reached, photographed, and carrying the artifact to prove it.
 *
 * The artifact check is not redundant with `screenshotMissingBecause === null`, and a Codex review pass
 * found the gap by counterexample: a row can carry both nullable reasons and an EMPTY artifact list, because
 * those two fields are set by the walk and the artifact list is set by the writer. Grading on the reasons
 * alone let a complete-looking walk with no screenshots anywhere on disk publish `synced` coverage — and the
 * test helper that built such rows was itself the counterexample, which is how a defect like this survives
 * a suite that passes.
 *
 * @param page the observation to judge
 * @returns whether the atlas holds this declared page in full
 */
export function isPageHeld({ page }: { page: NotionPageObservation }): boolean {
  return page.unreachableBecause === null && page.screenshotMissingBecause === null && page.artifacts.length > 0;
}

/**
 * Mark every page whose picture is byte-identical to another declared page's as not independently evidenced.
 *
 * ## Why a duplicate screenshot is a FINDING rather than a saving
 *
 * Artifacts are content-addressed, so two pages that photograph the same thing share one file — which is
 * correct storage and a silent disaster for a coverage claim. MEASURED: a walk reported a set of
 * declared routes reached and photographed, and every one of those screenshots was the same file, because
 * each was Notion's not-found shell. The title check above catches THAT case; this catches the whole
 * class, including the ones no vendor-specific constant would.
 *
 * The rule is exactly as strong as it should be: a picture identical to another page's does not evidence a
 * distinct surface, whatever produced it. Two genuinely identical pages are vanishingly unlikely — a real
 * page renders its own name — and being wrong here costs a page a coverage credit rather than granting one.
 *
 * @param pages every declared page's observation
 * @returns the observations, with a shared picture recorded on each page that shares one
 */
export function markIndistinguishablePages({
  pages,
}: {
  pages: readonly NotionPageObservation[];
}): readonly NotionPageObservation[] {
  const bySha = Map.groupBy(
    pages.flatMap((page) => page.artifacts.map((artifact) => ({ sha256: artifact.sha256, surface: page.surface }))),
    (entry) => entry.sha256,
  );
  return pages.map((page): NotionPageObservation => {
    // Every artifact any page carries was grouped above, so each of this page's own lookups is present.
    const shared = page.artifacts.flatMap((artifact) => bySha.get(artifact.sha256)!.map((entry) => entry.surface));
    const others = [...new Set(shared)].filter((surface) => surface !== page.surface).toSorted();
    if (others.length === 0) {
      return page;
    }
    return {
      ...page,
      artifacts: [],
      screenshotMissingBecause:
        `its screenshot is byte-identical to ${String(others.length)} other declared page(s) ` +
        `(${others.join(", ")}), so it evidences no surface of its own`,
    };
  });
}

/**
 * Walk every declared Notion page.
 *
 * Strictly sequential, one page at a time: it drives the owner's own browser, so two pages at once would
 * fight over the tab the owner is looking at.
 *
 * @param transport the bound page transport, released by the caller rather than here
 * @param writeArtifact where each page's screenshot is written and verified
 * @param progress where a line of progress goes; omitted discards it. It is given the surface NAME and
 *   never a URL, because a Notion URL carries the workspace slug
 * @returns every declared page's observation, or why the walk could not start at all
 */
export async function walkNotionBrowser({
  transport,
  writeArtifact,
  progress,
}: {
  transport: BrowserPageTransport;
  writeArtifact: NotionArtifactWriter;
  progress?: WalkProgress;
}): Promise<Result<NotionBrowserWalkResult>> {
  const workspace = await resolveWorkspaceRoot({ progress, settleMs: NOTION_PAGE_SETTLE_MS, transport });
  if (workspace.isErr()) {
    return err(workspace.error);
  }
  const pages: NotionPageObservation[] = [];
  let sessionLost = false;
  for (const [index, page] of NOTION_BROWSER_PAGES.entries()) {
    if (sessionLost) {
      pages.push(notAttemptedPage({ page }));
      continue;
    }
    progress?.({
      line: `notion browser: ${String(index + 1)}/${String(NOTION_BROWSER_PAGES.length)} ${page.surface}`,
    });
    const visited = await visitPage({ page, transport, workspace: workspace.value, writeArtifact });
    pages.push(visited.observation);
    sessionLost = visited.sessionLost;
  }
  return ok({
    pages: markIndistinguishablePages({ pages }),
    sessionLost,
    workspaceRootFound: workspace.value.root !== null,
  });
}
