/**
 * The pure path rules `workstream.ts` derives a workstream's tree and log from.
 */
import { describe, expect, it } from "vitest";

import { canonicalWorktreePath, fleetWorktreePath, turnLogPath } from "../../../measurement/workstream.js";

describe("fleetWorktreePath", () => {
  it("puts the worktree in a SIBLING directory, never inside the repository", () => {
    expect(fleetWorktreePath({ repo: "/a/repo", slug: "a-doc" })).toBe("/a/repo-fleet/a-doc");
  });

  it("tolerates a trailing slash on the repository path", () => {
    expect(fleetWorktreePath({ repo: "/a/repo/", slug: "a-doc" })).toBe("/a/repo-fleet/a-doc");
  });
});

describe("canonicalWorktreePath", () => {
  it("puts the worktree under .claude/worktrees.noindex INSIDE the repository", () => {
    expect(canonicalWorktreePath({ repo: "/a/repo", slug: "a-doc" })).toBe("/a/repo/.claude/worktrees.noindex/a-doc");
  });
});

describe("turnLogPath", () => {
  it("names one log file per workstream, beside the run journal", () => {
    expect(turnLogPath({ runsDir: "/tmp/runs", slug: "a-doc" })).toBe("/tmp/runs/a-doc.turns.log");
  });
});
