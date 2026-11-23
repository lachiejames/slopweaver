/**
 * `stack adopt`'s gate on measuring at all: a pull request GitHub already reports as one commit reaches no
 * Git, and a measurement that could not be taken reports why on the adopt's own output.
 */
import { describe, expect, it } from "vitest";

import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import { effectiveCommitsFor } from "../../../../../cli/commands/github/stackAdoptEffectiveCommits.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { err } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const HEAD_SHA = "a".repeat(40);

function pr(overrides: Partial<WrittenPr> = {}): WrittenPr {
  return {
    authorId: 1,
    baseRef: "parent-branch",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: HEAD_SHA },
    htmlUrl: "https://example.invalid/pr/100",
    mergedAtIso: undefined,
    nodeId: "PR_100",
    number: 100,
    stack: undefined,
    state: "open",
    title: "t",
    updatedAtIso: "2026-09-12T00:00:00Z",
    ...overrides,
  };
}

/** Git edges whose every fetch is refused, recording each write so a test can say none happened. */
function refusingGit(): { git: GithubPushDeps; writes: string[][] } {
  const writes: string[][] = [];
  const git: GithubPushDeps = {
    cwd: () => "/unused",
    doorLedger: memoryDoorLedger().port,
    out: () => undefined,
    readGit: ({ args }) => {
      throw new Error(`unexpected Git read: ${args.join(" ")}`);
    },
    writeGit: ({ args }) => {
      writes.push([...args]);
      return err("network unreachable");
    },
  };
  return { git, writes };
}

describe("effectiveCommitsFor", () => {
  it("measures nothing, and touches no ref, when GitHub already reports exactly one commit", () => {
    const { git, writes } = refusingGit();
    const lines: string[] = [];
    const measured = effectiveCommitsFor({
      deps: { git, out: ({ line }) => lines.push(line) },
      pr: pr({ commits: 1 }),
      remote: "origin",
      repoRoot: "/repo",
    });
    expect(measured).toBe(undefined);
    expect(writes).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("reports a measurement it could not take on the adopt's own output", () => {
    const { git } = refusingGit();
    const lines: string[] = [];
    const measured = effectiveCommitsFor({
      deps: { git, out: ({ line }) => lines.push(line) },
      pr: pr({ commits: 2 }),
      remote: "origin",
      repoRoot: "/repo",
    });
    const residue = "could not fetch origin/parent-branch: network unreachable";
    expect(measured).toEqual({ count: 0, measured: false, residue, tipSurvives: false });
    expect(lines).toEqual([`could not measure what a rebase would leave: ${residue}`]);
  });
});
