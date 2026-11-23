/**
 * The FRONTIER walk engine: visit a declared list of routes in the owner's own browser, photograph each,
 * then follow the routes the landed pages themselves rendered.
 *
 * ## Why this is kit-owned, and how it differs from `pageWalk.ts`
 *
 * `pageWalk.ts` walks a FIXED declared list and is what most atlases need. Two atlases needed more: a
 * platform that publishes no authenticated sitemap has a declared list that is a floor rather than a
 * ceiling, so the walk expands it with the navigation each landed page renders, and every discovered route
 * records which page's link found it. Twilio arrived at that first and Hex copied it, at which point the
 * clone ratchet said so — which is this kit's usual reason for existing.
 *
 * What is genuinely per-platform is {@link FrontierWalkSpec}: how a route becomes a URL, how a settled page
 * is graded, which responses are the platform's own, what one of those responses reduces to, and which of a
 * page's rendered links count as routes. Everything around them — the rounds, the seen set, the
 * four-way landed/redirected/unphotographed/not-attempted accounting, the screenshot verification, the
 * lost-session stop and the release-on-every-path — was identical, and each is a property a copy can
 * silently lose.
 *
 * ## Declared, reachable and openable are three different things
 *
 * A declared route may 404, may bounce to a sign-in wall, or may be gated behind a role the account does
 * not hold. Every one of those is a COMPLETED attempt against a real route, recorded on the page's own row
 * — never a walk failure, and never a page silently credited to wherever it landed.
 *
 * ## A page without its screenshot is NOT credited
 *
 * `docs/atlas-intent/05-browser-proof.md` makes the stored screenshot load-bearing — the atlas holds the image so an
 * agent can look at a page without piloting a browser to it. A row that says a page landed while holding no
 * picture of it is a claim the atlas cannot back, so the outcome becomes `unphotographed`.
 *
 * ## The session-loss tolerance is a platform's decision, not a default
 *
 * A page that closes its own tab no longer reaches this as a `SESSION_LOST` — the transport rebuilds the
 * relay and grades that page alone (`browser/selfClosedGrade.ts`'s `selfClosedTabRecovery`) — but a relay that drops
 * and an owner who closed Chrome are still indistinguishable in one. A platform that has such a page raises {@link FrontierWalkSpec.maxConsecutiveSessionLosses}
 * so the walk takes another route before deciding; one that does not leaves it at 1. A transport that never
 * attached, or an origin the lease refuses, gets no such tolerance: it ends the walk on the first route, because
 * every route after it would re-run the same 30 s attach. That stop names no
 * {@link FrontierWalkResult.sessionEndedAt}, since no session ended; a lost session's stop names the route
 * that reported it, so the skipped routes have a cause rather than a silence.
 *
 * ## Everything here is written against a seam
 *
 * `browser/pageTransport.ts` is the whole contract: `visit` and `release`. The engine and the artifact
 * writing run against a deterministic fake in tests, so a redirect, a sign-in wall, a lost body and a
 * missing screenshot are settled by unit tests rather than by luck in a live run.
 */
import {
  type BrowserPageTransport,
  isCaptureComplete,
  isWalkStoppingError,
  type PageCapture,
} from "../../browser/pageTransport.js";
import { err, ok, type Result } from "../../lib/result.js";

import type { AtlasArtifactWriter } from "./artifactWriter.js";
import { screenshotArtifact } from "./browserWalk.js";
import { AtlasCaptureErrors, atlasCaptureErrorLines } from "./captureErrors.js";
import { browserObservationView, type ChannelView } from "./channelEntity.js";
import type { AtlasArtifactRef } from "./contract.js";
import type {
  FrontierPageObservation,
  FrontierPageOutcome,
  FrontierWalkResult,
  FrontierWalkSpec,
} from "./frontierContract.js";
import { frontierPageDetail } from "./frontierPageDetail.js";

// `foreignGaps` lives with the rest of the gap vocabulary in `./gaps.ts`, `wasReached` with the page
// detail it grades in `./frontierPageDetail.ts`, and the publish half in `./frontierPublish.ts`; re-exported
// so the walks that import them from here keep one import line.
export { wasReached } from "./frontierPageDetail.js";
export { publishWalkedGeneration, walkedKindStatuses } from "./frontierPublish.js";
export { foreignGaps } from "./gaps.js";

/** One entry in the frontier: where to go, and which page's link sent us there. */
interface FrontierEntry {
  readonly discoveredFrom: string | null;
  readonly route: string;
}

/** What one walk accumulates across its rounds. Mutable by design — the rounds append to it in order. */
interface WalkState<TCall> {
  artifactsWritten: number;
  readonly calls: TCall[];
  readonly incompletePages: string[];
  readonly notAttempted: string[];
  readonly pages: FrontierPageObservation[];
  /** Every route any round has already taken, so the frontier cannot revisit one. */
  readonly seen: Set<string>;
  sessionEndedAt: string | null;
  sessionLossStreak: number;
  stop: boolean;
}

/** A row for a route that could not be visited at all. */
function unvisitedPage({
  route,
  discoveredFrom,
  outcome,
}: {
  route: string;
  discoveredFrom: string | null;
  outcome: FrontierPageOutcome;
}): FrontierPageObservation {
  return {
    artifacts: [],
    discoveredFrom,
    finalUrl: null,
    linksRendered: [],
    outcome,
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    route,
    statusCode: null,
    title: null,
  };
}

/**
 * Write one page's screenshot; a write that fails costs the page its `landed` grade, not just its picture.
 *
 * The writer is the kit's VERIFIED one, which reads back what it wrote and compares the digest before
 * answering `ok` — the whole value of a proof screenshot is that the bytes are the ones that were seen, and
 * a write call that returned without throwing is not that.
 */
function writeScreenshot({
  capture,
  writeArtifact,
  directory,
}: {
  capture: PageCapture;
  writeArtifact: AtlasArtifactWriter;
  directory: string;
}): { refs: readonly AtlasArtifactRef[]; written: number } {
  if (capture.screenshotPng === null) {
    return { refs: [], written: 0 };
  }
  const ref = screenshotArtifact({ bytes: capture.screenshotPng, directory });
  const written = writeArtifact({ bytes: capture.screenshotPng, relativePath: ref.relativePath, sha256: ref.sha256 });
  return written.isErr() ? { refs: [], written: 0 } : { refs: [ref], written: 1 };
}

/** One page's visit, folded into an observation plus whatever calls it produced. */
function foldVisit<TCall>({
  route,
  discoveredFrom,
  capture,
  writeArtifact,
  spec,
}: {
  route: string;
  discoveredFrom: string | null;
  capture: PageCapture;
  writeArtifact: AtlasArtifactWriter;
  spec: FrontierWalkSpec<TCall>;
}): { calls: readonly TCall[]; page: FrontierPageObservation; written: number } {
  const screenshot = writeScreenshot({ capture, directory: spec.artifactDirectory, writeArtifact });
  const graded = spec.gradeOutcome({ capture, route });
  const outcome: FrontierPageOutcome = graded === "landed" && screenshot.refs.length === 0 ? "unphotographed" : graded;
  const calls = capture.responses
    .filter((response) => spec.isFirstParty({ response }))
    .map((response) => spec.callFrom({ response, route }));
  return {
    calls,
    page: {
      artifacts: screenshot.refs,
      discoveredFrom,
      finalUrl: capture.finalUrl,
      linksRendered: spec.routesRenderedBy({ capture }),
      outcome,
      responseAccounting: capture.responseAccounting,
      route,
      statusCode: capture.statusCode,
      title: capture.title,
    },
    written: screenshot.written,
  };
}

/** Visit one route, fold it into the state, and report what it rendered for the next round. */
async function visitOne<TCall>({
  entry,
  state,
  transport,
  writeArtifact,
  spec,
}: {
  entry: FrontierEntry;
  state: WalkState<TCall>;
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  spec: FrontierWalkSpec<TCall>;
}): Promise<readonly string[]> {
  const visited = await transport.visit({ settleMs: spec.settleMs, url: spec.urlFor({ route: entry.route }) });
  if (visited.isErr()) {
    if (visited.error.code === "SESSION_LOST") {
      // The FIRST loss of a run names it; a later one in the same run does not move the name.
      state.sessionEndedAt = state.sessionLossStreak === 0 ? entry.route : state.sessionEndedAt;
      state.sessionLossStreak += 1;
      state.stop = state.sessionLossStreak >= spec.maxConsecutiveSessionLosses;
    } else if (isWalkStoppingError({ error: visited.error })) {
      // A transport that never attached, or a lease that refuses the origin, is the same for every route
      // after this one. MEASURED (`$SLOPWEAVER_HOME/live/recipe/resync-state/resync-atlas-hex.json`):
      // walking on re-ran the attach once per remaining route, at Playwright's 30 s each, every one opening a
      // connect page in the owner's Chrome. No session ended here, so `sessionEndedAt` is left as it stands.
      state.stop = true;
    }
    state.pages.push(unvisitedPage({ discoveredFrom: entry.discoveredFrom, outcome: "failed", route: entry.route }));
    spec.progress({ line: `  ${entry.route} — failed: ${visited.error.message}` });
    return [];
  }
  // A page loaded, so the session a loss before it reported gone came back: that loss ended nothing, and a
  // platform reading `sessionEndedAt` would otherwise publish a session-ended gap for a walk that finished.
  state.sessionLossStreak = 0;
  state.sessionEndedAt = null;
  spec.observe?.({ capture: visited.value });
  const folded = foldVisit({
    capture: visited.value,
    discoveredFrom: entry.discoveredFrom,
    route: entry.route,
    spec,
    writeArtifact,
  });
  state.pages.push(folded.page);
  state.calls.push(...folded.calls);
  state.artifactsWritten += folded.written;
  if (!isCaptureComplete({ capture: visited.value })) {
    state.incompletePages.push(entry.route);
  }
  spec.progress({ line: `  ${entry.route} — ${folded.page.outcome} (${String(folded.calls.length)} call(s))` });
  return folded.page.linksRendered;
}

/** Visit one round's frontier, and return what the landed pages rendered for the next one. */
async function runRound<TCall>({
  frontier,
  state,
  transport,
  writeArtifact,
  spec,
  stopAfter,
}: {
  frontier: readonly FrontierEntry[];
  state: WalkState<TCall>;
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  spec: FrontierWalkSpec<TCall>;
  stopAfter: (input: { page: FrontierPageObservation }) => boolean;
}): Promise<readonly FrontierEntry[]> {
  const next = new Map<string, FrontierEntry>();
  for (const entry of frontier) {
    if (state.seen.has(entry.route)) {
      continue;
    }
    state.seen.add(entry.route);
    if (state.stop) {
      state.notAttempted.push(entry.route);
      continue;
    }
    const rendered = await visitOne({ entry, spec, state, transport, writeArtifact });
    noteStop({ state, stopAfter });
    widenFrontier({ discoveredFrom: entry.route, next, rendered, seen: state.seen });
  }
  return [...next.values()];
}

/** Let the platform end the walk on the page just visited — a sign-in wall is what this exists for. */
function noteStop<TCall>({
  state,
  stopAfter,
}: {
  state: WalkState<TCall>;
  stopAfter: (input: { page: FrontierPageObservation }) => boolean;
}): void {
  const last = state.pages.at(-1);
  if (last !== undefined && stopAfter({ page: last })) {
    state.stop = true;
  }
}

/** Add whatever one landed page rendered to the next round, each naming the page whose link found it. */
function widenFrontier({
  rendered,
  next,
  seen,
  discoveredFrom,
}: {
  rendered: readonly string[];
  next: Map<string, FrontierEntry>;
  seen: ReadonlySet<string>;
  discoveredFrom: string;
}): void {
  for (const route of rendered) {
    if (!seen.has(route) && !next.has(route)) {
      next.set(route, { discoveredFrom, route });
    }
  }
}

/**
 * Walk the declared routes, then whatever the landed pages themselves rendered.
 *
 * @param transport the browser seam — Playwright over the owner's own Chrome in production, a deterministic
 *   fake in tests
 * @param writeArtifact where a screenshot's bytes are written
 * @param spec what this platform contributes
 * @param stopAfter whether one graded page ends the walk — a sign-in wall is the case this exists for, and
 *   driving a visible browser to the same login page forty times to establish one fact is what it prevents
 * @returns everything the walk observed, or the reason it could not start
 */
export async function runFrontierWalk<TCall>({
  transport,
  writeArtifact,
  spec,
  stopAfter,
}: {
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  spec: FrontierWalkSpec<TCall>;
  stopAfter: (input: { page: FrontierPageObservation }) => boolean;
}): Promise<Result<FrontierWalkResult<TCall>>> {
  const state: WalkState<TCall> = {
    artifactsWritten: 0,
    calls: [],
    incompletePages: [],
    notAttempted: [],
    pages: [],
    seen: new Set<string>(),
    sessionEndedAt: null,
    sessionLossStreak: 0,
    stop: false,
  };
  let frontier: readonly FrontierEntry[] = spec.declaredRoutes.map((route) => ({ discoveredFrom: null, route }));
  let roundsRun = 0;
  while (frontier.length > 0 && roundsRun < spec.maxRounds) {
    roundsRun += 1;
    frontier = await runRound({ frontier, spec, state, stopAfter, transport, writeArtifact });
  }
  const released = await transport.release();
  if (released.isErr()) {
    spec.progress({ line: `  release: ${released.error.message}` });
  }
  if (state.pages.length === 0) {
    return err(atlasCaptureErrorLines({ error: AtlasCaptureErrors.walkVisitedNothing() }));
  }
  return ok({
    artifactsWritten: state.artifactsWritten,
    calls: state.calls,
    incompletePages: state.incompletePages,
    notAttempted: state.notAttempted,
    pages: state.pages,
    roundsRun,
    sessionEndedAt: state.sessionEndedAt,
  });
}

/**
 * Project every page a walk visited into an entity carrying only the browser channel.
 *
 * Kit-owned for the same reason {@link frontierPageDetail} is, and it takes the id function rather than the
 * kind name because an atlas's entity id is namespaced to that atlas — see `kit/identity.ts`.
 *
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @param explain the English one outcome carries, or `null` when the page is fully held
 * @param entityIdFor this atlas's stable id for one page's provider id
 * @param assemble this atlas's own entity shape, around the id and the channel view
 * @param onPage which page one observed call was made on — the platform names its own field
 * @returns one entity per visited route, in visit order
 */
export function projectWalkedPages<TCall, TEntity>({
  walk,
  at,
  explain,
  entityIdFor,
  assemble,
  onPage,
}: {
  walk: FrontierWalkResult<TCall>;
  at: string;
  explain: (input: { outcome: string }) => string | null;
  entityIdFor: (input: { providerId: string }) => string;
  assemble: (input: { id: string; providerId: string; view: ChannelView<"browser">; detail: unknown }) => TEntity;
  onPage: (input: { call: TCall }) => string;
}): readonly TEntity[] {
  return walk.pages.map((page) => {
    const detail = frontierPageDetail({
      callCount: walk.calls.filter((call) => onPage({ call }) === page.route).length,
      captureComplete: !walk.incompletePages.includes(page.route),
      explain,
      page,
    });
    return assemble({
      detail,
      id: entityIdFor({ providerId: page.route }),
      providerId: page.route,
      view: browserObservationView({
        artifacts: page.artifacts,
        at,
        deepLink: page.finalUrl,
        detail,
        endpoint: page.route,
      }),
    });
  });
}
