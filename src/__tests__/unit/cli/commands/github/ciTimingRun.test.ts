/*
 * `github ci-timing`'s shell over plain-function seams: what each failure exits with, and that every report
 * exits 0 however slow a job in it was.
 */
import { describe, expect, it } from "vitest";

import type { GithubCiTimingDeps } from "../../../../../cli/commands/github/ciTimingEdges.js";
import { CI_TIMING_JOB_NAME, runGithubCiTiming } from "../../../../../cli/commands/github/ciTimingRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { type CiTimingError, CiTimingErrors } from "../../../../../live/github/ciTimingErrors.js";
import type { JobTiming } from "../../../../../live/github/runHistoryParse.js";

/** One job timing off a run. */
const timing = (over: Partial<JobTiming> = {}): JobTiming => ({
  conclusion: "success",
  dependencyBlocked: false,
  name: "unit",
  queueSeconds: 2,
  runId: 99,
  skipped: false,
  steps: [],
  totalSeconds: 3602,
  wallSeconds: 3600,
  ...over,
});

/**
 * Plain-function seams closing over arrays — not a mock, which `testing.md` bans — and what they captured.
 *
 * @returns the deps and the out, diagnostic and read records they write into
 */
function harness({ jobs, repoProblem }: { jobs: Result<readonly JobTiming[], CiTimingError>; repoProblem?: string }): {
  deps: GithubCiTimingDeps;
  out: string[];
  diagnostics: string[];
  reads: number[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const reads: number[] = [];
  const deps: GithubCiTimingDeps = {
    readJobs: async ({ runId }) => {
      reads.push(runId);
      return jobs;
    },
    resolveRepo: () => (repoProblem === undefined ? ok({ owner: "acme", repo: "widgets" }) : err([repoProblem])),
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, out, reads };
}

describe("runGithubCiTiming", () => {
  it("prints the report and exits 0 even when a job took an hour", async () => {
    const run = harness({ jobs: ok([timing(), timing({ name: CI_TIMING_JOB_NAME, wallSeconds: undefined })]) });

    const code = await runGithubCiTiming({ deps: run.deps, rest: ["--run-id", "5"] });

    expect(code).toBe(EXIT_OK);
    expect(run.reads).toEqual([5]);
    expect(run.out).toEqual(["ci-timing · run 5 · wall time per job\n\nunit  60:00 (3600s)"]);
    expect(run.diagnostics).toEqual([]);
  });

  it("exits with the usage code and prints the usage on a missing run id, before reading anything", async () => {
    const run = harness({ jobs: ok([]) });

    const code = await runGithubCiTiming({ deps: run.deps, rest: [] });

    expect(code).toBe(EXIT_USAGE);
    expect(run.reads).toEqual([]);
    expect(run.diagnostics[0]).toBe("--run-id is required; inside a workflow pass ${{ github.run_id }}");
    expect(run.diagnostics[1]).toContain("usage: slopweaver github ci-timing --run-id <n>");
  });

  it("exits with the error code when the repository will not resolve", async () => {
    const run = harness({ jobs: ok([]), repoProblem: "no origin remote" });

    const code = await runGithubCiTiming({ deps: run.deps, rest: ["--run-id", "5"] });

    expect(code).toBe(EXIT_ERROR);
    expect(run.reads).toEqual([]);
    expect(run.diagnostics).toEqual(["no origin remote"]);
  });

  it("exits with the error code and prints no report when the run cannot be read whole", async () => {
    const run = harness({
      jobs: err(CiTimingErrors.runReadFailed({ message: "run 5's jobs could not be read whole" })),
    });

    const code = await runGithubCiTiming({ deps: run.deps, rest: ["--run-id", "5"] });

    expect(code).toBe(EXIT_ERROR);
    expect(run.out).toEqual([]);
    expect(run.diagnostics).toEqual(["run 5's jobs could not be read whole"]);
  });
});
