import { describe, expect, it } from "vitest";
import { GithubVerbErrors, githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";

import { restackRunReportLines } from "../../../../../cli/commands/github/restackForestExecute.js";
import { parseGithubStackRestackArgs } from "../../../../../cli/commands/github/restackForestRun.js";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubStackRestackArgs", () => {
  it("defaults the remote to origin and stays off dry-run", () => {
    const parsed = parseGithubStackRestackArgs({ argv: [] });

    expect(parsed.isOk()).toBe(true);
    const args = unwrap(parsed);
    expect(args.remote).toBe("origin");
    expect(args.dryRun).toBe(false);
    expect(args.cwd).toBe(undefined);
    expect(args.home).toBe(undefined);
  });

  it("reads every flag it accepts", () => {
    const parsed = parseGithubStackRestackArgs({
      argv: ["--remote", "upstream", "--cwd", "/repo", "--home", "/home", "--dry-run"],
    });

    const args = unwrap(parsed);
    expect(args.remote).toBe("upstream");
    expect(args.cwd).toBe("/repo");
    expect(args.home).toBe("/home");
    expect(args.dryRun).toBe(true);
  });

  it("refuses a blank remote rather than falling back to origin", () => {
    const parsed = parseGithubStackRestackArgs({ argv: ["--remote", "  "] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed).toEqual(err(GithubVerbErrors.remoteBlank({ got: "  " })));
  });

  it("refuses a flag it does not accept", () => {
    const parsed = parseGithubStackRestackArgs({ argv: ["--push"] });

    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual(["unknown flag: --push"]);
  });
});

describe("restackRunReportLines", () => {
  it("reports each restacked branch with the commit it moved from and to", () => {
    const lines = restackRunReportLines({
      report: {
        adopted: ["two"],
        blocked: [],
        notAdopted: [],
        outcomes: [
          { branch: "one", fromSha: "aaa", kind: "restacked", toSha: "bbb" },
          { branch: "two", fromSha: "ccc", kind: "restacked", toSha: "ddd" },
        ],
      },
    });

    expect(lines).toEqual([
      "restacked one: aaa -> bbb",
      "restacked two: ccc -> ddd",
      "  moved local two onto its restacked commits",
    ]);
  });

  it("names the conflicting branch and says what the conflict stopped", () => {
    const lines = restackRunReportLines({
      report: {
        adopted: [],
        blocked: ["everything above three in this tree is unmoved: its own replay conflicted"],
        notAdopted: [],
        outcomes: [{ branch: "three", kind: "conflict", reason: "conflicting: wf-e2e-tests.yml" }],
      },
    });

    expect(lines).toEqual([
      "conflict: three — conflicting: wf-e2e-tests.yml",
      "blocked: everything above three in this tree is unmoved: its own replay conflicted",
    ]);
  });

  it("says which branch could not be moved locally and why", () => {
    const lines = restackRunReportLines({
      report: {
        adopted: [],
        blocked: [],
        notAdopted: ["one is checked out in /repo/wt — its restacked commits are staged"],
        outcomes: [{ branch: "one", fromSha: "aaa", kind: "restacked", toSha: "bbb" }],
      },
    });

    expect(lines).toEqual([
      "restacked one: aaa -> bbb",
      "  one is checked out in /repo/wt — its restacked commits are staged",
    ]);
  });

  it("prints nothing at all for an empty report", () => {
    expect(restackRunReportLines({ report: { adopted: [], blocked: [], notAdopted: [], outcomes: [] } })).toEqual([]);
  });
});
