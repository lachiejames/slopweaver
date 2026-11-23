/**
 * The reclaim roots and the finished-scratch test. A finished pass's scratch goes whole.
 */
import { describe, expect, it } from "vitest";

import { isFinishedScratch } from "../../../home/reclaim/finishedScratch.js";
import { declaredRootNames, findRoot, RECLAIM_ROOTS } from "../../../home/reclaim/roots.js";

describe("isFinishedScratch", () => {
  it("enters a scratch only when its pass wrote an artifact", () => {
    const finished = new Set(["aaa"]);
    expect(isFinishedScratch({ entryName: "aaa.scratch", finishedPassIds: finished })).toBe(true);
    expect(isFinishedScratch({ entryName: "bbb.scratch", finishedPassIds: finished })).toBe(false);
  });

  it("is false for anything that is not a scratch directory at all", () => {
    const finished = new Set(["aaa"]);
    expect(isFinishedScratch({ entryName: "aaa", finishedPassIds: finished })).toBe(false);
    expect(isFinishedScratch({ entryName: ".scratch", finishedPassIds: finished })).toBe(false);
  });
});

describe("the declared roots", () => {
  it("carries exactly the one root the verb may enter, taking the one surviving class", () => {
    expect(RECLAIM_ROOTS.length).toBeGreaterThan(0);
    expect(declaredRootNames()).toEqual(["codex-scratch"]);
    expect(RECLAIM_ROOTS.map((root) => root.takes)).toEqual(["finished-scratch"]);
    expect(RECLAIM_ROOTS.map((root) => root.homeSegment)).toEqual(["orchestration"]);
  });

  // A past finding, as a guard: supervisor-scratch was once a declared root and a run there
  // deleted live chair state a script opens by NAME. Re-declaring it reddens here.
  it("does not declare supervisor-scratch, and takes no content-identity class anywhere", () => {
    expect(RECLAIM_ROOTS.map((root) => root.homeSegment)).not.toContain("supervisor-scratch");
    expect(declaredRootNames()).not.toContain("supervisor-scratch");
    expect(RECLAIM_ROOTS.map((root) => root.takes)).not.toContain("duplicate-copy");
  });

  it("gives every root a reason a reader can act on, and never an absolute or climbing segment", () => {
    expect(RECLAIM_ROOTS.length).toBeGreaterThan(0);
    RECLAIM_ROOTS.forEach((root) => {
      expect(root.because.length).toBeGreaterThan(40);
      expect(root.homeSegment).not.toContain("/");
      expect(root.homeSegment).not.toContain("..");
    });
  });

  it("finds a declared root by name and answers undefined for anything else", () => {
    expect(findRoot({ name: "codex-scratch" })!.homeSegment).toBe("orchestration");
    expect(findRoot({ name: "exec-store" })).toBeUndefined();
    expect(findRoot({ name: "supervisor-scratch" })).toBeUndefined();
  });
});
