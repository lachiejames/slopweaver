/**
 * Walk GitHub's admin pages in the owner's own Chrome, photograph each, and record what its client asked for.
 *
 * ## The denominator is a FRONTIER, and every round of it is recorded
 *
 * `webRoutes.ts` carries the long version: GitHub publishes no authenticated settings sitemap, so this walk
 * cannot be judged against a vendor list the way the Falcon one is. It starts from structural seeds, keeps
 * every admin link each landed page RENDERED, and repeats until a round discovers nothing new. Each page
 * records which page its link came from, so the frontier is reconstructable from the generation rather than
 * being a property of a run nobody kept.
 *
 * ## Declared, reachable and openable are three different things
 *
 * A discovered page may 404, may redirect to a sign-in or SSO wall, or may be gated behind a role this
 * account does not hold. Every one of those is a COMPLETED attempt against a real link GitHub rendered,
 * recorded on the page's own row — never a walk failure, and never a page silently credited to wherever it
 * landed.
 *
 * ## A page without its screenshot is NOT credited, and that is a deliberate departure
 *
 * The CrowdStrike walk turns a missing screenshot into an empty artifact list and keeps the page. This one
 * does not: `docs/atlas-intent/05-browser-proof.md` makes the stored screenshot load-bearing — "it should know what the
 * exact URL to open in the browser is" and the atlas holds the image so an agent can look at a page without
 * piloting a browser to it. A row that says a page landed while holding no picture of it is a claim the
 * atlas cannot back, so the outcome becomes `unphotographed` and the shortfall is a named gap.
 *
 * ## Everything here is written against a seam
 *
 * `browser/pageTransport.ts` is the whole contract: `visit` and `release`. The walk, the reduction and the
 * artifact writing all run against a deterministic fake in tests, so a redirect, a lost body, a lost session
 * and a missing screenshot are settled by unit tests rather than by luck in a live run.
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
import { isRecordableResponse } from "../kit/consoleFold.js";
import type { AtlasArtifactRef } from "../kit/contract.js";

import { GithubRefusalErrors, githubRefusalErrorLines } from "./errors.js";
import { type ObservedWebCall, reduceWebCalls, type WebRequestObservation } from "./webReduction.js";
import { expandFrontier, isAdminPath, MAX_FRONTIER_ROUNDS } from "./webRoutes.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught.
 *
 * @internal
 */
export const PAGE_SETTLE_MS = 2_500;

/**
 * Where a screenshot is written, injected so the walk itself performs no I/O.
 *
 * @internal
 */
export type ArtifactWriter = (input: { relativePath: string; bytes: Uint8Array }) => Result<null>;

/** How one visited admin page's outcome is graded. */
export type AdminPageOutcome = "landed" | "redirected" | "unavailable" | "unphotographed" | "failed" | "not-attempted";

/** What one admin page's visit came to. */
export interface AdminPageObservation {
  readonly artifacts: readonly AtlasArtifactRef[];
  /** The page this one's link was found on, or `null` when it is a seed. */
  readonly discoveredFrom: string | null;
  readonly finalUrl: string | null;
  /** Same-origin admin links this page itself rendered — the next round's frontier. */
  readonly linksRendered: readonly string[];
  readonly outcome: AdminPageOutcome;
  readonly path: string;
  readonly statusCode: number | null;
  readonly title: string | null;
}

/** What the walk produced. */
export interface GithubWebWalkResult {
  readonly pages: readonly AdminPageObservation[];
  readonly requests: readonly WebRequestObservation[];
  /** Pages whose response bodies were not all captured — the walk saw less than it looks like it did. */
  readonly incompletePages: readonly string[];
  /**
   * Pages whose LINK read failed, with the reason the transport gave.
   *
   * The frontier is built from the links a page rendered, so a page whose link read threw contributes
   * nothing and looks exactly like a page with no admin links — which is how a walk that read no navigation
   * at all reports a closed frontier. `PageCapture.linksBlockedBecause` exists to make that falsifiable and
   * this is where it is consumed; a review found the first version capturing the field and then ignoring it,
   * which left the guarantee stated and unenforced.
   */
  readonly linkReadFailures: readonly { readonly path: string; readonly reason: string }[];
  /** Paths the frontier discovered and the walk never attempted, because the session was lost part-way. */
  readonly notAttempted: readonly string[];
  /**
   * Paths still in the frontier when the round cap was reached.
   *
   * Distinct from `notAttempted`: those were lost to a broken session, these were never reached because
   * expansion was bounded. A reader must be able to tell "the walk stopped" from "the walk ran out of
   * rounds", because only the second means the frontier was still growing.
   */
  readonly frontierRemaining: readonly string[];
  readonly artifactsWritten: number;
  /** How many rounds of link expansion actually ran, so a walk that closed early says so. */
  readonly roundsRun: number;
}

/**
 * Where a line of progress goes.
 *
 * @internal
 */
export type GithubWalkProgress = (input: { line: string }) => void;

/**
 * How one visited page's outcome is graded.
 *
 * A redirect is its own outcome rather than a success at a different address, because "this page exists and
 * sends you elsewhere" and "this page rendered" are different answers. A page that rendered and could not
 * be photographed is its own outcome too — see this file's header on why it is not credited as landed.
 *
 * @param capture what the transport returned
 * @param origin the origin the walk is bound to, so a page that settled off it is not read as reached
 * @returns the outcome to record on the page's row
 */
export function outcomeOf({ capture, origin }: { capture: PageCapture; origin: string }): AdminPageOutcome {
  if (capture.statusCode !== null && capture.statusCode >= 400) {
    return "unavailable";
  }
  if (!settledOnOrigin({ capture, origin }) || isRedirected({ capture })) {
    return "redirected";
  }
  return capture.screenshotPng === null ? "unphotographed" : "landed";
}

/**
 * Whether the browser settled on the origin the walk asked for.
 *
 * Checked separately from {@link isRedirected} because a status code cannot answer it. A single-page
 * application asked for a route it does not have can land on the vendor's PUBLIC site and answer HTTP 200
 * with a real page title — a sibling atlas graded a marketing page as a reached workspace surface that way
 * before it was fixed. GitHub's own not-found is a real 404, so this is defence rather than a measured
 * failure here; it costs one comparison and removes a whole class of false coverage.
 *
 * @param capture what the transport returned
 * @param origin the origin the walk is bound to
 * @returns whether the final URL is still on that origin
 */
export function settledOnOrigin({ capture, origin }: { capture: PageCapture; origin: string }): boolean {
  try {
    return new URL(capture.finalUrl).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/** A row for a path that could not be visited at all. */
function unvisitedPage({
  path,
  discoveredFrom,
  outcome,
}: {
  path: string;
  discoveredFrom: string | null;
  outcome: AdminPageOutcome;
}): AdminPageObservation {
  return {
    artifacts: [],
    discoveredFrom,
    finalUrl: null,
    linksRendered: [],
    outcome,
    path,
    statusCode: null,
    title: null,
  };
}

/**
 * Write one page's screenshot; a write that fails costs the page its `landed` grade, not just its picture.
 *
 * A capture that is a picture of a page mid-load is discarded here rather than written, so it reaches the
 * row as `unphotographed` — the same grade an absent capture gets, because it says the same thing.
 */
function writeScreenshot({ capture, writeArtifact }: { capture: PageCapture; writeArtifact: ArtifactWriter }): {
  refs: readonly AtlasArtifactRef[];
  written: number;
} {
  if (capture.screenshotPng === null || isUnrenderedScreenshot({ bytes: capture.screenshotPng })) {
    return { refs: [], written: 0 };
  }
  const ref = screenshotArtifact({ bytes: capture.screenshotPng, directory: "artifacts/web" });
  const written = writeArtifact({ bytes: capture.screenshotPng, relativePath: ref.relativePath });
  return written.isErr() ? { refs: [], written: 0 } : { refs: [ref], written: 1 };
}

/** One page's visit, folded into an observation plus whatever calls it produced. */
function foldVisit({
  path,
  discoveredFrom,
  capture,
  origin,
  writeArtifact,
}: {
  path: string;
  discoveredFrom: string | null;
  capture: PageCapture;
  origin: string;
  writeArtifact: ArtifactWriter;
}): { page: AdminPageObservation; calls: readonly ObservedWebCall[]; written: number } {
  const screenshot = writeScreenshot({ capture, writeArtifact });
  const graded = outcomeOf({ capture, origin });
  const outcome: AdminPageOutcome = graded === "landed" && screenshot.refs.length === 0 ? "unphotographed" : graded;
  const calls = capture.responses
    .filter((response) => isRecordableResponse({ origin, response }))
    .map((response) => ({
      body: response.body,
      method: response.method,
      onPage: path,
      statusCode: response.statusCode,
      url: response.url,
    }));
  return {
    calls,
    page: {
      artifacts: screenshot.refs,
      discoveredFrom,
      finalUrl: capture.finalUrl,
      linksRendered: capture.links.filter((href) => isAdminLink({ href, origin })),
      outcome,
      path,
      statusCode: capture.statusCode,
      title: capture.title,
    },
    written: screenshot.written,
  };
}

/** Whether one rendered href points at an admin page on this origin. */
function isAdminLink({ href, origin }: { href: string; origin: string }): boolean {
  try {
    const parsed = new URL(href, origin);
    return parsed.origin === new URL(origin).origin && isAdminPath({ path: parsed.pathname });
  } catch {
    return false;
  }
}

/** One entry in the frontier: where to go, and which page's link sent us there. */
interface FrontierEntry {
  readonly path: string;
  readonly discoveredFrom: string | null;
}

/** What one walk accumulates across its rounds. Mutable by design — the rounds append to it in order. */
interface WalkState {
  readonly pages: AdminPageObservation[];
  readonly calls: ObservedWebCall[];
  readonly incompletePages: string[];
  readonly linkReadFailures: { path: string; reason: string }[];
  artifactsWritten: number;
  sessionLost: boolean;
}

/**
 * Visit every page in one round of the frontier, appending what each showed.
 *
 * A visit that fails is recorded as `failed` and the round continues — one gated page must not end a walk.
 * A LOST SESSION is different and stops everything after it: every later page would be recorded as failed
 * for a reason that has nothing to do with the page, which would turn one sign-out into a hundred false
 * gaps.
 *
 * @param queue the pages this round visits
 * @param roundsRun which round this is, for the progress line
 * @param transport the browser seam
 * @param origin the web origin
 * @param writeArtifact where a screenshot is written
 * @param visited every path already attempted, which this round adds to
 * @param state the walk's accumulator
 * @param progress where a line of progress goes; omitted discards it
 * @returns every same-origin admin link this round's landed pages rendered
 */
async function walkRound({
  queue,
  roundsRun,
  transport,
  origin,
  writeArtifact,
  visited,
  state,
  progress,
}: {
  queue: readonly FrontierEntry[];
  roundsRun: number;
  transport: BrowserPageTransport;
  origin: string;
  writeArtifact: ArtifactWriter;
  visited: Set<string>;
  state: WalkState;
  progress?: GithubWalkProgress;
}): Promise<readonly string[]> {
  const rendered: string[] = [];
  for (const [index, entry] of queue.entries()) {
    if (state.sessionLost) {
      state.pages.push(unvisitedPage({ ...entry, outcome: "not-attempted" }));
      continue;
    }
    visited.add(entry.path);
    progress?.({
      line: `github admin: round ${String(roundsRun)} ${String(index + 1)}/${String(queue.length)} ${entry.path}`,
    });
    const visit = await visitPhotographed({ settleMs: PAGE_SETTLE_MS, transport, url: `${origin}${entry.path}` });
    if (visit.isErr()) {
      state.sessionLost = isWalkStoppingError({ error: visit.error });
      state.pages.push(unvisitedPage({ ...entry, outcome: state.sessionLost ? "not-attempted" : "failed" }));
      continue;
    }
    const folded = foldVisit({ ...entry, capture: visit.value, origin, writeArtifact });
    state.pages.push(folded.page);
    state.calls.push(...folded.calls);
    state.artifactsWritten += folded.written;
    rendered.push(...folded.page.linksRendered);
    if (!isCaptureComplete({ capture: visit.value })) {
      state.incompletePages.push(entry.path);
    }
    if (visit.value.linksBlockedBecause !== null) {
      state.linkReadFailures.push({ path: entry.path, reason: visit.value.linksBlockedBecause });
    }
  }
  return rendered;
}

/**
 * Walk the admin frontier to a fixed point, accumulating what each page showed.
 *
 * A visit that fails is recorded as `failed` and the walk continues — one gated page must not end a walk.
 * A LOST SESSION is different and stops it: every page after would be recorded as failed for a reason that
 * has nothing to do with the page, which would turn one sign-out into a hundred false gaps. Those paths are
 * returned as `notAttempted`, so the difference is visible rather than inferred.
 *
 * @param seeds the structural roots to start from
 * @param transport the browser seam
 * @param origin the web origin, used to decide which responses and links are first-party
 * @param writeArtifact where a screenshot is written
 * @param maxRounds how many rounds of link expansion to run; omitted takes {@link MAX_FRONTIER_ROUNDS}
 * @param progress where a line of progress goes; omitted discards it
 * @returns what the walk saw, or the reason it could not start
 */
export async function walkGithubAdmin({
  seeds,
  transport,
  origin,
  writeArtifact,
  maxRounds: rounds = MAX_FRONTIER_ROUNDS,
  progress,
}: {
  seeds: readonly string[];
  transport: BrowserPageTransport;
  origin: string;
  writeArtifact: ArtifactWriter;
  maxRounds?: number;
  progress?: GithubWalkProgress;
}): Promise<Result<GithubWebWalkResult>> {
  if (seeds.length === 0) {
    return err(githubRefusalErrorLines({ error: GithubRefusalErrors.noSeeds() }));
  }
  const state: WalkState = {
    artifactsWritten: 0,
    calls: [],
    incompletePages: [],
    linkReadFailures: [],
    pages: [],
    sessionLost: false,
  };
  const { pages, calls, incompletePages } = state;
  const visited = new Set<string>();
  let queue: readonly FrontierEntry[] = seeds.map((path) => ({ discoveredFrom: null, path }));
  let roundsRun = 0;

  while (queue.length > 0 && roundsRun < rounds && !state.sessionLost) {
    roundsRun += 1;
    const rendered = await walkRound({
      origin,
      queue,
      roundsRun,
      state,
      transport,
      visited,
      writeArtifact,
      ...(progress === undefined ? {} : { progress }),
    });
    const nextPaths = expandFrontier({ origin, rendered, visited });
    queue = nextPaths.map((path) => ({ discoveredFrom: pathThatRendered({ href: path, pages }), path }));
  }

  await transport.release();
  return ok({
    artifactsWritten: state.artifactsWritten,
    frontierRemaining: queue.map((entry) => entry.path),
    incompletePages,
    linkReadFailures: state.linkReadFailures,
    notAttempted: pages.filter((page) => page.outcome === "not-attempted").map((page) => page.path),
    pages,
    requests: reduceWebCalls({ calls }),
    roundsRun,
  });
}

/**
 * Which visited page rendered a link to this path — the provenance of a frontier entry.
 *
 * @param href the discovered path
 * @param pages every page visited so far
 * @returns the path of the first page that rendered it, or `null` when none did
 */
function pathThatRendered({ href, pages }: { href: string; pages: readonly AdminPageObservation[] }): string | null {
  for (const page of pages) {
    if (page.linksRendered.some((link) => link.endsWith(href))) {
      return page.path;
    }
  }
  return null;
}
