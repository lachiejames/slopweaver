/*
 * `github ci-timing`'s pure half: the parse, the rows a run's jobs become, the refusal of a read that could
 * not name every job, and the table. No bar, band or verdict word may appear in what it prints.
 */
import { describe, expect, it } from "vitest";

import {
  ciTimingRows,
  jobTimingsOfRun,
  parseGithubCiTimingArgs,
  renderCiTimingText,
} from "../../../../../cli/commands/github/ciTimingCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { JobTiming } from "../../../../../live/github/runHistoryParse.js";

/** One job timing off a run, with only the fields the report reads set to anything interesting. */
const timing = (over: Partial<JobTiming> = {}): JobTiming => ({
  conclusion: "success",
  dependencyBlocked: false,
  name: "unit",
  queueSeconds: 2,
  runId: 99,
  skipped: false,
  steps: [],
  totalSeconds: 302,
  wallSeconds: 300,
  ...over,
});

/** One raw GitHub job row, finished, with the instants the parser times. */
const jobRow = ({ name }: { name: unknown }): Record<string, unknown> => ({
  completed_at: "2026-11-01T00:06:30Z",
  conclusion: "success",
  created_at: "2026-11-01T00:00:00Z",
  name,
  run_attempt: 1,
  started_at: "2026-11-01T00:00:00Z",
  steps: [],
});

describe("parseGithubCiTimingArgs", () => {
  it("reads the run id, repo and home", () => {
    expect(
      unwrap(parseGithubCiTimingArgs({ rest: ["--run-id", "42", "--repo", "acme/widgets", "--home", "/tmp/h"] })),
    ).toEqual({ home: "/tmp/h", repo: "acme/widgets", runId: 42 });
  });

  it("refuses a missing run id rather than guessing the latest", () => {
    expect(unwrapErr(parseGithubCiTimingArgs({ rest: [] })).map((issue) => issue.code)).toEqual(["RUN_ID_MISSING"]);
  });

  it("refuses a run id that is not a positive integer", () => {
    expect(unwrapErr(parseGithubCiTimingArgs({ rest: ["--run-id", "0"] })).map((issue) => issue.code)).toEqual([
      "RUN_ID_NOT_NUMERIC",
    ]);
  });

  it("refuses a flag it does not take", () => {
    expect(
      unwrapErr(parseGithubCiTimingArgs({ rest: ["--run-id", "1", "--update"] })).map((issue) => issue.code),
    ).toEqual(["FLAG_PARSE"]);
  });
});

describe("jobTimingsOfRun", () => {
  it("times every named job of the folded run", () => {
    const timings = unwrap(jobTimingsOfRun({ payload: { jobs: [jobRow({ name: "unit" })] }, runId: 7 }));
    expect(timings.map((t) => [t.name, t.wallSeconds])).toEqual([["unit", 390]]);
  });

  it("refuses a run with a job row it cannot name, rather than reporting the rest as the whole run", () => {
    const error = unwrapErr(
      jobTimingsOfRun({ payload: { jobs: [jobRow({ name: "unit" }), jobRow({ name: 3 })] }, runId: 7 }),
    );
    expect(error.code).toBe("CI_TIMING_RUN_READ_FAILED");
    expect(error.message).toBe(
      "run 7 returned 1 job row(s) with no readable name — refusing rather than printing a report that silently leaves a job out",
    );
  });

  it("refuses a payload that is not a jobs document", () => {
    expect(unwrapErr(jobTimingsOfRun({ payload: { nope: true }, runId: 7 })).code).toBe("CI_TIMING_RUN_READ_FAILED");
  });
});

describe("ciTimingRows", () => {
  it("puts the slowest job first, breaks ties by name, and lists the unmeasured after, by name", () => {
    const rows = ciTimingRows({
      ownJobName: "ci-timing",
      timings: [
        timing({ name: "lint", wallSeconds: 120.4 }),
        timing({ name: "unit", wallSeconds: 390 }),
        timing({ name: "build", wallSeconds: 120 }),
        timing({ conclusion: "skipped", name: "integration", skipped: true, wallSeconds: undefined }),
        timing({ conclusion: undefined, name: "compile", wallSeconds: undefined }),
      ],
    });
    expect(rows).toEqual([
      { kind: "measured", name: "unit", wallSeconds: 390 },
      { kind: "measured", name: "build", wallSeconds: 120 },
      { kind: "measured", name: "lint", wallSeconds: 120 },
      { kind: "not-measured", name: "compile", reason: "no instants" },
      { kind: "not-measured", name: "integration", reason: "skipped" },
    ]);
  });

  it("leaves its own still-running job out by name", () => {
    const rows = ciTimingRows({
      ownJobName: "ci-timing",
      timings: [timing({ name: "ci-timing", wallSeconds: undefined }), timing({ name: "unit" })],
    });
    expect(rows.map((row) => row.name)).toEqual(["unit"]);
  });

  it("is empty for a run of only its own job", () => {
    expect(ciTimingRows({ ownJobName: "ci-timing", timings: [timing({ name: "ci-timing" })] })).toEqual([]);
  });
});

describe("renderCiTimingText", () => {
  it("prints one aligned line per job with minutes and seconds, and no verdict", () => {
    const text = renderCiTimingText({
      rows: [
        { kind: "measured", name: "unit", wallSeconds: 390 },
        { kind: "measured", name: "lint", wallSeconds: 59 },
        { kind: "not-measured", name: "integration", reason: "skipped" },
      ],
      runId: 12,
    });
    expect(text).toBe(
      [
        "ci-timing · run 12 · wall time per job",
        "",
        "unit          6:30 (390s)",
        "lint          0:59 (59s)",
        "integration  not measured (skipped)",
      ].join("\n"),
    );
  });

  it("says so when the run held no other job", () => {
    expect(renderCiTimingText({ rows: [], runId: 12 })).toBe(
      "ci-timing · run 12 · wall time per job\n\nno other job in this run",
    );
  });
});
