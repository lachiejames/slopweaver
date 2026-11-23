/**
 * Job planning for `slopweaver refresh` — turning the planned windows into the ordered list of ingest jobs.
 *
 * This is the layer between the pure window plan ({@link ./core}) and the effectful job factories
 * ({@link ./githubJobs}, {@link ./tokenedJobs}, and the OAuth-grant lanes in {@link ./grantJobs}): it picks the right factory per source, wires the progress
 * adapters, emits each source's window line, and appends the `self` job. Everything effectful arrives through
 * {@link RefreshDeps}, so the ORDER these decisions happen in is testable with plain fakes.
 */

import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import type { CorpusSource, ExportWindow } from "../../../corpus/types.js";
import { sanitiseLine } from "../../../lib/numbersOnly.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type RefreshOptions, type TokenedSource } from "./core.js";
import type { RefreshDeps } from "./deps.js";
import {
  RefreshErrors,
  type RefreshGithubJobUnbuildableError,
  type RefreshJobPlanError,
  type RefreshLaneNotWiredError,
} from "./errors.js";
import { buildCalendarSourceJob, buildGmailSourceJob, buildOutlookCalendarSourceJob } from "./grantJobs.js";
import { githubItemProgress, githubRepoProgress } from "./progressAdapters.js";
import { EPOCH_SINCE, type RefreshWindow, refreshWindowLogLine } from "./windows.js";

/**
 * Build ONE source's ingest job (effectful factory): the GitHub REST/GraphQL job, or a tokened source
 * (Slack/Linear/Notion). Returns `undefined` for the synthetic `gold` source (never fetched). A GitHub
 * repo-resolution error propagates as an error Result.
 *
 * @param source the source to build a job for
 * @param window the planned export window
 * @param options the parsed refresh options
 * @param home the Slopweaver home
 * @param deps the effectful seams
 * @param cursorOverridden whether an explicit window flag beat the stored cursor
 * @returns the job, `undefined` for a never-fetched source, or the resolution error
 */
function buildOneSourceJob({
  source,
  window,
  options,
  home,
  deps,
  cursorOverridden,
}: {
  source: CorpusSource;
  window: ExportWindow;
  options: RefreshOptions;
  home: string;
  deps: RefreshDeps;
  cursorOverridden: boolean;
}): Result<SourceIngestJob | undefined, RefreshJobPlanError> {
  if (source === "github") {
    return buildGithubSourceJob({ cursorOverridden, deps, home, options, window });
  }
  if (source === "gold") {
    return ok(undefined); // `gold` is synthetic and never fetched — narrows source to TokenedSource below.
  }
  if (source === "self") {
    // Unreachable by construction: `self` is absent from FETCHABLE_SOURCES, so `selectRefreshSources` refuses
    // `--source self` and no window is ever planned for it. Kept as a LOUD error rather than a silent
    // `ok(undefined)` because if it ever does become reachable, that means someone added `self` to the fetch
    // list — the one decision here most likely to be violated by accident — and a quiet skip would hide it.
    return err(RefreshErrors.selfNotFetchable());
  }
  if (source === "gmail") {
    return buildGmailSourceJob({ cursorOverridden, deps, home, options, window });
  }
  if (source === "calendar") {
    return buildCalendarSourceJob({ cursorOverridden, deps, home, options, window });
  }
  if (source === "outlook-calendar") {
    return buildOutlookCalendarSourceJob({ cursorOverridden, deps, home, options, window });
  }
  if (source === "fathom") {
    return buildFathomSourceJob({ deps, home, options, window });
  }
  if (source === "chatgpt") {
    // A whole-snapshot read of an export already on disk: no credential, no cap, no cursor.
    const build = deps.buildChatgptJob;
    if (build === undefined) {
      return err(RefreshErrors.laneNotWired({ source: "chatgpt" }));
    }
    return ok(build({ home, window }));
  }
  return buildTokenedSourceJob({ cursorOverridden, deps, home, options, source, window });
}

/**
 * Build the `fathom` ingest job.
 *
 * Its own branch rather than the tokened path, even though its credential IS a bare key like Linear's: the
 * shared builder hands every job the Slack channel list and the Notion capture caps, and this lane has no
 * use for either. It also takes no `cursorOverridden` — it holds no second cursor layer of its own, so the
 * pooled watermark `ingestSources` owns is the only cursor there is to override.
 *
 * @param options the parsed refresh options, for the two caps this lane honours itself
 * @param window the planned export window, passed to Fathom as its `created_at` filter
 * @param home the Slopweaver home
 * @param deps the effectful seams
 * @returns the job, or the reason this build cannot make one
 */
function buildFathomSourceJob({
  options,
  window,
  home,
  deps,
}: {
  options: RefreshOptions;
  window: ExportWindow;
  home: string;
  deps: RefreshDeps;
}): Result<SourceIngestJob, RefreshLaneNotWiredError> {
  const build = deps.buildFathomJob;
  if (build === undefined) {
    return err(RefreshErrors.laneNotWired({ source: "fathom" }));
  }
  return ok(
    build({
      home,
      window,
      ...(options.sample !== undefined ? { sample: options.sample } : {}),
      ...(options.fetchCap !== undefined ? { fetchCap: options.fetchCap } : {}),
    }),
  );
}

/**
 * Build a TOKENED source's ingest job (Slack/Linear/Notion) over the shared connector builder.
 *
 * @param source the tokened source — every non-tokened one is decided before this is reached
 * @param options the parsed refresh options
 * @param window the planned export window
 * @param home the Slopweaver home
 * @param deps the effectful seams
 * @param cursorOverridden whether an explicit window flag beat the stored cursor
 * @returns the job
 */
function buildTokenedSourceJob({
  source,
  options,
  window,
  home,
  deps,
  cursorOverridden,
}: {
  source: TokenedSource;
  options: RefreshOptions;
  window: ExportWindow;
  home: string;
  deps: RefreshDeps;
  cursorOverridden: boolean;
}): Result<SourceIngestJob, RefreshJobPlanError> {
  const read = source === "slack" ? deps.slackReadToken() : undefined;
  if (read?.warning !== undefined) {
    deps.logger.warn({ msg: read.warning });
  }
  const token = source === "slack" ? read!.token! : deps.resolveTokens()[source]!;
  return ok(
    deps.buildSourceJob({
      cursorOverridden,
      home,
      nowIso: () => deps.nowDate().toISOString(),
      sampled: options.sample !== undefined,
      slackChannels: options.slackChannels,
      source,
      token,
      window,
      ...(deps.sourceProgress !== undefined ? { onProgress: deps.sourceProgress } : {}),
      ...(options.fetchCap !== undefined ? { fetchCap: options.fetchCap } : {}),
      ...(options.refetchUnchanged ? { refetchUnchanged: true } : {}),
      ...(options.noNotionAttachments ? { withAttachments: false } : {}),
      notionCaps: options.notionCaps,
    }),
  );
}

/** Build the GitHub ingest job: the org-mode fan-out when `--all-repos` (+ seam), else the single-repo job. */
function buildGithubSourceJob({
  options,
  window,
  home,
  deps,
  cursorOverridden,
}: {
  options: RefreshOptions;
  window: ExportWindow;
  home: string;
  deps: RefreshDeps;
  cursorOverridden: boolean;
}): Result<SourceIngestJob, RefreshGithubJobUnbuildableError> {
  const sourceProgress = deps.sourceProgress;
  if (!options.allRepos || deps.buildGithubOrgJob === undefined) {
    const onProgress = sourceProgress !== undefined ? githubItemProgress({ sourceProgress }) : undefined;
    return deps
      .buildGithubJob({
        // `--sample` and `--fetch-cap` both withhold the durable committer, for two different reasons that
        // `githubRunCommitter` spells out; the single-repo lane is never cursor-isolated (a `store load`
        // always goes through org mode).
        bounded: options.sample !== undefined || options.fetchCap !== undefined,
        home,
        noEnrich: options.noEnrich,
        repoSlug: options.repo,
        window,
        ...(onProgress !== undefined ? { onProgress } : {}),
      })
      .mapErr((reasons) => RefreshErrors.githubJobUnbuildable({ reasons }));
  }
  const onRepoProgress = sourceProgress !== undefined ? githubRepoProgress({ sourceProgress }) : undefined;
  return deps
    .buildGithubOrgJob({
      home,
      ignoreRepoCursors: cursorOverridden,
      options,
      window,
      ...(onRepoProgress !== undefined ? { onRepoProgress } : {}),
    })
    .mapErr((reasons) => RefreshErrors.githubJobUnbuildable({ reasons }));
}

/**
 * Build the ordered source jobs (effectful factories) + emit each window line; a GitHub repo error stops it.
 *
 * @param windows the planned per-source windows, in order
 * @param options the parsed refresh options
 * @param home the Slopweaver home
 * @param today today's date, for the window log line
 * @param deps the effectful seams
 * @returns the ordered jobs, or the first source's resolution error
 */
export function buildRefreshJobs({
  windows,
  options,
  home,
  today,
  deps,
}: {
  windows: readonly RefreshWindow[];
  options: RefreshOptions;
  home: string;
  today: string;
  deps: RefreshDeps;
}): Result<readonly SourceIngestJob[], RefreshJobPlanError> {
  const jobs: SourceIngestJob[] = [];
  for (const { source, window, cursorOverridden } of windows) {
    const built = buildOneSourceJob({ cursorOverridden, deps, home, options, source, window });
    if (built.isErr()) {
      return err(built.error);
    }
    if (built.value !== undefined) {
      jobs.push(built.value);
      const line = refreshWindowLogLine({ cursorOverridden, source, today, window });
      deps.logger.info({
        msg: options.numbersOnly ? sanitiseLine({ label: built.value.label, text: line }) : line,
      });
    }
  }
  return ok(jobs);
}

/**
 * The `self` job, as a zero-or-one list so the caller can splice it in without a conditional.
 *
 * Appended AFTER the fetched sources rather than joining `sources`, and that is the shape of the whole decision
 * rather than an ordering preference: `self` is not in `FETCHABLE_SOURCES`, so `--source self` is refused,
 * `buildRefreshWindows` never plans a window for it, no watermark is read or written for it, and a bare
 * `refresh` cannot reach it. The obvious implementation — add `"self"` to the source list — would have wired it
 * into all four of those paths at once.
 *
 * @param selfRoots the resolved roots (empty ⇒ no job)
 * @param selfExclude relative-path prefixes to decline, each reported by name
 * @param home the Slopweaver home
 * @param until the run's exclusive upper bound, which names the bronze file
 * @param deps the effectful seams (the job builder is injected)
 * @returns the one-element job list, or an empty one
 */
export function buildSelfJobs({
  selfRoots,
  selfExclude,
  home,
  until,
  deps,
}: {
  selfRoots: readonly string[];
  selfExclude: readonly string[];
  home: string;
  until: string;
  deps: RefreshDeps;
}): readonly SourceIngestJob[] {
  const build = deps.buildSelfJob;
  if (selfRoots.length === 0 || build === undefined) {
    return [];
  }
  const job = build({ exclude: selfExclude, home, roots: selfRoots, window: { since: EPOCH_SINCE, until } });
  deps.logger.info({ msg: `refresh self · ${String(selfRoots.length)} root(s) · full re-scan, no cursor` });
  return [job];
}

/**
 * The lines a job-plan failure prints: a GitHub builder refusal as the builder's own lines, one per line
 * exactly as it wrote them, and every other failure as its one message.
 *
 * @param error the failure to print
 * @returns the lines, in order
 */
export function refreshJobErrorLines({ error }: { error: RefreshJobPlanError }): readonly string[] {
  if (error.code === "GITHUB_JOB_UNBUILDABLE") {
    return error.reasons;
  }
  return [error.message];
}
