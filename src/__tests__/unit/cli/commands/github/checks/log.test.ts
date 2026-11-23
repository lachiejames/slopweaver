/** `--log`: each failed check's own Actions job read, grouped by run, and the reads it declines to make. */
import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";
import { runChecksLog } from "../../../../../../cli/commands/github/checksLogRun.js";
import { runGithubChecks } from "../../../../../../cli/commands/github/checksRun.js";
import type { GithubChecksDeps, PollTarget } from "../../../../../../cli/commands/github/checksSeams.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../../../../cli/exitCodes.js";
import { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import { GithubJobLogErrors } from "../../../../../../live/github/jobLogErrors.js";
import type { JobLogDocument } from "../../../../../../live/github/jobLogRead.js";
import { depsFor, FAILED_CHECK, PASSED_CHECK, snapshot } from "./harness.js";

describe("runGithubChecks --log", () => {
  const ACTIONS_JOB = "https://github.com/acme/widget/actions/runs/700/job/9001";

  /** One job-log document, shaped by the read the shell asked for. */
  function document({ jobIds, runId }: { jobIds: readonly number[]; runId: number }): JobLogDocument {
    return {
      jobs: jobIds.map((jobId) => ({
        conclusion: "failure",
        failedStep: { conclusion: "failure", name: "Lint", number: 8 },
        htmlUrl: undefined,
        jobId,
        log: {
          annotations: [],
          annotationsDropped: 0,
          closed: true,
          linesTruncated: 0,
          regionLines: 1,
          tail: ["dev lint: FAIL"],
          testFilePaths: [],
          testFilePathsDropped: 0,
        },
        name: `job-${String(jobId)}`,
      })),
      readAtIso: "2026-09-20T10:00:00.000Z",
      repo: "acme/widget",
      residue: [],
      run: {
        conclusion: "failure",
        headBranch: "a-branch",
        headSha: "abc123",
        htmlUrl: undefined,
        id: runId,
        name: "CI",
      },
      tailLines: 40,
    };
  }

  it("reads each failed check's own job, grouped by run, and prints the report", async () => {
    const out: string[] = [];
    const logReads: { runId: number; jobIds: readonly number[]; lines: number }[] = [];

    const code = await runGithubChecks({
      deps: depsFor({
        diagnostic: [],
        fetches: [snapshot({ checks: [{ ...FAILED_CHECK, url: ACTIONS_JOB }] })],
        logReads,
        out,
        readJobLogs: (args) => Promise.resolve(ok(document({ jobIds: args.jobIds, runId: args.runId }))),
      }),
      rest: ["--number", "9", "--log", "--lines", "12"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(logReads).toEqual([{ jobIds: [9001], lines: 12, runId: 700 }]);
    expect(out[0]).toContain("run 700 · acme/widget");
    expect(out[0]).toContain("dev lint: FAIL");
  });

  it("says the head is green and reads no log at all when nothing failed", async () => {
    const out: string[] = [];
    const logReads: { runId: number; jobIds: readonly number[]; lines: number }[] = [];

    const code = await runGithubChecks({
      deps: depsFor({
        diagnostic: [],
        fetches: [{ ...snapshot({ checks: [PASSED_CHECK] }), rollupState: "SUCCESS" }],
        logReads,
        out,
      }),
      rest: ["--number", "9", "--log"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(logReads).toEqual([]);
    expect(out).toEqual([
      "no failed check on abc123 — GitHub's rollup reads SUCCESS over 1 check(s), so there is no job log to read",
    ]);
  });

  it("names a failed check carrying no Actions job URL rather than silently skipping it", async () => {
    const diagnostic: string[] = [];

    const code = await runGithubChecks({
      deps: depsFor({ diagnostic, fetches: [snapshot({ checks: [FAILED_CHECK] })], out: [] }),
      rest: ["--number", "9", "--log"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(diagnostic).toEqual(["test failed but carries no Actions job URL — its log is not GitHub's to serve"]);
  });

  it("reports a log read that failed with the read's own message", async () => {
    const diagnostic: string[] = [];

    const code = await runGithubChecks({
      deps: depsFor({
        diagnostic,
        fetches: [snapshot({ checks: [{ ...FAILED_CHECK, url: ACTIONS_JOB }] })],
        out: [],
        readJobLogs: () => Promise.resolve(err(GithubJobLogErrors.logUnavailable({ jobId: 9001 }))),
      }),
      rest: ["--number", "9", "--log"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostic[0]).toContain("Actions logs expire");
  });
});

describe("runChecksLog, called directly", () => {
  const TARGET: PollTarget = {
    deadlineMs: 0,
    home: undefined,
    limit: 100,
    number: 9,
    owner: "acme",
    repo: "widget",
    timeoutSeconds: 1200,
  };

  it("reports the checks read's own failure and reads no log at all", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const logReads: { runId: number; jobIds: readonly number[]; lines: number }[] = [];
    const deps: GithubChecksDeps = {
      ...depsFor({ diagnostic, fetches: [snapshot({ checks: [PASSED_CHECK] })], logReads, out }),
      fetchChecks: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "github graphql failed" }))),
    };

    const code = await runChecksLog({ deps, lines: 40, target: TARGET });

    expect(code).toBe(EXIT_ERROR);
    expect(logReads).toEqual([]);
    expect(diagnostic).toEqual(["github graphql failed"]);
    expect(out).toEqual([]);
  });
});
