/*
 * The process-tree walks — pure, over one snapshot: up the parent chain to an ancestor, across it to the process
 * a registration's session id names, and down a tree to every pid in it. It was split out when the
 * process-snapshot suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import {
  findAncestor,
  findBySessionId,
  flattenProcessTreePids,
  type ProcessRow,
} from "../../../../../live/standing/processes.js";
import { SNAPSHOT } from "./harness.js";

describe("findAncestor", () => {
  it("walks up from the listener to its claude session", () => {
    const found = findAncestor({
      matches: (argv) => argv.includes("--plugin-dir"),
      pid: 61202,
      processes: SNAPSHOT,
    });

    expect(found?.pid).toBe(42246);
  });

  it("returns the process itself when it already matches", () => {
    const found = findAncestor({ matches: (argv) => argv.includes("--plugin-dir"), pid: 42246, processes: SNAPSHOT });

    expect(found?.pid).toBe(42246);
  });

  it("returns undefined when the chain reaches the top without a match", () => {
    expect(
      findAncestor({ matches: (argv) => argv.includes("nothing"), pid: 61202, processes: SNAPSHOT }),
    ).toBeUndefined();
  });

  it("returns undefined for a pid not in the snapshot", () => {
    expect(findAncestor({ matches: () => true, pid: 999_999, processes: SNAPSHOT })).toBeUndefined();
  });

  it("ends rather than spinning on a process that is its own parent", () => {
    const cycle: readonly ProcessRow[] = [{ argv: "/loop", pid: 7, ppid: 7 }];

    expect(findAncestor({ matches: (argv) => argv.includes("nope"), pid: 7, processes: cycle })).toBeUndefined();
  });
});

describe("findBySessionId", () => {
  it("joins on the exact --session-id the registration recorded", () => {
    expect(findBySessionId({ processes: SNAPSHOT, sessionId: "60aa20c0-d689" })?.pid).toBe(42246);
  });

  it("returns undefined when no live process claims that session", () => {
    expect(findBySessionId({ processes: SNAPSHOT, sessionId: "not-running" })).toBeUndefined();
  });
});

describe("flattenProcessTreePids", () => {
  it("flattens a whole tree depth-first, roots included", () => {
    expect(
      flattenProcessTreePids({
        roots: [
          {
            children: [{ children: [{ children: [], name: "node", pid: 61202 }], name: "node", pid: 61048 }],
            name: "claude",
            pid: 42246,
          },
          { children: [], name: "esbuild", pid: 61260 },
        ],
      }),
    ).toEqual([42246, 61048, 61202, 61260]);
  });

  it("returns nothing for an empty tree", () => {
    expect(flattenProcessTreePids({ roots: [] })).toEqual([]);
  });
});
