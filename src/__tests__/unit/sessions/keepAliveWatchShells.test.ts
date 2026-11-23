/**
 * The shell half of the keep-alive close: what a hosting shell's fault names, and which filter processes its piped
 * command owns. Which commands are a keep-alive is `./keepAliveShellCommand.test.ts`; the whole decision over the
 * measured chair is `./keepAliveSeatClose.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { CmuxProcess } from "../../../cmux/client.js";
import type { TtyProcessRow } from "../../../live/standing/processes.js";
import { watchShells } from "../../../sessions/keepAliveWatchShells.js";
import {
  BARE_KEEP_ALIVE,
  bashToolArgv,
  CHAIR_TREE,
  CHAIR_WATCH,
  CHAIR_WATCH_ONLY,
  claudeRow,
  PIPED_CHAIR_TREE,
  PIPED_KEEP_ALIVE,
  shellRow,
  ugrepRow,
  watchRows,
} from "./keepAliveChairFixture.js";

/** The measured piped chair's rows: its `claude`, the shell running `command`, the watch, and `extra`. */
function pipedRows({ command, extra }: { command: string; extra: TtyProcessRow[] }): TtyProcessRow[] {
  return [
    claudeRow({ pid: 42315 }),
    shellRow({ argv: bashToolArgv({ command }), pid: 84990 }),
    ...CHAIR_WATCH_ONLY,
    ...extra,
  ];
}

/** The piped chair's tree with more children under the keep-alive's shell. */
function treeWith({ children }: { children: CmuxProcess[] }): readonly CmuxProcess[] {
  const [claude] = CHAIR_TREE;
  const shell = claude!.children[1]!;
  return [{ ...claude!, children: [claude!.children[0]!, { ...shell, children: [...shell.children, ...children] }] }];
}

describe("watchShells filter ownership", () => {
  it("owns the bundled ugrep a written grep runs as, the measured chair's shape", () => {
    const rows = pipedRows({ command: PIPED_KEEP_ALIVE, extra: [ugrepRow({ pid: 84993 })] });
    expect(watchShells({ rows, seatWatchPids: [85912], tree: PIPED_CHAIR_TREE })).toEqual({
      fault: undefined,
      hosting: 1,
      shells: 1,
    });
  });

  it("owns one process per stage of a grep-then-tail pipeline", () => {
    const tail = { ...ugrepRow({ pid: 84994 }), argv: "tail -20" };
    const rows = pipedRows({ command: `${PIPED_KEEP_ALIVE} | tail -20`, extra: [ugrepRow({ pid: 84993 }), tail] });
    const tree = treeWith({
      children: [
        { children: [], name: "2.1.323", pid: 84993 },
        { children: [], name: "tail", pid: 84994 },
      ],
    });
    expect(watchShells({ rows, seatWatchPids: [85912], tree }).fault).toBe(undefined);
  });

  it("leaves a grep the command never named a stranger", () => {
    const rows = pipedRows({ command: `${BARE_KEEP_ALIVE} 2>&1 | tail -20`, extra: [ugrepRow({ pid: 84993 })] });
    expect(watchShells({ rows, seatWatchPids: [85912], tree: PIPED_CHAIR_TREE }).fault).toEqual({
      kind: "stranger",
      name: "2.1.323",
      pid: 84993,
    });
  });

  it("leaves a second ugrep a stranger when the command names one grep", () => {
    const rows = pipedRows({ command: PIPED_KEEP_ALIVE, extra: [ugrepRow({ pid: 84993 }), ugrepRow({ pid: 84995 })] });
    const tree = treeWith({
      children: [
        { children: [], name: "2.1.323", pid: 84993 },
        { children: [], name: "2.1.323", pid: 84995 },
      ],
    });
    expect(watchShells({ rows, seatWatchPids: [85912], tree }).fault).toEqual({
      kind: "stranger",
      name: "2.1.323",
      pid: 84995,
    });
  });

  it("owns only the filter process itself, so one it started, not directly under the shell, is a stranger", () => {
    const rows = pipedRows({
      command: PIPED_KEEP_ALIVE,
      extra: [ugrepRow({ pid: 84993 }), ugrepRow({ pid: 84996, ppid: 84993 })],
    });
    expect(watchShells({ rows, seatWatchPids: [85912], tree: PIPED_CHAIR_TREE }).fault).toEqual({
      kind: "stranger",
      name: "ugrep",
      pid: 84996,
    });
  });
});

describe("watchShells", () => {
  it("counts the measured chair's one shell as hosting its watch, with no fault", () => {
    expect(watchShells({ rows: CHAIR_WATCH, seatWatchPids: [85912], tree: CHAIR_TREE })).toEqual({
      fault: undefined,
      hosting: 1,
      shells: 1,
    });
  });

  it("names a hosting shell running rather than asleep, with its state", () => {
    const rows = [
      claudeRow({ pid: 42315 }),
      shellRow({ pid: 84990, state: "R" }),
      ...watchRows({ child: 85912, launcher: 84992, wait: false }),
    ];

    expect(watchShells({ rows, seatWatchPids: [85912], tree: CHAIR_TREE }).fault).toEqual({
      kind: "awake",
      pid: 84990,
      state: "R",
    });
  });

  it("reads a shell's last row when the table lists its pid twice", () => {
    const rows = [...CHAIR_WATCH, shellRow({ pid: 84990, state: "R" })];

    expect(watchShells({ rows, seatWatchPids: [85912], tree: CHAIR_TREE }).fault).toEqual({
      kind: "awake",
      pid: 84990,
      state: "R",
    });
  });

  it("names a hosting shell whose own command is not a keep-alive", () => {
    const rows = [
      claudeRow({ pid: 42315 }),
      shellRow({ argv: bashToolArgv({ command: `${BARE_KEEP_ALIVE}; sleep 600` }), pid: 84990 }),
      ...watchRows({ child: 85912, launcher: 84992, wait: false }),
    ];

    expect(watchShells({ rows, seatWatchPids: [85912], tree: CHAIR_TREE }).fault).toEqual({
      kind: "command",
      pid: 84990,
    });
  });
});
