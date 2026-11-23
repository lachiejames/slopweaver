import { describe, expect, it } from "vitest";
import { GITHUB_CI_RUNS_FLAG_NAMES, parseGithubCiRunsArgs } from "../../../../../cli/commands/github/ciRunsCore.js";
import { githubCiRunsUsage } from "../../../../../cli/commands/github/ciUsage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubCiRunsArgs", () => {
  it("defaults to the window the owner's own question was asked over", () => {
    const args = unwrap(parseGithubCiRunsArgs({ rest: [] }));
    expect(args.runs).toBe(20);
    expect(args.branch).toBe("main");
    expect(args.event).toBe("push");
    expect(args.workflow).toBe("ci.yml");
    expect(args.json).toBe(false);
    expect(args.repo).toBe(undefined);
    expect(args.home).toBe(undefined);
  });

  it("reads every flag it declares", () => {
    const args = unwrap(
      parseGithubCiRunsArgs({
        rest: [
          "--repo",
          "lachiejames/slopweaver",
          "--branch",
          "release",
          "--event",
          "merge_group",
          "--runs",
          "5",
          "--workflow",
          "pr-body-gate.yml",
          "--json",
          "--home",
          "/tmp/home",
        ],
      }),
    );
    expect(args.repo).toBe("lachiejames/slopweaver");
    expect(args.branch).toBe("release");
    expect(args.event).toBe("merge_group");
    expect(args.runs).toBe(5);
    expect(args.workflow).toBe("pr-body-gate.yml");
    expect(args.json).toBe(true);
    expect(args.home).toBe("/tmp/home");
  });

  it("refuses a run count outside the bound rather than clamping it", () => {
    for (const typed of ["0", "101", "ten"]) {
      const issues = unwrapErr(parseGithubCiRunsArgs({ rest: ["--runs", typed] }));
      expect(issues.map((issue) => issue.code)).toEqual(["RUN_WINDOW_OUT_OF_RANGE"]);
      expect(issues[0]!.message).toBe("--runs must be an integer from 1 to 100");
    }
  });

  it("refuses an event GitHub's own trigger list does not carry", () => {
    const issues = unwrapErr(parseGithubCiRunsArgs({ rest: ["--event", "schedule"] }));
    expect(issues.map((issue) => issue.code)).toEqual(["UNKNOWN_EVENT"]);
    expect(issues[0]!.message).toBe("--event must be one of push, pull_request, merge_group");
  });

  it("reports every usage problem in one pass", () => {
    const issues = unwrapErr(parseGithubCiRunsArgs({ rest: ["--runs", "0", "--event", "schedule"] }));
    expect(issues.map((issue) => issue.code)).toEqual(["RUN_WINDOW_OUT_OF_RANGE", "UNKNOWN_EVENT"]);
  });

  it("names the flag that was given with no value, rather than only saying one was", () => {
    const issues = unwrapErr(parseGithubCiRunsArgs({ rest: ["--branch", "  "] }));
    expect(issues.map((issue) => issue.code)).toEqual(["BLANK_FLAG_VALUE"]);
    expect(issues[0]!.message).toBe("--branch was given with no value");
  });

  it("forwards a shared flag-parser problem rather than re-wording it", () => {
    const issues = unwrapErr(parseGithubCiRunsArgs({ rest: ["--nonsense"] }));
    expect(issues.map((issue) => issue.code)).toEqual(["FLAG_PARSE"]);
    expect(issues[0]!.message).toContain("nonsense");
  });
});

describe("githubCiRunsUsage", () => {
  it("names every flag the parser accepts", () => {
    const usage = githubCiRunsUsage();
    for (const flag of GITHUB_CI_RUNS_FLAG_NAMES) {
      expect(usage).toContain(flag);
    }
  });

  it("says why the event matters, so an absent job is not read as a fast one", () => {
    expect(githubCiRunsUsage()).toContain("an absent job is not");
  });
});
