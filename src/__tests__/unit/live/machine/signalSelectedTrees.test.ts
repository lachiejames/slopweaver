/** The one signal loop both reaps share: plan order, deepest first, a fresh-table re-check before every signal. */
import { describe, expect, it } from "vitest";

import { signalSelectedTrees } from "../../../../live/machine/signalSelectedTrees.js";
import type { ProcessRow } from "../../../../live/standing/processes.js";

/** The reason a pid the plan selected is not signalled once its argv moved or it is gone. */
const MOVED = "it is no longer the process the plan selected — gone, or the pid was reused";

/** A shell at 100 with a child at 101, listed deepest first, and a lone daemon at 200. */
const SHELL = { argvByPid: { "100": "zsh -c snapshot", "101": "sleep 60" }, treePids: [101, 100] };
const DAEMON = { argvByPid: { "200": "node nx-daemon" }, treePids: [200] };

/** A table holding exactly the processes the plan saw. */
const UNCHANGED: readonly ProcessRow[] = [
  { argv: "zsh -c snapshot", pid: 100, ppid: 1 },
  { argv: "sleep 60", pid: 101, ppid: 100 },
  { argv: "node nx-daemon", pid: 200, ppid: 1 },
];

/** Run the loop over a table, recording every pid actually signalled, with `refuse` naming pids whose kill fails. */
function run({ processes, refuse }: { processes: readonly ProcessRow[]; refuse: ReadonlyMap<number, string> }): {
  signalled: number[];
  outcome: ReturnType<typeof signalSelectedTrees>;
} {
  const signalled: number[] = [];
  const outcome = signalSelectedTrees({
    kill: ({ pid }) => {
      signalled.push(pid);
      return refuse.get(pid);
    },
    processes,
    targets: [SHELL, DAEMON],
  });
  return { outcome, signalled };
}

describe("signalSelectedTrees", () => {
  it("signals every target's pids in plan order, deepest first within each", () => {
    expect(run({ processes: UNCHANGED, refuse: new Map() })).toEqual({
      outcome: { failed: [], killed: [101, 100, 200] },
      signalled: [101, 100, 200],
    });
  });

  it("never signals a pid that has disappeared from the fresh table", () => {
    const processes = UNCHANGED.filter((row) => row.pid !== 101);
    expect(run({ processes, refuse: new Map() })).toEqual({
      outcome: { failed: [{ pid: 101, why: MOVED }], killed: [100, 200] },
      signalled: [100, 200],
    });
  });

  it("never signals a pid the kernel reused for a different process", () => {
    const processes = UNCHANGED.map((row) => (row.pid === 200 ? { ...row, argv: "vim notes.md" } : row));
    expect(run({ processes, refuse: new Map() })).toEqual({
      outcome: { failed: [{ pid: 200, why: MOVED }], killed: [101, 100] },
      signalled: [101, 100],
    });
  });

  it("reports a kill that failed with the reason the kill gave", () => {
    expect(run({ processes: UNCHANGED, refuse: new Map([[100, "EPERM"]]) })).toEqual({
      outcome: { failed: [{ pid: 100, why: "EPERM" }], killed: [101, 200] },
      signalled: [101, 100, 200],
    });
  });

  it("keeps signal order across a mix of moved, refused and signalled pids", () => {
    const processes = UNCHANGED.filter((row) => row.pid !== 101);
    expect(run({ processes, refuse: new Map([[200, "ESRCH"]]) })).toEqual({
      outcome: {
        failed: [
          { pid: 101, why: MOVED },
          { pid: 200, why: "ESRCH" },
        ],
        killed: [100],
      },
      signalled: [100, 200],
    });
  });

  it("signals nothing over an empty table, reporting every selected pid as moved", () => {
    expect(run({ processes: [], refuse: new Map() })).toEqual({
      outcome: {
        failed: [
          { pid: 101, why: MOVED },
          { pid: 100, why: MOVED },
          { pid: 200, why: MOVED },
        ],
        killed: [],
      },
      signalled: [],
    });
  });
});
