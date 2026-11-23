/** `awaitColdVerdict` over a fake client: a tab whose tty descriptors, process group or holders say a typed line would not be read. */
import { describe, expect, it } from "vitest";

import { awaitColdVerdict } from "../../../../../../cli/commands/cmux/reseatCold.js";
import type { CmuxClient } from "../../../../../../cmux/client.js";
import { err, ok, unwrapErr } from "../../../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../../../live/standing/processes.js";
import { honestExecutables, honestTtyHolders } from "../../fleet/fleetKit.js";
import { CHAIR_ID, workspace } from "./fixtures.js";
import { coldWorld } from "./harness.js";

describe("awaitColdVerdict", () => {
  // tab's tty whose stdin is a FIFO, so every column reads a prompt and a typed line reaches no reader.
  it("refuses a bare-looking shell that holds its tty on stdout and stderr but not on stdin, off lsof", async () => {
    const bare: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
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
        readExecutables: ({ pids }) => ok(honestExecutables({ pids, rows: bare })),
        readProcessRows: () => ok(bare),
        readTtyHolders: () => ok(new Map([[60562, [1, 2]]])),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read workspace:1's processes: process 60562 (/bin/zsh) at the tab's prompt shape holds the tab's tty ttys003 on descriptor(s) [1, 2] in the lsof read beside it, not on its stdin, so it reads its commands from somewhere else and a typed line would reach no reader — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });

  // A helper that ignored SIGTTOU, tcsetpgrp'd the tty to the login's
  // group and exited leaves a sleeping, childless shell with the tty on fd 0 that SIGTTIN stops the moment it reads.
  it("refuses a bare-looking shell whose process group is not its tty's foreground group, off ps", async () => {
    const bare: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
    ];
    const asked: number[][] = [];
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
        readProcessGroups: ({ pids }) => {
          asked.push([...pids]);
          return ok(new Map([[60562, { pgid: 60562, tpgid: 60561 }]]));
        },
        readProcessRows: () => ok(bare),
        readTtyHolders: ({ tty }) => ok(honestTtyHolders({ rows: bare, tty })),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect([journal, asked]).toEqual([[], [[60562]]]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read workspace:1's processes: process 60562 (/bin/zsh) at the tab's prompt shape is in process group 60562 while the tab's tty ttys003 has foreground group 60561 in the ps read beside it, so a line typed there would stop it with SIGTTIN and reach no prompt — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });

  // A `setsid`'d helper reparented to launchd, on no controlling tty, kept
  // fd 0 on the tab's tty and read the typed line; every `ps` column showed the tab a bare shell.
  it("refuses a bare-looking shell whose tty a process outside the forest holds open, off lsof", async () => {
    const bare: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
      { argv: "/tmp/reader", pid: 60700, ppid: 1, state: "S", tty: "??" },
    ];
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
        readProcessRows: () => ok(bare),
        readTtyHolders: ({ tty }) => {
          asked.push(tty);
          return ok(
            new Map([
              [60562, [0, 1, 2]],
              [60700, [0]],
            ]),
          );
        },
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(asked).toEqual(["ttys003"]);
    expect(journal).toEqual([]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read workspace:1's processes: process 60700 holds the tab's tty ttys003 open in the lsof read beside it and is outside the tab's forest, so a typed line could reach it — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });

  it("refuses the read when the tty's holders cannot be read, never assuming the shell alone holds it", async () => {
    const bare: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
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
        readExecutables: ({ pids }) => ok(honestExecutables({ pids, rows: bare })),
        readProcessRows: () => ok(bare),
        readTtyHolders: () => err("the processes holding tty ttys003 open could not be read (lsof: exited 1)"),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(journal).toEqual([]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read the processes holding workspace:1's tty open: the processes holding tty ttys003 open could not be read (lsof: exited 1) — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });
});
