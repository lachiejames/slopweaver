/*
 * `openPullRequestHold`: a warm or unstamped tree with an open pull request on its branch is held, naming every
 * one, and a tree with none open, or one exactly at `--older-than`, is not.
 */
import { describe, expect, it } from "vitest";

import { openPullRequestHold } from "../../../../worktree/pruneColdness.js";
import { NOW_MS, OLDER_THAN_MS } from "./harness.js";

describe("openPullRequestHold", () => {
  const hold = (over: { openPullRequests?: readonly string[]; lastActivityMs?: number | null }) =>
    openPullRequestHold({
      lastActivityMs: NOW_MS - 3_600_000,
      nowMs: NOW_MS,
      olderThanMs: OLDER_THAN_MS,
      openPullRequests: ["open pull request o/r#9", "open pull request o/r#10"],
      ...over,
    });

  it("holds a warm tree, naming every pull request on its branch", () => {
    expect(hold({})).toBe("touched 1h ago, with open pull request o/r#9, open pull request o/r#10 on its branch");
  });

  it("holds nothing when no pull request is open", () => {
    expect(hold({ openPullRequests: [] })).toBe(undefined);
  });

  it("holds a tree whose stamp could not be read, since nothing shows it cold", () => {
    expect(hold({ lastActivityMs: null })).toBe(
      "no activity timestamp could be read, with open pull request o/r#9, open pull request o/r#10 on its branch",
    );
  });

  it("treats a tree exactly at --older-than as cold", () => {
    expect(hold({ lastActivityMs: NOW_MS - OLDER_THAN_MS })).toBe(undefined);
  });
});
