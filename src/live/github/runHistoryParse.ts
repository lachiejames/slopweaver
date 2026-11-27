/**
 * The PARSE half of workflow-run history: GitHub's runs and jobs payloads shaped into run references and
 * per-job, per-step timings, as pure functions. `./runHistory.ts` composes these into the history document
 * and its summaries, and reads {@link DEPENDENCY_BLOCKED_JOBS} for each job summary's flag as well.
 *
 * "The module header" the comments below cite is `./runHistory.ts`'s: its measured skipped `integration` job
 * and its negative-span rule are why a skipped job carries no figure here and why {@link spanSeconds} answers
 * `undefined` rather than a duration below zero.
 */

import { parseIsoMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { optStr } from "../../corpus/slack/shape.js";
import { type GithubRunHistoryError, GithubRunHistoryErrors } from "./runHistoryErrors.js";

/** Milliseconds in one second, for turning two instants into a duration. */
const MS_PER_SECOND = 1000;

/** One workflow run in the window: what it was, on which commit, and when GitHub created it. */
export interface WorkflowRunRef {
  readonly id: number;
  readonly runNumber: number;
  readonly headSha: string;
  readonly event: string;
  readonly status: string;
  readonly conclusion: string | undefined;
  readonly createdAtIso: string;
  /** The run's own page, or absent when the payload carried none — never a blank standing in for one. */
  readonly url: string | undefined;
}

/** One job of one run, with its queue and wall time split apart. */
export interface JobTiming {
  readonly runId: number;
  readonly name: string;
  readonly conclusion: string | undefined;
  /** `started_at` → `completed_at`, the job's own work. `undefined` when either instant is absent. */
  readonly wallSeconds: number | undefined;
  /** `created_at` → `started_at`. `undefined` when either instant is absent. */
  readonly queueSeconds: number | undefined;
  /** `created_at` → `completed_at`, what a watcher experiences. `undefined` when either instant is absent. */
  readonly totalSeconds: number | undefined;
  /**
   * Whether this job's queue time is mostly its `needs` rather than runner contention.
   *
   * It cannot be read off the payload — GitHub reports no dependency edge on a job — so it is supplied by
   * the caller from the workflow's own declared graph ({@link DEPENDENCY_BLOCKED_JOBS}). A `true` here means
   * `queueSeconds` says nothing about how busy the runners were.
   */
  readonly dependencyBlocked: boolean;
  /**
   * Whether GitHub concluded this job `skipped` — it did not run, so it has no duration and contributes no
   * sample. A skipped job is reported as NOT MEASURED, never as a fast one.
   */
  readonly skipped: boolean;
  /**
   * Each of this job's STEPS, in declared order, with its own wall time.
   *
   * The job-level number says a job is slow; only this says which of `yarn install --immutable`, `Lint` and
   * `Unit tests` it is slow IN. Naming the cause is half of what was asked for, and without the
   * steps that half is a guess.
   */
  readonly steps: readonly StepTiming[];
}

/**
 * One step of one job: what it was, and how long it took.
 *
 * @internal — a caller reaches these through the document rather than by naming the type.
 */
export interface StepTiming {
  readonly name: string;
  readonly number: number;
  readonly conclusion: string | undefined;
  readonly wallSeconds: number | undefined;
}

/**
 * The jobs whose queue time is their `needs` rather than runner contention, read off `.github/workflows/ci.yml`.
 *
 * Declared here rather than derived because GitHub's jobs payload carries no dependency edge at all: a
 * `needs`-blocked job reports the whole wait for its dependencies as `created_at` → `started_at`, which is
 * indistinguishable in the payload from a job that sat in a runner queue for the same span. A caller reading
 * `build`'s 9-minute "queue" as contention would conclude the runners are starved when the truth is that
 * `build` waits for every worker by design. `unit` is kept for the runs that still carry it: before `build`
 * took over the merge of the six shards' reports, that job did it, and its queue was their whole lap.
 *
 * @internal — read by this module and `./runHistory.ts`; a caller reads the summary flag, not this list.
 */
export const DEPENDENCY_BLOCKED_JOBS: readonly string[] = ["build", "unit"];

/**
 * Seconds between two ISO instants, or `undefined` when either is absent, unparseable, or out of order.
 *
 * @param fromIso the earlier instant
 * @param toIso the later instant
 * @returns the span in seconds, or `undefined` when it cannot be established
 */
export function spanSeconds({
  fromIso,
  toIso,
}: {
  fromIso: string | undefined;
  toIso: string | undefined;
}): number | undefined {
  if (fromIso === undefined || toIso === undefined) {
    return undefined;
  }
  const from = parseIsoMs({ tsIso: fromIso });
  const to = parseIsoMs({ tsIso: toIso });
  if (from === undefined || to === undefined) {
    return undefined;
  }
  const seconds = (to - from) / MS_PER_SECOND;
  // A job that finished before it started is a payload this read cannot trust — see the module header's
  // measured `integration  20  -1:-1  0:00  0:00`. A negative duration sorts to the top of a fastest-first
  // list and sits under every ceiling, so it must never leave here as a number.
  if (seconds < 0) {
    return undefined;
  }
  return seconds;
}

/** One raw workflow run shaped into a {@link WorkflowRunRef}, or `undefined` when a core field is missing. */
function toRunRef({ raw }: { raw: unknown }): WorkflowRunRef | undefined {
  if (!isRecord(raw) || typeof raw["id"] !== "number" || typeof raw["run_number"] !== "number") {
    return undefined;
  }
  const headSha = optStr({ value: raw["head_sha"] });
  const event = optStr({ value: raw["event"] });
  const status = optStr({ value: raw["status"] });
  const createdAtIso = optStr({ value: raw["created_at"] });
  const url = optStr({ value: raw["html_url"] });
  if (headSha === undefined || event === undefined || status === undefined || createdAtIso === undefined) {
    return undefined;
  }
  return {
    conclusion: optStr({ value: raw["conclusion"] }),
    createdAtIso,
    event,
    headSha,
    id: raw["id"],
    runNumber: raw["run_number"],
    status,
    url,
  };
}

/**
 * Shape one page of `GET /actions/runs` into run references, dropping a row missing a core field.
 *
 * A dropped row is COUNTED rather than fatal: one malformed entry in a page of twenty must not destroy the
 * other nineteen measurements, and a silent drop would overstate how complete the window is.
 *
 * @param payload whatever the REST seam returned for the runs page
 * @returns the readable runs and how many rows were dropped, or why the page could not be read at all
 */
export function parseWorkflowRunsPage({
  payload,
}: {
  payload: unknown;
}): Result<{ runs: readonly WorkflowRunRef[]; dropped: number }, GithubRunHistoryError> {
  const body = isRecord(payload) && isRecord(payload["data"]) ? payload["data"] : payload;
  if (!isRecord(body) || !Array.isArray(body["workflow_runs"])) {
    return err(GithubRunHistoryErrors.unreadable({ subject: "workflow runs" }));
  }
  const runs: WorkflowRunRef[] = [];
  let dropped = 0;
  for (const raw of body["workflow_runs"]) {
    const ref = toRunRef({ raw });
    if (ref === undefined) {
      dropped += 1;
    } else {
      runs.push(ref);
    }
  }
  return ok({ dropped, runs });
}

/** One raw job shaped into a {@link JobTiming}, or `undefined` when it carries no usable name. */
function toJobTiming({ raw, runId }: { raw: unknown; runId: number }): JobTiming | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const name = optStr({ value: raw["name"] });
  if (name === undefined) {
    return undefined;
  }
  const conclusion = optStr({ value: raw["conclusion"] });
  const skipped = conclusion === "skipped";
  const createdAtIso = optStr({ value: raw["created_at"] });
  const startedAtIso = optStr({ value: raw["started_at"] });
  const completedAtIso = optStr({ value: raw["completed_at"] });
  // A skipped job's instants are emitted anyway, a fraction of a second apart — see the module header. It
  // did not run, so none of the three figures exists for it.
  const measurable = skipped ? undefined : completedAtIso;
  return {
    conclusion,
    dependencyBlocked: DEPENDENCY_BLOCKED_JOBS.includes(name),
    name,
    queueSeconds: skipped ? undefined : spanSeconds({ fromIso: createdAtIso, toIso: startedAtIso }),
    runId,
    skipped,
    steps: skipped ? [] : toStepTimings({ raw: raw["steps"] }),
    totalSeconds: spanSeconds({ fromIso: createdAtIso, toIso: measurable }),
    wallSeconds: spanSeconds({ fromIso: startedAtIso, toIso: measurable }),
  };
}

/**
 * Shape a job's raw `steps` array into per-step timings, dropping a step with no readable name.
 *
 * @param raw whatever sat under the job's `steps` key
 * @returns the readable step timings, in the order GitHub returned them
 */
function toStepTimings({ raw }: { raw: unknown }): readonly StepTiming[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const steps: StepTiming[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const name = optStr({ value: entry["name"] });
    if (name === undefined) {
      continue;
    }
    steps.push({
      conclusion: optStr({ value: entry["conclusion"] }),
      name,
      number: typeof entry["number"] === "number" ? entry["number"] : 0,
      wallSeconds: spanSeconds({
        fromIso: optStr({ value: entry["started_at"] }),
        toIso: optStr({ value: entry["completed_at"] }),
      }),
    });
  }
  return steps;
}

/**
 * Shape one page of `GET /actions/runs/{run_id}/jobs` into per-job timings.
 *
 * @param payload whatever the REST seam returned for the jobs page
 * @param runId the run these jobs belong to, carried onto each timing
 * @returns the readable timings and how many rows were dropped, or why the page could not be read
 */
export function parseRunJobsPage({
  payload,
  runId,
}: {
  payload: unknown;
  runId: number;
}): Result<{ timings: readonly JobTiming[]; dropped: number }, GithubRunHistoryError> {
  const body = isRecord(payload) && isRecord(payload["data"]) ? payload["data"] : payload;
  if (!isRecord(body) || !Array.isArray(body["jobs"])) {
    return err(GithubRunHistoryErrors.unreadable({ subject: `jobs of run ${String(runId)}` }));
  }
  const timings: JobTiming[] = [];
  let dropped = 0;
  for (const raw of body["jobs"]) {
    const timing = toJobTiming({ raw, runId });
    if (timing === undefined) {
      dropped += 1;
    } else {
      timings.push(timing);
    }
  }
  return ok({ dropped, timings });
}
