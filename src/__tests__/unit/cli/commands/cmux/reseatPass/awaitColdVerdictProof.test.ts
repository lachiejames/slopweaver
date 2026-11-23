/** `awaitColdVerdict` over a fake client: what proves a tab cold — the graft, the shell image and the tty modes. */
import { describe, expect, it } from "vitest";

import { awaitColdVerdict } from "../../../../../../cli/commands/cmux/reseatCold.js";
import type { CmuxClient } from "../../../../../../cmux/client.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../../../live/standing/processes.js";
import { honestExecutables, honestTtyHolders, honestTtyModes } from "../../fleet/fleetKit.js";
import { CHAIR_ID, workspace } from "./fixtures.js";
import { coldWorld } from "./harness.js";

describe("awaitColdVerdict", () => {
  // MEASURED on cmux 0.65.2: a reopened tab at its prompt attributes NO process and lists its `login` and shell
  // as unattributed tty pids. Read as `processes` alone this is `no-process`, and `fleet resume` refused the pinned chair
  // `NO_LIVE_SESSION` — the whole fleet stayed down until the chair was resumed by hand.
  it("reads a 0.65.2 tab whose shell cmux attributes to no tree as cold, grafting it from the process table", async () => {
    const journal: string[] = [];
    const { client, deps } = coldWorld({ journal, trees: [] });
    const unattributed: CmuxClient = {
      ...client,
      workspaceTop: () =>
        Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [60561, 60562] })),
    };
    const table: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      {
        argv: "/usr/bin/login -flp ada /bin/bash --noprofile --norc -c exec -l /bin/zsh",
        pid: 60561,
        ppid: 60470,
        state: "Ss",
        tty: "ttys003",
      },
      { argv: "-/bin/zsh", pid: 60562, ppid: 60561, state: "S", tty: "ttys003" },
    ];

    const read = await awaitColdVerdict({
      deps: {
        ...deps,
        client: unattributed,
        readExecutables: ({ pids }) => ok(honestExecutables({ pids, rows: table })),
        readProcessRows: () => ok(table),
        readTtyHolders: ({ tty }) => ok(honestTtyHolders({ rows: table, tty })),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect(unwrap(read)).toEqual({
      argv: `--settings {} --resume ${CHAIR_ID}`,
      cwd: "/wt/ws-chair",
      kind: "cold",
      mismatch: undefined,
      sessionId: CHAIR_ID,
    });
  });

  // `execve("/tmp/zsh", ["/bin/zsh"])` under the real login prints `/bin/zsh` in every
  // `ps` column (MEASURED), so the image lsof lists is read after the graft, and only it can say.
  it("refuses a bare-looking shell whose executable is not the system shell its argv names, and one lsof cannot read", async () => {
    const table: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
    ];
    const spoofedJournal: string[] = [];
    const spoofed = coldWorld({ journal: spoofedJournal, trees: [] });
    const unreadJournal: string[] = [];
    const unread = coldWorld({ journal: unreadJournal, trees: [] });
    const unattributed = (client: CmuxClient): CmuxClient => ({
      ...client,
      workspaceTop: () =>
        Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [60561, 60562] })),
    });
    const asked: (readonly number[])[] = [];

    const spoofedRead = await awaitColdVerdict({
      deps: {
        ...spoofed.deps,
        client: unattributed(spoofed.client),
        readExecutables: ({ pids }) => {
          asked.push(pids);
          return ok(new Map([[60562, "/tmp/zsh"]]));
        },
        readProcessRows: () => ok(table),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });
    const unreadRead = await awaitColdVerdict({
      deps: {
        ...unread.deps,
        client: unattributed(unread.client),
        readExecutables: () => err("lsof: exited 1"),
        readProcessRows: () => ok(table),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    // The shell alone: the login is root's, and lsof as the owner prints no block for it (MEASURED).
    expect(asked).toEqual([[60562]]);
    expect([spoofedJournal, unreadJournal]).toEqual([[], []]);
    expect(unwrapErr(spoofedRead)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read workspace:1's processes: process 60562 (/bin/zsh) in the tab's forest runs \"/tmp/zsh\", the image lsof lists for it, not the system shell its argv names — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
    expect(unwrapErr(unreadRead)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read the executables behind workspace:1's shell: lsof: exited 1 — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });

  // Cmux attributes the shell as a bare `zsh` while the table's argv spells `/bin/zsh`, and
  // the forest once kept cmux's word, so an image in another system shell directory passed on its basename.
  it("refuses an attributed shell whose image is a system shell in another directory than the table's argv spells", async () => {
    const table: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60470, state: "S+", tty: "ttys003" },
    ];
    const journal: string[] = [];
    const attributed = coldWorld({ journal, trees: [] });
    const asked: (readonly number[])[] = [];

    const read = await awaitColdVerdict({
      deps: {
        ...attributed.deps,
        client: {
          ...attributed.client,
          workspaceTop: () =>
            Promise.resolve(
              ok({
                surfaces: 1,
                trees: [{ children: [], name: "zsh", pid: 60562 }],
                ttys: [],
                unattributedTtyPids: [],
              }),
            ),
        },
        readExecutables: ({ pids }) => {
          asked.push(pids);
          return ok(new Map([[60562, "/usr/local/bin/zsh"]]));
        },
        readProcessRows: () => ok(table),
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect([asked, journal]).toEqual([[[60562]], []]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read workspace:1's processes: process 60562 (/bin/zsh) in the tab's forest runs \"/usr/local/bin/zsh\", the image lsof lists for it, not the system shell its argv names — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });

  // A same-owner helper ran `stty -f /dev/ttys003 icanon inlcr -icrnl` and exited before
  // any read, so every process read showed a bare prompt while the kernel held the typed line for a delimiter it
  // mapped away. The modes are read off `stty -g` after the executables and before the holders, and refused.
  it("refuses a bare-looking shell whose tty a helper left canonical, before the holders are read", async () => {
    const bare: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
      { argv: "/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
    ];
    const journal: string[] = [];
    const reads: string[] = [];
    const canonical = coldWorld({ journal, trees: [] });
    const unattributed: CmuxClient = {
      ...canonical.client,
      workspaceTop: () =>
        Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [60561, 60562] })),
    };

    const read = await awaitColdVerdict({
      deps: {
        ...canonical.deps,
        client: unattributed,
        readExecutables: ({ pids }) => ok(honestExecutables({ pids, rows: bare })),
        readProcessRows: () => ok(bare),
        readTtyHolders: ({ tty }) => {
          reads.push(`holders ${tty}`);
          return ok(honestTtyHolders({ rows: bare, tty }));
        },
        readTtyModes: ({ tty }) => {
          reads.push(`modes ${tty}`);
          // The measured `lflag` with `icanon` (0x100) set, `iflag` with `icrnl` (0x100) cleared and `inlcr` kept.
          return ok({ ...honestTtyModes(), iflag: 0x6a42, lflag: 0x5c3 });
        },
      },
      pinnedSessionId: CHAIR_ID,
      workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
    });

    expect([journal, reads]).toEqual([[], ["modes ttys003"]]);
    expect(unwrapErr(read)).toEqual({
      code: "CMUX_READ_FAILED",
      message:
        "cmux could not read workspace:1's processes: the tab's tty ttys003 has icanon set in the stty read beside it, so it is in canonical mode, where the kernel holds a typed line until a delimiter it may have been set to map away, where a shell at its prompt reads raw through its own line editor and a typed line would never be entered — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing",
    });
  });
});
