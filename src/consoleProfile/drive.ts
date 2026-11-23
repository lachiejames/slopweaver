/**
 * The effectful half of `slopweaver perf console`: launch a browser, walk the console, and time what the owner would feel.
 *
 * **A LAUNCHED browser, never the owner's.** `chromium.launch()` starts Playwright's own build with a throwaway profile, no
 * `userDataDir`, no persistent context and no remote-debugging port, so nothing here can reach the owner's Chrome, their
 * cookies or a provider they are signed into (rule 3, `src/devLint/noPrivateBrowserProfile.ts`). The only origin it
 * visits is the console's own `--base`.
 *
 * **Three clocks, one epoch.** Every instant is milliseconds since the Unix epoch at sub-millisecond resolution:
 * `performance.timeOrigin + performance.now()` on both sides of the wire, and a request's own `timing().startTime`.
 * They share this machine's clock, so a press timed in the page and a read timed by the driver subtract cleanly.
 * A STEP of the wall clock between two of their origins mid-walk breaks that, and with it every duration column, not
 * only a window's boundary — so the walk does not defend one boundary against it: a
 * run that straddled a clock step is void, and re-run.
 *
 * What the page itself says is read by the probe in `./pageProbe.ts`; the reads it starts are followed by
 * `./readLedger.ts`, a warm click is timed by `./warmClick.ts`, and the verbs behind the reads timed alone by
 * `./verbTiming.ts`.
 */
import { availableParallelism, loadavg } from "node:os";

import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";

import { err, ok, type Result } from "../lib/result.js";
import { type ConsoleProfileError, ConsoleProfileErrors } from "./errors.js";
import {
  blockingBetween,
  freshContext,
  heapAfterGc,
  LAND_CAP_MS,
  loadedAt,
  measured,
  memoryNow,
  nowEpoch,
  type ProbeState,
  probeUntil,
  readProbe,
} from "./pageProbe.js";
import { CONSOLE_FLOWS, CONSOLE_ROUTES, type ConsoleClick, type ConsoleRoute, sidebarClicks } from "./plan.js";
import { followReads, type ReadLedger, waitQuiet } from "./readLedger.js";
import { type ClickSample, type ConsoleProfileReport, type LoadSample, type MemorySample } from "./report.js";
import { launcherFloorMs, timeVerbs } from "./verbTiming.js";
import { standOn, warmClick } from "./warmClick.js";

/** Sidebar round trips between the two memory readings. */
const MEMORY_ROUND_TRIPS = 3;

/**
 * One cold load's sample from what the page and its reads said. A page whose probe never answered is a sample of
 * its reads alone, every page-side column unmeasured; a page that never drew is never fully loaded.
 *
 * @param path the page
 * @param state the probe's state after the reads went quiet, or `undefined` when no read of it answered
 * @param quiet what the quiet wait saw: the last answer, the reads, and what was still unanswered at the cap
 * @param heapBytes the heap after a forced collection
 * @returns the sample
 */
export function loadSampleOf({
  path,
  state,
  quiet,
  heapBytes,
}: {
  path: string;
  state:
    | Pick<
        ProbeState,
        "domNodes" | "fcp" | "indicator" | "landedAt" | "lcp" | "long" | "origin" | "scriptBytes" | "ttfb"
      >
    | undefined;
  quiet: { lastAnswer: number; reads: LoadSample["reads"]; unanswered: readonly string[] };
  heapBytes: number | undefined;
}): LoadSample {
  if (state === undefined) {
    return {
      blockingMs: undefined,
      domNodes: undefined,
      fcpMs: undefined,
      heapBytes,
      landedMs: undefined,
      lcpMs: undefined,
      loadingIndicator: false,
      path,
      reads: quiet.reads,
      scriptBytes: undefined,
      settledMs: undefined,
      ttfbMs: undefined,
      unanswered: quiet.unanswered,
    };
  }
  const landedMs = state.landedAt === null ? undefined : state.landedAt - state.origin;
  const settledAt = state.landedAt === null ? quiet.lastAnswer : Math.max(quiet.lastAnswer, state.landedAt);
  return {
    blockingMs: blockingBetween({ from: state.origin, long: state.long, to: settledAt }),
    domNodes: state.domNodes,
    fcpMs: measured({ value: state.fcp }),
    heapBytes,
    landedMs,
    lcpMs: measured({ value: state.lcp }),
    loadingIndicator: state.indicator,
    path,
    reads: quiet.reads,
    scriptBytes: state.scriptBytes,
    settledMs: quiet.unanswered.length > 0 || landedMs === undefined ? undefined : settledAt - state.origin,
    ttfbMs: measured({ value: state.ttfb }),
    unanswered: quiet.unanswered,
  };
}

/**
 * One cold load of one page in its own fresh context.
 *
 * @param browser the launched browser
 * @param base the console's origin
 * @param route the page
 * @returns the sample
 */
async function coldLoad({
  browser,
  base,
  route,
}: {
  browser: Browser;
  base: string;
  route: ConsoleRoute;
}): Promise<LoadSample> {
  const context = await freshContext({ browser });
  try {
    const page = await context.newPage();
    const ledger = followReads({ page });
    // The fallback window opens before the navigation, so a page whose probe never answered still owes every read.
    const asked = nowEpoch();
    await page.goto(`${base}${route.path}`, { waitUntil: "commit" });
    const landed = await probeUntil({
      capMs: LAND_CAP_MS,
      from: asked,
      page,
      until: (state) => state.landedAt !== null,
    });
    const origin = landed.state === undefined ? asked : landed.state.origin;
    const quiet = await waitQuiet({ ledger, quietFrom: await loadedAt({ page }), since: origin });
    const state = await readProbe({ page });
    const heapBytes = await heapAfterGc({ context, page });
    return loadSampleOf({ heapBytes, path: route.path, quiet, state });
  } finally {
    await context.close();
  }
}

/** Why the console's first page cannot be walked, or `undefined` when it answered; nothing to check with no pages. */
async function unreachableAt({
  browser,
  base,
  first,
}: {
  browser: Browser;
  base: string;
  first: ConsoleRoute | undefined;
}): Promise<ConsoleProfileError | undefined> {
  if (first === undefined) {
    return undefined;
  }
  try {
    const context = await freshContext({ browser });
    const response = await (await context.newPage()).goto(`${base}${first.path}`, { waitUntil: "commit" });
    await context.close();
    if (response === null) {
      return ConsoleProfileErrors.consoleUnreachable({ base, why: "no response" });
    }
    if (response.status() >= 500) {
      return ConsoleProfileErrors.consoleUnreachable({ base, why: `HTTP ${String(response.status())}` });
    }
    return undefined;
  } catch (cause) {
    return ConsoleProfileErrors.consoleUnreachable({
      base,
      why: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/** Every page loaded cold, `runs` times over. */
async function coldLoads({
  browser,
  base,
  routes,
  runs,
  progress,
}: {
  browser: Browser;
  base: string;
  routes: readonly ConsoleRoute[];
  runs: number;
  progress: (line: string) => void;
}): Promise<readonly LoadSample[]> {
  const loads: LoadSample[] = [];
  for (let run = 1; run <= runs; run += 1) {
    for (const route of routes) {
      const sample = await coldLoad({ base, browser, route });
      loads.push(sample);
      progress(`load ${route.path} run ${String(run)}: settled ${String(sample.settledMs)} ms`);
    }
  }
  return loads;
}

/**
 * Sidebar round trips on the warm page between two memory readings, or `undefined` when no page is in the sidebar.
 */
async function memoryTrip({
  base,
  context,
  ledger,
  page,
  routes,
}: {
  base: string;
  context: BrowserContext;
  ledger: ReadLedger;
  page: Page;
  routes: readonly ConsoleRoute[];
}): Promise<MemorySample | undefined> {
  const home = routes.find((route) => route.inSidebar);
  if (home === undefined) {
    return undefined;
  }
  await standOn({ base, ledger, page, path: home.path });
  const start = await memoryNow({ context, page });
  const trip = sidebarClicks({ routes }).filter((click) => click.to !== "/docs" && click.from !== "/docs");
  for (let round = 1; round <= MEMORY_ROUND_TRIPS; round += 1) {
    for (const click of trip) {
      await warmClick({ base, click, ledger, page });
    }
  }
  await standOn({ base, ledger, page, path: home.path });
  const end = await memoryNow({ context, page });
  return {
    endDomNodes: end.dom,
    endHeapBytes: end.heap,
    roundTrips: MEMORY_ROUND_TRIPS,
    startDomNodes: start.dom,
    startHeapBytes: start.heap,
  };
}

/** Every planned click on one warm page, `runs` times over, then the memory round trips on the same page. */
async function warmWalk({
  browser,
  base,
  clicksPlanned,
  routes,
  runs,
  progress,
}: {
  browser: Browser;
  base: string;
  clicksPlanned: readonly ConsoleClick[];
  routes: readonly ConsoleRoute[];
  runs: number;
  progress: (line: string) => void;
}): Promise<{ clicks: readonly ClickSample[]; memory: MemorySample | undefined }> {
  const clicks: ClickSample[] = [];
  const context = await freshContext({ browser });
  try {
    const page = await context.newPage();
    const ledger = followReads({ page });
    for (let run = 1; run <= runs; run += 1) {
      for (const click of clicksPlanned) {
        const sample = await warmClick({ base, click, ledger, page });
        clicks.push(sample);
        progress(`click ${click.name} run ${String(run)}: drawn ${String(sample.landedMs)} ms`);
      }
    }
    const memory = await memoryTrip({ base, context, ledger, page, routes });
    return { clicks, memory };
  } finally {
    await context.close();
  }
}

/** What one walk covers and how. */
export interface DriveOptions {
  /** The console's origin, e.g. `http://localhost:3100`. */
  readonly base: string;
  /** How many times each row is taken. */
  readonly runs: number;
  /** Show the browser window rather than running it headless. */
  readonly headed: boolean;
  /** Also time each read alone, and the launcher's floor. */
  readonly verbs: boolean;
  /** Only the paths named, when the operator narrowed the walk. */
  readonly only: readonly string[] | undefined;
  /** Where each finished row is said, so a long walk is visibly moving. */
  readonly progress: (line: string) => void;
}

/**
 * Walk the console once end to end and return every measurement.
 *
 * @param options what to walk and how
 * @returns the report, or why no walk could run
 */
export async function driveConsoleProfile(
  options: DriveOptions,
): Promise<Result<ConsoleProfileReport, ConsoleProfileError>> {
  const { base, runs, headed, verbs, only, progress } = options;
  const routes = CONSOLE_ROUTES.filter((route) => only === undefined || only.includes(route.path));
  const loadAtStart = loadavg()[0]!;
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: !headed });
  } catch (cause) {
    return err(ConsoleProfileErrors.browserLaunchFailed({ cause }));
  }
  try {
    const unreachable = await unreachableAt({ base, browser, first: routes[0] });
    if (unreachable !== undefined) {
      return err(unreachable);
    }
    const loads = await coldLoads({ base, browser, progress, routes, runs });
    const clicksPlanned = [...sidebarClicks({ routes }), ...CONSOLE_FLOWS].filter(
      (click) => only === undefined || only.includes(click.from),
    );
    const { clicks, memory } = await warmWalk({ base, browser, clicksPlanned, progress, routes, runs });
    const livePaths = [
      // A read still unanswered at the cap is timed alone too — it is the one most worth knowing about.
      ...new Set(
        [...loads, ...clicks].flatMap((sample) => [...sample.reads.map((read) => read.path), ...sample.unanswered]),
      ),
    ].filter((path) => path.startsWith("/api/live/"));
    const verbSamples = verbs ? await timeVerbs({ base, paths: livePaths.toSorted() }) : [];
    return ok({
      base,
      clicks,
      loads,
      machine: { cores: availableParallelism(), loadAtEnd: loadavg()[0]!, loadAtStart },
      measuredAtIso: new Date().toISOString(),
      memory,
      runs,
      verbFloorMs: verbs ? launcherFloorMs() : undefined,
      verbs: verbSamples,
    });
  } finally {
    await browser.close();
  }
}
