import { describe, expect, it } from "vitest";

import {
  githubStackDissolveDecisionFor,
  githubStackDissolveDoorRequest,
  githubStackDissolveFreshnessFor,
  parseGithubStackDissolveArgs,
  type StackDissolveDecision,
  stackDissolveDescription,
} from "../../../../../cli/commands/github/stackDissolveCore.js";
import type { GithubStack, GithubStackEntry } from "../../../../../corpus/github/stack.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

function entry({
  number,
  mergedAtIso = undefined,
}: {
  number: number;
  mergedAtIso?: string | undefined;
}): GithubStackEntry {
  return { baseRef: "main", headRef: `branch-${String(number)}`, mergedAtIso, number, state: "open" };
}

function stack({ number = 42, entries }: { number?: number; entries: readonly GithubStackEntry[] }): GithubStack {
  return { entries, id: 900, number, open: true };
}

describe("parseGithubStackDissolveArgs", () => {
  it("requires --repo owner/name and a positive whole --stack", () => {
    expect(unwrap(parseGithubStackDissolveArgs({ argv: ["--repo", "o/r", "--stack", "42"] }))).toEqual({
      dryRun: false,
      home: undefined,
      owner: "o",
      repo: "r",
      stackNumber: 42,
    });
    expect(unwrapErr(parseGithubStackDissolveArgs({ argv: ["--repo", "broken", "--stack", "0"] }))).toEqual([
      '--repo must be owner/name; "broken" is not',
      "--stack must be a positive whole number",
    ]);
    expect(unwrapErr(parseGithubStackDissolveArgs({ argv: [] }))).toEqual([
      "--repo owner/name is required",
      "--stack <n> is required",
    ]);
  });

  it("resolves --dry-run and --home", () => {
    const args = unwrap(
      parseGithubStackDissolveArgs({ argv: ["--repo", "o/r", "--stack", "42", "--dry-run", "--home", "/tmp/h"] }),
    );

    expect(args.dryRun).toBe(true);
    expect(args.home).toBe("/tmp/h");
  });
});

describe("githubStackDissolveDecisionFor", () => {
  it("refuses a stack with no entries", () => {
    const result = githubStackDissolveDecisionFor({ stack: stack({ entries: [] }) });

    expect(result).toEqual({ kind: "refused", reason: expect.stringContaining("nothing to dissolve") });
  });

  it("proceeds even when an entry is already merged — unstack itself leaves it in place", () => {
    const result = githubStackDissolveDecisionFor({
      stack: stack({ entries: [entry({ mergedAtIso: "2026-08-01T00:00:00Z", number: 10 }), entry({ number: 11 })] }),
    });

    expect(result).toEqual({ kind: "proceed", entryNumbers: [10, 11], stackNumber: 42 });
  });
});

describe("stackDissolveDescription", () => {
  it("names every entry, in order", () => {
    const decision: Extract<StackDissolveDecision, { kind: "proceed" }> = {
      entryNumbers: [10, 11],
      kind: "proceed",
      stackNumber: 42,
    };

    expect(stackDissolveDescription({ decision })).toBe("dissolve native stack #42 (#10, #11)");
  });
});

describe("githubStackDissolveFreshnessFor", () => {
  it("is fresh when the same entries are present, regardless of order", () => {
    expect(githubStackDissolveFreshnessFor({ current: [11, 10], previewed: [10, 11] })).toEqual({ fresh: true });
  });

  it("refuses when the stack's own entries changed", () => {
    const result = githubStackDissolveFreshnessFor({ current: [10, 13], previewed: [10, 11] });

    expect(result).toEqual({ fresh: false, reason: expect.stringContaining("changed between planning") });
  });
});

describe("githubStackDissolveDoorRequest", () => {
  it("describes the exact dissolve being admitted", () => {
    const request = githubStackDissolveDoorRequest({
      decision: { entryNumbers: [10, 11], kind: "proceed", stackNumber: 42 },
      home: "/home",
      owner: "o",
      repo: "r",
    });

    expect(request).toEqual({
      action: { kind: "verb", noun: "github", verb: "stack dissolve" },
      artifact: { entryNumbers: [10, 11], repo: "o/r", stackNumber: 42 },
      meta: { createsWorkItem: false, effect: "external-write", home: "/home", requiresApproval: false },
    });
  });
});
