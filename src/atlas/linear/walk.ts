/**
 * The browser surface, ACQUIRED: one visit per planned settings page, in the owner's own Chrome.
 *
 * ## Nothing here launches a browser
 *
 * The seam is `browser/pageTransport.ts` and production resolves it to `browser/playwrightCli.ts`, which
 * attaches to the Chrome the owner is already running through the Playwright Extension relay
 * ([browser-route](../../../docs/browser-route/target-proof-and-playwright.md#playwright-is-the-transport-and-it-reaches-the-owners-real-chrome)). This module NAVIGATES and observes: no click, no form
 * submission, no request replay, so the pages Linear's own client fetches while a settings page renders are
 * passive observations rather than actions taken on the owner's behalf. A test injects a deterministic fake, so the
 * behaviour on a redirect, a lost session and a missing screenshot is settled by unit tests rather than by
 * luck in a live run.
 *
 * ## A redirect is the answer, not a failure
 *
 * When `viewer.admin` is `false`, a workspace-administration route answers by moving the browser somewhere
 * else. Recording the DESTINATION as a reached page is the single most dangerous thing a walk of a
 * single-page application can do — it is how a walk reports full coverage of every route having reached
 * one, which is the failure canon records for the Slack walk. So a settled
 * address that is not the address asked for is stored with `redirected: true` and the page counts as a GAP
 * rather than as coverage.
 *
 * ## A page without its screenshot is NOT reached
 *
 * `docs/atlas-intent/05-browser-proof.md` makes the held picture part of what a page record IS, so grading a page reached on
 * the strength of a title and a URL would report coverage the atlas cannot show anybody. A page the browser
 * opened but could not photograph gets its own outcome — `unphotographed` — which keeps the observation
 * without letting it count toward a filled surface. A Codex review pass named this: a screenshot read failure
 * currently becomes `null` in the transport, so without this distinction it would be invisible.
 *
 * ## `--limit` bounds what is VISITED, never what was declared
 *
 * A bounded walk still takes the whole plan and records every route past the bound as `not-attempted`. That
 * is the fix for a real defect a Codex review pass found: slicing the plan before the walk
 * made the limited prefix the whole denominator, so a one-page run reported the browser surface `synced`
 * over every declared page — and, worse, counted as a COMPLETE walk, which let it mark every page an earlier
 * full walk had found as stale. The denominator is what was declared; the limit only says how far this run
 * got.
 *
 * ## A lost session stops the walk; one gated page does not
 *
 * The distinction is the CrowdStrike walk's and it is the right one: a failed visit costs one page, while a
 * lost session would make every remaining route fail for a reason that has nothing to do with the route.
 * Those are returned as not-attempted, so a reader can tell a walk that was refused from a walk that ended.
 */
import { createHash } from "node:crypto";

import { type BrowserPageTransport, isWalkStoppingError, type PageCapture } from "../../browser/pageTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import { isUnrenderedScreenshot, visitPhotographed } from "../kit/browserWalk.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { walkTicker } from "../kit/walkProgress.js";

import { LinearAtlasErrors, linearAtlasErrorLines } from "./errors.js";
import type { CapturedGraphqlResponse } from "./graphqlObservations.js";
import type { LinearPlannedPage } from "./routes.js";

/**
 * Where a screenshot's bytes are written. The walk never touches the filesystem itself.
 * @internal
 */
export type ArtifactWriter = (input: { relativePath: string; bytes: Uint8Array }) => Result<null>;

/**
 * Where a line of progress goes.
 * @internal
 */
export type WalkProgress = (input: { line: string }) => void;

/**
 * How long to keep observing after a settings page loads.
 *
 * Linear's settings screens are client-rendered and fetch their own data after first paint, so a visit that
 * returned at load would capture the shell and none of the GraphQL calls the walk exists to see.
 * @internal
 */
export const PAGE_SETTLE_MS = 4_000;

/** What one visited page came to. */
export interface LinearPageObservation {
  readonly providerId: string;
  readonly area: string;
  readonly pageScope: string;
  readonly requestedUrl: string;
  readonly outcome: "reached" | "unphotographed" | "redirected" | "failed" | "not-attempted";
  readonly finalUrl: string | null;
  readonly statusCode: number | null;
  readonly title: string | null;
  readonly observedAt: string | null;
  readonly graphqlCallCount: number;
  readonly artifacts: readonly AtlasArtifactRef[];
  /** Whether every response the transport wanted was actually read. A dropped body is not a silence. */
  readonly captureComplete: boolean;
}

/**
 * Everything one walk saw.
 * @internal
 */
export interface LinearWalkResult {
  readonly pages: readonly LinearPageObservation[];
  readonly responses: readonly CapturedGraphqlResponse[];
  readonly artifactsWritten: number;
  /** Routes never attempted because the session was lost partway. */
  readonly notAttempted: readonly string[];
  /** Pages reached whose capture lost at least one response body. */
  readonly incompletePages: readonly string[];
}

/**
 * The artifact reference for one page screenshot, addressed by the digest of its own bytes.
 *
 * Addressed by digest rather than by page name so identical bytes are one artifact, and so a proof
 * screenshot can be shown to be the bytes that were seen rather than bytes that later replaced them.
 *
 * @param bytes the PNG the transport handed back
 * @returns the reference, whose `relativePath` is relative to the atlas's own directory
 */
export function screenshotArtifact({ bytes }: { bytes: Uint8Array }): AtlasArtifactRef {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    byteLength: bytes.byteLength,
    kind: "page-png",
    mediaType: "image/png",
    relativePath: `artifacts/settings/${sha256}.png`,
    sha256,
  };
}

/** Whether the transport read every response body it wanted for one page. */
function isCaptureComplete({ capture }: { capture: PageCapture }): boolean {
  return capture.responseAccounting.bodyFailed === 0;
}

/**
 * Write one page's screenshot; a write that fails costs the artifact, never the page.
 *
 * A capture that is a picture of the settings client still loading is discarded here rather than written, so
 * the page reaches its row as `unphotographed` — the same outcome an absent capture gets, because it says
 * the same thing about what this atlas can show anybody.
 */
function writeScreenshot({ capture, writeArtifact }: { capture: PageCapture; writeArtifact: ArtifactWriter }): {
  refs: readonly AtlasArtifactRef[];
  written: number;
} {
  if (capture.screenshotPng === null || isUnrenderedScreenshot({ bytes: capture.screenshotPng })) {
    return { refs: [], written: 0 };
  }
  const ref = screenshotArtifact({ bytes: capture.screenshotPng });
  const written = writeArtifact({ bytes: capture.screenshotPng, relativePath: ref.relativePath });
  return written.isErr() ? { refs: [], written: 0 } : { refs: [ref], written: 1 };
}

/** A page that was not visited at all, so its row says which of the two reasons applies. */
function unvisitedPage({
  page,
  outcome,
}: {
  page: LinearPlannedPage;
  outcome: "failed" | "not-attempted";
}): LinearPageObservation {
  return {
    area: page.area,
    artifacts: [],
    captureComplete: false,
    finalUrl: null,
    graphqlCallCount: 0,
    observedAt: null,
    outcome,
    pageScope: page.pageScope,
    providerId: page.providerId,
    requestedUrl: page.url,
    statusCode: null,
    title: null,
  };
}

/** A redirect outranks a missing screenshot: a page that went somewhere else was never this page at all. */
function redirectOutcome({
  redirected,
  photographed,
}: {
  redirected: boolean;
  photographed: boolean;
}): "reached" | "unphotographed" | "redirected" {
  if (redirected) {
    return "redirected";
  }
  return photographed ? "reached" : "unphotographed";
}

/** Whether the browser settled somewhere other than where it was sent, query strings and fragments aside. */
function isRedirect({ requested, settled }: { requested: string; settled: string }): boolean {
  try {
    const from = new URL(requested);
    const to = new URL(settled);
    return from.origin !== to.origin || from.pathname.replace(/\/$/, "") !== to.pathname.replace(/\/$/, "");
  } catch {
    return requested !== settled;
  }
}

/** How many of one capture's responses came from the GraphQL endpoint. */
function graphqlCountOf({ capture }: { capture: PageCapture }): number {
  return capture.responses.filter((response) => {
    try {
      return new URL(response.url).pathname.endsWith("/graphql");
    } catch {
      return false;
    }
  }).length;
}

/**
 * One capture's responses in the shape this walk stores them.
 *
 * The spread rather than a plain `requestBody: response.requestBody` is `exactOptionalPropertyTypes`: an
 * absent request body must be an absent KEY, not one spelled `undefined`, or the stored row claims a field
 * the capture never had.
 */
function capturedResponses({ capture }: { capture: PageCapture }): readonly CapturedGraphqlResponse[] {
  return capture.responses.map((response) => ({
    body: response.body,
    url: response.url,
    ...(response.requestBody === undefined ? {} : { requestBody: response.requestBody }),
  }));
}

/**
 * Visit every planned page, in order, and accumulate what each one showed.
 *
 * @param pages every page `routes.ts` planned for this workspace
 * @param transport the browser seam
 * @param writeArtifact where a screenshot is written
 * @param progress where a line of progress goes; omitted discards it
 * @param limit how many pages to actually visit; the rest are recorded as not-attempted, never dropped
 * @returns what the walk saw, or the reason it could not start
 */
export async function walkLinearSettings({
  pages,
  transport,
  writeArtifact,
  progress,
  limit,
}: {
  pages: readonly LinearPlannedPage[];
  transport: BrowserPageTransport;
  writeArtifact: ArtifactWriter;
  progress?: WalkProgress;
  limit?: number;
}): Promise<Result<LinearWalkResult>> {
  if (pages.length === 0) {
    return err(linearAtlasErrorLines({ error: LinearAtlasErrors.pagesUnplanned() }));
  }
  const observed: LinearPageObservation[] = [];
  const responses: CapturedGraphqlResponse[] = [];
  const incompletePages: string[] = [];
  let artifactsWritten = 0;
  let sessionLost = false;
  const tick = walkTicker({ label: "linear settings", progress, total: pages.length });

  for (const [index, page] of pages.entries()) {
    if (sessionLost || (limit !== undefined && index >= limit)) {
      observed.push(unvisitedPage({ outcome: "not-attempted", page }));
      continue;
    }
    tick({ page: page.providerId, position: index + 1 });
    const visited = await visitPhotographed({ settleMs: PAGE_SETTLE_MS, transport, url: page.url });
    if (visited.isErr()) {
      const lost = isWalkStoppingError({ error: visited.error });
      sessionLost = lost;
      observed.push(unvisitedPage({ outcome: lost ? "not-attempted" : "failed", page }));
      continue;
    }
    const capture = visited.value;
    const artifacts = writeScreenshot({ capture, writeArtifact });
    artifactsWritten += artifacts.written;
    observed.push(foldVisit({ artifacts: artifacts.refs, capture, page }));
    responses.push(...capturedResponses({ capture }));
    if (!isCaptureComplete({ capture })) {
      incompletePages.push(page.providerId);
    }
  }

  await transport.release();
  return ok({
    artifactsWritten,
    incompletePages,
    notAttempted: observed.filter((page) => page.outcome === "not-attempted").map((page) => page.providerId),
    pages: observed,
    responses,
  });
}

/**
 * Fold one completed visit into the row this walk stores.
 *
 * Separate from the loop because every judgement about what a visit MEANT is here: whether the browser
 * settled where it was sent, whether the page was photographed, and how those two combine into an outcome.
 *
 * @param artifacts the screenshot references this visit produced, empty when none was written
 * @param capture what the transport handed back
 * @param page the page that was asked for
 * @returns the observation to store
 */
function foldVisit({
  artifacts,
  capture,
  page,
}: {
  artifacts: readonly AtlasArtifactRef[];
  capture: PageCapture;
  page: LinearPlannedPage;
}): LinearPageObservation {
  return {
    area: page.area,
    artifacts,
    captureComplete: isCaptureComplete({ capture }),
    finalUrl: capture.finalUrl,
    graphqlCallCount: graphqlCountOf({ capture }),
    observedAt: capture.observedAt,
    outcome: redirectOutcome({
      photographed: artifacts.length > 0,
      redirected: isRedirect({ requested: page.url, settled: capture.finalUrl }),
    }),
    pageScope: page.pageScope,
    providerId: page.providerId,
    requestedUrl: page.url,
    statusCode: capture.statusCode,
    title: capture.title,
  };
}
