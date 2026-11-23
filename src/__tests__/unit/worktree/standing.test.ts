/**
 * {@link classifyStanding} and {@link renderStanding} — the verdict `slopweaver worktree here` prints, and
 * the one a spawned child gates its first write on. Pure: every git fact is passed in.
 */
import { describe, expect, it } from "vitest";

import {
  classifyStanding,
  renderStanding,
  type StandingFacts,
  type StandingReport,
} from "../../../worktree/standing.js";

/** The facts of a session standing in its own linked worktree, overridable field by field. */
function facts(over: Partial<StandingFacts> = {}): StandingFacts {
  return {
    branch: "my-feature",
    cwd: "/repo/.claude/worktrees/my-feature",
    declared: true,
    isMainWorktree: false,
    mainCheckoutRoot: "/repo",
    ...over,
  };
}

/** The report for one set of facts. */
function report(over: Partial<StandingFacts> = {}): StandingReport {
  return classifyStanding({ facts: facts(over) });
}

describe("classifyStanding", () => {
  it("calls a linked worktree writable", () => {
    expect(report()).toEqual({ facts: facts(), standing: "linked-worktree", writable: true });
  });

  it("calls a main checkout unwritable", () => {
    expect(report({ cwd: "/repo", isMainWorktree: true }).writable).toBe(false);
  });

  it("names a main checkout as such", () => {
    expect(report({ cwd: "/repo", isMainWorktree: true }).standing).toBe("main-checkout");
  });

  it("calls a directory outside any repository unwritable", () => {
    expect(report({ cwd: "/tmp/x", isMainWorktree: false, mainCheckoutRoot: undefined }).writable).toBe(false);
  });

  it("names a directory outside any repository as such", () => {
    expect(report({ mainCheckoutRoot: undefined }).standing).toBe("outside-repository");
  });

  it("prefers outside-repository over a stale isMainWorktree, since no repository resolved", () => {
    expect(report({ isMainWorktree: true, mainCheckoutRoot: undefined }).standing).toBe("outside-repository");
  });

  it("keeps a linked worktree writable when its repository is undeclared", () => {
    expect(report({ declared: false }).writable).toBe(true);
  });

  it("keeps a main checkout unwritable when its repository is undeclared", () => {
    expect(report({ cwd: "/repo", declared: false, isMainWorktree: true }).writable).toBe(false);
  });

  it("carries the facts through unchanged, so --json reports what was read", () => {
    expect(report({ branch: undefined }).facts.branch).toBeUndefined();
  });
});

describe("renderStanding", () => {
  it("leads a worktree with the directory it is standing in", () => {
    expect(renderStanding({ report: report() })[0]).toBe(
      "own worktree: /repo/.claude/worktrees/my-feature [my-feature]",
    );
  });

  it("names the main checkout a worktree must not write to", () => {
    expect(renderStanding({ report: report() })[1]).toBe("  main checkout: /repo (declared) — do not write there");
  });

  it("omits the declared marker for an undeclared repository", () => {
    expect(renderStanding({ report: report({ declared: false }) })[1]).toBe(
      "  main checkout: /repo — do not write there",
    );
  });

  it("renders a detached HEAD as such rather than as an empty branch", () => {
    expect(renderStanding({ report: report({ branch: undefined }) })[0]).toBe(
      "own worktree: /repo/.claude/worktrees/my-feature [(detached)]",
    );
  });

  it("shouts the verdict first in a main checkout", () => {
    expect(renderStanding({ report: report({ cwd: "/repo", isMainWorktree: true }) })[0]).toBe(
      "MAIN CHECKOUT: /repo [my-feature] (declared)",
    );
  });

  it("names the typed way to ask when a child is blocked in a main checkout", () => {
    expect(renderStanding({ report: report({ cwd: "/repo", isMainWorktree: true }) }).at(-1)).toContain(
      "slopweaver handover ask",
    );
  });

  it("names the way to get a worktree of its own", () => {
    expect(renderStanding({ report: report({ cwd: "/repo", isMainWorktree: true }) })[2]).toContain(
      "slopweaver cmux spawn",
    );
  });

  it("names the typed way to ask from outside a repository too", () => {
    expect(renderStanding({ report: report({ mainCheckoutRoot: undefined }) }).at(-1)).toContain(
      "slopweaver handover ask",
    );
  });

  it("says plainly that a worktree is the session's own to write in", () => {
    expect(renderStanding({ report: report() })[2]).toBe("  this worktree is yours: write, commit and push here");
  });
});
