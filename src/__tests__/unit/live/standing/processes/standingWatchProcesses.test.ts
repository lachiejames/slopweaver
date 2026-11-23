/*
 * `standingWatchProcesses` — one entry per running `claude watch` loop, not per process: `bin/slopweaver` execs
 * tsx and tsx runs the entrypoint in a node child, so the launcher row is never a watch of its own. It was split
 * out when the process-snapshot suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { decodeClaudeWatch, type ProcessRow, standingWatchProcesses } from "../../../../../live/standing/processes.js";

describe("standingWatchProcesses — one entry per running loop, not per process", () => {
  // MEASURED on the owner's machine: `bin/slopweaver` execs tsx, and tsx runs the entrypoint in a
  // CHILD node process, so one watch is two rows carrying the same entrypoint and verb.
  const MAIN = "/Users/owner/dev/slopweaver";
  const LAUNCHER: ProcessRow = {
    argv: `/node ${MAIN}/bin/../node_modules/.bin/tsx ${MAIN}/bin/../src/cli/index.ts claude watch --interval 5`,
    pid: 53785,
    ppid: 53784,
  };
  const CHILD: ProcessRow = {
    argv: `/node --require ${MAIN}/node_modules/tsx/dist/preflight.cjs --import file://${MAIN}/node_modules/tsx/dist/loader.mjs ${MAIN}/bin/../src/cli/index.ts claude watch --interval 5`,
    pid: 53862,
    ppid: 53785,
  };

  it("reads a watch and its tsx launcher as the ONE child that runs the loop", () => {
    expect(standingWatchProcesses({ processes: [LAUNCHER, CHILD] })).toStrictEqual([
      { cwd: MAIN, pid: 53862, ppid: 53785, waiting: false },
    ]);
  });

  it("keeps two independent watches as two, in snapshot order, and drops everything else", () => {
    const other: ProcessRow = { argv: "node /wt/other/src/cli/index.ts claude watch", pid: 9, ppid: 1 };
    const unrelated: ProcessRow = { argv: "/bin/sleep 600", pid: 10, ppid: 1 };
    expect(
      standingWatchProcesses({ processes: [LAUNCHER, unrelated, CHILD, other] }).map((watcher) => watcher.pid),
    ).toStrictEqual([53862, 9]);
  });

  it("reads an empty table as no watch at all", () => {
    expect(standingWatchProcesses({ processes: [] })).toStrictEqual([]);
  });
});

describe("the tsx launcher is never a watch — only its node child runs the loop", () => {
  const MAIN = "/Users/owner/dev/slopweaver";
  const LAUNCHER: ProcessRow = {
    argv: `/node ${MAIN}/bin/../node_modules/.bin/tsx ${MAIN}/bin/../src/cli/index.ts claude watch --interval 5`,
    pid: 53785,
    ppid: 53784,
  };

  // Before the child appears, or after it exits, the launcher stands alone — and read as a live
  // watch over a machine refreshing nothing.
  it("reads a lone launcher as no watch at all", () => {
    expect(decodeClaudeWatch({ row: LAUNCHER })).toBe(undefined);
    expect(standingWatchProcesses({ processes: [LAUNCHER] })).toStrictEqual([]);
  });

  it("reads the resolved tsx cli path as a launcher too", () => {
    const resolved: ProcessRow = {
      argv: `/node ${MAIN}/node_modules/tsx/dist/cli.mjs ${MAIN}/src/cli/index.ts claude watch`,
      pid: 1,
      ppid: 0,
    };
    expect(decodeClaudeWatch({ row: resolved })).toBe(undefined);
  });

  it("still reads `node --import tsx <entry>`, which runs the loop in-process", () => {
    const inProcess: ProcessRow = { argv: `node --import tsx ${MAIN}/src/cli/index.ts claude watch`, pid: 2, ppid: 0 };
    expect(decodeClaudeWatch({ row: inProcess })?.pid).toBe(2);
  });
});
