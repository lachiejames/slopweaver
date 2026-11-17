/**
 * `slopweaver refresh` — the bronze ingest across every source. Bare `refresh` stays GitHub-only for
 * back-compat; `--source <id>` (repeatable) and `--all-sources` select Slack/Linear/Notion/GitHub, each
 * fetched over its own incremental window (per-source watermark; `--since`/`--all` override depth,
 * default ~90 days for the new sources), projected into `CorpusRecord`s, and committed through the one
 * write+watermark path (`ingestSource`). A requested source with no token is a usage error before any
 * network.
 *
 * A thin effectful shell, and thin literally: every pure decision (flag parsing, source selection, window
 * planning, the missing-token diagnostics, the result summary + exit code) comes from {@link ./core}, and the
 * work each stage does lives in a sibling module — {@link ./request} turns the argv into a go-ahead request,
 * {@link ./slotNarrowing} takes each source's refresh slot, {@link ./githubJobs} and {@link ./tokenedJobs} know how each
 * provider is crawled, {@link ./jobPlan} turns the planned windows into ordered jobs, {@link ./hydration} runs
 * the two post-ingest lanes, {@link ./summary} routes every reported line to its stream, and
 * {@link ./progressAdapters} maps the connector hooks onto the rich event stream. What is left here is the
 * ORDER those stages run in.
 *
 * All of it arrives through {@link RefreshDeps} ({@link ./deps}), so the short-circuit and summary behaviour is
 * unit-tested with plain fakes. `runRefresh(argv)` wires production dependencies.
 */

import { progressJsonEnabled, slopweaverHome } from "../../../config.js";
import { calendarIngestJob } from "../../../corpus/calendar/ingest.js";
import { chatgptIngestJob } from "../../../corpus/chatgpt/ingest.js";
import { bronzeDir } from "../../../corpus/corpusPaths.js";
import { fathomIngestJob } from "../../../corpus/fathom/ingest.js";
import { gmailIngestJob } from "../../../corpus/gmail/ingest.js";
import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import { ingestSources } from "../../../corpus/ingestSource.js";
import { outlookMailIngestJob } from "../../../corpus/outlook/ingest.js";
import { outlookCalendarIngestJob } from "../../../corpus/outlookCalendar/ingest.js";
import { toRichProgressEvent } from "../../../corpus/progress.js";
import { selfIngestJob } from "../../../corpus/self/ingest.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { readWatermark } from "../../../corpus/watermark.js";
import { yyyyMmDdTodayPlus } from "../../../lib/date.js";
import { logger } from "../../../lib/logger.js";
import { survivesNumbersOnly, WITHHELD } from "../../../lib/numbersOnly.js";
import {
  createRichProgressEmitter,
  type RichProgressEmitter,
  unrefIntervalStallTimer,
} from "../../../lib/progressRichEmitter.js";
import { safeFsAsync } from "../../../lib/safeBoundary.js";
import { currentSyncRunObserver } from "../../../syncRun/observerScope.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { type RefreshOptions, refreshExitCode, SELF_ROOTS_ENV, summariseRefreshResults } from "./core.js";
import type { RefreshDeps } from "./deps.js";
import { liveRefreshDerive, runRefreshDeriveStep } from "./derive.js";
import { type HydrationLaneFailure, type RefreshLegFailures, refreshFailureClosingLine } from "./failureClosingLine.js";
import { REFRESH_USAGE as USAGE } from "./flags.js";
import { githubJob, githubOrgJob } from "./githubJobs.js";
import {
  hydrateMembersStep,
  hydrateStructuresStep,
  productionHydrateMember,
  productionHydrateStructure,
} from "./hydration.js";
import { buildRefreshJobs, buildSelfJobs, refreshJobErrorLines } from "./jobPlan.js";
import { hydrationHeartbeat, numbersOnlyEvent } from "./progressAdapters.js";
import { logErrorLines, resolveRefreshRequest } from "./request.js";
import { refreshUntil } from "./requestDefaults.js";
import { runSlackCoverage } from "./slackCoverage.js";
import { narrowOrReport } from "./slotNarrowing.js";
import { productionStoreIngest, runRefreshStoreStep } from "./storeLeg.js";
import { emitRefreshSummary, publishRefreshEvents } from "./summary.js";
import { ingestUnderSyncRun, productionOpenSyncRun } from "./syncRunLedger.js";
import { sourceJob } from "./tokenedJobs.js";
import { resolveTokens, slackReadToken } from "./tokens.js";
import { productionMeasureVoice, runRefreshVoiceStep } from "./voiceLeg.js";
import { buildRefreshWindows } from "./windows.js";

/**
 * The `--coverage` branch: report Slack reach instead of fetching anything.
 *
 * It REPLACES the fetch rather than following it — a coverage report run straight after an ingest would
 * measure the state that ingest just produced, which is the one measurement that cannot surprise anyone.
 * Refused for any other source, because none of the other three has a membership boundary for it to be about.
 *
 * @param sources the selected sources
 * @param home the Slopweaver home
 * @param deps the effectful seams
 * @returns the coverage exit code, or `EXIT_USAGE` when a non-Slack source was selected
 */
async function coverageStep({
  sources,
  home,
  deps,
}: {
  sources: readonly CorpusSource[];
  home: string;
  deps: RefreshDeps;
}): Promise<number> {
  if (sources.some((source) => source !== "slack")) {
    deps.logger.error({ msg: "refresh --coverage: Slack only — pass --source slack" });
    deps.logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  return runSlackCoverage({ deps, home });
}

/**
 * Run the refresh verb over injected dependencies — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @param deps the effectful seams
 * @returns the process exit code
 */
export async function runRefreshWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: RefreshDeps;
}): Promise<number> {
  const resolved = resolveRefreshRequest({ argv, deps });
  if (resolved.kind === "exit") {
    return resolved.code;
  }
  const { options, sources, home, selfRoots } = resolved.request;

  if (options.coverage) {
    return coverageStep({ deps, home, sources });
  }

  const narrowed = narrowOrReport({ deps, options, sources });
  if ("code" in narrowed) {
    return narrowed.code;
  }
  const admitted = narrowed.admitted;
  const until = refreshUntil({ deps, options });
  // One clock read for both consumers: the window planner caps a stored cursor at it, and the per-source log
  // line renders the inclusive end against it. Two reads could straddle midnight and disagree.
  const today = yyyyMmDdTodayPlus({ days: 0, now: deps.nowDate() });
  const windows = buildRefreshWindows({
    all: options.all,
    home,
    lookbackDays: options.lookbackDays,
    orgMode: options.allRepos,
    readWatermark: deps.readWatermark,
    sinceFlag: options.since,
    sources: admitted,
    today,
    until,
  });
  const jobsResult = buildRefreshJobs({
    deps,
    home,
    options,
    today,
    windows,
  });
  if (jobsResult.isErr()) {
    logErrorLines({ lines: refreshJobErrorLines({ error: jobsResult.error }), sink: deps.logger });
    return EXIT_USAGE;
  }
  const jobs = [
    ...jobsResult.value,
    ...buildSelfJobs({ deps, home, selfExclude: options.selfExclude, selfRoots, until }),
  ];

  return ingestAndReport({ admitted, deps, home, jobs, options });
}

/**
 * Fetch the planned jobs, report what they wrote, publish the per-source events and derive — everything
 * after the plan is fixed.
 *
 * Split out of {@link runRefreshWithDeps} so the shell above stays inside the function-length gate while
 * reading as one sequence: resolve, narrow, plan, run.
 *
 * @param admitted the sources this run actually holds slots for
 * @param deps the effectful seams
 * @param home the Slopweaver home
 * @param jobs the planned per-source ingest jobs
 * @param options the parsed refresh options
 * @returns the process exit code
 */
async function ingestAndReport({
  admitted,
  deps,
  home,
  jobs,
  options,
}: {
  admitted: readonly CorpusSource[];
  deps: RefreshDeps;
  home: string;
  jobs: readonly SourceIngestJob[];
  options: RefreshOptions;
}): Promise<number> {
  const results = await ingestUnderSyncRun({ deps, home, jobs, options });
  const summary = summariseRefreshResults({ bronzePath: bronzeDir({ home }), results });
  emitRefreshSummary({ home, lines: summary.lines, numbersOnly: options.numbersOnly, sink: deps.logger });
  publishRefreshEvents({ deps, home, nowIso: deps.nowDate().toISOString(), results });
  const { numbersOnly, store } = options;
  const stored = await runRefreshStoreStep({ deps, home, jobs, numbersOnly, results, store });
  const voice = await runRefreshVoiceStep({ deps, home, numbersOnly, results });
  const post = await postIngestSteps({ deps, home, options, sources: admitted });
  const legFailed =
    stored.failures.length > 0 ||
    voice.failures.length > 0 ||
    post.hydration.length > 0 ||
    post.derive.failures.length > 0;
  const exitCode = refreshExitCode({ anyFailed: summary.anyFailed || legFailed, totalWritten: summary.totalWritten });
  const closing = refreshFailureClosingLine({
    deriveFailures: post.derive.failures,
    hydrationFailures: post.hydration,
    numbersOnly: options.numbersOnly,
    results,
    storeFailures: stored.failures,
    voiceFailures: voice.failures,
  });
  // LAST, after every warning-only lane: a scheduled firing keeps only the tail of stderr (`./failureClosingLine.ts`).
  if (exitCode === EXIT_ERROR && closing !== null) {
    deps.logger.error({ msg: closing });
  }
  return exitCode;
}

/**
 * The three lanes that run AFTER activity ingest, in the order they depend on each other: members, then
 * structures, then derive — derive last because it reads what the first two just wrote.
 *
 * @param deps the effectful seams
 * @param home the Slopweaver home
 * @param options the parsed refresh options
 * @param sources the selected sources, in order
 * @returns the hydration lanes that threw, and derive's failures; both empty when silver is current
 */
async function postIngestSteps({
  deps,
  home,
  options,
  sources,
}: {
  deps: RefreshDeps;
  home: string;
  options: RefreshOptions;
  sources: readonly CorpusSource[];
}): Promise<{ hydration: readonly HydrationLaneFailure[]; derive: RefreshLegFailures }> {
  const fetchedAtIso = deps.nowDate().toISOString();
  const lanes = [
    { lane: "members", run: () => hydrateMembersStep({ deps, fetchedAtIso, home, options, sources }) },
    { lane: "structures", run: () => hydrateStructuresStep({ deps, fetchedAtIso, home, options, sources }) },
  ] as const;
  const hydration: HydrationLaneFailure[] = [];
  for (const { lane, run } of lanes) {
    // A lane that throws still fails the run, but through the closing line rather than past it.
    const ran = await safeFsAsync({ execute: run, operation: `hydrate ${lane}` });
    if (ran.isErr()) {
      hydration.push({ lane, reason: ran.error.message });
      deps.logger.error({ msg: `${lane}: ${options.numbersOnly ? WITHHELD : ran.error.message}` });
    }
  }
  const derive = await runRefreshDeriveStep({
    derive: deps.derive,
    home,
    noDerive: options.noDerive,
    numbersOnly: options.numbersOnly,
    sink: deps.logger,
  });
  return { derive, hydration };
}

/**
 * Production dependencies for {@link runRefreshWithDeps} (real token reads, connector factories, ingest).
 *
 * The emitter is built by {@link runRefresh} rather than here because it owns a watchdog interval that has to
 * be closed when the run ends, and only the caller that awaits the run knows when that is.
 */
function productionRefreshDeps({
  emitter,
  numbersOnly,
}: {
  emitter: RichProgressEmitter;
  numbersOnly: boolean;
}): RefreshDeps {
  return {
    buildGithubJob: githubJob,
    buildGithubOrgJob: githubOrgJob,
    buildCalendarJob: calendarIngestJob,
    buildChatgptJob: chatgptIngestJob,
    buildFathomJob: fathomIngestJob,
    buildGmailJob: gmailIngestJob,
    buildOutlookCalendarJob: outlookCalendarIngestJob,
    buildOutlookMailJob: outlookMailIngestJob,
    buildSelfJob: selfIngestJob,
    buildSourceJob: sourceJob,
    home: slopweaverHome,
    hydrateMember: productionHydrateMember,
    derive: liveRefreshDerive,
    hydrateStructure: productionHydrateStructure,
    ingestSources,
    logger,
    nowDate: () => new Date(),
    openSyncRun: productionOpenSyncRun,
    onProgress: (p) => {
      if (p.phase === "members" || p.phase === "structures") {
        emitter.emit(hydrationHeartbeat(p));
      }
    },
    readWatermark,
    resolveTokens,
    selfRootsEnv: () => process.env[SELF_ROOTS_ENV],
    slackReadToken,
    storeIngest: productionStoreIngest,
    measureVoice: productionMeasureVoice,
    // The ONE place a connector's stream reaches a terminal, which is what makes it the right place to
    // withhold: sanitising per connector would mean nine chances to forget, and the one that forgot would be
    // the one whose output got pasted into a public PR.
    sourceProgress: (event) => {
      // The ledger copy goes first and regardless of `--numbers-only`: it is a local file under the home, never
      // pasted anywhere, and a scheduled refresh runs with that flag — the run the Automations page most needs.
      currentSyncRunObserver()?.progress({ event });
      if (!numbersOnly) {
        emitter.emit(toRichProgressEvent({ event }));
        return;
      }
      if (survivesNumbersOnly({ event })) {
        emitter.emit(numbersOnlyEvent({ event: toRichProgressEvent({ event }) }));
      }
    },
  };
}

/**
 * Run the refresh verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runRefresh(argv: readonly string[]): Promise<number> {
  // A cheap pre-parse purely to decide how the emitter is built. The real parse happens inside
  // `runRefreshWithDeps` and remains the authority; this only has to be right about ONE boolean, and reading
  // it off the raw argv means the emitter cannot start streaming unsanitised output before the flag is known.
  const numbersOnly = argv.includes("--numbers-only");
  // The long crawl is where a wedged API call actually stalls — so refresh wires the non-blocking watchdog.
  // Human lines stream to stderr; the machine JSON lane is off unless opted in (so the watch view is clean).
  // Closed in `finally` because one process can run several verbs: an interval this run leaves behind prints its
  // last phase as `(stalled)` every minute for the rest of that process's life (`lib/progressRichEmitter.ts`).
  const emitter = createRichProgressEmitter({
    stallTimer: unrefIntervalStallTimer,
    verb: "refresh",
    ...(progressJsonEnabled() ? {} : { machineSink: () => {} }),
  });
  try {
    return await runRefreshWithDeps({ argv, deps: productionRefreshDeps({ emitter, numbersOnly }) });
  } finally {
    emitter.close();
  }
}

export const refreshRunCommand = defineCommand({ run: runRefresh });
