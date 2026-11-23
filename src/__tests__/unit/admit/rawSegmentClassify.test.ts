/*
 * The git and cmux segment classifiers the raw-command gate judges one segment's tokens through, called
 * directly: which git shapes are destructive, which category a blocked one routes to, and how a raw cmux
 * call is labelled.
 */
import { describe, expect, it } from "vitest";

import { classifyCmuxSegment, gitCategory, isDestructiveGit } from "../../../admit/rawSegmentClassify.js";

describe("isDestructiveGit", () => {
  it("flags a push behind a global, a hard reset, a forced clean, a branch delete and filter-branch", () => {
    expect([
      isDestructiveGit({ tokens: ["git", "-C", "/repo", "push"] }),
      isDestructiveGit({ tokens: ["git", "reset", "--hard"] }),
      isDestructiveGit({ tokens: ["git", "clean", "-fd"] }),
      isDestructiveGit({ tokens: ["git", "branch", "-D", "old"] }),
      isDestructiveGit({ tokens: ["git", "filter-branch"] }),
    ]).toEqual([true, true, true, true, true]);
  });

  it("passes a soft reset, a dry-run clean, a status and a bare git", () => {
    expect([
      isDestructiveGit({ tokens: ["git", "reset", "HEAD~1"] }),
      isDestructiveGit({ tokens: ["git", "clean", "-n"] }),
      isDestructiveGit({ tokens: ["git", "status"] }),
      isDestructiveGit({ tokens: ["git"] }),
    ]).toEqual([false, false, false, false]);
  });
});

describe("gitCategory", () => {
  it("routes a push to its governed verb and every other destructive shape to the local category", () => {
    expect([
      gitCategory({ tokens: ["git", "-C", "/repo", "push"] }),
      gitCategory({ tokens: ["git", "reset", "--hard"] }),
    ]).toEqual(["git-push", "local-destructive-git"]);
  });
});

describe("classifyCmuxSegment", () => {
  it("leaves a bare cmux alone", () => {
    expect(classifyCmuxSegment({ tokens: ["cmux"] })).toBe(undefined);
  });

  it("labels a covered, two retired and an ungoverned subcommand", () => {
    expect([
      classifyCmuxSegment({ tokens: ["cmux", "workspace", "close"] }),
      classifyCmuxSegment({ tokens: ["cmux", "workspace", "status"] }),
      classifyCmuxSegment({ tokens: ["cmux", "todo", "add"] }),
      classifyCmuxSegment({ tokens: ["cmux", "new-workspace"] }),
    ]).toEqual([
      { category: "cmux-governed", reason: "raw cmux workspace drives the fleet outside the door", tool: "cmux" },
      { category: "cmux-retired", reason: "raw cmux workspace drives the fleet outside the door", tool: "cmux" },
      { category: "cmux-retired", reason: "raw cmux todo drives the fleet outside the door", tool: "cmux" },
      { category: "cmux-ungoverned", reason: "raw cmux new-workspace drives the fleet outside the door", tool: "cmux" },
    ]);
  });
});
