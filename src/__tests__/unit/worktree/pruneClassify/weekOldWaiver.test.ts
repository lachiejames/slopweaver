/*
 * The week-old waiver: a dirty, hidden-edit or unpushed-detached tree untouched past `--nuke-after` is salvaged
 * rather than held for good, while a live reference, the main checkout and an unreadable tree or age stay held.
 */
import { describe, expect, it } from "vitest";

import { classify, DAY_MS, NOW_MS, NUKE_AFTER_MS } from "./harness.js";

describe("the week-old waiver", () => {
  const WEEK_OLD = NOW_MS - 10 * DAY_MS;

  it("still HOLDS a dirty tree that is only five days old, so the 24h rule keeps its own subjects", () => {
    const verdict = classify({ dirtyCount: 4, lastActivityMs: NOW_MS - 5 * DAY_MS, mergedIntoTrunk: false });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("4 uncommitted change(s)");
  });

  it("SALVAGES a dirty tree past the week rather than removing it under an ordinary class", () => {
    const verdict = classify({ dirtyCount: 4, lastActivityMs: WEEK_OLD, mergedIntoTrunk: false });
    expect(verdict.cls).toBe("salvaged");
    expect(verdict.reason).toContain("4 uncommitted change(s)");
    expect(verdict.reason).toContain("untouched 10d");
    expect(verdict.deleteBranch).toBe(false);
  });

  it("HOLDS a tree whose only changes are HIDDEN from status, which read as a clean merged tree", () => {
    // The gap a review pass drove all the way to a deletion: `--assume-unchanged` makes an edited file
    // invisible to `status --porcelain`, so `dirtyCount` is 0, no dirt rule fires, the tree classifies
    // `merged` and `removeTree` takes the only copy of those bytes. Every fact here EXCEPT the new one is
    // the strictly-safe worktree this file's helper describes, so the hold can come from nothing else.
    const verdict = classify({ hiddenFromStatus: 1, lastActivityMs: NOW_MS - 5 * DAY_MS });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe(
      "1 file(s) hidden from status by --assume-unchanged or --skip-worktree carry edits status does not report",
    );
  });

  it("SALVAGES that tree past the week rather than holding it forever over an index bit", () => {
    // Safe because the capture CLEARS the bits before measuring and DECLINES if one will not clear, which
    // `runSalvage.test.ts` pins. Without this, a bit nobody remembers setting would keep a tree for good.
    const verdict = classify({ hiddenFromStatus: 2, lastActivityMs: WEEK_OLD });
    expect(verdict.cls).toBe("salvaged");
    expect(verdict.reason).toContain("2 file(s) hidden from status");
    expect(verdict.deleteBranch).toBe(false);
  });

  it("HOLDS UNWAIVABLY when the hidden-file listing could not be read at all, however old the tree is", () => {
    // Not knowing whether a tree is dirty is the same fact as not being able to read it, and the rule is
    // stated entirely in "since touched" — an unreadable tree has not been shown to be a week old either.
    const verdict = classify({ hiddenFromStatus: null, lastActivityMs: WEEK_OLD });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("which files it hides from status could not be read");
  });

  it("SALVAGES a detached HEAD no remote carries once it is past the week", () => {
    const verdict = classify({
      branch: null,
      headOnRemoteRef: null,
      headSha: "a1b2c3d4e5f6",
      lastActivityMs: WEEK_OLD,
      mergedIntoTrunk: null,
    });
    expect(verdict.cls).toBe("salvaged");
    expect(verdict.reason).toContain("a detached HEAD origin does not carry");
  });

  it("KEEPS holding a live session's worktree however old it is, because that hold is not waivable", () => {
    const verdict = classify({ dirtyCount: 2, lastActivityMs: WEEK_OLD, liveRefs: ["session x"] });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("referenced by session x");
  });

  it("KEEPS holding the main checkout however old it is", () => {
    const verdict = classify({ isMainCheckout: true, lastActivityMs: WEEK_OLD });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("the repository's own main checkout");
  });

  it("KEEPS holding a tree whose working tree could not be READ, because an unknown is not a week old", () => {
    const verdict = classify({ dirtyCount: null, lastActivityMs: WEEK_OLD });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("its working tree could not be read");
  });

  it("KEEPS holding a tree with NO activity timestamp, since the waiver is computed from one", () => {
    // The reason is the DIRTY rule rather than the timestamp one, because order is the contract and the
    // dirty rule sits first. What this proves is the waiver: with a timestamp past the week this exact tree
    // is `salvaged`, and with none it is held — the hold is what an unreadable age must produce.
    const verdict = classify({ dirtyCount: 3, lastActivityMs: null, mergedIntoTrunk: false });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("3 uncommitted change(s)");
    expect(classify({ dirtyCount: 3, lastActivityMs: NOW_MS - 10 * DAY_MS, mergedIntoTrunk: false }).cls).toBe(
      "salvaged",
    );
  });

  it("KEEPS holding a CLEAN tree with no activity timestamp, where the timestamp rule is the one that fires", () => {
    const verdict = classify({ lastActivityMs: null, mergedIntoTrunk: false, unbackedCommits: 0 });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("no activity timestamp could be read");
  });

  it("names EVERY waived hold in the reason, so the plan line says what the capture has to carry", () => {
    const verdict = classify({
      branch: null,
      dirtyCount: 2,
      headOnRemoteRef: null,
      headSha: "f00ba4f00ba4",
      lastActivityMs: WEEK_OLD,
      mergedIntoTrunk: null,
    });
    expect(verdict.cls).toBe("salvaged");
    expect(verdict.reason).toContain("2 uncommitted change(s)");
    expect(verdict.reason).toContain("a detached HEAD origin does not carry");
  });

  it("leaves an ordinary cold clean merged tree on its own class, waiving nothing", () => {
    const verdict = classify({ lastActivityMs: WEEK_OLD });
    expect(verdict.cls).toBe("merged");
    expect(verdict.reason).toBe("merged into the trunk, clean, unreferenced and cold");
  });

  it("treats a tree exactly at the waiver as past it, matching how the coldness rule reads its own bound", () => {
    expect(classify({ dirtyCount: 1, lastActivityMs: NOW_MS - NUKE_AFTER_MS, mergedIntoTrunk: false }).cls).toBe(
      "salvaged",
    );
  });
});
