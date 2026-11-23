/**
 * The shared process-tree walk every machine reaper kills in: the order is the contract, deepest first and the
 * root last, so each case asserts the complete ordered list rather than its membership. Beside it, the tree's
 * summed `%CPU`, where "no sample taken" and "sample taken, this pid absent" are different answers.
 */
import { describe, expect, it } from "vitest";

import { treeCpu, treeDeepestFirst } from "../../../../live/machine/processTree.js";

describe("treeCpu", () => {
  const cpuRows = [
    { cpuPct: 10.04, pid: 1 },
    { cpuPct: 2.03, pid: 2 },
  ];
  const cpuByPid = new Map(cpuRows.map((row) => [row.pid, row.cpuPct]));

  it("sums the tree's pids and rounds to one decimal", () => {
    expect(treeCpu({ cpuByPid, cpuRows, treePids: [2, 1] })).toBe(12.1);
  });

  it("counts a pid the sample did not carry as zero", () => {
    expect(treeCpu({ cpuByPid, cpuRows, treePids: [3, 1] })).toBe(10);
  });

  it("answers undefined, never 0, when no sample was taken", () => {
    expect(treeCpu({ cpuByPid: new Map<number, number>(), cpuRows: [], treePids: [1, 2] })).toBe(undefined);
  });
});

describe("treeDeepestFirst", () => {
  it("lists a branching tree breadth-first and then reverses it, so the deepest pids go first", () => {
    const childrenByPpid = new Map<number, number[]>([
      [10, [11, 12]],
      [11, [13]],
      [12, [14, 15]],
    ]);

    expect(treeDeepestFirst({ childrenByPpid, root: 10 })).toEqual([15, 14, 13, 12, 11, 10]);
  });

  it("returns only the root when the snapshot carries no children for it", () => {
    expect(treeDeepestFirst({ childrenByPpid: new Map<number, number[]>(), root: 42 })).toEqual([42]);
  });

  it("visits a child listed under two parents once", () => {
    const childrenByPpid = new Map<number, number[]>([
      [1, [2, 3]],
      [2, [4]],
      [3, [4]],
    ]);

    expect(treeDeepestFirst({ childrenByPpid, root: 1 })).toEqual([4, 3, 2, 1]);
  });

  it("terminates on a cycle a racing snapshot could carry, never re-queuing the root", () => {
    const childrenByPpid = new Map<number, number[]>([
      [7, [8]],
      [8, [7, 9]],
    ]);

    expect(treeDeepestFirst({ childrenByPpid, root: 7 })).toEqual([9, 8, 7]);
  });

  it("ignores everything outside the subtree it was asked for", () => {
    const childrenByPpid = new Map<number, number[]>([
      [1, [2, 5]],
      [2, [3]],
      [5, [6]],
    ]);

    expect(treeDeepestFirst({ childrenByPpid, root: 2 })).toEqual([3, 2]);
  });
});
