/**
 * Every attempt of one workflow run, read whole and folded to the jobs the run's report is about.
 *
 * `GET /actions/runs/{run_id}/jobs` defaults to `filter=latest`: the jobs of the run's LATEST ATTEMPT only. A
 * "re-run failed jobs" attempt holds only the jobs it re-ran and those that need them, so a reader of that
 * default on attempt 2 sees every job that had passed on attempt 1 as never having run. MEASURED on run
 * `41120434531` (`slopweaver github run-log 41120434531`): `build`, `compile`, `lint`, `typecheck` and
 * `unit-2`–`unit-5` read ABSENT, eight jobs that were green one attempt earlier.
 *
 * So the read asks for `filter=all`, pages until it holds the `total_count` GitHub reports, and keeps, per job
 * NAME, the rows of the highest attempt that ran that job: a re-run job is timed on its re-run, a job left
 * alone on the attempt that ran it. A re-run of ALL jobs folds to the last attempt exactly.
 */

import { isDeepStrictEqual } from "node:util";
import { optStr } from "../../corpus/slack/shape.js";
import { appendAll } from "../../lib/arrays.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type CiTimingError, CiTimingErrors } from "./ciTimingErrors.js";

/** GitHub's own ceiling on `per_page` for the jobs list. */
const JOBS_PER_PAGE = 100;

/**
 * How many pages one run's read may take before it refuses: 1,000 job rows. One attempt of `ci.yml` carries
 * 17 jobs today, so this is about 58 attempts — a bound against a payload whose `total_count` never arrives,
 * not a limit a real run meets.
 */
export const MAX_JOB_PAGES = 10;

/** The injected one-page seam: production wraps the shared REST door, a test passes a plain function. */
export type FetchRunJobsPage = (args: { page: number }) => Promise<Result<unknown, CiTimingError>>;

/** A job row's name and attempt, or `undefined` when the row carries either unreadably. */
function attemptKey({ row }: { row: unknown }): { name: string; attempt: number } | undefined {
  if (!isRecord(row)) {
    return undefined;
  }
  const name = optStr({ value: row["name"] });
  const attempt = row["run_attempt"];
  if (name === undefined || typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1) {
    return undefined;
  }
  return { attempt, name };
}

/**
 * Keep, for each job name, only the rows of the highest attempt that carries that name.
 *
 * A row with no readable name or attempt passes through untouched, so the parser downstream counts and drops
 * it exactly as it did before attempts were read at all. Two rows of one name in the SAME attempt both stay:
 * folding is about attempts, and choosing between peers is not this function's call.
 *
 * @param rows the raw job rows of every attempt, in any order
 * @returns the rows the run's report is about, in their original order
 */
export function latestAttemptJobRows({ rows }: { rows: readonly unknown[] }): readonly unknown[] {
  const latest = new Map<string, number>();
  for (const row of rows) {
    const key = attemptKey({ row });
    if (key === undefined) {
      continue;
    }
    const held = latest.get(key.name);
    if (held === undefined || key.attempt > held) {
      latest.set(key.name, key.attempt);
    }
  }
  return rows.filter((row) => {
    const key = attemptKey({ row });
    if (key === undefined) {
      return true;
    }
    return latest.get(key.name) === key.attempt;
  });
}

/**
 * One jobs page's rows and the total GitHub says the whole read holds.
 *
 * @param payload whatever the REST seam returned for one page
 * @param runId the run read, named in the refusal
 * @returns the page's rows and `total_count`, or why the page is not one
 */
export function jobRowsOfPage({
  payload,
  runId,
}: {
  payload: unknown;
  runId: number;
}): Result<{ rows: readonly unknown[]; totalCount: number }, CiTimingError> {
  const body = isRecord(payload) && isRecord(payload["data"]) ? payload["data"] : payload;
  if (!isRecord(body) || !Array.isArray(body["jobs"]) || typeof body["total_count"] !== "number") {
    return err(
      CiTimingErrors.runReadFailed({
        message: `GitHub's jobs page for run ${String(runId)} carried no jobs list and total — no attempt can be read from it`,
      }),
    );
  }
  return ok({ rows: body["jobs"], totalCount: body["total_count"] });
}

/**
 * The exact REST parameters for one page of a run's jobs across every attempt.
 *
 * @param page the 1-indexed page
 * @returns the `GET /actions/runs/{run_id}/jobs` parameters, `filter=all` included
 */
export function allAttemptJobsParams({
  owner,
  repo,
  runId,
  page,
}: {
  owner: string;
  repo: string;
  runId: number;
  page: number;
}): Readonly<Record<string, unknown>> {
  return { filter: "all", owner, page, per_page: JOBS_PER_PAGE, repo, run_id: runId };
}

/** The refusal every short, shifting or oversized read ends in, naming the run and what was seen. */
function partialRead({ runId, detail }: { runId: number; detail: string }): CiTimingError {
  return CiTimingErrors.runReadFailed({
    message: `run ${String(runId)}'s jobs could not be read whole (${detail}) — refusing rather than reporting the missing jobs as never run`,
  });
}

/**
 * A job name two rows of ONE attempt share, when the run has more than one attempt — or `undefined`.
 *
 * GitHub's jobs list carries no identity for a job that survives across attempts; the display name is the
 * only key, and it is the one the report is keyed by. Two jobs sharing a name in one attempt cannot be
 * matched to their re-runs, so folding them would drop one or time it on the other's lap. On a run of one
 * attempt nothing is folded, and the rows pass as they always did.
 *
 */
function ambiguousFoldName({ rows }: { rows: readonly unknown[] }): string | undefined {
  const attempts = new Set<number>();
  const seen = new Set<string>();
  let repeated: string | undefined;
  for (const row of rows) {
    const key = attemptKey({ row });
    if (key === undefined) {
      continue;
    }
    attempts.add(key.attempt);
    const pair = `${String(key.attempt)}\u0000${key.name}`;
    if (seen.has(pair) && repeated === undefined) {
      repeated = key.name;
    }
    seen.add(pair);
  }
  if (attempts.size < 2) {
    return undefined;
  }
  return repeated;
}

/**
 * The first job `id` two rows share, or `undefined` when every numeric id is distinct.
 *
 * Every row of `filter=all` is one job execution with its own id, so a repeat means the offset pages shifted
 * between requests — and a repeated row can make up the count for a row the shift skipped. A row with no
 * numeric id is left to the parser, as everywhere else in this module.
 */
function firstRepeatedJobId({ rows }: { rows: readonly unknown[] }): number | undefined {
  const seen = new Set<number>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row["id"] !== "number") {
      continue;
    }
    if (seen.has(row["id"])) {
      return row["id"];
    }
    seen.add(row["id"]);
  }
  return undefined;
}

/** Why a page's `total_count` cannot be read against, or `undefined` when it holds the claim page 1 made. */
function totalRefusal({
  claimed,
  total,
  page,
  runId,
}: {
  claimed: number | undefined;
  total: number;
  page: number;
  runId: number;
}): CiTimingError | undefined {
  if (claimed === undefined && total > MAX_JOB_PAGES * JOBS_PER_PAGE) {
    return partialRead({ detail: `${String(total)} jobs, past the ${String(MAX_JOB_PAGES)}-page cap`, runId });
  }
  if (claimed !== undefined && total !== claimed) {
    return partialRead({
      detail: `the total moved from ${String(claimed)} to ${String(total)} on page ${String(page)}`,
      runId,
    });
  }
  return undefined;
}

/** The rows held once every one of `total` is in, refused when two jobs of one attempt share a name. */
function foldedWhole({
  rows,
  runId,
}: {
  rows: readonly unknown[];
  runId: number;
}): Result<readonly unknown[], CiTimingError> {
  const ambiguous = ambiguousFoldName({ rows });
  if (ambiguous !== undefined) {
    return err(
      CiTimingErrors.runReadFailed({
        message: `run ${String(runId)} has two jobs named "${ambiguous}" in one attempt and more than one attempt — a re-run cannot be matched to its job by name, so refusing rather than timing either on the other's lap`,
      }),
    );
  }
  return ok(latestAttemptJobRows({ rows }));
}

/**
 * Judge the rows held after one page: `true` once they equal `total`, `false` while still short, or the
 * refusal a repeated id, an overshoot or an empty short page ends in.
 */
function pageStep({
  rows,
  total,
  pageRows,
  runId,
}: {
  rows: readonly unknown[];
  total: number;
  pageRows: number;
  runId: number;
}): Result<boolean, CiTimingError> {
  const repeated = firstRepeatedJobId({ rows });
  if (repeated !== undefined) {
    return err(partialRead({ detail: `job ${String(repeated)} came back twice, so the pages shifted`, runId }));
  }
  if (rows.length === total) {
    return ok(true);
  }
  if (rows.length > total) {
    return err(partialRead({ detail: `${String(rows.length)} rows against a total of ${String(total)}`, runId }));
  }
  if (pageRows === 0) {
    return err(partialRead({ detail: `ran out at ${String(rows.length)} of ${String(total)}`, runId }));
  }
  return ok(false);
}

/** One pass over every page: the rows it held, and how many pages it took to hold them. */
async function readPagesOnce({
  fetchPage,
  runId,
}: {
  fetchPage: FetchRunJobsPage;
  runId: number;
}): Promise<Result<{ rows: readonly unknown[]; pages: number }, CiTimingError>> {
  const rows: unknown[] = [];
  let claimed: number | undefined;
  for (let page = 1; page <= MAX_JOB_PAGES; page += 1) {
    const read = (await fetchPage({ page })).andThen((payload) => jobRowsOfPage({ payload, runId }));
    if (read.isErr()) {
      return err(read.error);
    }
    const total = read.value.totalCount;
    const moved = totalRefusal({ claimed, page, runId, total });
    if (moved !== undefined) {
      return err(moved);
    }
    claimed = total;
    appendAll({ from: read.value.rows, into: rows });
    const step = pageStep({ pageRows: read.value.rows.length, rows, runId, total });
    if (step.isErr()) {
      return err(step.error);
    }
    if (step.value) {
      return ok({ pages: page, rows });
    }
  }
  return err(
    partialRead({ detail: `${String(rows.length)} of ${String(claimed)} after ${String(MAX_JOB_PAGES)} pages`, runId }),
  );
}

/**
 * Read every attempt's job rows of one run, page by page, and fold them to the latest attempt per job.
 *
 * Page 1's `total_count` is the claim the read is held to. It completes only when the rows held EQUAL it, and
 * refuses when a later page reports a different total, when one job id comes back twice (shifted pages can
 * pad the count with a repeat while skipping a job), when the rows overshoot it, when a page comes back
 * empty first, or when the total is past what {@link MAX_JOB_PAGES} pages can hold — a job missing from a
 * partial read would be reported as never run, the false reading this module exists to remove. The fold runs once, over
 * the whole list, because a later attempt can sit on a later page.
 *
 * GitHub pages by offset with no snapshot, so a multi-page read during which one job row vanished and another
 * appeared, total unchanged, passes every per-page check above. So a read that took more than one page is
 * taken TWICE and must return the same rows, every field, in the same order. What that buys is exact: the rows
 * the fold runs over are what a whole second read saw, so a hybrid only one read assembled — a row skipped or repeated by
 * a shift, a row read before an edit beside one read after it — makes the two disagree and is refused. A row
 * edited before EITHER read reached it is no disagreement, and needs none: both reads hold the list as it stood
 * after the edit, a state the run really had. A one-page read — every run of `ci.yml` today, 17 jobs an attempt —
 * is one response and is taken once. **The residue, stated rather than discovered:** a list that shifts the
 * same way during BOTH reads — shift, restore before the second read, shift again — hands each read the same
 * hybrid, and no client of an offset-paged list without a snapshot can tell that from a stable one. A run's
 * job rows are not deleted, so it needs a finished run's jobs edited, reverted and edited again inside one read.
 *
 * @param fetchPage one page of `filter=all` jobs, 1-indexed
 * @param runId the run read, named in a refusal
 * @returns the folded rows, as a `{ jobs }` payload the run-jobs parser reads unchanged
 */
export async function readAllAttemptJobRows({
  fetchPage,
  runId,
}: {
  fetchPage: FetchRunJobsPage;
  runId: number;
}): Promise<Result<{ jobs: readonly unknown[] }, CiTimingError>> {
  const first = await readPagesOnce({ fetchPage, runId });
  if (first.isErr()) {
    return err(first.error);
  }
  if (first.value.pages > 1) {
    // Cloned BEFORE the second read, so a seam that hands back the same row objects cannot make the first read
    // agree with the second by changing under it. Every field counts, `-0` and an `undefined` field included,
    // because the parser downstream reads timings, conclusions and steps, not only identity.
    const before = structuredClone(first.value.rows);
    const second = await readPagesOnce({ fetchPage, runId });
    if (second.isErr()) {
      return err(second.error);
    }
    if (!isDeepStrictEqual(before, second.value.rows)) {
      return err(partialRead({ detail: "two whole reads of its pages disagreed, so the pages shifted", runId }));
    }
  }
  return foldedWhole({ rows: first.value.rows, runId }).map((jobs) => ({ jobs }));
}
