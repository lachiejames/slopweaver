/*
 * `graftTtyProcesses`, the tab's tty: every process on the tab's tty must be one cmux reported, at a prompt rather
 * than stopped, spinning or reading a script, under one cmux app on one real tty, in a table that does not loop; and
 * each refusal is one typed error naming its check.
 */
import { describe, expect, it } from "vitest";

import type { CmuxProcess } from "../../../../cmux/client.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseProcessRowsWhole, type TtyProcessRow } from "../../../../live/standing/processes.js";
import { graftTtyProcesses } from "../../../../sessions/coldGraft.js";
import { ColdGraftErrors } from "../../../../sessions/coldGraftErrors.js";
import { ColdGraftTtyErrors } from "../../../../sessions/coldGraftTtyErrors.js";
import { BARE_SHELL, GRAFTED_SHELL, TABLE } from "./harness.js";

describe("graftTtyProcesses", () => {
  // A foreground child whose argv began with a newline was dropped by the
  // tolerant decoder, so the shell read as a bare prompt. The whole decoder joins the line back; the graft then
  // sees the child, unnamed, under the shell.
  it("places a child whose argv is a bare newline continuation under its shell, so the tab is not a prompt", () => {
    const rows = unwrap(
      parseProcessRowsWhole({
        text: "100 0 ?? Ss /Applications/cmux.app/Contents/MacOS/cmux\n10 100 ttys005 S -/bin/zsh\n11 10 ttys005 S+ \nvim\n",
      }),
    );

    expect(unwrap(graftTtyProcesses({ rows, trees: [{ children: [], name: "zsh", pid: 10 }], ttyPids: [] }))).toEqual([
      { children: [{ children: [], name: "(unnamed)", pid: 11 }], name: "-/bin/zsh", pid: 10 },
    ]);
  });

  // Nothing listed and nothing attributed returned an empty forest.
  it("refuses a tab cmux reports no process for, never an empty forest", () => {
    expect(unwrapErr(graftTtyProcesses({ rows: TABLE, trees: [], ttyPids: [] })).message).toBe(
      "cmux reported no process for the tab, so there is nothing to graft; an empty tab is judged without the table",
    );
  });

  // Two roots each under its own cmux app row passed, because each parent
  // LOOKED like the app; one tab is owned by one app process.
  it("refuses roots that sit under two cmux app processes, since one tab is owned by one app", () => {
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 70000, ppid: 1, state: "S", tty: "??" },
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "vim notes.md", pid: 20, ppid: 70000, state: "S", tty: "ttys005" },
    ];
    const trees: readonly CmuxProcess[] = [
      { children: [], name: "zsh", pid: 10 },
      { children: [], name: "vim", pid: 20 },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows, trees, ttyPids: [] })).message).toBe(
      "the tab's roots sit under two cmux app processes in the process table read beside it, 60470 and 70000, and one tab is owned by one app",
    );
  });

  // A `vim` under the cmux app beside the reported shell, on the same tab, was
  // never walked — the graft reads only reported roots and their descendants — so the childless shell was approved.
  // The tty is the tab membership `ps` carries, and a row on it the forest does not hold is refused; a process the
  // tab orphaned to launchd is on the tty too, and refused the same way.
  it("refuses a process on the tab's tty that cmux neither attributed nor listed, under the app or orphaned", () => {
    const shell: readonly CmuxProcess[] = [{ children: [], name: "zsh", pid: 10 }];
    const sibling: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "vim notes.md", pid: 20, ppid: 60470, state: "S", tty: "ttys005" },
    ];
    const orphan: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "sleep 100", pid: 30, ppid: 1, state: "S", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: sibling, trees: shell, ttyPids: [] })).message).toBe(
      "process 20 (vim) is on the tab's tty ttys005 in the process table read beside it, and cmux neither attributed nor listed it",
    );
    expect(unwrapErr(graftTtyProcesses({ rows: orphan, trees: shell, ttyPids: [] })).message).toBe(
      "process 30 (sleep) is on the tab's tty ttys005 in the process table read beside it, and cmux neither attributed nor listed it",
    );
  });

  // A shell a signal stopped shows every shape a prompt shows, and the read
  // carried no state to tell them apart, so the line was typed at a shell reading nothing until SIGCONT.
  it("refuses a process on the tab's tty a signal stopped or left a zombie, a childless shell first among them", () => {
    const stoppedShell: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "T", tty: "ttys005" },
    ];
    const zombieShell: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "Z+", tty: "ttys005" },
    ];
    const stoppedUnderLogin: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 100, ppid: 60470, state: "Ss", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 101, ppid: 100, state: "T+", tty: "ttys005" },
    ];
    const sleeping: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "Ss+", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: stoppedShell, trees: BARE_SHELL, ttyPids: [] })).message).toBe(
      "process 10 (-/bin/zsh) on the tab's tty ttys005 is in state T in the process table read beside it, stopped or exited, and such a process is at no prompt",
    );
    expect(unwrapErr(graftTtyProcesses({ rows: zombieShell, trees: BARE_SHELL, ttyPids: [] })).message).toBe(
      "process 10 (-/bin/zsh) on the tab's tty ttys005 is in state Z+ in the process table read beside it, stopped or exited, and such a process is at no prompt",
    );
    expect(unwrapErr(graftTtyProcesses({ rows: stoppedUnderLogin, trees: [], ttyPids: [100, 101] })).message).toBe(
      "process 101 (-/bin/zsh) on the tab's tty ttys005 is in state T+ in the process table read beside it, stopped or exited, and such a process is at no prompt",
    );
    expect(unwrap(graftTtyProcesses({ rows: sleeping, trees: BARE_SHELL, ttyPids: [] }))).toEqual(GRAFTED_SHELL);
  });

  // `spin() { while :; do :; done; }` installed as a precmd hook keeps
  // a genuine interactive zsh childless on its tty, and only its state says it is on the CPU rather than asleep in
  // its line editor. MEASURED the same day: ten bare shells sampled S, SN or S+; a spinning process sampled R.
  it("refuses a childless shell on the tab's tty that is on the CPU, under a login too, never a sleeping one", () => {
    const spinning: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "R+", tty: "ttys005" },
    ];
    const spinningUnderLogin: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 100, ppid: 60470, state: "Ss", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 101, ppid: 100, state: "R", tty: "ttys005" },
    ];
    const idle: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "SN", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: spinning, trees: BARE_SHELL, ttyPids: [] }))).toEqual({
      code: "SHELL_BUSY_ON_TTY",
      message:
        "process 10 (-/bin/zsh) on the tab's tty ttys005 is in state R+ in the process table read beside it, on the CPU, where a shell at its prompt sleeps in its line editor, so it is running a builtin loop and a typed line would queue behind it",
      name: "-/bin/zsh",
      pid: 10,
      state: "R+",
      tty: "ttys005",
    });
    expect(unwrapErr(graftTtyProcesses({ rows: spinningUnderLogin, trees: [], ttyPids: [100, 101] })).message).toBe(
      "process 101 (-/bin/zsh) on the tab's tty ttys005 is in state R in the process table read beside it, on the CPU, where a shell at its prompt sleeps in its line editor, so it is running a builtin loop and a typed line would queue behind it",
    );
    expect(unwrap(graftTtyProcesses({ rows: idle, trees: BARE_SHELL, ttyPids: [] }))).toEqual(GRAFTED_SHELL);
  });

  // The cycle walk covers only the forest, so a cmux app row that was its
  // own parent, or whose ancestry returned to it, was a looping table that still rebuilt the prompt shape.
  it("refuses a table whose cmux app row is its own parent or whose ancestry returns to it, naming the loop", () => {
    const selfParented: readonly TtyProcessRow[] = [
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 100, ppid: 100, state: "S", tty: "??" },
      { argv: "-/bin/zsh", pid: 10, ppid: 100, state: "S", tty: "ttys005" },
    ];
    const through: readonly TtyProcessRow[] = [
      { argv: "/sbin/launchd", pid: 1, ppid: 100, state: "Ss", tty: "??" },
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 100, ppid: 1, state: "S", tty: "??" },
      { argv: "-/bin/zsh", pid: 10, ppid: 100, state: "S", tty: "ttys005" },
    ];
    const real: readonly TtyProcessRow[] = [
      { argv: "/sbin/launchd", pid: 1, ppid: 0, state: "Ss", tty: "??" },
      { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 100, ppid: 1, state: "S", tty: "??" },
      { argv: "-/bin/zsh", pid: 10, ppid: 100, state: "S", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: selfParented, trees: BARE_SHELL, ttyPids: [] }))).toEqual(
      ColdGraftErrors.tableLoops({ pids: [100] }),
    );
    expect(unwrapErr(graftTtyProcesses({ rows: through, trees: BARE_SHELL, ttyPids: [] }))).toEqual(
      ColdGraftErrors.tableLoops({ pids: [100, 1] }),
    );
    expect(unwrap(graftTtyProcesses({ rows: real, trees: BARE_SHELL, ttyPids: [] }))).toEqual(GRAFTED_SHELL);
  });

  // `exec /bin/zsh /tmp/commands.fifo` with no writer is childless and
  // sleeping exactly as a prompt is, and only its argv says it reads a script.
  it("refuses a childless shell on the tab's tty started on a script or a command string, never one started interactive", () => {
    const onFifo: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 100, ppid: 60470, state: "Ss", tty: "ttys005" },
      { argv: "/bin/zsh /tmp/commands.fifo", pid: 101, ppid: 100, state: "S", tty: "ttys005" },
    ];
    const onString: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/bin/zsh -c read", pid: 10, ppid: 60470, state: "S+", tty: "ttys005" },
    ];
    const interactive: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/bin/zsh -l -i", pid: 10, ppid: 60470, state: "S+", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: onFifo, trees: [], ttyPids: [100, 101] })).message).toBe(
      'process 101 on the tab\'s tty ttys005 is a shell started as "/bin/zsh /tmp/commands.fifo" in the process table read beside it, not one at its prompt',
    );
    expect(unwrapErr(graftTtyProcesses({ rows: onString, trees: BARE_SHELL, ttyPids: [] })).message).toBe(
      'process 10 on the tab\'s tty ttys005 is a shell started as "/bin/zsh -c read" in the process table read beside it, not one at its prompt',
    );
    expect(unwrap(graftTtyProcesses({ rows: interactive, trees: BARE_SHELL, ttyPids: [] }))).toEqual([
      { children: [], name: "/bin/zsh", pid: 10 },
    ]);
  });

  it("refuses a root on no tty, and roots on two ttys, since one tab is one tty", () => {
    const untethered: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "??" },
    ];
    const twoTtys: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "vim notes.md", pid: 20, ppid: 60470, state: "S", tty: "ttys006" },
    ];
    const trees: readonly CmuxProcess[] = [
      { children: [], name: "zsh", pid: 10 },
      { children: [], name: "vim", pid: 20 },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: untethered, trees: BARE_SHELL, ttyPids: [] })).message).toBe(
      "process 10 cmux shows as a root of the tab is on no tty in the process table read beside it",
    );
    expect(unwrapErr(graftTtyProcesses({ rows: twoTtys, trees, ttyPids: [] })).message).toBe(
      "the tab's roots sit on two ttys in the process table read beside it, ttys005 and ttys006, and one tab is one tty",
    );
  });

  // The decoder takes any non-empty token as a tty, so a misread row with
  // `bogus` there was accepted as a tab and every row "on" it placed.
  it("refuses a root whose tty token is not a ttys<N> device name", () => {
    const bogus: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "bogus" },
    ];
    const trees: readonly CmuxProcess[] = [{ children: [], name: "zsh", pid: 10 }];

    expect(unwrapErr(graftTtyProcesses({ rows: bogus, trees, ttyPids: [] }))).toEqual({
      code: "ROOT_ON_UNREAL_TTY",
      message:
        'process 10 cmux shows as a root of the tab is on tty "bogus" in the process table read beside it, which is not a ttys<N> device name, so the row is misread',
      pid: 10,
      tty: "bogus",
    });
  });

  // MEASURED: a `claude`'s pipe-driven `zsh -c` children sit on no tty under a tab's `claude`. They are
  // placed off the parent column as any descendant is. A child on no tty directly under the SHELL is no measured
  // shape, and the tab's tty never reads what it runs, so it is refused.
  it("places a descendant on no tty under a program, and refuses one directly under the shell", () => {
    const underProgram: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "claude", pid: 11, ppid: 10, state: "S+", tty: "ttys005" },
      { argv: "/bin/zsh -c ps", pid: 12, ppid: 11, state: "S", tty: "??" },
    ];
    const underShell: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "/bin/zsh -c ps", pid: 11, ppid: 10, state: "S", tty: "??" },
    ];

    expect(unwrap(graftTtyProcesses({ rows: underProgram, trees: BARE_SHELL, ttyPids: [] }))).toEqual([
      {
        children: [{ children: [{ children: [], name: "/bin/zsh", pid: 12 }], name: "claude", pid: 11 }],
        name: "-/bin/zsh",
        pid: 10,
      },
    ]);
    expect(unwrapErr(graftTtyProcesses({ rows: underShell, trees: BARE_SHELL, ttyPids: [] })).message).toBe(
      "process 11 in the tab's forest sits on tty ?? in the process table read beside it, not the tab's ttys005, so what it runs is unread by the tab's tty",
    );
  });

  // A listed shell cmux also attributed under a `vim`, the table agreeing, was
  // detached from the `vim` and rooted beside it.
  it("keeps a listed pid under the attributed parent both reads put it under, never rooted beside it", () => {
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "vim notes.md", pid: 20, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 21, ppid: 20, state: "S", tty: "ttys005" },
    ];
    const underVim: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "zsh", pid: 21 }], name: "vim", pid: 20 },
    ];

    expect(unwrap(graftTtyProcesses({ rows, trees: underVim, ttyPids: [21] }))).toEqual([
      { children: [{ children: [], name: "-/bin/zsh", pid: 21 }], name: "vim", pid: 20 },
    ]);
  });

  // A cycle made only of listed pids rooted none of them and came back as an
  // empty tree, never an error.
  it("changes nothing when there is nothing to graft, and refuses a cycle of listed pids", () => {
    const cyclic: readonly TtyProcessRow[] = [
      { argv: "-/bin/zsh", pid: 5, ppid: 6, state: "S", tty: "ttys005" },
      { argv: "/usr/bin/login", pid: 6, ppid: 5, state: "S", tty: "ttys005" },
    ];
    const bareRows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
    ];

    expect(unwrap(graftTtyProcesses({ rows: bareRows, trees: BARE_SHELL, ttyPids: [] }))).toEqual(GRAFTED_SHELL);
    expect(unwrapErr(graftTtyProcesses({ rows: cyclic, trees: [], ttyPids: [5, 6] })).message).toBe(
      "the process table read beside the tab loops: listed pid(s) 5, 6 sit under one another with no root among them",
    );
  });

  // With only the login listed, the walk rooted it, read the shell under it off
  // the table, met the login again under the shell and dropped that edge — login → childless shell, the prompt shape.
  it("refuses a table whose parent links loop back through a rooted pid, rather than dropping the closing edge", () => {
    const loop: readonly TtyProcessRow[] = [
      { argv: "/usr/bin/login", pid: 10, ppid: 11, state: "S", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 11, ppid: 10, state: "S", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: loop, trees: [], ttyPids: [10] })).message).toBe(
      "the process table read beside the tab loops: pid(s) 10 sit under their own descendants",
    );
  });

  it("refuses as one typed error per disagreement, the code naming the check and the message the facts", () => {
    const stray: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "vim notes.md", pid: 20, ppid: 60470, state: "S", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: TABLE, trees: [], ttyPids: [] }))).toEqual(
      ColdGraftErrors.nothingToGraft(),
    );
    expect(unwrapErr(graftTtyProcesses({ rows: stray, trees: BARE_SHELL, ttyPids: [] }))).toEqual({
      code: "STRAY_ON_TTY",
      message:
        "process 20 (vim) is on the tab's tty ttys005 in the process table read beside it, and cmux neither attributed nor listed it",
      name: "vim",
      pid: 20,
      tty: "ttys005",
    });
    expect(ColdGraftErrors.strayOnTty({ name: "vim", pid: 20, tty: "ttys005" })).toEqual(
      ColdGraftTtyErrors.strayOnTty({ name: "vim", pid: 20, tty: "ttys005" }),
    );
  });
});
