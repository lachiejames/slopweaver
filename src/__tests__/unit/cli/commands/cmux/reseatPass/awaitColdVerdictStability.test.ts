/** `awaitColdVerdict` over a fake client: a tab whose forest, tty or state moves between the two table reads is refused. */
import { describe, expect, it } from "vitest";

import { awaitColdVerdict } from "../../../../../../cli/commands/cmux/reseatCold.js";
import type { CmuxClient } from "../../../../../../cmux/client.js";
import { ok, unwrapErr } from "../../../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../../../live/standing/processes.js";
import { honestExecutables, honestTtyHolders } from "../../fleet/fleetKit.js";
import { CHAIR_ID, workspace } from "./fixtures.js";
import { coldWorld } from "./harness.js";

describe("awaitColdVerdict", () => {
  // Lsof reads only the pids the first table placed, so a child forked between that
  // table read and the lsof read was in neither, and the shell it hung under confirmed as /bin/zsh.
  it("refuses a bare-looking shell that forks a child between the table read and the lsof read", async () => {
    const bare: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
    ];
    const withVim: readonly TtyProcessRow[] = [
      ...bare,
      { argv: "vim notes.md", pid: 60600, ppid: 60562, state: "S+", tty: "ttys003" },
    ];
    let tableReads = 0;
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const unattributed: CmuxClient = {
      ...client,
      workspaceTop: () =>
        Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [60561, 60562] })),
    };

    const read = await awaitColdVerdict({
      deps: {
        ...deps,
        client: unattributed,
        readExecutables: ({ pids }) => ok(honestExecutables({ pids, rows: bare })),
        readProcessRows: () => {
          tableReads += 1;
          return ok(tableReads % 2 === 1 ? bare : withVim);
        },
        readTtyHolders: ({ tty }) => ok(honestTtyHolders({ rows: bare, tty })),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read workspace:1's processes: the tab's forest read after lsof is [d0 60561 /usr/bin/login, d1 60562 /bin/zsh, d2 60600 vim] where the one read before it was [d0 60561 /usr/bin/login, d1 60562 /bin/zsh], so a process started, ended or changed between the two reads — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });

  // The identical forest, every row on another tty in the second read.
  it("refuses a bare-looking shell whose forest the second table read puts on another tty", async () => {
    const bare: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
    ];
    const moved: readonly TtyProcessRow[] = bare.map((row) =>
      row.tty === "ttys003" ? { ...row, tty: "ttys004" } : row,
    );
    let tableReads = 0;
    const asked: string[] = [];
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const unattributed: CmuxClient = {
      ...client,
      workspaceTop: () =>
        Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [60561, 60562] })),
    };

    const read = await awaitColdVerdict({
      deps: {
        ...deps,
        client: unattributed,
        readExecutables: ({ pids }) => ok(honestExecutables({ pids, rows: bare })),
        readProcessRows: () => {
          tableReads += 1;
          return ok(tableReads % 2 === 1 ? bare : moved);
        },
        readTtyHolders: ({ tty }) => {
          asked.push(tty);
          return ok(honestTtyHolders({ rows: bare, tty }));
        },
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect([journal, asked]).toEqual([[], ["ttys003"]]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read workspace:1's processes: the tab's forest read after lsof is on tty ttys004 where the one read before it was on ttys003, so the holders read covered a tty the tab is no longer on — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });

  // A second shape: `exec /bin/zsh -i </tmp/feed`, a genuine interactive system zsh on the
  // The identical forest on the identical tty, its root under a second cmux
  // app row in the second table read.
  it("refuses a bare-looking shell whose root the second table read puts under another cmux app", async () => {
    const underFirst: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 70000, ppid: 1, state: "S", tty: "??" },
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
    ];
    const underSecond: readonly TtyProcessRow[] = underFirst.map((row) =>
      row.pid === 60561 ? { ...row, ppid: 70000 } : row,
    );
    let tableReads = 0;
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const unattributed: CmuxClient = {
      ...client,
      workspaceTop: () =>
        Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [60561, 60562] })),
    };

    const read = await awaitColdVerdict({
      deps: {
        ...deps,
        client: unattributed,
        readExecutables: ({ pids }) => ok(honestExecutables({ pids, rows: underFirst })),
        readProcessRows: () => {
          tableReads += 1;
          return ok(tableReads % 2 === 1 ? underFirst : underSecond);
        },
        readTtyHolders: ({ tty }) => ok(honestTtyHolders({ rows: underFirst, tty })),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        'cmux could not read workspace:1\'s processes: process 60561 in the tab\'s forest is under 70000 on ttys003 as "/usr/bin/login -flp ada /bin/zsh" in the table read after lsof where it was under 60470 on ttys003 as "/usr/bin/login -flp ada /bin/zsh" in the one read before it, so the two reads disagree about where it sits — nothing was typed; run the same command again once cmux and ps answer, and read the tab\'s screen if it keeps failing',
    });
  });

  // A genuine interactive zsh spinning in a builtin precmd hook is
  // childless on its tty with every image, holder and forest check green; only its state says it is on the CPU.
  it("refuses a bare-looking shell that is on the CPU where a shell at its prompt sleeps, and types nothing", async () => {
    const spinning: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "R+", tty: "ttys003" },
    ];
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const unattributed: CmuxClient = {
      ...client,
      workspaceTop: () =>
        Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [60561, 60562] })),
    };

    const read = await awaitColdVerdict({
      deps: {
        ...deps,
        client: unattributed,
        readExecutables: ({ pids }) => ok(honestExecutables({ pids, rows: spinning })),
        readProcessRows: () => ok(spinning),
        readTtyHolders: ({ tty }) => ok(honestTtyHolders({ rows: spinning, tty })),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read workspace:1's processes: process 60562 (/bin/zsh) on the tab's tty ttys003 is in state R+ in the process table read beside it, on the CPU, where a shell at its prompt sleeps in its line editor, so it is running a builtin loop and a typed line would queue behind it — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });
});
