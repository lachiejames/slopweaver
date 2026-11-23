/*
 * A branch the trunk already carries is cold after two hours rather than `--older-than`, unless a caller's narrower
 * `--older-than` or an open pull request says otherwise; an unmerged branch keeps the whole window. The merged
 * verdict carries that window, so the removal re-judges a tree a seat went back into after the scan.
 */
import { describe, expect, it } from "vitest";

import { classifyWorktree } from "../../../../worktree/pruneClassify.js";
import { classify, facts, NOW_MS, NUKE_AFTER_MS } from "./harness.js";

describe("a branch the trunk already carries is cold after two hours", () => {
  const HOUR_MS = 3_600_000;

  it("removes a clean, unreferenced, merged tree touched 3h ago under the default 24h", () => {
    expect(classify({ lastActivityMs: NOW_MS - 3 * HOUR_MS }).cls).toBe("merged");
  });

  it("carries the two-hour window on the merged verdict, so the removal re-judges a tree touched since the scan", () => {
    expect(classify({ lastActivityMs: NOW_MS - 3 * HOUR_MS }).activityFloorMs).toBe(2 * HOUR_MS);
  });

  it("carries a caller's narrower --older-than as that window instead", () => {
    const verdict = classifyWorktree({
      facts: facts({ lastActivityMs: NOW_MS - 45 * 60_000 }),
      nowMs: NOW_MS,
      nukeAfterMs: NUKE_AFTER_MS,
      olderThanMs: 30 * 60_000,
    });
    expect(verdict.activityFloorMs).toBe(30 * 60_000);
  });

  it("holds the same tree touched 1h ago", () => {
    const verdict = classify({ lastActivityMs: NOW_MS - HOUR_MS });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("touched 1h ago");
  });

  it("keeps a caller's narrower --older-than narrower", () => {
    const verdict = classifyWorktree({
      facts: facts({ lastActivityMs: NOW_MS - 45 * 60_000 }),
      nowMs: NOW_MS,
      nukeAfterMs: NUKE_AFTER_MS,
      olderThanMs: 30 * 60_000,
    });
    expect(verdict.cls).toBe("merged");
  });

  it("leaves the 24h window on a branch the trunk does not carry", () => {
    const verdict = classify({ lastActivityMs: NOW_MS - 3 * HOUR_MS, mergedIntoTrunk: false });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("touched 3h ago");
  });

  it("holds a merged tree touched 1h ago whose branch is also on its own remote, rather than disarming the rule", () => {
    const verdict = classify({ branchOnOwnRemote: true, lastActivityMs: NOW_MS - HOUR_MS });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("touched 1h ago");
  });

  it("lets an open pull request hold a merged tree for the whole --older-than", () => {
    const verdict = classify({ lastActivityMs: NOW_MS - 3 * HOUR_MS, openPullRequests: ["open pull request o/r#9"] });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("touched 3h ago, with open pull request o/r#9 on its branch");
  });
});
