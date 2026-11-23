import { describe, expect, it } from "vitest";

import {
  parseGithubPrRetargetArgs,
  retargetDecisionFor,
  retargetDoorRequest,
  retargetFreshnessFor,
} from "../../../../../cli/commands/github/retargetCore.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HEAD = {
  label: "o:feature",
  ref: "feature",
  repoFullName: "o/r",
  sha: "1111111111111111111111111111111111111111",
};

function pr({
  authorId = 1,
  number = 7,
  state = "open",
  baseRef = "main",
  stack = undefined,
}: {
  authorId?: number;
  number?: number;
  state?: string;
  baseRef?: string;
  stack?: WrittenPr["stack"];
} = {}): WrittenPr {
  return {
    authorId,
    baseRef,
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: HEAD,
    htmlUrl: `https://example.invalid/pr/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack,
    state,
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
  };
}

describe("parseGithubPrRetargetArgs", () => {
  it("requires one exact repository, number, and a non-blank base", () => {
    expect(unwrap(parseGithubPrRetargetArgs({ rest: ["--repo", "o/r", "--number", "7", "--base", "main"] }))).toEqual({
      adopt: false,
      base: "main",
      dryRun: false,
      home: undefined,
      json: false,
      number: 7,
      owner: "o",
      repo: "r",
    });
    expect(
      unwrapErr(parseGithubPrRetargetArgs({ rest: ["--repo", "broken", "--number", "0", "--base", "  "] })),
    ).toEqual([
      "--repo owner/name is required",
      "--number must be a positive whole number",
      "--base <ref> is required",
    ]);
  });

  it("resolves --dry-run, --json and --adopt", () => {
    const args = unwrap(
      parseGithubPrRetargetArgs({
        rest: ["--repo", "o/r", "--number", "7", "--base", "main", "--dry-run", "--json", "--adopt"],
      }),
    );

    expect(args.adopt).toBe(true);
    expect(args.dryRun).toBe(true);
    expect(args.json).toBe(true);
  });
});

describe("retargetDecisionFor", () => {
  it("proceeds when the requested base differs from both the live base and the head", () => {
    expect(retargetDecisionFor({ pr: pr({}), requestedBase: "release" })).toEqual({ kind: "proceed" });
  });

  it("refuses a requested base equal to the pull request's own head branch", () => {
    const result = retargetDecisionFor({ pr: pr({}), requestedBase: "feature" });

    expect(result).toEqual({ kind: "refused", reason: expect.stringContaining("own head branch") });
  });

  it("reports a no-op when the requested base already matches the live base", () => {
    const result = retargetDecisionFor({ pr: pr({ baseRef: "main" }), requestedBase: "main" });

    expect(result).toEqual({ kind: "noop", reason: "#7 already targets main" });
  });

  it("refuses a pull request that is already a member of a native GitHub stack", () => {
    const result = retargetDecisionFor({
      pr: pr({ stack: { id: 900, number: 42, position: 2, size: 3 } }),
      requestedBase: "release",
    });

    expect(result).toEqual({
      kind: "refused",
      reason: expect.stringContaining("native stack #42"),
    });
  });
});

describe("retargetDoorRequest", () => {
  it("addresses the exact pull request and the requested base as the door artifact", () => {
    expect(
      retargetDoorRequest({
        args: {
          adopt: false,
          base: "release",
          dryRun: false,
          home: undefined,
          json: false,
          number: 7,
          owner: "o",
          repo: "r",
        },
        home: "/tmp/home",
      }),
    ).toEqual({
      action: { kind: "verb", noun: "github", verb: "pr retarget" },
      artifact: { base: "release", id: "o/r#7" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
    });
  });
});

describe("retargetFreshnessFor", () => {
  it("is fresh when the number, author, state, base and head commit have not moved", () => {
    expect(retargetFreshnessFor({ current: pr({}), previewed: pr({}) })).toEqual({ fresh: true });
  });

  it("refuses when another actor already retargeted the base", () => {
    const result = retargetFreshnessFor({
      current: pr({ baseRef: "other" }),
      previewed: pr({ baseRef: "main" }),
    });

    expect(result).toEqual({ fresh: false, reason: expect.stringContaining("the base branch") });
  });

  it("refuses when the pull request closed between the read and the write", () => {
    const result = retargetFreshnessFor({ current: pr({ state: "closed" }), previewed: pr({ state: "open" }) });

    expect(result).toEqual({ fresh: false, reason: expect.stringContaining("open/closed state") });
  });
});
