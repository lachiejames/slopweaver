/**
 * Reading a failed CI job's log through the door, bounded, over injected seams.
 *
 * Three seams rather than one, because they are three different calls with three different failure kinds:
 * the run header, the run's jobs page, and the log body itself. The log seam is the unusual one — it hands
 * back an async iterable of text CHUNKS rather than a string, and that is the whole reason this read is
 * bounded. See `./jobLog.ts`'s header for the measurement that forced it: a 3.2 MB job log with no
 * byte-range shortcut, because GitHub's log blob host answers a `Range` request with the entire body.
 */

import { err, ok, type Result } from "../../lib/result.js";
import {
  JobLogAccumulator,
  type JobLogSummary,
  MAX_LINE_CHARS,
  splitStreamChunk,
  stripLogTimestamp,
} from "./jobLog.js";
import { type GithubJobLogError, GithubJobLogErrors } from "./jobLogErrors.js";
import {
  failedStepOf,
  isUnsuccessfulJob,
  type JobFacts,
  type JobStepFacts,
  parseJobsPage,
  parseRunFacts,
  type RunFacts,
} from "./jobLogShape.js";

/** The injected run-header seam. */
export type FetchWorkflowRun = (args: {
  owner: string;
  repo: string;
  runId: number;
}) => Promise<Result<unknown, GithubJobLogError>>;

/** The injected jobs-page seam. */
export type FetchWorkflowRunJobs = (args: {
  owner: string;
  repo: string;
  runId: number;
}) => Promise<Result<unknown, GithubJobLogError>>;

/**
 * The injected log seam: one job's log as a stream of text chunks.
 *
 * An `AsyncIterable<string>` rather than a `string` IS the contract — a seam returning the whole body would
 * make every caller of this module hold a data-sized payload in one JS string, which is the thing
 * `.claude/rules/typescript-patterns.md` forbids and the thing the streamed read exists to avoid.
 */
export type StreamJobLog = (args: {
  owner: string;
  repo: string;
  jobId: number;
}) => Promise<Result<AsyncIterable<string>, GithubJobLogError>>;

/** One job's log, already bounded. */
export interface JobLogEntry {
  readonly jobId: number;
  readonly name: string;
  readonly conclusion: string | undefined;
  readonly htmlUrl: string | undefined;
  /** The step GitHub concluded `failure`, or `undefined` when the job failed without naming one. */
  readonly failedStep: JobStepFacts | undefined;
  readonly log: JobLogSummary;
}

/** What one `run-log` read established. */
export interface JobLogDocument {
  readonly repo: string;
  readonly run: RunFacts;
  readonly tailLines: number;
  readonly jobs: readonly JobLogEntry[];
  readonly readAtIso: string;
  /** What this read did NOT cover, stated rather than left for a reader to infer. */
  readonly residue: readonly string[];
}

/**
 * Consume one job's streamed log into a bounded window.
 *
 * The accumulator is fed every line and keeps a fixed number of them, so this function's memory does not
 * grow with the log. It does NOT stop reading at the first `Process completed` line: a job's log carries
 * one per step that ran a process, and the window a reader wants is the one the LAST of them closes — so
 * the whole body is streamed through and the accumulator's own close snapshot decides where it ends.
 *
 * @param chunks the streamed body
 * @param tailLines how many trailing lines to keep
 * @returns the bounded summary of the whole log
 */
export async function accumulateJobLog({
  chunks,
  tailLines,
}: {
  chunks: AsyncIterable<string>;
  tailLines: number;
}): Promise<JobLogSummary> {
  const accumulator = new JobLogAccumulator({ tailLines });
  let carry = "";
  for await (const chunk of chunks) {
    const split = splitStreamChunk({ carry, chunk });
    carry = split.carry;
    accumulator.recordTruncated({ count: split.truncated });
    for (const line of split.lines) {
      accumulator.push({ line: stripLogTimestamp({ line }) });
    }
  }
  // A body whose last line carries no trailing newline leaves one line in the carry. Dropping it would
  // silently lose the `Process completed` line on any log that ends without one. The carry can stand one
  // character past the cap by construction (see `splitStreamChunk`), so an over-long final line is counted
  // here exactly as a terminated one would be.
  if (carry.length > 0) {
    if (carry.length > MAX_LINE_CHARS) {
      accumulator.recordTruncated({ count: 1 });
    }
    accumulator.push({ line: stripLogTimestamp({ line: carry.slice(0, MAX_LINE_CHARS) }) });
  }
  return accumulator.summary();
}

/**
 * The jobs this read should fetch a log for, or a named refusal.
 *
 * Three selectors rather than one because three callers ask three different questions. `jobIds` is
 * `github checks --log`'s: it already knows the exact jobs, because each failed check's `detailsUrl` names
 * one, so re-deriving them from a conclusion would be strictly worse — a check that failed is the subject
 * even if GitHub's job conclusion for it reads something else.
 */
function selectJobs({
  jobs,
  job,
  jobIds,
  runId,
  runConclusion,
}: {
  jobs: readonly JobFacts[];
  job: string | undefined;
  jobIds: readonly number[] | undefined;
  runId: number;
  runConclusion: string | undefined;
}): Result<readonly JobFacts[], GithubJobLogError> {
  if (jobIds !== undefined) {
    const selected = jobs.filter((candidate) => jobIds.includes(candidate.id));
    if (selected.length === 0) {
      return err(GithubJobLogErrors.noFailedJob({ conclusion: "no job in it matched", runId }));
    }
    return ok(selected);
  }
  if (job !== undefined) {
    const named = jobs.filter((candidate) => candidate.name === job);
    if (named.length === 0) {
      return err(GithubJobLogErrors.jobNotFound({ available: jobs.map((one) => one.name), job }));
    }
    return ok(named);
  }
  const unsuccessful = jobs.filter((candidate) => isUnsuccessfulJob({ conclusion: candidate.conclusion }));
  if (unsuccessful.length === 0) {
    if (runConclusion === undefined) {
      return err(GithubJobLogErrors.noFailedJob({ conclusion: "nothing yet", runId }));
    }
    return err(GithubJobLogErrors.noFailedJob({ conclusion: runConclusion, runId }));
  }
  return ok(unsuccessful);
}

/**
 * What this read could not cover, named rather than left implicit.
 *
 * Every entry is a real bound of the read, not a disclaimer: a tail is a tail, a dropped annotation is a
 * line a reader will never see here, a truncated line is one whose length came from the data rather than
 * from this window, and a region that never closed means the runner's own end-of-step marker was absent so
 * the "step" reported is the whole log.
 */
function readResidue({
  entries,
  tailLines,
}: {
  entries: readonly JobLogEntry[];
  tailLines: number;
}): readonly string[] {
  const residue: string[] = [
    `each job reports every annotation it raised in full, and only the last ${String(tailLines)} lines of ` +
      "its failing step — raise it with --lines, or open the job URL for the whole log",
  ];
  const dropped = entries.reduce((total, entry) => total + entry.log.annotationsDropped, 0);
  if (dropped > 0) {
    residue.push(`${String(dropped)} annotation(s) past the cap were not kept`);
  }
  const truncated = entries.reduce((total, entry) => total + entry.log.linesTruncated, 0);
  if (truncated > 0) {
    residue.push(
      `${String(truncated)} line(s) were longer than ${String(MAX_LINE_CHARS)} characters and are shown ` +
        "only as their first that many",
    );
  }
  const unclosed = entries.filter((entry) => !entry.log.closed).map((entry) => entry.name);
  if (unclosed.length > 0) {
    residue.push(
      `no \`Process completed\` marker in ${unclosed.join(", ")} — the lines shown are the end of the whole ` +
        "job log, not of one step",
    );
  }
  return residue;
}

/**
 * Stream each selected job's log into its own bounded entry, in the order the jobs page listed them.
 *
 * Sequential rather than concurrent on purpose: a run with eight red legs would otherwise open eight
 * multi-megabyte bodies at once, and the report is read in order anyway.
 */
async function readEntries({
  selected,
  owner,
  repo,
  tailLines,
  streamLog,
}: {
  selected: readonly JobFacts[];
  owner: string;
  repo: string;
  tailLines: number;
  streamLog: StreamJobLog;
}): Promise<Result<readonly JobLogEntry[], GithubJobLogError>> {
  const entries: JobLogEntry[] = [];
  for (const candidate of selected) {
    const chunks = await streamLog({ jobId: candidate.id, owner, repo });
    if (chunks.isErr()) {
      return err(chunks.error);
    }
    entries.push({
      conclusion: candidate.conclusion,
      failedStep: failedStepOf({ steps: candidate.steps }),
      htmlUrl: candidate.htmlUrl,
      jobId: candidate.id,
      log: await accumulateJobLog({ chunks: chunks.value, tailLines }),
      name: candidate.name,
    });
  }
  return ok(entries);
}

/**
 * Read the log of every unsuccessful job in one workflow run, bounded.
 *
 * @param owner the repository owner
 * @param repo the repository name
 * @param runId the Actions run
 * @param job read only the job with this name, instead of every unsuccessful one
 * @param jobIds read exactly these jobs — what a caller that already resolved them from a check's details
 *   URL passes, so nothing is re-derived from a conclusion
 * @param tailLines how many trailing lines of each job's failing step to keep
 * @param fetchRun the run-header seam
 * @param fetchJobs the jobs-page seam
 * @param streamLog the log-body seam
 * @param nowIso the read clock
 * @returns the bounded document, or a named failure
 */
export async function readJobLogs({
  owner,
  repo,
  runId,
  job,
  jobIds,
  tailLines,
  fetchRun,
  fetchJobs,
  streamLog,
  nowIso,
}: {
  owner: string;
  repo: string;
  runId: number;
  job: string | undefined;
  jobIds: readonly number[] | undefined;
  tailLines: number;
  fetchRun: FetchWorkflowRun;
  fetchJobs: FetchWorkflowRunJobs;
  streamLog: StreamJobLog;
  nowIso: () => string;
}): Promise<Result<JobLogDocument, GithubJobLogError>> {
  const runPayload = await fetchRun({ owner, repo, runId });
  if (runPayload.isErr()) {
    return err(runPayload.error);
  }
  const run = parseRunFacts({ payload: runPayload.value });
  if (run === undefined) {
    return err(GithubJobLogErrors.runNotFound({ runId }));
  }
  const jobsPayload = await fetchJobs({ owner, repo, runId });
  if (jobsPayload.isErr()) {
    return err(jobsPayload.error);
  }
  const selected = selectJobs({
    job,
    jobIds,
    jobs: parseJobsPage({ payload: jobsPayload.value }),
    runConclusion: run.conclusion,
    runId,
  });
  if (selected.isErr()) {
    return err(selected.error);
  }
  const entries = await readEntries({ owner, repo, selected: selected.value, streamLog, tailLines });
  if (entries.isErr()) {
    return err(entries.error);
  }
  return ok({
    jobs: entries.value,
    readAtIso: nowIso(),
    repo: `${owner}/${repo}`,
    residue: readResidue({ entries: entries.value, tailLines }),
    run,
    tailLines,
  });
}
