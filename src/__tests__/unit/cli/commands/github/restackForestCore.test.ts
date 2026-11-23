import { describe, expect, it } from "vitest";

import {
  planRestackForest,
  type RestackPullRequest,
  replayBaseSha,
  restackForestReportLines,
  restackSteps,
} from "../../../../../cli/commands/github/restackForestCore.js";

describe("replayBaseSha", () => {
  const moved = new Map([["parent-branch", "moved-tip"]]);

  it("replays onto the tip this run moved the base to", () => {
    expect(replayBaseSha({ baseBranch: "parent-branch", moved, preRunBaseTip: "pre-run-tip" })).toBe("moved-tip");
  });

  it("replays onto the pre-run tip when this run did not move the base", () => {
    expect(replayBaseSha({ baseBranch: "main", moved, preRunBaseTip: "pre-run-tip" })).toBe("pre-run-tip");
  });
});

/** One open pull request, defaulted to a fresh trunk-based one so each test states only what it varies. */
const pr = (over: Partial<RestackPullRequest> & { number: number; headRef: string }): RestackPullRequest => ({
  baseIsAncestorOfHead: true,
  baseRef: "main",
  headSha: `sha-${String(over.number)}`,
  ...over,
});

describe("planRestackForest", () => {
  it("makes a trunk-based pull request a root of its own tree", () => {
    const forest = planRestackForest({ pullRequests: [pr({ headRef: "feature", number: 1 })] });

    expect(forest.trees.length).toBe(1);
    expect(forest.trees[0]!.rootBranch).toBe("feature");
    expect(forest.trees[0]!.nodes.length).toBe(1);
    expect(forest.trees[0]!.nodes[0]!.depth).toBe(0);
    expect(forest.residue).toEqual([]);
  });

  it("makes a pull request based on a branch nobody heads a root too, so a release base still restacks", () => {
    const forest = planRestackForest({
      pullRequests: [pr({ baseIsAncestorOfHead: false, baseRef: "release-9", headRef: "hotfix", number: 7 })],
    });

    expect(forest.trees.length).toBe(1);
    expect(forest.trees[0]!.rootBranch).toBe("hotfix");
    expect(forest.trees[0]!.nodes[0]!.baseBranch).toBe("release-9");
    expect(forest.trees[0]!.nodes[0]!.reason).toBe("base-moved");
  });

  it("chains three pull requests bottom-up and propagates from the one whose base moved", () => {
    const forest = planRestackForest({
      pullRequests: [
        pr({ baseRef: "two", headRef: "three", number: 3 }),
        pr({ baseIsAncestorOfHead: false, headRef: "one", number: 1 }),
        pr({ baseRef: "one", headRef: "two", number: 2 }),
      ],
    });

    expect(forest.trees.length).toBe(1);
    const branches = forest.trees[0]!.nodes.map((node) => node.branch);
    expect(branches).toEqual(["one", "two", "three"]);
    const reasons = forest.trees[0]!.nodes.map((node) => node.reason);
    expect(reasons).toEqual(["base-moved", "propagated", "propagated"]);
    const depths = forest.trees[0]!.nodes.map((node) => node.depth);
    expect(depths).toEqual([0, 1, 2]);
  });

  it("moves nothing when every base is still an ancestor of its own head", () => {
    const forest = planRestackForest({
      pullRequests: [pr({ headRef: "one", number: 1 }), pr({ baseRef: "one", headRef: "two", number: 2 })],
    });

    expect(restackSteps({ forest })).toEqual([]);
    expect(forest.trees[0]!.nodes.map((node) => node.reason)).toEqual([undefined, undefined]);
  });

  it("propagates into every child when one branch carries two of them", () => {
    const forest = planRestackForest({
      pullRequests: [
        pr({ baseIsAncestorOfHead: false, headRef: "base", number: 10 }),
        pr({ baseRef: "base", headRef: "left", number: 12 }),
        pr({ baseRef: "base", headRef: "right", number: 11 }),
      ],
    });

    const branches = forest.trees[0]!.nodes.map((node) => node.branch);
    expect(branches).toEqual(["base", "right", "left"]);
    expect(forest.trees[0]!.nodes.map((node) => node.reason)).toEqual(["base-moved", "propagated", "propagated"]);
  });

  it("emits a whole branch of the tree before the next, so every base is written by the step before it", () => {
    const forest = planRestackForest({
      pullRequests: [
        pr({ baseIsAncestorOfHead: false, headRef: "root", number: 1 }),
        pr({ baseRef: "root", headRef: "a", number: 2 }),
        pr({ baseRef: "a", headRef: "a-child", number: 4 }),
        pr({ baseRef: "root", headRef: "b", number: 3 }),
      ],
    });

    expect(forest.trees[0]!.nodes.map((node) => node.branch)).toEqual(["root", "a", "a-child", "b"]);
    expect(forest.trees[0]!.nodes.map((node) => node.depth)).toEqual([0, 1, 2, 1]);
  });

  it("orders separate trees by their root's pull-request number", () => {
    const forest = planRestackForest({
      pullRequests: [pr({ headRef: "later", number: 20 }), pr({ headRef: "earlier", number: 4 })],
    });

    expect(forest.trees.map((tree) => tree.rootBranch)).toEqual(["earlier", "later"]);
  });

  it("refuses a base cycle as residue and plants no tree for it", () => {
    const forest = planRestackForest({
      pullRequests: [pr({ baseRef: "b", headRef: "a", number: 1 }), pr({ baseRef: "a", headRef: "b", number: 2 })],
    });

    expect(forest.trees).toEqual([]);
    expect(forest.residue.length).toBe(2);
    expect(forest.residue[0]).toContain("refusing to restack a cycle");
  });

  it("keeps a healthy tree when a separate cycle is present", () => {
    const forest = planRestackForest({
      pullRequests: [
        pr({ baseRef: "y", headRef: "x", number: 1 }),
        pr({ baseRef: "x", headRef: "y", number: 2 }),
        pr({ headRef: "clean", number: 3 }),
      ],
    });

    expect(forest.trees.map((tree) => tree.rootBranch)).toEqual(["clean"]);
    expect(forest.residue.length).toBe(2);
  });

  it("names both pull requests when two claim the same head branch, and places neither", () => {
    const forest = planRestackForest({
      pullRequests: [pr({ headRef: "shared", number: 5 }), pr({ headRef: "shared", number: 6 })],
    });

    expect(forest.trees).toEqual([]);
    expect(forest.residue).toEqual(["#5, #6 all have head shared — cannot tell which one a child of it would follow"]);
  });

  it("treats a child of an ambiguous head as a root rather than dropping it", () => {
    const forest = planRestackForest({
      pullRequests: [
        pr({ headRef: "shared", number: 5 }),
        pr({ headRef: "shared", number: 6 }),
        pr({ baseIsAncestorOfHead: false, baseRef: "shared", headRef: "above", number: 7 }),
      ],
    });

    expect(forest.trees.map((tree) => tree.rootBranch)).toEqual(["above"]);
    expect(forest.trees[0]!.nodes[0]!.reason).toBe("base-moved");
  });

  it("plans nothing at all from no pull requests", () => {
    const forest = planRestackForest({ pullRequests: [] });

    expect(forest.trees).toEqual([]);
    expect(forest.residue).toEqual([]);
  });
});

describe("restackSteps", () => {
  it("returns only the moving nodes, parents before children, across every tree", () => {
    const forest = planRestackForest({
      pullRequests: [
        pr({ headRef: "still", number: 1 }),
        pr({ baseIsAncestorOfHead: false, headRef: "moving", number: 2 }),
        pr({ baseRef: "moving", headRef: "above", number: 3 }),
      ],
    });

    expect(restackSteps({ forest }).map((node) => node.branch)).toEqual(["moving", "above"]);
  });
});

describe("restackForestReportLines", () => {
  it("says plainly that nothing needs restacking when no node moves", () => {
    const forest = planRestackForest({ pullRequests: [pr({ headRef: "settled", number: 1 })] });

    expect(restackForestReportLines({ forest })).toEqual([
      "nothing to restack: every open pull request of yours is already on its latest base.",
    ]);
  });

  it("counts the moving nodes against the tree's size and names each one", () => {
    const forest = planRestackForest({
      pullRequests: [
        pr({ baseIsAncestorOfHead: false, headRef: "one", number: 1 }),
        pr({ baseRef: "one", headRef: "two", number: 2 }),
      ],
    });

    expect(restackForestReportLines({ forest })).toEqual([
      "tree rooted at one: 2 of 2 moving",
      "  would restack one (PR #1) onto main — base-moved",
      "  would restack two (PR #2) onto one — propagated",
    ]);
  });

  it("prints residue after the plan", () => {
    const forest = planRestackForest({
      pullRequests: [pr({ headRef: "shared", number: 5 }), pr({ headRef: "shared", number: 6 })],
    });

    expect(restackForestReportLines({ forest })).toEqual([
      "nothing to restack: every open pull request of yours is already on its latest base.",
      "residue: #5, #6 all have head shared — cannot tell which one a child of it would follow",
    ]);
  });
});
