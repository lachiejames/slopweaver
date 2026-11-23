import { describe, expect, it } from "vitest";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { type CiTimingError, CiTimingErrors } from "../../../../live/github/ciTimingErrors.js";
import { parseRunJobsPage } from "../../../../live/github/runHistoryParse.js";
import {
  allAttemptJobsParams,
  type FetchRunJobsPage,
  jobRowsOfPage,
  latestAttemptJobRows,
  MAX_JOB_PAGES,
  readAllAttemptJobRows,
} from "../../../../live/github/runJobAttempts.js";

/** One raw job row as GitHub's `filter=all` jobs list returns it, with only the fields the fold and parser read. */
const row = ({ name, attempt, wall = 100 }: { name: string; attempt: number; wall?: number }) => ({
  completed_at: new Date(Date.UTC(2026, 9, 30, 20, 0, wall)).toISOString(),
  conclusion: "success",
  created_at: "2026-10-30T19:59:58.000Z",
  name,
  run_attempt: attempt,
  started_at: "2026-10-30T20:00:00.000Z",
});

/**
 * A fake page seam serving `pages` in order, each with its own `total_count`, and recording which page
 * numbers were asked for. Past the last page it serves an empty list under the last total, which is what a
 * read running out looks like.
 */
function pagesOf({ pages }: { pages: readonly { jobs: readonly unknown[]; total: number }[] }): {
  fetchPage: FetchRunJobsPage;
  asked: number[];
} {
  const asked: number[] = [];
  const fetchPage: FetchRunJobsPage = ({ page }) => {
    asked.push(page);
    const served = page <= pages.length ? pages[page - 1]! : { jobs: [], total: pages.at(-1)!.total };
    const result: Result<unknown, CiTimingError> = ok({ data: { jobs: served.jobs, total_count: served.total } });
    return Promise.resolve(result);
  };
  return { asked, fetchPage };
}

/** A fake page seam serving `responses` strictly in CALL order, whatever page is asked — a list that moves. */
function responsesInOrder({ responses }: { responses: readonly { jobs: readonly unknown[]; total: number }[] }): {
  fetchPage: FetchRunJobsPage;
  asked: number[];
} {
  const asked: number[] = [];
  const fetchPage: FetchRunJobsPage = ({ page }) => {
    const served = responses[asked.length]!;
    asked.push(page);
    const result: Result<unknown, CiTimingError> = ok({ data: { jobs: served.jobs, total_count: served.total } });
    return Promise.resolve(result);
  };
  return { asked, fetchPage };
}

/** `count` distinct one-attempt rows with numeric ids starting at `from`. */
const idRows = ({ from, count }: { from: number; count: number }) =>
  Array.from({ length: count }, (_, i) => ({ ...row({ attempt: 1, name: `job-${String(from + i)}` }), id: from + i }));

describe("latestAttemptJobRows", () => {
  it("times a re-run job on its re-run and keeps a job left alone on the attempt that ran it", () => {
    const rows = [
      row({ attempt: 1, name: "lint", wall: 250 }),
      row({ attempt: 1, name: "unit-6", wall: 205 }),
      row({ attempt: 2, name: "unit-6", wall: 180 }),
      row({ attempt: 1, name: "ratchet" }),
      row({ attempt: 2, name: "ratchet" }),
    ];
    expect(latestAttemptJobRows({ rows })).toEqual([rows[0], rows[2], rows[4]]);
  });

  it("picks the highest attempt by number, not the last row", () => {
    const rows = [row({ attempt: 3, name: "lint", wall: 240 }), row({ attempt: 1, name: "lint", wall: 290 })];
    expect(latestAttemptJobRows({ rows })).toEqual([rows[0]]);
  });

  it("leaves a single-attempt run exactly as it was", () => {
    const rows = [row({ attempt: 1, name: "lint" }), row({ attempt: 1, name: "compile" })];
    expect(latestAttemptJobRows({ rows })).toEqual(rows);
  });

  it("passes a row with no readable name or attempt through for the parser to count", () => {
    const rows = [
      { run_attempt: 1 },
      { name: "", run_attempt: 1 },
      { name: "lint" },
      { name: "lint", run_attempt: 1.5 },
      { name: "lint", run_attempt: 0 },
      row({ attempt: 2, name: "lint" }),
    ];
    expect(latestAttemptJobRows({ rows })).toEqual(rows);
  });

  it("keeps both rows of one name in the same attempt", () => {
    const rows = [
      row({ attempt: 2, name: "unit" }),
      row({ attempt: 2, name: "unit" }),
      row({ attempt: 1, name: "unit" }),
    ];
    expect(latestAttemptJobRows({ rows })).toEqual([rows[0], rows[1]]);
  });

  it("answers an empty list for an empty read", () => {
    expect(latestAttemptJobRows({ rows: [] })).toEqual([]);
  });
});

describe("jobRowsOfPage", () => {
  it("reads the rows and the total off a REST envelope", () => {
    const page = jobRowsOfPage({
      payload: { data: { jobs: [row({ attempt: 1, name: "lint" })], total_count: 3 } },
      runId: 7,
    });
    expect(unwrap(page).totalCount).toBe(3);
    expect(unwrap(page).rows.length).toBe(1);
  });

  it("refuses a page with no total, naming the run", () => {
    const page = jobRowsOfPage({ payload: { jobs: [] }, runId: 7 });
    expect(unwrapErr(page).code).toBe("CI_TIMING_RUN_READ_FAILED");
    expect(unwrapErr(page).message).toContain("run 7");
  });
});

describe("allAttemptJobsParams", () => {
  it("asks for every attempt, a full page, at the page given", () => {
    expect(allAttemptJobsParams({ owner: "acme", page: 2, repo: "widgets", runId: 41 })).toEqual({
      filter: "all",
      owner: "acme",
      page: 2,
      per_page: 100,
      repo: "widgets",
      run_id: 41,
    });
  });
});

describe("readAllAttemptJobRows", () => {
  it("pages until it holds the total, then folds — the run 41120434531 shape reads no job ABSENT", async () => {
    const attemptOne = [
      row({ attempt: 1, name: "lint", wall: 250 }),
      row({ attempt: 1, name: "compile", wall: 170 }),
      row({ attempt: 1, name: "unit-6", wall: 205 }),
    ];
    const attemptTwo = [row({ attempt: 2, name: "unit-6", wall: 180 })];
    const { asked, fetchPage } = pagesOf({
      pages: [
        { jobs: attemptOne, total: 4 },
        { jobs: attemptTwo, total: 4 },
      ],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 41120434531 });
    expect(asked).toEqual([1, 2, 1, 2]);
    const timings = unwrap(parseRunJobsPage({ payload: unwrap(read), runId: 41120434531 })).timings;
    expect(timings.map((t) => [t.name, t.wallSeconds])).toEqual([
      ["lint", 250],
      ["compile", 170],
      ["unit-6", 180],
    ]);
  });

  it("stops after one page when the first page already holds the total", async () => {
    const { asked, fetchPage } = pagesOf({ pages: [{ jobs: [row({ attempt: 1, name: "lint" })], total: 1 }] });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 1 });
    expect(asked).toEqual([1]);
    expect(unwrap(read).jobs.length).toBe(1);
  });

  it("completes an empty run on its first page", async () => {
    const { asked, fetchPage } = pagesOf({ pages: [{ jobs: [], total: 0 }] });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 1 });
    expect(asked).toEqual([1]);
    expect(unwrap(read).jobs).toEqual([]);
  });

  it("refuses a read that runs out short of the total rather than reporting the rest as never run", async () => {
    const { fetchPage } = pagesOf({ pages: [{ jobs: [row({ attempt: 1, name: "lint" })], total: 5 }] });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(unwrapErr(read).message).toContain("ran out at 1 of 5");
  });

  it("refuses a total that moves between pages", async () => {
    const { fetchPage } = pagesOf({
      pages: [
        { jobs: [row({ attempt: 1, name: "lint" })], total: 2 },
        { jobs: [row({ attempt: 2, name: "lint" })], total: 3 },
      ],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(unwrapErr(read).message).toContain("the total moved from 2 to 3 on page 2");
  });

  it("refuses a job id that comes back twice, even when the count then matches the total", async () => {
    const { fetchPage } = pagesOf({
      pages: [
        { jobs: [{ ...row({ attempt: 1, name: "compile" }), id: 100 }], total: 2 },
        { jobs: [{ ...row({ attempt: 1, name: "compile" }), id: 100 }], total: 2 },
      ],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(unwrapErr(read).message).toContain("job 100 came back twice");
  });

  it("completes when every job id is distinct", async () => {
    const { fetchPage } = pagesOf({
      pages: [
        { jobs: [{ ...row({ attempt: 1, name: "compile" }), id: 100 }], total: 2 },
        { jobs: [{ ...row({ attempt: 1, name: "lint" }), id: 101 }], total: 2 },
      ],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(unwrap(read).jobs.length).toBe(2);
  });

  it("refuses a shift that swaps one job for another under an unchanged total, with no id repeated", async () => {
    // Job 1 vanishes and job 102 appears between page 1 and page 2: the first read holds 1..100 and 102 —
    // 101 distinct ids, the total met — while the list now reads 2..102, so the second read disagrees.
    const { asked, fetchPage } = responsesInOrder({
      responses: [
        { jobs: idRows({ count: 100, from: 1 }), total: 101 },
        { jobs: idRows({ count: 1, from: 102 }), total: 101 },
        { jobs: idRows({ count: 100, from: 2 }), total: 101 },
        { jobs: idRows({ count: 1, from: 102 }), total: 101 },
      ],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(asked).toEqual([1, 2, 1, 2]);
    expect(unwrapErr(read).message).toContain("two whole reads of its pages disagreed");
  });

  it("refuses a job whose timing changed between the two passes, ids and order unchanged", async () => {
    const retimed = [{ ...row({ attempt: 1, name: "job-1", wall: 160 }), id: 1 }, ...idRows({ count: 99, from: 2 })];
    const { fetchPage } = responsesInOrder({
      responses: [
        { jobs: idRows({ count: 100, from: 1 }), total: 101 },
        { jobs: idRows({ count: 1, from: 101 }), total: 101 },
        { jobs: retimed, total: 101 },
        { jobs: idRows({ count: 1, from: 101 }), total: 101 },
      ],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(unwrapErr(read).message).toContain("two whole reads of its pages disagreed");
  });

  it("refuses a change between passes even when the seam hands back the same row objects", async () => {
    const pageOne = idRows({ count: 100, from: 1 });
    const pageTwo = idRows({ count: 1, from: 101 });
    let calls = 0;
    const fetchPage: FetchRunJobsPage = ({ page }) => {
      calls += 1;
      if (calls === 3) {
        pageOne[0]!.conclusion = "failure";
      }
      const jobs = page === 1 ? pageOne : pageTwo;
      const result: Result<unknown, CiTimingError> = ok({ data: { jobs, total_count: 101 } });
      return Promise.resolve(result);
    };
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(calls).toBe(4);
    expect(unwrapErr(read).message).toContain("two whole reads of its pages disagreed");
  });

  it("refuses a step number that changed from 0 to -0 between passes, which JSON text cannot tell apart", async () => {
    const withStep = ({ number }: { number: number }) => [
      { ...row({ attempt: 1, name: "a" }), id: 1, steps: [{ name: "s", number }] },
    ];
    const { fetchPage } = responsesInOrder({
      responses: [
        { jobs: withStep({ number: 0 }), total: 2 },
        { jobs: idRows({ count: 1, from: 2 }), total: 2 },
        { jobs: withStep({ number: -0 }), total: 2 },
        { jobs: idRows({ count: 1, from: 2 }), total: 2 },
      ],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(unwrapErr(read).message).toContain("two whole reads of its pages disagreed");
  });

  it("folds a re-run on a later page once both passes agree", async () => {
    const pageOne = [{ ...row({ attempt: 1, name: "x", wall: 200 }), id: 1 }, ...idRows({ count: 99, from: 2 })];
    const pageTwo = [{ ...row({ attempt: 2, name: "x", wall: 150 }), id: 101 }];
    const { fetchPage } = responsesInOrder({
      responses: [
        { jobs: pageOne, total: 101 },
        { jobs: pageTwo, total: 101 },
        { jobs: pageOne, total: 101 },
        { jobs: pageTwo, total: 101 },
      ],
    });
    const jobs = unwrap(await readAllAttemptJobRows({ fetchPage, runId: 9 })).jobs;
    expect(jobs.length).toBe(100);
    expect(jobs.at(-1)).toEqual(pageTwo[0]);
  });

  it("completes a multi-page read whose second pass returns the same rows", async () => {
    const { asked, fetchPage } = responsesInOrder({
      responses: [
        { jobs: idRows({ count: 100, from: 1 }), total: 101 },
        { jobs: idRows({ count: 1, from: 101 }), total: 101 },
        { jobs: idRows({ count: 100, from: 1 }), total: 101 },
        { jobs: idRows({ count: 1, from: 101 }), total: 101 },
      ],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(asked).toEqual([1, 2, 1, 2]);
    expect(unwrap(read).jobs.length).toBe(101);
  });

  it("refuses two same-named jobs in one attempt once a second attempt exists", async () => {
    const { fetchPage } = pagesOf({
      pages: [
        {
          jobs: [
            { ...row({ attempt: 1, name: "test", wall: 90 }), id: 1 },
            { ...row({ attempt: 1, name: "test", wall: 120 }), id: 2 },
            { ...row({ attempt: 2, name: "test", wall: 110 }), id: 3 },
          ],
          total: 3,
        },
      ],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(unwrapErr(read).message).toContain('two jobs named "test" in one attempt');
  });

  it("passes two same-named jobs through on a run of one attempt, as before", async () => {
    const { fetchPage } = pagesOf({
      pages: [
        {
          jobs: [
            { ...row({ attempt: 1, name: "test" }), id: 1 },
            { ...row({ attempt: 1, name: "test" }), id: 2 },
          ],
          total: 2,
        },
      ],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(unwrap(read).jobs.length).toBe(2);
  });

  it("refuses rows that overshoot the total", async () => {
    const { fetchPage } = pagesOf({
      pages: [{ jobs: [row({ attempt: 1, name: "lint" }), row({ attempt: 1, name: "compile" })], total: 1 }],
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(unwrapErr(read).message).toContain("2 rows against a total of 1");
  });

  it("refuses a total past the page cap on page 1, before reading further", async () => {
    const { asked, fetchPage } = pagesOf({ pages: [{ jobs: [row({ attempt: 1, name: "lint" })], total: 1001 }] });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(asked).toEqual([1]);
    expect(unwrapErr(read).message).toContain(`1001 jobs, past the ${String(MAX_JOB_PAGES)}-page cap`);
  });

  it("refuses after the page cap when every page is short of a total it could still hold", async () => {
    const { asked, fetchPage } = pagesOf({
      pages: Array.from({ length: MAX_JOB_PAGES + 1 }, (_, i) => ({
        jobs: [row({ attempt: i + 1, name: "lint" })],
        total: 1000,
      })),
    });
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(asked.length).toBe(MAX_JOB_PAGES);
    expect(unwrapErr(read).message).toContain(`10 of 1000 after ${String(MAX_JOB_PAGES)} pages`);
  });

  it("carries a failed page fetch through unchanged, with no partial list", async () => {
    const fetchPage: FetchRunJobsPage = () =>
      Promise.resolve(err(CiTimingErrors.runReadFailed({ message: "HTTP 502 from the jobs list" })));
    const read = await readAllAttemptJobRows({ fetchPage, runId: 9 });
    expect(unwrapErr(read).message).toBe("HTTP 502 from the jobs list");
  });
});
