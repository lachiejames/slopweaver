import { describe, expect, it } from "vitest";

import { type LandingDetailDeps, reportLandingDetail } from "../../../../../cli/commands/github/landingDetail.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";
import type { JobLogDocument } from "../../../../../live/github/jobLogRead.js";
import { landingRowFake } from "../../../../landingRowFake.js";

/** One run's log document holding one job, naming the given failing test files. */
function runLog({ runId, jobId, paths }: { runId: number; jobId: number; paths: readonly string[] }): JobLogDocument {
  return {
    jobs: [
      {
        conclusion: "failure",
        failedStep: { conclusion: "failure", name: "Unit", number: 6 },
        htmlUrl: undefined,
        jobId,
        log: {
          annotations: [],
          annotationsDropped: 0,
          closed: true,
          linesTruncated: 0,
          regionLines: 40,
          tail: [],
          testFilePaths: paths,
          testFilePathsDropped: 0,
        },
        name: "unit",
      },
    ],
    readAtIso: "2026-10-04T08:00:00.000Z",
    repo: "acme/widgets",
    residue: [],
    run: { conclusion: "failure", headBranch: "b", headSha: "abc", htmlUrl: undefined, id: runId, name: "CI" },
    tailLines: 0,
  };
}

/** A failing `unit` check whose details URL names this repository's run and job. */
function unitCheck({ runId, jobId }: { runId: number; jobId: number }) {
  return {
    kind: "check-run",
    name: "unit",
    required: true,
    runId: String(runId),
    state: "failed",
    url: `https://github.com/acme/widgets/actions/runs/${String(runId)}/job/${String(jobId)}`,
  } as const;
}

/** Deps answering each run's log from a map, and a complete file list that ADDED `src/new.test.ts`. */
function deps({ logs, out }: { logs: ReadonlyMap<number, JobLogDocument>; out: string[] }): LandingDetailDeps {
  return {
    pullRequestFiles: () => Promise.resolve(ok({ complete: true, statuses: new Map([["src/new.test.ts", "added"]]) })),
    readJobLogs: ({ runId }) => Promise.resolve(ok(logs.get(runId)!)),
    writeDiagnostic: (line) => out.push(`diag: ${line}`),
    writeOut: (line) => out.push(line),
  };
}

describe("reportLandingDetail", () => {
  it("keeps two same-named failing checks' log evidence apart, each under its own run", async () => {
    const out: string[] = [];
    const row = landingRowFake({
      failingChecks: [unitCheck({ jobId: 22, runId: 11 }), unitCheck({ jobId: 33, runId: 12 })],
    });
    const logs = new Map([
      [11, runLog({ jobId: 22, paths: ["src/new.test.ts"], runId: 11 })],
      [12, runLog({ jobId: 33, paths: [], runId: 12 })],
    ]);

    const code = await reportLandingDetail({
      deps: deps({ logs, out }),
      home: undefined,
      number: row.number,
      rows: [row],
      slug: "acme/widgets",
    });

    expect(code).toBe(EXIT_OK);
    const start = out.indexOf("checks not passing:");
    expect(out.slice(start, start + 5)).toEqual([
      "checks not passing:",
      "  REQUIRED unit (failed) https://github.com/acme/widgets/actions/runs/11/job/22",
      "    failing test file src/new.test.ts — ADDED in this pull request",
      "  REQUIRED unit (failed) https://github.com/acme/widgets/actions/runs/12/job/33",
      "    its log names no failing test file",
    ]);
  });

  it("reads no log for a URL naming its run only in a query string or another repository, nor for a check GitHub does not tie to that run", async () => {
    const out: string[] = [];
    const smuggled = "https://github.com/acme/widgets/actions/runs/not-a-run?redirect=/actions/runs/11/job/22";
    const elsewhere = "https://github.com/other/widgets/actions/runs/11/job/22";
    const actionsJob = "https://github.com/acme/widgets/actions/runs/11/job/22";
    const row = landingRowFake({
      failingChecks: [
        { kind: "check-run", name: "external", required: false, state: "failed", url: smuggled },
        { kind: "check-run", name: "forked", required: false, state: "failed", url: elsewhere },
        { kind: "status", name: "legacy", required: false, state: "failed", url: actionsJob },
        { kind: "check-run", name: "other-app", required: false, state: "failed", url: actionsJob },
        { kind: "check-run", name: "other-run", required: false, runId: "12", state: "failed", url: actionsJob },
        { kind: "check-run", name: "unfinished", required: true, runId: "11", state: "running", url: actionsJob },
      ],
    });
    const logs = new Map([[11, runLog({ jobId: 22, paths: [], runId: 11 })]]);

    await reportLandingDetail({
      deps: deps({ logs, out }),
      home: undefined,
      number: row.number,
      rows: [row],
      slug: "acme/widgets",
    });

    const why =
      "    log not read: its details URL is not one of this repository's Actions jobs, so GitHub serves no log for it";
    const untied =
      "    log not read: GitHub does not tie this check to the Actions run its details URL names, so that run's log is not its own";
    const start = out.indexOf("checks not passing:");
    expect(out.slice(start, start + 13)).toEqual([
      "checks not passing:",
      `  advisory external (failed) ${smuggled}`,
      why,
      `  advisory forked (failed) ${elsewhere}`,
      why,
      `  advisory legacy (failed) ${actionsJob}`,
      "    log not read: it is a commit status another CI posted, not a Check Run, so it has no Actions log",
      `  advisory other-app (failed) ${actionsJob}`,
      untied,
      `  advisory other-run (failed) ${actionsJob}`,
      untied,
      `  REQUIRED unfinished (running) ${actionsJob}`,
      "    log not read: it is still running, so its log holds no verdict yet",
    ]);
  });

  it("says a number the selection does not hold is not found, as a status rather than a fault", async () => {
    const out: string[] = [];
    const code = await reportLandingDetail({
      deps: deps({ logs: new Map(), out }),
      home: undefined,
      number: 9,
      rows: [landingRowFake()],
      slug: "acme/widgets",
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out).toEqual([
      "diag: landing: acme/widgets#9 is not an open pull request this selection matches (a draft, a closed one, or " +
        "another author's under --author)",
    ]);
  });
});
