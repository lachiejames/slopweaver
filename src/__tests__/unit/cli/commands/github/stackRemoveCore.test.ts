import { describe, expect, it } from "vitest";

import {
  githubStackRemoveDecisionFor,
  githubStackRemoveDoorRequest,
  githubStackRemoveFreshnessFor,
  parseGithubStackRemoveArgs,
  type StackRemoveDecision,
  stackRemoveDescription,
} from "../../../../../cli/commands/github/stackRemoveCore.js";
import type { GithubStack, GithubStackEntry } from "../../../../../corpus/github/stack.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HEAD = {
  label: "o:feature",
  ref: "feature",
  repoFullName: "o/r",
  sha: "1111111111111111111111111111111111111111",
};

function pr({ number = 11, stack }: { number?: number; stack: WrittenPr["stack"] }): WrittenPr {
  return {
    authorId: 1,
    baseRef: "bottom",
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
    state: "open",
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
  };
}

function entry({
  number,
  mergedAtIso = undefined,
}: {
  number: number;
  mergedAtIso?: string | undefined;
}): GithubStackEntry {
  return { baseRef: "main", headRef: `branch-${String(number)}`, mergedAtIso, number, state: "open" };
}

function nativeStack({ number = 5, entries }: { number?: number; entries: readonly GithubStackEntry[] }): GithubStack {
  return { entries, id: 900, number, open: true };
}

describe("parseGithubStackRemoveArgs", () => {
  it("requires --repo owner/name and a positive whole --pr", () => {
    expect(unwrap(parseGithubStackRemoveArgs({ argv: ["--repo", "o/r", "--pr", "11"] }))).toEqual({
      dryRun: false,
      home: undefined,
      owner: "o",
      prNumber: 11,
      repo: "r",
    });
    expect(unwrapErr(parseGithubStackRemoveArgs({ argv: ["--repo", "broken", "--pr", "0"] }))).toEqual([
      '--repo must be owner/name; "broken" is not',
      "--pr must be a positive whole number",
    ]);
    expect(unwrapErr(parseGithubStackRemoveArgs({ argv: [] }))).toEqual([
      "--repo owner/name is required",
      "--pr <n> is required",
    ]);
  });

  it("resolves --dry-run and --home", () => {
    const args = unwrap(
      parseGithubStackRemoveArgs({ argv: ["--repo", "o/r", "--pr", "11", "--dry-run", "--home", "/tmp/h"] }),
    );

    expect(args.dryRun).toBe(true);
    expect(args.home).toBe("/tmp/h");
  });
});

describe("githubStackRemoveDecisionFor", () => {
  it("refuses a pull request that is not a member of any native stack", () => {
    const result = githubStackRemoveDecisionFor({
      pr: pr({ stack: undefined }),
      stack: nativeStack({ entries: [entry({ number: 11 })] }),
    });

    expect(result).toEqual({ kind: "refused", reason: expect.stringContaining("nothing to remove") });
  });

  const stacked: WrittenPr["stack"] = { id: 900, number: 5, position: 1, size: 2 };

  it("refuses a stack with any merged entry", () => {
    const result = githubStackRemoveDecisionFor({
      pr: pr({ stack: stacked }),
      stack: nativeStack({
        entries: [entry({ mergedAtIso: "2026-08-01T00:00:00Z", number: 10 }), entry({ number: 11 })],
      }),
    });

    expect(result).toEqual({ kind: "refused", reason: expect.stringContaining("merged entry (#10)") });
  });

  it("refuses when the pull request is not actually among the stack's own entries", () => {
    const result = githubStackRemoveDecisionFor({
      pr: pr({ number: 99, stack: stacked }),
      stack: nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] }),
    });

    expect(result).toEqual({ kind: "refused", reason: expect.stringContaining("was not found among") });
  });

  it("proceeds, naming the remaining entries in their original order", () => {
    const result = githubStackRemoveDecisionFor({
      pr: pr({ number: 11, stack: stacked }),
      stack: nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 }), entry({ number: 12 })] }),
    });

    expect(result).toEqual({ kind: "proceed", remainingNumbers: [10, 12], removedNumber: 11, stackNumber: 5 });
  });

  it("proceeds with an empty remainder when the target is the stack's only entry", () => {
    const result = githubStackRemoveDecisionFor({
      pr: pr({ number: 11, stack: stacked }),
      stack: nativeStack({ entries: [entry({ number: 11 })] }),
    });

    expect(result).toEqual({ kind: "proceed", remainingNumbers: [], removedNumber: 11, stackNumber: 5 });
  });
});

describe("stackRemoveDescription", () => {
  const proceed = ({
    remainingNumbers,
  }: {
    remainingNumbers: readonly number[];
  }): Extract<StackRemoveDecision, { kind: "proceed" }> => ({
    kind: "proceed",
    remainingNumbers,
    removedNumber: 11,
    stackNumber: 5,
  });

  it("says the stack dissolves entirely with no remaining entries", () => {
    expect(stackRemoveDescription({ decision: proceed({ remainingNumbers: [] }) })).toBe(
      "remove #11 from native stack #5 — the stack has no other entries, so it dissolves entirely",
    );
  });

  it("says the stack dissolves entirely with one remaining entry, too few to re-stack", () => {
    expect(stackRemoveDescription({ decision: proceed({ remainingNumbers: [12] }) })).toBe(
      "remove #11 from native stack #5 — dissolve the stack entirely, since only #12 would remain, too few to re-stack",
    );
  });

  it("names every remaining entry when two or more survive", () => {
    expect(stackRemoveDescription({ decision: proceed({ remainingNumbers: [10, 12] }) })).toBe(
      "remove #11 from native stack #5 — dissolve it and re-form the remaining 2 entries (#10, #12) as a new stack, in the same order",
    );
  });
});

describe("githubStackRemoveFreshnessFor", () => {
  it("is fresh when the same pull requests are present, regardless of order", () => {
    expect(githubStackRemoveFreshnessFor({ current: [12, 10, 11], previewed: [10, 11, 12] })).toEqual({ fresh: true });
  });

  it("refuses when the stack's own entries changed", () => {
    const result = githubStackRemoveFreshnessFor({ current: [10, 11, 13], previewed: [10, 11, 12] });

    expect(result).toEqual({ fresh: false, reason: expect.stringContaining("changed between planning") });
  });
});

describe("githubStackRemoveDoorRequest", () => {
  it("describes the exact removal being admitted", () => {
    const request = githubStackRemoveDoorRequest({
      decision: { kind: "proceed", remainingNumbers: [10, 12], removedNumber: 11, stackNumber: 5 },
      home: "/home",
      owner: "o",
      repo: "r",
    });

    expect(request).toEqual({
      action: { kind: "verb", noun: "github", verb: "stack remove" },
      artifact: { remainingNumbers: [10, 12], removedNumber: 11, repo: "o/r", stackNumber: 5 },
      meta: { createsWorkItem: false, effect: "external-write", home: "/home", requiresApproval: false },
    });
  });
});
