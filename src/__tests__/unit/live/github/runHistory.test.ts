import { describe, expect, it } from "vitest";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  breachesBar,
  percentileSeconds,
  rankJobsByWall,
  readRunHistory,
  summariseJobDurations,
} from "../../../../live/github/runHistory.js";
import { GithubRunHistoryErrors } from "../../../../live/github/runHistoryErrors.js";
import {
  type JobTiming,
  parseRunJobsPage,
  parseWorkflowRunsPage,
  spanSeconds,
} from "../../../../live/github/runHistoryParse.js";

const RUN_ROW = {
  conclusion: "success",
  created_at: "2026-09-19T10:00:00Z",
  event: "push",
  head_sha: "a1b2c3d4e5f6a7b8",
  html_url: "https://github.com/octo-self/slopweaver/actions/runs/1",
  id: 1,
  run_number: 101,
  status: "completed",
};

const JOB_ROW = {
  completed_at: "2026-09-19T10:07:30Z",
  conclusion: "success",
  created_at: "2026-09-19T10:00:00Z",
  name: "lint",
  started_at: "2026-09-19T10:00:30Z",
};

describe("spanSeconds", () => {
  it("measures the span between two instants", () => {
    expect(spanSeconds({ fromIso: "2026-09-19T10:00:00Z", toIso: "2026-09-19T10:07:30Z" })).toBe(450);
  });

  it("answers undefined when the later instant is absent, never zero", () => {
    expect(spanSeconds({ fromIso: "2026-09-19T10:00:00Z", toIso: undefined })).toBe(undefined);
  });

  it("answers undefined when an instant is unparseable", () => {
    expect(spanSeconds({ fromIso: "not-a-date", toIso: "2026-09-19T10:07:30Z" })).toBe(undefined);
  });
});

describe("percentileSeconds", () => {
  it("answers undefined for an empty sample", () => {
    expect(percentileSeconds({ p: 0.95, samples: [] })).toBe(undefined);
  });

  it("answers the sole value for a sample of one", () => {
    expect(percentileSeconds({ p: 0.95, samples: [42] })).toBe(42);
  });

  it("takes the nearest rank rather than interpolating", () => {
    expect(percentileSeconds({ p: 0.5, samples: [10, 20] })).toBe(10);
    expect(percentileSeconds({ p: 0.95, samples: [10, 20] })).toBe(20);
  });

  it("sorts before ranking, so input order cannot change the answer", () => {
    expect(percentileSeconds({ p: 0.5, samples: [90, 10, 50, 30, 70] })).toBe(50);
  });
});

describe("parseWorkflowRunsPage", () => {
  it("reads a page nested under Octokit's data envelope", () => {
    const parsed = parseWorkflowRunsPage({ payload: { data: { workflow_runs: [RUN_ROW] } } });
    expect(parsed.isOk()).toBe(true);
    const value = unwrap(parsed);
    expect(value.runs.length).toBe(1);
    expect(value.runs[0]!.runNumber).toBe(101);
    expect(value.runs[0]!.headSha).toBe("a1b2c3d4e5f6a7b8");
    expect(value.dropped).toBe(0);
  });

  it("counts a row missing a core field rather than failing the whole page", () => {
    const parsed = parseWorkflowRunsPage({
      payload: { workflow_runs: [RUN_ROW, { id: 2, run_number: 102 }] },
    });
    const value = unwrap(parsed);
    expect(value.runs.length).toBe(1);
    expect(value.dropped).toBe(1);
  });

  it("refuses a payload that is not a runs page at all", () => {
    const parsed = parseWorkflowRunsPage({ payload: { data: { nothing: true } } });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("RUN_HISTORY_UNREADABLE");
    expect(unwrapErr(parsed).message).toContain("workflow runs");
  });
});

describe("parseRunJobsPage", () => {
  it("splits queue time from wall time", () => {
    const parsed = parseRunJobsPage({ payload: { data: { jobs: [JOB_ROW] } }, runId: 1 });
    const timing = unwrap(parsed).timings[0]!;
    expect(timing.name).toBe("lint");
    expect(timing.queueSeconds).toBe(30);
    expect(timing.wallSeconds).toBe(420);
    expect(timing.totalSeconds).toBe(450);
    expect(timing.dependencyBlocked).toBe(false);
  });

  it("marks a needs-blocked job so its queue time is not read as contention", () => {
    const parsed = parseRunJobsPage({
      payload: { jobs: [{ ...JOB_ROW, name: "build" }] },
      runId: 1,
    });
    expect(unwrap(parsed).timings[0]!.dependencyBlocked).toBe(true);
  });

  it("marks the unit merge job, which waits for every shard, as needs-blocked too", () => {
    const parsed = parseRunJobsPage({
      payload: { jobs: [{ ...JOB_ROW, name: "unit" }] },
      runId: 1,
    });
    expect(unwrap(parsed).timings[0]!.dependencyBlocked).toBe(true);
  });

  it("answers undefined durations for a job still running, never zero", () => {
    const parsed = parseRunJobsPage({
      payload: { jobs: [{ ...JOB_ROW, completed_at: null, conclusion: null }] },
      runId: 1,
    });
    const running = unwrap(parsed).timings[0]!;
    expect(running.wallSeconds).toBe(undefined);
    expect(running.totalSeconds).toBe(undefined);
    expect(running.queueSeconds).toBe(30);
  });

  it("counts a job row carrying no name", () => {
    const parsed = parseRunJobsPage({ payload: { jobs: [JOB_ROW, { started_at: "x" }] }, runId: 1 });
    expect(unwrap(parsed).dropped).toBe(1);
  });

  it("names the run in its unreadable error", () => {
    const parsed = parseRunJobsPage({ payload: { jobs: "not-an-array" }, runId: 77 });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("jobs of run 77");
  });
});

function jobTiming({
  name,
  wallSeconds,
  queueSeconds,
}: {
  name: string;
  wallSeconds: number | undefined;
  queueSeconds: number | undefined;
}): JobTiming {
  return {
    conclusion: "success",
    dependencyBlocked: name === "build",
    name,
    queueSeconds,
    runId: 1,
    skipped: false,
    steps: [],
    totalSeconds: undefined,
    wallSeconds,
  };
}

describe("summariseJobDurations", () => {
  it("collapses one job name across runs into percentiles", () => {
    const summaries = summariseJobDurations({
      timings: [
        jobTiming({ name: "lint", queueSeconds: 10, wallSeconds: 300 }),
        jobTiming({ name: "lint", queueSeconds: 20, wallSeconds: 400 }),
        jobTiming({ name: "lint", queueSeconds: 30, wallSeconds: 500 }),
      ],
    });
    expect(summaries.length).toBe(1);
    expect(summaries[0]!.runs).toBe(3);
    expect(summaries[0]!.wallP50Seconds).toBe(400);
    expect(summaries[0]!.wallP95Seconds).toBe(500);
    expect(summaries[0]!.wallMinSeconds).toBe(300);
    expect(summaries[0]!.queueP50Seconds).toBe(20);
    expect(summaries[0]!.queueMaxSeconds).toBe(30);
    expect(summaries[0]!.unreadable).toBe(0);
  });

  it("counts an unmeasured appearance instead of sampling a zero for it", () => {
    const summaries = summariseJobDurations({
      timings: [
        jobTiming({ name: "unit", queueSeconds: 10, wallSeconds: 600 }),
        jobTiming({ name: "unit", queueSeconds: undefined, wallSeconds: undefined }),
      ],
    });
    expect(summaries[0]!.runs).toBe(1);
    expect(summaries[0]!.unreadable).toBe(1);
    expect(summaries[0]!.wallP50Seconds).toBe(600);
  });

  it("ranks slowest-first on p95 wall", () => {
    const summaries = summariseJobDurations({
      timings: [
        jobTiming({ name: "typecheck", queueSeconds: 1, wallSeconds: 100 }),
        jobTiming({ name: "lint", queueSeconds: 1, wallSeconds: 500 }),
        jobTiming({ name: "unit", queueSeconds: 1, wallSeconds: 300 }),
      ],
    });
    expect(summaries.map((s) => s.name)).toEqual(["lint", "unit", "typecheck"]);
  });
});

describe("rankJobsByWall", () => {
  it("sorts an unmeasured job last rather than first", () => {
    const summaries = summariseJobDurations({
      timings: [
        jobTiming({ name: "ghost", queueSeconds: undefined, wallSeconds: undefined }),
        jobTiming({ name: "lint", queueSeconds: 1, wallSeconds: 10 }),
      ],
    });
    expect(rankJobsByWall({ summaries }).map((s) => s.name)).toEqual(["lint", "ghost"]);
  });
});

describe("breachesBar", () => {
  const summaries = summariseJobDurations({
    timings: [jobTiming({ name: "lint", queueSeconds: 1, wallSeconds: 301 })],
  });

  it("flags a job whose p95 wall is over the bar", () => {
    expect(breachesBar({ barMinutes: 5, summary: summaries[0]! })).toBe(true);
  });

  it("does not flag one exactly on the bar", () => {
    const onBar = summariseJobDurations({
      timings: [jobTiming({ name: "lint", queueSeconds: 1, wallSeconds: 300 })],
    });
    expect(breachesBar({ barMinutes: 5, summary: onBar[0]! })).toBe(false);
  });

  it("does not flag an unmeasured job, which is reported as unreadable instead", () => {
    const unmeasured = summariseJobDurations({
      timings: [jobTiming({ name: "ghost", queueSeconds: undefined, wallSeconds: undefined })],
    });
    expect(breachesBar({ barMinutes: 5, summary: unmeasured[0]! })).toBe(false);
  });
});

describe("readRunHistory", () => {
  const address = { owner: "octo-self", repo: "slopweaver" };
  const selection = { branch: "main", event: "push", runs: 2, workflow: "ci.yml" };
  const nowIso = (): string => "2026-09-20T00:00:00.000Z";

  it("times every job across the window", async () => {
    const read = await readRunHistory({
      ...address,
      ...selection,
      fetchJobs: async () => ok({ data: { jobs: [JOB_ROW, { ...JOB_ROW, name: "unit" }] } }),
      fetchRuns: async () => ok({ data: { workflow_runs: [RUN_ROW, { ...RUN_ROW, id: 2, run_number: 102 }] } }),
      nowIso,
    });
    expect(read.isOk()).toBe(true);
    const document = unwrap(read);
    expect(document.runs.length).toBe(2);
    expect(document.jobs.map((j) => j.name).toSorted()).toEqual(["lint", "unit"]);
    expect(document.jobs[0]!.runs).toBe(2);
    expect(document.readAtIso).toBe("2026-09-20T00:00:00.000Z");
    expect(document.residue).toEqual([]);
  });

  it("caps the window at the run count asked for", async () => {
    const read = await readRunHistory({
      ...address,
      ...selection,
      runs: 1,
      fetchJobs: async () => ok({ data: { jobs: [JOB_ROW] } }),
      fetchRuns: async () => ok({ data: { workflow_runs: [RUN_ROW, { ...RUN_ROW, id: 2, run_number: 102 }] } }),
      nowIso,
    });
    expect(unwrap(read).runs.length).toBe(1);
  });

  it("records an unreadable run in the residue and keeps the readable ones", async () => {
    const read = await readRunHistory({
      ...address,
      ...selection,
      fetchJobs: async ({ runId }) =>
        runId === 2
          ? err(GithubRunHistoryErrors.fetchFailed({ message: "403 forbidden" }))
          : ok({ data: { jobs: [JOB_ROW] } }),
      fetchRuns: async () => ok({ data: { workflow_runs: [RUN_ROW, { ...RUN_ROW, id: 2, run_number: 102 }] } }),
      nowIso,
    });
    const document = unwrap(read);
    expect(document.jobs[0]!.runs).toBe(1);
    expect(document.residue.length).toBe(1);
    expect(document.residue[0]!).toContain("403 forbidden");
    expect(document.residue[0]!).toContain("run 102");
  });

  it("refuses a selection that matched no run, naming it", async () => {
    const read = await readRunHistory({
      ...address,
      ...selection,
      branch: "no-such-branch",
      fetchJobs: async () => ok({ data: { jobs: [] } }),
      fetchRuns: async () => ok({ data: { workflow_runs: [] } }),
      nowIso,
    });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("RUN_HISTORY_EMPTY");
    expect(unwrapErr(read).message).toContain("no-such-branch");
  });

  it("refuses when every run's jobs page was unreadable", async () => {
    const read = await readRunHistory({
      ...address,
      ...selection,
      fetchJobs: async () => err(GithubRunHistoryErrors.fetchFailed({ message: "502" })),
      fetchRuns: async () => ok({ data: { workflow_runs: [RUN_ROW] } }),
      nowIso,
    });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("RUN_HISTORY_EMPTY");
  });

  it("forwards a runs-page failure unchanged", async () => {
    const read = await readRunHistory({
      ...address,
      ...selection,
      fetchJobs: async () => ok({ data: { jobs: [] } }),
      fetchRuns: async () => err(GithubRunHistoryErrors.fetchFailed({ message: "404 not found" })),
      nowIso,
    });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("RUN_HISTORY_FETCH_FAILED");
    expect(unwrapErr(read).message).toBe("404 not found");
  });
});

describe("a skipped job", () => {
  const SKIPPED_ROW = {
    completed_at: "2026-09-19T10:00:00Z",
    conclusion: "skipped",
    created_at: "2026-09-19T10:00:01Z",
    name: "integration",
    started_at: "2026-09-19T10:00:01Z",
  };

  it("carries no duration at all, rather than the fraction of a second GitHub reports", () => {
    const parsed = parseRunJobsPage({ payload: { jobs: [SKIPPED_ROW] }, runId: 1 });
    const job = unwrap(parsed).timings[0]!;
    expect(job.skipped).toBe(true);
    expect(job.wallSeconds).toBe(undefined);
    expect(job.queueSeconds).toBe(undefined);
    expect(job.totalSeconds).toBe(undefined);
  });

  it("is counted as skipped and sampled nowhere", () => {
    const parsed = parseRunJobsPage({ payload: { jobs: [SKIPPED_ROW] }, runId: 1 });
    const summaries = summariseJobDurations({ timings: unwrap(parsed).timings });
    expect(summaries[0]!.skipped).toBe(1);
    expect(summaries[0]!.runs).toBe(0);
    expect(summaries[0]!.unreadable).toBe(0);
    expect(summaries[0]!.wallP95Seconds).toBe(undefined);
  });

  it("never breaches the bar, because it is not a measurement to judge", () => {
    const parsed = parseRunJobsPage({ payload: { jobs: [SKIPPED_ROW] }, runId: 1 });
    const summaries = summariseJobDurations({ timings: unwrap(parsed).timings });
    expect(breachesBar({ barMinutes: 5, summary: summaries[0]! })).toBe(false);
  });
});

describe("an out-of-order payload", () => {
  it("answers undefined rather than a negative duration", () => {
    expect(spanSeconds({ fromIso: "2026-09-19T10:00:01Z", toIso: "2026-09-19T10:00:00Z" })).toBe(undefined);
  });

  it("does not let a backwards clock sort to the top of the fastest-first list", () => {
    const parsed = parseRunJobsPage({
      payload: {
        jobs: [
          { ...JOB_ROW, completed_at: "2026-09-19T09:59:59Z", name: "backwards", started_at: "2026-09-19T10:00:30Z" },
        ],
      },
      runId: 1,
    });
    const summaries = summariseJobDurations({ timings: unwrap(parsed).timings });
    expect(summaries[0]!.wallP50Seconds).toBe(undefined);
    expect(summaries[0]!.unreadable).toBe(1);
  });
});
