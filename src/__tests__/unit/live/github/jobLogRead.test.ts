import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { MAX_LINE_CHARS } from "../../../../live/github/jobLog.js";
import {
  accumulateJobLog,
  type FetchWorkflowRun,
  type FetchWorkflowRunJobs,
  readJobLogs,
  type StreamJobLog,
} from "../../../../live/github/jobLogRead.js";
import { renderJobLogJson, renderJobLogText } from "../../../../live/github/jobLogReport.js";

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

/** One `run-log --from` read over the fake seams. */
async function readFrom({
  from,
  tailLines,
  logs = { 7: LINT_LOG },
}: {
  from: string;
  tailLines: number;
  logs?: Record<number, readonly string[]>;
}) {
  return unwrap(
    await readJobLogs({
      ...seamsFor({ logs }),
      from,
      job: undefined,
      jobIds: undefined,
      nowIso: () => "2026-09-20T10:00:00.000Z",
      owner: "o",
      repo: "r",
      runId: 42,
      tailLines,
    }),
  );
}

describe("readJobLogs --from", () => {
  it("keeps each job's window from its first match in place of the tail", async () => {
    const document = await readFrom({ from: "escape-hatch", tailLines: 2 });

    expect(document.jobs[0]!.log.from).toStrictEqual({
      firstLine: 3,
      lines: ["  ✓ escape-hatch (2.3s)", "dev lint: FAIL"],
      logLines: 6,
      text: "escape-hatch",
    });
    expect(document.jobs[0]!.log.tail).toEqual([]);
  });

  it("matches a line the stream delivered split across two chunks", async () => {
    const summary = await accumulateJobLog({
      chunks: chunksOf({ parts: ["a\ndev li", "nt: x\nb\n"] }),
      from: "dev lint: x",
      tailLines: 5,
    });

    expect(summary.from!.firstLine).toBe(2);
    expect(summary.from!.lines).toEqual(["dev lint: x", "b"]);
  });

  it("states the forward bound as residue, and names --from on a tail read", async () => {
    const forward = await readFrom({ from: "escape-hatch", tailLines: 2 });
    const tail = unwrap(
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

    expect(forward.residue[0]).toContain(
      'at most 2 lines from the first line of its whole log containing "escape-hatch"',
    );
    expect(tail.residue[0]).toContain("read a section from its first line with --from <text>");
  });

  it("drops the unclosed-step note, which describes a tail and not a forward window", async () => {
    const document = await readFrom({ from: "went", logs: { 7: ["something went wrong\n"] }, tailLines: 2 });

    expect(document.residue.length).toBe(1);
  });
});

describe("renderJobLogText --from", () => {
  it("prints the annotations, then the window with where it sits in the whole log", async () => {
    const text = renderJobLogText({ document: await readFrom({ from: "escape-hatch", tailLines: 2 }) });

    expect(text).toContain('lines 3..4 of 6, from the first line containing "escape-hatch":');
    expect(text.indexOf("bad assertion")).toBeLessThan(text.indexOf("lines 3..4 of 6"));
    expect(text).not.toContain("last 2 of");
  });

  it("says plainly when no line matched", async () => {
    const text = renderJobLogText({ document: await readFrom({ from: "dev lint: oxlint", tailLines: 2 }) });

    expect(text).toContain(`no line in this job's log contains "dev lint: oxlint"`);
  });

  it("names the match without a backwards range under --lines 0", async () => {
    const text = renderJobLogText({ document: await readFrom({ from: "escape-hatch", tailLines: 0 }) });

    expect(text).toContain('first line containing "escape-hatch" is 3; no log lines were kept — --lines was zero');
  });

  it("qualifies the match when a line was cut before the search, since a match past the cut is not seen", async () => {
    const cut = `${"x".repeat(MAX_LINE_CHARS)}NEEDLE\n`;
    const caveat = `1 line(s) were cut at ${String(MAX_LINE_CHARS)} characters and searched only on what was kept`;
    const matched = renderJobLogText({
      document: await readFrom({ from: "NEEDLE", logs: { 7: [cut, "later NEEDLE\n"] }, tailLines: 1 }),
    });
    const unmatched = renderJobLogText({
      document: await readFrom({ from: "NEEDLE", logs: { 7: [cut] }, tailLines: 1 }),
    });

    const within = `in its first ${String(MAX_LINE_CHARS)} characters`;

    expect(matched).toContain(`lines 2..2 of 2, from the first line containing "NEEDLE" ${within}:`);
    expect(matched).toContain(caveat);
    expect(unmatched).toContain(`no line in this job's log contains "NEEDLE" ${within}`);
    expect(unmatched).toContain(caveat);
  });

  it("states no cut when every line was searched whole", async () => {
    const text = renderJobLogText({ document: await readFrom({ from: "escape-hatch", tailLines: 2 }) });

    expect(text).not.toContain("were cut at");
    expect(text).toContain('from the first line containing "escape-hatch":');
  });

  it("carries the window into the JSON document", async () => {
    const json = renderJobLogJson({ document: await readFrom({ from: "escape-hatch", tailLines: 1 }) });

    expect(json).toContain('"firstLine": 3');
    expect(json).toContain('"logLines": 6');
  });
});
