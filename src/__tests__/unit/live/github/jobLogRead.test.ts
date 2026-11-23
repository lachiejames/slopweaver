import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  accumulateJobLog,
  type FetchWorkflowRun,
  type FetchWorkflowRunJobs,
  readJobLogs,
  type StreamJobLog,
} from "../../../../live/github/jobLogRead.js";
import { renderJobLogText } from "../../../../live/github/jobLogReport.js";

/** One streamed body, as the production seam hands one over: chunks, not a string. */
function chunksOf({ parts }: { parts: readonly string[] }): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) {
        yield part;
      }
    },
  };
}

const RUN_PAYLOAD = {
  data: { conclusion: "failure", head_branch: "a-branch", head_sha: "abc1234", id: 42, name: "CI" },
};

const JOBS_PAYLOAD = {
  data: {
    jobs: [
      {
        conclusion: "failure",
        html_url: "https://github.com/o/r/actions/runs/42/job/7",
        id: 7,
        name: "lint",
        steps: [
          { conclusion: "success", name: "Set up job", number: 1 },
          { conclusion: "failure", name: "Lint", number: 8 },
        ],
      },
      { conclusion: "success", id: 8, name: "unit", steps: [] },
    ],
  },
};

const LINT_LOG = [
  "2026-09-20T09:25:31.0000000Z ##[group]Run yarn lint\n",
  "2026-09-20T09:25:32.1000000Z ##[error]site/x.tsx:86:11: bad assertion\n",
  "2026-09-20T09:31:44.0000000Z   ✓ escape-hatch (2.3s)\n",
  "2026-09-20T09:31:45.0000000Z dev lint: FAIL\n",
  "2026-09-20T09:31:45.1000000Z ##[error]Process completed with exit code 1.\n",
  "2026-09-20T09:31:45.9000000Z Cleaning up orphan processes\n",
];

/** The three seams, each a plain fake — nothing here is a mock. */
function seamsFor({
  logs = { 7: LINT_LOG },
  jobsPayload = JOBS_PAYLOAD,
  streamed = [],
}: {
  logs?: Record<number, readonly string[]>;
  jobsPayload?: unknown;
  streamed?: number[];
} = {}): { fetchRun: FetchWorkflowRun; fetchJobs: FetchWorkflowRunJobs; streamLog: StreamJobLog } {
  return {
    fetchJobs: () => Promise.resolve(ok(jobsPayload)),
    fetchRun: () => Promise.resolve(ok(RUN_PAYLOAD)),
    streamLog: ({ jobId }) => {
      streamed.push(jobId);
      const parts = logs[jobId];
      if (parts === undefined) {
        return Promise.resolve(ok(chunksOf({ parts: [] })));
      }
      return Promise.resolve(ok(chunksOf({ parts })));
    },
  };
}

describe("accumulateJobLog", () => {
  it("bounds a body arriving in arbitrary chunks to the tail and the annotations", async () => {
    const summary = await accumulateJobLog({
      chunks: chunksOf({
        parts: ["##[group]Run x\n##[err", "or]boom\nfine\n##[error]Process completed with exit code 1.\ncleanup\n"],
      }),
      tailLines: 2,
    });

    expect(summary.annotations).toEqual([{ level: "error", text: "boom" }]);
    expect(summary.tail).toEqual(["fine", "##[error]Process completed with exit code 1."]);
    expect(summary.closed).toBe(true);
  });

  it("keeps a final line that carried no trailing newline, so a close is never lost", async () => {
    const summary = await accumulateJobLog({
      chunks: chunksOf({ parts: ["a\n##[error]Process completed with exit code 1."] }),
      tailLines: 1,
    });

    expect(summary.tail).toEqual(["##[error]Process completed with exit code 1."]);
    expect(summary.closed).toBe(true);
  });

  it("reports an empty body as an unclosed window of no lines", async () => {
    const summary = await accumulateJobLog({ chunks: chunksOf({ parts: [] }), tailLines: 5 });

    expect(summary.regionLines).toBe(0);
    expect(summary.closed).toBe(false);
    expect(summary.tail).toEqual([]);
  });
});

describe("readJobLogs", () => {
  it("reads every unsuccessful job and no successful one", async () => {
    const streamed: number[] = [];
    const document = unwrap(
      await readJobLogs({
        ...seamsFor({ streamed }),
        job: undefined,
        jobIds: undefined,
        nowIso: () => "2026-09-20T10:00:00.000Z",
        owner: "o",
        repo: "r",
        runId: 42,
        tailLines: 2,
      }),
    );

    expect(streamed).toEqual([7]);
    expect(document.jobs.length).toBe(1);
    expect(document.jobs[0]!.name).toBe("lint");
    expect(document.jobs[0]!.failedStep).toEqual({ conclusion: "failure", name: "Lint", number: 8 });
    expect(document.jobs[0]!.log.annotations).toEqual([{ level: "error", text: "site/x.tsx:86:11: bad assertion" }]);
    expect(document.repo).toBe("o/r");
    expect(document.readAtIso).toBe("2026-09-20T10:00:00.000Z");
  });

  it("reads a named job that PASSED, which is the only way to reach one", async () => {
    const streamed: number[] = [];
    const document = unwrap(
      await readJobLogs({
        ...seamsFor({ logs: { 8: ["done\n"] }, streamed }),
        job: "unit",
        jobIds: undefined,
        nowIso: () => "2026-09-20T10:00:00.000Z",
        owner: "o",
        repo: "r",
        runId: 42,
        tailLines: 2,
      }),
    );

    expect(streamed).toEqual([8]);
    expect(document.jobs[0]!.conclusion).toBe("success");
  });

  it("reads exactly the job ids a caller already resolved from a check's details URL", async () => {
    const streamed: number[] = [];
    await readJobLogs({
      ...seamsFor({ logs: { 8: ["done\n"] }, streamed }),
      job: undefined,
      jobIds: [8],
      nowIso: () => "2026-09-20T10:00:00.000Z",
      owner: "o",
      repo: "r",
      runId: 42,
      tailLines: 2,
    });

    expect(streamed).toEqual([8]);
  });

  it("names the jobs that exist when --job matches none", async () => {
    const failure = unwrapErr(
      await readJobLogs({
        ...seamsFor(),
        job: "typecheck",
        jobIds: undefined,
        nowIso: () => "2026-09-20T10:00:00.000Z",
        owner: "o",
        repo: "r",
        runId: 42,
        tailLines: 2,
      }),
    );

    expect(failure.code).toBe("JOB_NOT_FOUND");
    expect(failure.message).toContain("lint, unit");
  });

  it("refuses a run in which nothing failed, naming the run's own conclusion", async () => {
    const failure = unwrapErr(
      await readJobLogs({
        ...seamsFor({ jobsPayload: { data: { jobs: [{ conclusion: "success", id: 8, name: "unit", steps: [] }] } } }),
        job: undefined,
        jobIds: undefined,
        nowIso: () => "2026-09-20T10:00:00.000Z",
        owner: "o",
        repo: "r",
        runId: 42,
        tailLines: 2,
      }),
    );

    expect(failure.code).toBe("NO_FAILED_JOB");
    expect(failure.message).toContain("failure");
  });

  it("refuses a run payload carrying no run at all", async () => {
    const failure = unwrapErr(
      await readJobLogs({
        ...seamsFor(),
        fetchRun: () => Promise.resolve(ok({ data: {} })),
        job: undefined,
        jobIds: undefined,
        nowIso: () => "2026-09-20T10:00:00.000Z",
        owner: "o",
        repo: "r",
        runId: 42,
        tailLines: 2,
      }),
    );

    expect(failure.code).toBe("RUN_NOT_FOUND");
  });

  it("states the tail bound as residue rather than leaving a reader to infer it", async () => {
    const document = unwrap(
      await readJobLogs({
        ...seamsFor(),
        job: undefined,
        jobIds: undefined,
        nowIso: () => "2026-09-20T10:00:00.000Z",
        owner: "o",
        repo: "r",
        runId: 42,
        tailLines: 2,
      }),
    );

    expect(document.residue[0]).toContain("only the last 2 lines");
  });

  it("names a job whose log never closed, so a whole-log tail is not read as one step's", async () => {
    const document = unwrap(
      await readJobLogs({
        ...seamsFor({ logs: { 7: ["something went wrong\n"] } }),
        job: undefined,
        jobIds: undefined,
        nowIso: () => "2026-09-20T10:00:00.000Z",
        owner: "o",
        repo: "r",
        runId: 42,
        tailLines: 2,
      }),
    );

    expect(document.residue[1]).toContain("no `Process completed` marker in lint");
  });
});

describe("renderJobLogText", () => {
  it("prints the annotations ABOVE the tail, which is the whole point of the report's order", async () => {
    const document = unwrap(
      await readJobLogs({
        ...seamsFor(),
        job: undefined,
        jobIds: undefined,
        nowIso: () => "2026-09-20T10:00:00.000Z",
        owner: "o",
        repo: "r",
        runId: 42,
        tailLines: 2,
      }),
    );
    const text = renderJobLogText({ document });

    expect(text.indexOf("bad assertion")).toBeLessThan(text.indexOf("dev lint: FAIL"));
    expect(text).toContain("run 42 · o/r · CI · a-branch · failure");
    expect(text).toContain('job lint (7) failure at step 8 "Lint"');
    expect(text).toContain("1 annotation(s):");
    expect(text).toContain("last 2 of 5 line(s):");
    expect(text).toContain("whole log: https://github.com/o/r/actions/runs/42/job/7");
  });

  it("says so plainly when a job's log carried no annotation", async () => {
    const document = unwrap(
      await readJobLogs({
        ...seamsFor({ logs: { 7: ["only this\n##[error]Process completed with exit code 1.\n"] } }),
        job: undefined,
        jobIds: undefined,
        nowIso: () => "2026-09-20T10:00:00.000Z",
        owner: "o",
        repo: "r",
        runId: 42,
        tailLines: 2,
      }),
    );

    expect(renderJobLogText({ document })).toContain("no ##[error] or ##[warning] annotations in this job's log");
  });
});
