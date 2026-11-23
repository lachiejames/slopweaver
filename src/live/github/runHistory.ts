/**
 * Workflow-run HISTORY — how long each CI job actually took, over a window of runs.
 *
 * `./checks.ts` answers "is this pull request green"; it reports state and never duration. This module
 * answers the other question the owner asked, whether all CI checks stay under five minutes, which
 * needs a window of runs, per JOB, split into the time a job spent waiting for a runner and the time it spent
 * working. Before it existed there was no door verb for that at all, so the only way to take the measurement
 * was the raw `gh` AGENTS.md rule 3 bans.
 *
 * ## Three durations, named once
 *
 * GitHub's jobs payload carries three instants per job, and the difference between them is the whole
 * diagnosis:
 *
 * - `created_at` → `started_at` is QUEUE time. On an unblocked job that is runner contention. On a job with
 *   `needs`, it is mostly waiting for its dependencies, which is not contention at all — see
 *   {@link JobTiming.dependencyBlocked}, which is why this module reports the two separately rather than
 *   handing a caller one number they will misread.
 * - `started_at` → `completed_at` is WALL time: what the job's own steps cost. This is the figure the
 *   five-minute bar is about.
 * - `created_at` → `completed_at` is the total a watcher experiences.
 *
 * **A missing instant yields `undefined`, never a zero.** A job GitHub is still running, or one whose payload
 * dropped a field, has no duration — and a zero substituted for one reads as "instant" and drags a
 * percentile down, which is exactly the false green this measurement exists to avoid. Every skipped figure
 * is counted and named in the document's residue.
 *
 * ## A SKIPPED job is not a fast job, and the first run of this verb proved it
 *
 * MEASURED, on the very first read this verb took of `main`: `integration` is declared
 * `if: github.event_name == 'pull_request' || github.event_name == 'merge_group'`, so in all twenty `push`
 * runs of `main` it was SKIPPED — and GitHub still emits a job record for it, carrying `started_at` and
 * `completed_at` a fraction of a second apart and sometimes in the WRONG ORDER. The report read
 * `integration  20  -1:-1  0:00  0:00`: the slowest check in the workflow presented as the fastest, with a
 * twenty-run sample behind it.
 *
 * Two rules follow, and both are here rather than in the renderer because a consumer that computes its own
 * verdict (a ratchet, say) has to inherit them:
 *
 * - **A job whose conclusion is `skipped` has no duration at all.** It is counted in
 *   {@link JobDurationSummary.skipped} and sampled nowhere. Reporting it as a pass is the same
 *   skipped-conclusion-counts-as-green trap `.github/workflows/ci.yml`'s own `build` comment documents.
 * - **A NEGATIVE span is not a measurement.** Two instants out of order mean the payload cannot be trusted
 *   for that job, so {@link ./runHistoryParse.spanSeconds} answers `undefined` rather than a number below zero, which would
 *   otherwise sort to the top of a fastest-first list and sit under every ceiling ever written.
 *
 * ## Percentiles are nearest-rank, stated rather than assumed
 *
 * {@link percentileSeconds} sorts ascending and takes the `ceil(p * n)`-th sample (1-indexed), clamped into
 * range. No interpolation. It is spelled here once so the number in the page, the number in a pull-request
 * body and the number a ratchet baseline is set from are all computed by the same function — the four
 * independent `tsToIso` copies this repository already paid for are the reason that matters.
 */

import { appendAll } from "../../lib/arrays.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubRunHistoryError, GithubRunHistoryErrors } from "./runHistoryErrors.js";
import {
  DEPENDENCY_BLOCKED_JOBS,
  type JobTiming,
  parseRunJobsPage,
  parseWorkflowRunsPage,
  type WorkflowRunRef,
} from "./runHistoryParse.js";

/** Seconds in one minute — the unit every duration here is reported in. */
const SECONDS_PER_MINUTE = 60;

/**
 * Every timing for one step NAME across the window, within one job.
 *
 * @internal — a caller reaches these through the document rather than by naming the type.
 */
export interface StepDurationSummary {
  readonly job: string;
  readonly name: string;
  readonly runs: number;
  readonly wallP50Seconds: number | undefined;
  readonly wallP95Seconds: number | undefined;
}

/** Every timing for one job NAME across the window, plus the percentiles the five-minute bar is judged on. */
export interface JobDurationSummary {
  readonly name: string;
  /** How many runs in the window carried this job with a readable wall time. */
  readonly runs: number;
  readonly wallP50Seconds: number | undefined;
  readonly wallP95Seconds: number | undefined;
  readonly wallMaxSeconds: number | undefined;
  readonly wallMinSeconds: number | undefined;
  readonly queueP50Seconds: number | undefined;
  readonly queueMaxSeconds: number | undefined;
  readonly dependencyBlocked: boolean;
  /** How many of this job's appearances carried no readable wall time while having actually run. */
  readonly unreadable: number;
  /** How many runs in the window skipped this job entirely — not measured, and never a pass. */
  readonly skipped: number;
}

/** A whole history read: what was selected, which runs it covered, and what each job costs. */
export interface RunHistoryDocument {
  readonly source: "github";
  readonly repo: string;
  readonly workflow: string;
  readonly branch: string;
  readonly event: string;
  readonly readAtIso: string;
  readonly runs: readonly WorkflowRunRef[];
  readonly jobs: readonly JobDurationSummary[];
  /**
   * Per-step timings, present only when the caller asked for them (`--steps`). Empty means nobody asked,
   * NOT that the jobs have no steps — an absent breakdown and a breakdown of nothing are different facts,
   * and {@link RunHistoryDocument.stepsRequested} is the one that says which this is.
   */
  readonly steps: readonly StepDurationSummary[];
  /** Whether the caller asked for the per-step breakdown at all. */
  readonly stepsRequested: boolean;
  readonly residue: readonly string[];
}

/**
 * The `--branch` value that means "no branch filter at all".
 *
 * It exists because GitHub filters an Actions run on its own HEAD ref, which for a `pull_request` run is the
 * feature branch and never the base — so `--event pull_request --branch main` matches nothing, every time,
 * and a caller reads that as "the integration lane never runs" rather than "you filtered it out".
 */
export const ANY_BRANCH = "any";

/** The injected runs-page seam. Production wraps the shared `GithubReadRest`; tests supply a plain fake. */
export type FetchWorkflowRuns = (args: {
  owner: string;
  repo: string;
  workflow: string;
  branch: string;
  event: string;
  perPage: number;
}) => Promise<Result<unknown, GithubRunHistoryError>>;

/** The injected jobs-page seam, one call per run. Same contract as {@link FetchWorkflowRuns}. */
export type FetchRunJobs = (args: {
  owner: string;
  repo: string;
  runId: number;
}) => Promise<Result<unknown, GithubRunHistoryError>>;

/**
 * The nearest-rank percentile of a sample, in seconds.
 *
 * No interpolation: the sample is sorted ascending and the `ceil(p * n)`-th value (1-indexed) is returned,
 * clamped into range. Spelled once so every consumer of these numbers computes them identically.
 *
 * @param samples the durations, in any order; an empty sample answers `undefined`
 * @param p the percentile as a fraction, e.g. 0.95
 * @returns the percentile value, or `undefined` when there is no sample
 */
export function percentileSeconds({ samples, p }: { samples: readonly number[]; p: number }): number | undefined {
  if (samples.length === 0) {
    return undefined;
  }
  const sorted = samples.toSorted((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index];
}

/**
 * Collapse every step of one job into per-step percentiles, in first-seen declared order.
 *
 * Order is the workflow's, not a ranking: a reader following a slow job down its steps is reading a
 * sequence, and sorting it by cost would hide that the install runs before the thing it is slowing down.
 *
 * @param timings every job timing across the window
 * @param job the job name whose steps are wanted
 * @returns one summary per step name, in declared order
 * @internal — called by {@link readRunHistory}; exported so the unit lane can reach it without a mock.
 */
export function summariseStepDurations({
  timings,
  job,
}: {
  timings: readonly JobTiming[];
  job: string;
}): readonly StepDurationSummary[] {
  const order: string[] = [];
  const byName = new Map<string, number[]>();
  for (const timing of timings.filter((t) => t.name === job)) {
    for (const step of timing.steps) {
      const held = byName.get(step.name);
      if (held === undefined) {
        order.push(step.name);
        byName.set(step.name, step.wallSeconds === undefined ? [] : [step.wallSeconds]);
      } else if (step.wallSeconds !== undefined) {
        held.push(step.wallSeconds);
      }
    }
  }
  return order.map((name) => {
    const held = byName.get(name);
    // `order` is built from `byName`'s own keys, so a miss is unreachable; the `!` says that rather than a
    // `?? []` inventing an empty sample the gate would (rightly) call a silent fallback.
    const samples = held!;
    return {
      job,
      name,
      runs: samples.length,
      wallP50Seconds: percentileSeconds({ p: 0.5, samples }),
      wallP95Seconds: percentileSeconds({ p: 0.95, samples }),
    };
  });
}

/**
 * Collapse every timing of one job name into the percentiles the five-minute bar is judged on.
 *
 * A job appearance with no readable wall time contributes to {@link JobDurationSummary.unreadable} and to
 * nothing else — never a zero sample.
 *
 * @param timings every job timing across the whole window, in any order
 * @returns one summary per job name, ranked slowest-first on p95 wall time
 */
export function summariseJobDurations({ timings }: { timings: readonly JobTiming[] }): readonly JobDurationSummary[] {
  const byName = new Map<string, JobTiming[]>();
  for (const timing of timings) {
    const held = byName.get(timing.name);
    if (held === undefined) {
      byName.set(timing.name, [timing]);
    } else {
      held.push(timing);
    }
  }
  const summaries: JobDurationSummary[] = [];
  for (const [name, group] of byName) {
    const ran = group.filter((t) => !t.skipped);
    const wall = ran.map((t) => t.wallSeconds).filter((s): s is number => s !== undefined);
    const queue = ran.map((t) => t.queueSeconds).filter((s): s is number => s !== undefined);
    summaries.push({
      dependencyBlocked: DEPENDENCY_BLOCKED_JOBS.includes(name),
      name,
      queueMaxSeconds: queue.length === 0 ? undefined : Math.max(...queue),
      queueP50Seconds: percentileSeconds({ p: 0.5, samples: queue }),
      runs: wall.length,
      skipped: group.length - ran.length,
      unreadable: ran.length - wall.length,
      wallMaxSeconds: wall.length === 0 ? undefined : Math.max(...wall),
      wallMinSeconds: wall.length === 0 ? undefined : Math.min(...wall),
      wallP50Seconds: percentileSeconds({ p: 0.5, samples: wall }),
      wallP95Seconds: percentileSeconds({ p: 0.95, samples: wall }),
    });
  }
  return rankJobsByWall({ summaries });
}

/**
 * Rank job summaries slowest-first on p95 wall time — the order the owner asked the measurement to be in.
 *
 * A summary with no readable wall time sorts last rather than first: "unmeasured" is not "slowest", and
 * putting it at the top would make the ranking's own headline a job nobody has a number for.
 *
 * @param summaries the per-job summaries, in any order
 * @returns the same summaries, descending on p95 wall time
 */
export function rankJobsByWall({
  summaries,
}: {
  summaries: readonly JobDurationSummary[];
}): readonly JobDurationSummary[] {
  return summaries.toSorted((a, b) => sortKey({ summary: b }) - sortKey({ summary: a }));
}

/**
 * The descending sort key for one summary: its p95 wall, or a value below every real duration.
 *
 * Named rather than written as `?? -1` inline, because the substitution is the whole behaviour: an
 * unmeasured job is being deliberately sent to the BOTTOM of a slowest-first list, and a duration can never
 * be negative, so nothing real can collide with it.
 *
 * @param summary the job summary to key
 * @returns its p95 wall in seconds, or -1 when it has no measurement at all
 */
function sortKey({ summary }: { summary: JobDurationSummary }): number {
  if (summary.wallP95Seconds === undefined) {
    return -1;
  }
  return summary.wallP95Seconds;
}

/**
 * Whether a job's p95 wall time breaches the bar, treating an unmeasured job as NOT a pass.
 *
 * @returns true only when there is a measurement AND it exceeds the bar; false for an unmeasured job,
 * which the report renders as `n/m` rather than as either verdict.
 */
export function breachesBar({ summary, barMinutes }: { summary: JobDurationSummary; barMinutes: number }): boolean {
  if (summary.wallP95Seconds === undefined) {
    return false;
  }
  return summary.wallP95Seconds > barMinutes * SECONDS_PER_MINUTE;
}

/** What one history read needs: the address, the selection, the two seams, and a clock. */
export interface ReadRunHistoryArgs {
  readonly owner: string;
  readonly repo: string;
  readonly workflow: string;
  readonly branch: string;
  readonly event: string;
  readonly runs: number;
  readonly fetchRuns: FetchWorkflowRuns;
  readonly fetchJobs: FetchRunJobs;
  readonly nowIso: () => string;
  /** Whether to compute the per-step breakdown — the half that names a slow job's CAUSE. */
  readonly steps?: boolean;
}

/**
 * Fetch and shape every run's jobs, turning a failed or malformed run into RESIDUE rather than a failure.
 *
 * Split out of {@link readRunHistory} because the loop carries all of that function's branching: a window of
 * twenty runs where two are unreadable is eighteen real measurements plus two named gaps, and collapsing it
 * into the caller put the whole read over both the length and the complexity ceilings.
 *
 * @param runs the window, already trimmed to what the caller asked for
 * @param fetchJobs the jobs-page seam
 * @returns every readable job timing, and one residue line per run or row that could not be read
 */
async function collectJobTimings({
  runs,
  owner,
  repo,
  fetchJobs,
}: {
  runs: readonly WorkflowRunRef[];
  owner: string;
  repo: string;
  fetchJobs: FetchRunJobs;
}): Promise<{ timings: readonly JobTiming[]; residue: readonly string[] }> {
  const timings: JobTiming[] = [];
  const residue: string[] = [];
  for (const run of runs) {
    const where = `run ${String(run.runNumber)} (${run.headSha.slice(0, 8)})`;
    const jobsPage = await fetchJobs({ owner, repo, runId: run.id });
    if (jobsPage.isErr()) {
      residue.push(`${where}: ${jobsPage.error.message}`);
      continue;
    }
    const jobs = parseRunJobsPage({ payload: jobsPage.value, runId: run.id });
    if (jobs.isErr()) {
      residue.push(`${where}: ${jobs.error.message}`);
      continue;
    }
    if (jobs.value.dropped > 0) {
      residue.push(`${where}: ${String(jobs.value.dropped)} job row(s) carried no name`);
    }
    appendAll({ from: jobs.value.timings, into: timings });
  }
  return { residue, timings };
}

/**
 * Read one window of workflow runs and time every job in it.
 *
 * The runs page is fetched once; each run's jobs are then fetched in declared order, and a run whose jobs
 * page cannot be read is recorded in the residue rather than failing the whole measurement — nineteen
 * readable runs is a real answer, and a caller can see exactly how many it is missing.
 *
 * @param args the address, the selection, the injected seams and the clock
 * @returns the timing document, or the first failure that left nothing to measure
 */
export async function readRunHistory(
  args: ReadRunHistoryArgs,
): Promise<Result<RunHistoryDocument, GithubRunHistoryError>> {
  const selection = `${args.workflow} on ${args.branch} (${args.event})`;
  const page = await args.fetchRuns({
    branch: args.branch,
    event: args.event,
    owner: args.owner,
    perPage: args.runs,
    repo: args.repo,
    workflow: args.workflow,
  });
  if (page.isErr()) {
    return err(page.error);
  }
  const parsed = parseWorkflowRunsPage({ payload: page.value });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const runs = parsed.value.runs.slice(0, args.runs);
  if (runs.length === 0) {
    return err(GithubRunHistoryErrors.empty({ selection }));
  }
  const residue: string[] = [];
  if (parsed.value.dropped > 0) {
    residue.push(`${String(parsed.value.dropped)} run row(s) dropped: no readable id, sha, event or created_at`);
  }
  const collected = await collectJobTimings({ fetchJobs: args.fetchJobs, owner: args.owner, repo: args.repo, runs });
  appendAll({ from: collected.residue, into: residue });
  const timings = collected.timings;
  if (timings.length === 0) {
    return err(GithubRunHistoryErrors.empty({ selection }));
  }
  const jobs = summariseJobDurations({ timings });
  const stepsRequested = args.steps === true;
  const steps = stepsRequested ? jobs.flatMap((job) => summariseStepDurations({ job: job.name, timings })) : [];
  return ok({
    branch: args.branch,
    event: args.event,
    jobs,
    readAtIso: args.nowIso(),
    repo: `${args.owner}/${args.repo}`,
    residue,
    runs,
    source: "github",
    steps,
    stepsRequested,
    workflow: args.workflow,
  });
}
