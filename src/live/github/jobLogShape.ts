/**
 * Shaping GitHub's Actions payloads into the narrow facts a job-log read needs, as pure functions.
 *
 * Separate from `./runHistoryParse.ts`'s parse of the same two endpoints on purpose: that one shapes a TIMING
 * document, shaped around how long each job and step took (a step's `conclusion` rides along with it).
 * This read is the opposite — it needs which step FAILED and nothing about how long it took — and widening
 * the timing document to carry failure structure would leave one type that half of each caller ignores.
 */

import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";

/** One step of a job, as far as a log read cares. */
export interface JobStepFacts {
  readonly number: number;
  readonly name: string;
  /** GitHub's own conclusion: `success`, `failure`, `skipped`, `cancelled`, or absent while running. */
  readonly conclusion: string | undefined;
}

/** One job of a workflow run. */
export interface JobFacts {
  readonly id: number;
  readonly name: string;
  readonly conclusion: string | undefined;
  readonly htmlUrl: string | undefined;
  readonly steps: readonly JobStepFacts[];
}

/** The run-level facts a report's header prints. */
export interface RunFacts {
  readonly id: number;
  readonly name: string | undefined;
  readonly conclusion: string | undefined;
  readonly headBranch: string | undefined;
  readonly headSha: string | undefined;
  readonly htmlUrl: string | undefined;
}

/** The Actions run and job a check's details URL points at. */
export interface CheckLogTarget {
  readonly runId: number;
  readonly jobId: number;
}

/**
 * Unwrap an Octokit response envelope, or accept an already-unwrapped body.
 *
 * Both shapes are real: `githubReadRest` hands back the whole `{ status, headers, data }` response, while a
 * test fake supplies the body directly. Accepting either is what lets one parser serve both without the
 * fake having to imitate a transport it is not testing.
 */
function payloadBody({ payload }: { payload: unknown }): unknown {
  if (isRecord(payload) && isRecord(payload["data"])) {
    return payload["data"];
  }
  return payload;
}

/**
 * Shape one workflow run.
 *
 * @param payload the raw `GET /actions/runs/{run_id}` response or its body
 * @returns the run facts, or `undefined` when the payload carries no numeric run id
 */
export function parseRunFacts({ payload }: { payload: unknown }): RunFacts | undefined {
  const body = payloadBody({ payload });
  if (!isRecord(body) || typeof body["id"] !== "number") {
    return undefined;
  }
  return {
    conclusion: optStr({ value: body["conclusion"] }),
    headBranch: optStr({ value: body["head_branch"] }),
    headSha: optStr({ value: body["head_sha"] }),
    htmlUrl: optStr({ value: body["html_url"] }),
    id: body["id"],
    name: optStr({ value: body["name"] }),
  };
}

/** Shape one step entry, dropping anything without a number and a name. */
function parseStep({ entry }: { entry: unknown }): JobStepFacts | undefined {
  if (!isRecord(entry) || typeof entry["number"] !== "number") {
    return undefined;
  }
  const name = optStr({ value: entry["name"] });
  if (name === undefined) {
    return undefined;
  }
  return { conclusion: optStr({ value: entry["conclusion"] }), name, number: entry["number"] };
}

/**
 * Shape one run's jobs page.
 *
 * @param payload the raw `GET /actions/runs/{run_id}/jobs` response or its body
 * @returns every job the page carried, in GitHub's own order
 */
export function parseJobsPage({ payload }: { payload: unknown }): readonly JobFacts[] {
  const body = payloadBody({ payload });
  if (!isRecord(body) || !Array.isArray(body["jobs"])) {
    return [];
  }
  const jobs: JobFacts[] = [];
  for (const entry of body["jobs"]) {
    if (!isRecord(entry) || typeof entry["id"] !== "number") {
      continue;
    }
    const name = optStr({ value: entry["name"] });
    if (name === undefined) {
      continue;
    }
    const rawSteps = Array.isArray(entry["steps"]) ? entry["steps"] : [];
    jobs.push({
      conclusion: optStr({ value: entry["conclusion"] }),
      htmlUrl: optStr({ value: entry["html_url"] }),
      id: entry["id"],
      name,
      steps: rawSteps.flatMap((step) => {
        const parsed = parseStep({ entry: step });
        return parsed === undefined ? [] : [parsed];
      }),
    });
  }
  return jobs;
}

/** The conclusions that mean a job did not do its work — every one of them is worth a log. */
const UNSUCCESSFUL_CONCLUSIONS: ReadonlySet<string> = new Set(["failure", "cancelled", "timed_out", "action_required"]);

/**
 * Whether this job's conclusion is one a reader is asking about when a leg goes red.
 *
 * `cancelled` and `timed_out` are included deliberately: a cancelled job's log is exactly where a session
 * finds out WHY it was cancelled, and reporting "nothing failed" for a run that timed out would send the
 * reader straight back to the lane this verb exists to replace.
 *
 * @param conclusion GitHub's own job conclusion, or `undefined` while it is still running
 * @returns whether this job's log is one the default selection should read
 */
export function isUnsuccessfulJob({ conclusion }: { conclusion: string | undefined }): boolean {
  if (conclusion === undefined) {
    return false;
  }
  return UNSUCCESSFUL_CONCLUSIONS.has(conclusion);
}

/**
 * The step a job failed at, when it has one.
 *
 * A job can end unsuccessfully with NO step marked `failure` — a cancellation, or a runner-level failure.
 * MEASURED on run 35502228255: the `build` aggregator job failed at step 2, but a cancelled job reports
 * every step `cancelled` and none `failure`. Answering `undefined` there is the honest result, and the
 * caller reports the job's own region instead of claiming a step it cannot name.
 *
 * @param steps the job's steps, in declared order
 * @returns the first step GitHub concluded `failure`, or `undefined`
 */
export function failedStepOf({ steps }: { steps: readonly JobStepFacts[] }): JobStepFacts | undefined {
  return steps.find((step) => step.conclusion === "failure");
}

/**
 * The Actions run and job a check run's details URL names.
 *
 * `GithubCheck.url` is GitHub's own `detailsUrl`, shaped
 * `https://github.com/{owner}/{repo}/actions/runs/{runId}/job/{jobId}` for an Actions check run. Reading
 * the pair out of it is what lets `github checks --log` reach a log with no extra GraphQL field and no
 * second round trip — the snapshot already holds everything the read needs.
 *
 * A legacy commit Status, or a check posted by some other CI system, carries a URL of a completely
 * different shape; that answers `undefined` rather than a guess.
 *
 * @param url the check's details URL, or `undefined` when GitHub reported none
 * @returns the run and job ids, or `undefined` when this is not an Actions job URL
 */
export function parseCheckLogTarget({ url }: { url: string | undefined }): CheckLogTarget | undefined {
  if (url === undefined) {
    return undefined;
  }
  const match = /\/actions\/runs\/(\d+)\/job\/(\d+)/u.exec(url);
  const runText = match?.[1];
  const jobText = match?.[2];
  if (runText === undefined || jobText === undefined) {
    return undefined;
  }
  return { jobId: Number(jobText), runId: Number(runText) };
}
