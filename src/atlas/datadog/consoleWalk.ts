/**
 * Walk every page the Datadog left nav declares, photograph each, record what the console asked for, and
 * take the console's own word on its nav and its palette.
 *
 * ## Declared, reachable and openable are three different things
 *
 * A declared page may 404, may redirect, or may show an onboarding screen for a product the organisation
 * has not enabled — an entry can land on a product's landing page rather than the list it names.
 * Every one of those is a COMPLETED attempt against a real declaration, recorded on the page's own row:
 * never a walk failure, and never a page silently credited to wherever it landed. {@link outcomeOf} grades a
 * redirect as its own outcome for exactly that reason.
 *
 * ## Two legs the page transport cannot take, each recorded rather than fatal
 *
 * The nav leg re-reads the left nav's fly-outs so `consolePages.ts` can be judged against the console
 * rather than trusted; the palette leg opens the command palette and captures the calls only it makes.
 * Both run through `browser/datadogConsole.ts`. Either failing costs the walk that leg's evidence and
 * nothing else: the result carries the leg's error beside a `null` observation, and `consoleSurface.ts`
 * turns the absence into the right gap rather than into a claim.
 *
 * ## Everything here is written against two seams
 *
 * `browser/pageTransport.ts` (`visit`, `release`) and `browser/datadogConsole.ts` (`observeNav`,
 * `observePalette`, `release`), with the screenshot writer `kit/artifactWriter.ts`, which reads back what
 * it wrote before answering `ok`. A redirect, a lost body, a lost session, a missing screenshot, a failed
 * hover and a palette that never opened are each settled by a unit test over a fake.
 */
import type {
  DatadogConsoleTransport,
  DatadogNavObservation,
  DatadogPaletteObservation,
} from "../../browser/datadogConsole.js";
import {
  type BrowserPageTransport,
  isCaptureComplete,
  isWalkStoppingError,
  type PageCapture,
  type ResponseAccounting,
} from "../../browser/pageTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasArtifactWriter } from "../kit/artifactWriter.js";
import { visitPhotographed, writePageScreenshot } from "../kit/browserWalk.js";
import { type ConsoleWalkState, emptyConsoleWalkState, firstPartyCalls } from "../kit/consoleFold.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { addressDisagreement } from "../kit/pageWalk.js";
import type { DatadogConsoleRoute } from "./consolePages.js";
import { type ConsoleRequestObservation, reduceDatadogConsoleCalls } from "./consoleReduction.js";
import type { DatadogConsolePage } from "./documents.js";
import { type DatadogAtlasError, DatadogAtlasErrors } from "./errors.js";

/**
 * How long to keep observing one page after it settles, so its own deferred calls are caught. Datadog's
 * explorers issue their queries from a worker a beat after first paint.
 *
 * @internal
 */
export const DATADOG_PAGE_SETTLE_MS = 4_000;

/** Where this atlas files a page's picture, under its own generation directory. */
const DATADOG_ARTIFACT_DIRECTORY = "artifacts/console";

/** The page href the palette's calls are recorded against. It is not a page; the name says so. */
export const DATADOG_PALETTE_PAGE = "cmd-k";

/** What one visited console page yielded, before it becomes an entity. */
export interface ConsolePageObservation {
  readonly route: DatadogConsoleRoute;
  readonly outcome: DatadogConsolePage["outcome"];
  readonly finalUrl: string | null;
  readonly statusCode: number | null;
  readonly title: string | null;
  readonly artifacts: readonly AtlasArtifactRef[];
  /**
   * What the transport SAW against what it KEPT, carried through verbatim, or `null` for a route that was
   * never visited at all.
   *
   * Here rather than recomputed downstream for the reason `kit/frontierContract.ts` states about its own copy:
   * a lost response body is otherwise invisible. The page still has its screenshot, its status and its
   * title, so a page that dropped two of twelve bodies reads exactly like one that kept all twelve — and
   * `console-request` is built from those bodies, so the difference is the atlas's own completeness.
   * `walk.incompletePages` names WHICH pages lost something; this says how much.
   */
  readonly responseAccounting: ResponseAccounting | null;
}

/** What the walk produced. */
export interface DatadogWalkResult {
  readonly pages: readonly ConsolePageObservation[];
  readonly requests: readonly ConsoleRequestObservation[];
  /** Pages whose response bodies were not all captured — the walk saw less than it looked like it did. */
  readonly incompletePages: readonly string[];
  /** Pages that were reached but whose capture was still a loading frame, so nothing was photographed. */
  readonly unrenderedPages: readonly string[];
  /** Declared routes the walk never attempted, because the session was lost part-way. */
  readonly notAttempted: readonly string[];
  /**
   * Declared routes this run was never ASKED to visit — what `--limit` left beyond its bound.
   *
   * Kept apart from {@link notAttempted}, which is a session lost part-way: the two have different
   * remedies, and a caller that cannot tell them apart cannot say which one to print. Non-empty is what
   * makes a bounded run publish `deferred` — see `consoleSurface.ts`'s `walkTally`.
   */
  readonly omitted: readonly string[];
  /** Every URL a visit actually settled on, so the registry can be checked against evidence. */
  readonly finalUrls: readonly string[];
  readonly artifactsWritten: number;
  /** The live nav as the console rendered it this run, or `null` with `navError` saying why not. */
  readonly nav: DatadogNavObservation | null;
  readonly navError: string | null;
  /** The palette as it opened this run, or `null` with `paletteError` saying why not. */
  readonly palette: DatadogPaletteObservation | null;
  readonly paletteError: string | null;
}

/**
 * Where a line of progress goes.
 *
 * @internal
 */
export type DatadogWalkProgress = (input: { line: string }) => void;

/**
 * How one visited page's outcome is graded.
 *
 * A redirect is its own outcome rather than a success at a different address, because "this page exists and
 * sends you elsewhere" and "this page rendered" are different answers. A 404 is split from the other error
 * codes because on a declared list it means something specific: the nav named a page the console does not
 * serve.
 *
 * @param capture what the transport returned
 * @returns the outcome to record on the page's row
 */
export function outcomeOf({ capture }: { capture: PageCapture }): DatadogConsolePage["outcome"] {
  if (capture.statusCode === 404) {
    return "not-found";
  }
  if (capture.statusCode !== null && capture.statusCode >= 400) {
    return "unavailable";
  }
  return settledElsewhere({ capture }) ? "redirected" : "landed";
}

/**
 * Whether a capture settled on a DIFFERENT PAGE, rather than on the same page wearing its own state.
 *
 * MEASURED over the first full walk of this console: `isRedirected` — which compares the whole
 * URL — graded pages redirected that had landed, and almost every page it graded so was the same path
 * with the console's own view state appended. `/cost/analyze/explorer` settles on
 * `/cost/analyze/explorer?filterRecent=false&timeframeRefreshMode=undefined&start=…&end=…&paused=false`;
 * `/devices` settles on `/devices?query=&facets=&hiddenColumns=…`. Reporting those as redirects understated
 * the surface's landed count by every such page, and `surfaceFill.ts` reads that count.
 *
 * So the comparison is the PATH, plus every parameter the declaration itself asked for. A page that
 * appends its own defaults landed; a page that drops a parameter the route named did not render what was
 * asked for; and `/ci` settling on `/ci/pipelines/health` is a real redirect and still reads as one. The
 * shared `isRedirected` stays exactly as it is — its whole-URL comparison is the right one for a walk whose
 * addresses carry no state, and this console's do.
 *
 * That comparison is now the KIT's — `atlas/kit/pageWalk.ts`'s {@link addressDisagreement} — because the
 * question is about URLs rather than about Datadog, and it stood in ten other near-verbatim copies which all
 * tolerated any query difference. This function keeps the measurement above and the platform's own name for
 * it; the hoist also fixed a repeated parameter, which `searchParams.get` compared against the first value
 * only.
 *
 * @param capture what the transport returned
 * @returns whether the browser ended up somewhere other than the page that was asked for
 */
export function settledElsewhere({ capture }: { capture: PageCapture }): boolean {
  return addressDisagreement({ finalUrl: capture.finalUrl, requestedUrl: capture.requestedUrl }) !== null;
}

/** A row for a route that could not be visited at all. */
function unvisitedPage({
  route,
  outcome,
}: {
  route: DatadogConsoleRoute;
  outcome: DatadogConsolePage["outcome"];
}): ConsolePageObservation {
  return { artifacts: [], finalUrl: null, outcome, responseAccounting: null, route, statusCode: null, title: null };
}

/** Fold one landed capture into the walk's running state. */
function recordVisit({
  state,
  capture,
  route,
  origin,
  writeArtifact,
}: {
  state: ConsoleWalkState<ConsolePageObservation>;
  capture: PageCapture;
  route: DatadogConsoleRoute;
  origin: string;
  writeArtifact: AtlasArtifactWriter;
}): void {
  const artifacts = writePageScreenshot({ capture, directory: DATADOG_ARTIFACT_DIRECTORY, writeArtifact });
  state.artifactsWritten += artifacts.written;
  if (artifacts.unrendered) {
    state.unrenderedPages.push(route.href);
  }
  state.pages.push({
    artifacts: artifacts.refs,
    finalUrl: capture.finalUrl,
    outcome: outcomeOf({ capture }),
    responseAccounting: capture.responseAccounting,
    route,
    statusCode: capture.statusCode,
    title: capture.title,
  });
  state.calls.push(...firstPartyCalls({ capture, onPage: route.href, origin }));
  state.finalUrls.push(capture.finalUrl);
  if (!isCaptureComplete({ capture })) {
    state.incompletePages.push(route.href);
  }
}

/** Take the palette leg, folding its calls into the walk under {@link DATADOG_PALETTE_PAGE}. */
function observePalette({
  console: consoleTransport,
  state,
  origin,
  progress,
}: {
  console: DatadogConsoleTransport;
  state: ConsoleWalkState<ConsolePageObservation>;
  origin: string;
  progress?: DatadogWalkProgress | undefined;
}): { palette: DatadogPaletteObservation | null; paletteError: string | null } {
  progress?.({ line: "datadog console: opening the command palette" });
  const observed = consoleTransport.observePalette();
  if (observed.isErr()) {
    return { palette: null, paletteError: observed.error.message };
  }
  state.calls.push(...firstPartyCalls({ capture: observed.value, onPage: DATADOG_PALETTE_PAGE, origin }));
  return { palette: observed.value, paletteError: null };
}

/**
 * Visit every declared route in order, then take the nav and palette legs, and accumulate what each showed.
 *
 * A visit that fails is recorded as `failed` and the walk continues — one gated page must not end the walk.
 * A LOST SESSION is different and stops the page loop: every route after a sign-out would be recorded as
 * failed for a reason that has nothing to do with the page. Those routes come back as `notAttempted`. The
 * two console legs still run after a lost page session, because they open their own; a failure there is
 * recorded on the result rather than thrown.
 *
 * ## `limit` bounds the walk HERE, so the routes it leaves out are reported rather than forgotten
 *
 * The caller used to slice the registry itself and hand in the prefix, which left the walk unable to tell a
 * bounded run from a whole one: `notAttempted` came back empty, the publisher read that as complete, and a
 * three-page smoke run published the console surface as `synced`. That is the exact failure
 * `cli/commands/datadogAtlas/walkRun.ts`'s own header says `--limit` must not produce. Taking the whole
 * registry plus its bound means the remainder is a value on the result — {@link DatadogWalkResult.omitted}.
 *
 * @param routes every route the registry declares — the WHOLE list, never a prefix
 * @param limit how many of them to visit, or `null` for all of them
 * @param transport the page seam
 * @param console the nav-and-palette seam, or `null` to skip both legs
 * @param origin the console origin, used to build each URL and to decide which responses are first-party
 * @param writeArtifact where a screenshot is written
 * @param progress where a line of progress goes; omitted discards it
 * @param legs which console legs to take; omitted takes both
 * @returns what the walk saw, or the reason it could not start
 */
export async function walkDatadogConsole({
  routes,
  limit,
  transport,
  console: consoleTransport,
  origin,
  writeArtifact,
  progress,
  legs = { nav: true, palette: true },
}: {
  routes: readonly DatadogConsoleRoute[];
  /** How many of `routes` to visit. `null` walks all of them; a bound leaves the rest `omitted`. */
  limit: number | null;
  transport: BrowserPageTransport;
  console: DatadogConsoleTransport | null;
  origin: string;
  writeArtifact: AtlasArtifactWriter;
  progress?: DatadogWalkProgress;
  /** Which of the two console legs to take; a leg left out records no observation and no error. */
  legs?: { readonly nav: boolean; readonly palette: boolean };
}): Promise<Result<DatadogWalkResult, DatadogAtlasError>> {
  if (routes.length === 0) {
    return err(DatadogAtlasErrors.consoleRegistryEmpty());
  }
  const bounded = boundedRoutes({ limit, routes });
  if (bounded.isErr()) {
    return err(bounded.error);
  }
  const { omitted, visiting } = bounded.value;
  const state = emptyConsoleWalkState<ConsolePageObservation>();
  await visitEveryRoute({ origin, progress, routes: visiting, state, transport, writeArtifact });
  const legOutcome = await takeConsoleLegs({ console: consoleTransport, legs, origin, progress, state });
  return ok({
    artifactsWritten: state.artifactsWritten,
    finalUrls: state.finalUrls,
    incompletePages: state.incompletePages,
    nav: legOutcome.nav,
    navError: legOutcome.navError,
    notAttempted: state.pages.filter((page) => page.outcome === "not-attempted").map((page) => page.route.href),
    omitted: omitted.map((route) => route.href),
    pages: state.pages,
    palette: legOutcome.palette,
    paletteError: legOutcome.paletteError,
    requests: reduceDatadogConsoleCalls({ calls: state.calls }),
    unrenderedPages: state.unrenderedPages,
  });
}

/**
 * Split the declared registry into the prefix a bound keeps and the remainder it leaves.
 *
 * A bound of zero is refused rather than silently walking nothing: `--limit 0` asks for a walk that visits
 * no page and would publish a generation saying so, which is never what the flag is for.
 *
 * @param routes the whole declared registry
 * @param limit the bound, or `null` for no bound
 * @returns the routes to visit and the ones left out, or the reason the bound is unusable
 */
export function boundedRoutes({
  routes,
  limit,
}: {
  routes: readonly DatadogConsoleRoute[];
  limit: number | null;
}): Result<
  { readonly visiting: readonly DatadogConsoleRoute[]; readonly omitted: readonly DatadogConsoleRoute[] },
  DatadogAtlasError
> {
  if (limit === null) {
    return ok({ omitted: [], visiting: routes });
  }
  if (limit < 1) {
    return err(DatadogAtlasErrors.consoleLimitEmpty({ limit }));
  }
  return ok({ omitted: routes.slice(limit), visiting: routes.slice(0, limit) });
}

/**
 * Visit every declared route in order, then let the page transport go.
 *
 * @param routes the routes to visit, in order
 * @param transport the page seam
 * @param origin the console origin
 * @param state the walk's accumulators, mutated in place
 * @param writeArtifact where a screenshot is written
 * @param progress where a line of progress goes
 */
async function visitEveryRoute({
  routes,
  transport,
  origin,
  state,
  writeArtifact,
  progress,
}: {
  routes: readonly DatadogConsoleRoute[];
  transport: BrowserPageTransport;
  origin: string;
  state: ConsoleWalkState<ConsolePageObservation>;
  writeArtifact: AtlasArtifactWriter;
  progress?: DatadogWalkProgress | undefined;
}): Promise<void> {
  let sessionLost = false;
  for (const [index, route] of routes.entries()) {
    if (sessionLost) {
      state.pages.push(unvisitedPage({ outcome: "not-attempted", route }));
      continue;
    }
    progress?.({ line: `datadog console: ${String(index + 1)}/${String(routes.length)} ${route.href}` });
    const visited = await visitPhotographed({
      // Passed BEFORE the visit, so a withheld page's PNG is never produced rather than produced and
      // deleted — `consolePages.ts`'s `photograph` field carries which pages and why.
      photograph: route.photograph !== "withheld",
      settleMs: DATADOG_PAGE_SETTLE_MS,
      transport,
      url: `${origin}${route.href}`,
    });
    if (visited.isErr()) {
      sessionLost = isWalkStoppingError({ error: visited.error });
      state.pages.push(unvisitedPage({ outcome: sessionLost ? "not-attempted" : "failed", route }));
      continue;
    }
    recordVisit({ capture: visited.value, origin, route, state, writeArtifact });
  }
  await transport.release();
}

/** What the two console legs came to: an observation each, or the reason there is none. */
interface ConsoleLegOutcome {
  readonly nav: DatadogNavObservation | null;
  readonly navError: string | null;
  readonly palette: DatadogPaletteObservation | null;
  readonly paletteError: string | null;
}

/**
 * Take the nav and palette legs, each failing into its own recorded error rather than into the walk's.
 *
 * @param console the nav-and-palette seam, or `null` to take neither leg
 * @param legs which legs to take
 * @param origin the console origin, for deciding which palette responses are first-party
 * @param state the walk's accumulators, which the palette's calls fold into
 * @param progress where a line of progress goes
 * @returns both legs' outcomes
 */
async function takeConsoleLegs({
  console: consoleTransport,
  legs,
  origin,
  state,
  progress,
}: {
  console: DatadogConsoleTransport | null;
  legs: { readonly nav: boolean; readonly palette: boolean };
  origin: string;
  state: ConsoleWalkState<ConsolePageObservation>;
  progress?: DatadogWalkProgress | undefined;
}): Promise<ConsoleLegOutcome> {
  if (consoleTransport === null) {
    return { nav: null, navError: null, palette: null, paletteError: null };
  }
  let nav: DatadogNavObservation | null = null;
  let navError: string | null = null;
  if (legs.nav) {
    progress?.({ line: "datadog console: reading the live left nav" });
    const observed = consoleTransport.observeNav();
    if (observed.isErr()) {
      navError = observed.error.message;
    } else {
      nav = observed.value;
    }
  }
  const paletteLeg = legs.palette
    ? observePalette({ console: consoleTransport, origin, progress, state })
    : { palette: null, paletteError: null };
  consoleTransport.release();
  return { nav, navError, ...paletteLeg };
}
