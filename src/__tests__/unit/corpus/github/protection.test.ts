import { describe, expect, it } from "vitest";

import {
  mergeGroupSuiteIds,
  namesInMergeGroupSuites,
  queueRefSuiteIds,
  recentEntryHeads,
} from "../../../../corpus/github/protection.js";

const RUNS = [
  { check_suite_id: 10, head_sha: "aaa" },
  { check_suite_id: 11, head_sha: "aaa" },
  { check_suite_id: 12, head_sha: "bbb" },
  { check_suite_id: 13, head_sha: "ccc" },
] as const;

describe("recentEntryHeads", () => {
  it("caps on DISTINCT heads, not on the run count — several workflows fire on one queue entry", () => {
    expect(recentEntryHeads({ entries: 2, runs: RUNS })).toEqual(["aaa", "bbb"]);
  });

  it("keeps GitHub's own newest-first order and never repeats a head", () => {
    expect(recentEntryHeads({ entries: 10, runs: RUNS })).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("measures nothing when asked for no entries", () => {
    expect(recentEntryHeads({ entries: 0, runs: RUNS })).toEqual([]);
  });

  it("answers empty on a repository whose queue has never run", () => {
    expect(recentEntryHeads({ entries: 5, runs: [] })).toEqual([]);
  });
});

describe("mergeGroupSuiteIds", () => {
  it("collects every suite of every run on the covered heads", () => {
    expect([...mergeGroupSuiteIds({ heads: ["aaa", "bbb"], runs: RUNS })]).toEqual([10, 11, 12]);
  });

  it("excludes a head the window does not cover", () => {
    expect([...mergeGroupSuiteIds({ heads: ["ccc"], runs: RUNS })]).toEqual([13]);
  });

  it("skips a run GitHub reports with no suite id", () => {
    expect([...mergeGroupSuiteIds({ heads: ["aaa"], runs: [{ check_suite_id: null, head_sha: "aaa" }] })]).toEqual([]);
  });
});

describe("namesInMergeGroupSuites", () => {
  const CHECK_RUNS = [
    { check_suite: { id: 10 }, name: "build" },
    { check_suite: { id: 12 }, name: "integration" },
    { check_suite: { id: 99 }, name: "CodeQL" },
    { check_suite: null, name: "orphan" },
  ] as const;

  it("keeps only the names whose suite ran on a merge-group entry", () => {
    const suites = new Set([10, 12]);

    expect(namesInMergeGroupSuites({ checkRuns: CHECK_RUNS, suites })).toEqual(["build", "integration"]);
  });

  it("drops a context reported on the same commit by a suite the queue never fired", () => {
    const suites = new Set([10]);

    expect(namesInMergeGroupSuites({ checkRuns: CHECK_RUNS, suites })).toEqual(["build"]);
  });

  it("observes nothing when no merge-group suite is in hand", () => {
    expect(namesInMergeGroupSuites({ checkRuns: CHECK_RUNS, suites: new Set() })).toEqual([]);
  });
});

describe("queueRefSuiteIds", () => {
  const SUITES = [
    { head_branch: "gh-readonly-queue/main/pr-1044-abc", id: 20 },
    { head_branch: "main", id: 21 },
    { head_branch: null, id: 22 },
    { head_branch: "gh-readonly-queue/release/pr-9-def", id: 23 },
  ] as const;

  it("counts a suite cut on a queue entry branch, whatever produced it — an App owns no workflow run", () => {
    expect([...queueRefSuiteIds({ suites: SUITES })]).toEqual([20, 23]);
  });

  it("excludes the push suite that lands on the same sha once the entry merges", () => {
    expect([...queueRefSuiteIds({ suites: [{ head_branch: "main", id: 21 }] })]).toEqual([]);
  });

  it("excludes a suite GitHub reports with no head branch rather than guessing", () => {
    expect([...queueRefSuiteIds({ suites: [{ head_branch: null, id: 22 }] })]).toEqual([]);
  });

  it("is empty on a ref with no suites at all", () => {
    expect([...queueRefSuiteIds({ suites: [] })]).toEqual([]);
  });
});
