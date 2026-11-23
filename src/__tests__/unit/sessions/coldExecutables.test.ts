/**
 * `executablesAgree`: each shell and `login` in a grafted forest must run the system image its argv names, read off
 * `lsof` after the graft, since the argv is the process's own word for itself.
 */
import { describe, expect, it } from "vitest";

import type { CmuxProcess } from "../../../cmux/client.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { TtyProcessRow } from "../../../live/standing/processes.js";
import { ColdGraftExecutableErrors } from "../../../sessions/coldExecutableErrors.js";
import {
  executablePids,
  executablesAgree,
  foregroundAgrees,
  forestChanged,
  graftChanged,
  promptShellPids,
  tabPlacement,
  tabTty,
  ttyHoldersAgree,
} from "../../../sessions/coldExecutables.js";
import { ColdGraftErrors } from "../../../sessions/coldGraftErrors.js";

/** The measured 0.65.2 prompt shape, grafted: the login over the shell. */
const LOGIN_OVER_SHELL: readonly CmuxProcess[] = [
  { children: [{ children: [], name: "-/bin/zsh", pid: 60562 }], name: "/usr/bin/login", pid: 60561 },
];
/** A shell running a program that itself forks a shell: only the shells and the login are read. */
const SHELL_OVER_PROGRAM: readonly CmuxProcess[] = [
  {
    children: [{ children: [{ children: [], name: "/bin/zsh", pid: 9 }], name: "claude", pid: 8 }],
    name: "-/bin/zsh",
    pid: 7,
  },
];

describe("executablePids", () => {
  // MEASURED on a real bare tab: `login` is root's, `lsof -p 40159,40171` as the owner printed the
  // shell's block alone and exited 1, and `-p 40171` exited 0. Asked for, the login refused every real tab.
  it("names each shell in pre-order, never a login nor a program", () => {
    expect([executablePids({ tree: LOGIN_OVER_SHELL }), executablePids({ tree: SHELL_OVER_PROGRAM })]).toEqual([
      [60562],
      [7, 9],
    ]);
  });
});

describe("executablesAgree", () => {
  it("accepts a shell in a system shell directory under a login the read holds nothing for", () => {
    const executables = new Map([[60562, "/bin/zsh"]]);

    expect(executablesAgree({ executables, tree: LOGIN_OVER_SHELL })).toBeUndefined();
  });

  // MEASURED: `/bin/sleep` spawned with `argv0: "/bin/zsh"` lists as `/bin/zsh` in `ps -o args=` and
  // `ps -o comm=` alike; `lsof` lists `/bin/sleep` as its first txt file.
  it("refuses a shell whose image is outside the system shell directories, however its argv is spelled", () => {
    const executables = new Map([[60562, "/tmp/zsh"]]);

    expect(executablesAgree({ executables, tree: LOGIN_OVER_SHELL })).toEqual(
      ColdGraftErrors.executableOffSystemPath({ name: "-/bin/zsh", path: "/tmp/zsh", pid: 60562 }),
    );
    expect(executablesAgree({ executables, tree: LOGIN_OVER_SHELL })).toEqual({
      code: "EXECUTABLE_OFF_SYSTEM_PATH",
      message:
        'process 60562 (-/bin/zsh) in the tab\'s forest runs "/tmp/zsh", the image lsof lists for it, not the system shell its argv names',
      name: "-/bin/zsh",
      path: "/tmp/zsh",
      pid: 60562,
    });
  });

  it("refuses a shell image that is a program at a system path, or any path but the one the argv spells", () => {
    const sleepAtBin = new Map([[60562, "/bin/sleep"]]);
    // A system shell that is not the one the argv spells.
    const bashAsZsh = new Map([[60562, "/bin/bash"]]);
    // The same bare name in another system shell directory.
    const localZsh = new Map([[60562, "/usr/local/bin/zsh"]]);

    expect([
      executablesAgree({ executables: sleepAtBin, tree: LOGIN_OVER_SHELL }),
      executablesAgree({ executables: bashAsZsh, tree: LOGIN_OVER_SHELL }),
      executablesAgree({ executables: localZsh, tree: LOGIN_OVER_SHELL }),
    ]).toEqual([
      ColdGraftExecutableErrors.executableOffSystemPath({ name: "-/bin/zsh", path: "/bin/sleep", pid: 60562 }),
      ColdGraftExecutableErrors.executableOffSystemPath({ name: "-/bin/zsh", path: "/bin/bash", pid: 60562 }),
      ColdGraftExecutableErrors.executableOffSystemPath({ name: "-/bin/zsh", path: "/usr/local/bin/zsh", pid: 60562 }),
    ]);
  });

  it("refuses a shell the read holds no image for, naming the first in pre-order", () => {
    const loginOnly = new Map([[60561, "/usr/bin/login"]]);

    expect(executablesAgree({ executables: loginOnly, tree: LOGIN_OVER_SHELL })).toEqual({
      code: "EXECUTABLE_UNREAD",
      message:
        "process 60562 (-/bin/zsh) in the tab's forest has no executable in the lsof read beside it, so what it runs is unconfirmed",
      name: "-/bin/zsh",
      pid: 60562,
    });
  });

  it("reads the shells under a program too, and accepts them at system paths", () => {
    const executables = new Map([
      [7, "/bin/zsh"],
      [9, "/bin/zsh"],
    ]);

    expect(executablesAgree({ executables, tree: SHELL_OVER_PROGRAM })).toBeUndefined();
  });
});

describe("tabTty", () => {
  const rows: readonly TtyProcessRow[] = [
    { argv: "/usr/bin/login", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
    { argv: "-/bin/zsh", pid: 60562, ppid: 60561, state: "S", tty: "ttys003" },
  ];

  it("names the tty the forest's first root sits on in the table", () => {
    expect(unwrap(tabTty({ rows, tree: LOGIN_OVER_SHELL }))).toBe("ttys003");
  });

  it("refuses an empty forest and a root the table does not hold", () => {
    expect([unwrapErr(tabTty({ rows, tree: [] })), unwrapErr(tabTty({ rows: [], tree: LOGIN_OVER_SHELL }))]).toEqual([
      ColdGraftErrors.tabTtyUnknown(),
      ColdGraftErrors.tabTtyUnknown(),
    ]);
  });
});

describe("ttyHoldersAgree", () => {
  // MEASURED: a bare tab's tty is held by its shell alone, on fds 0, 1, 2, 10 and 14; the login holds
  // no descriptor on it.
  it("accepts the shell alone holding the tty with fd 0 among its descriptors", () => {
    const shellAlone = new Map([[60562, [0, 1, 2, 10, 14]]]);
    const stdinAlone = new Map([[60562, [0]]]);

    expect([
      ttyHoldersAgree({ holders: shellAlone, tree: LOGIN_OVER_SHELL, tty: "ttys003" }),
      ttyHoldersAgree({ holders: stdinAlone, tree: LOGIN_OVER_SHELL, tty: "ttys003" }),
    ]).toEqual([undefined, undefined]);
  });

  // The login is root's process, so its image cannot be read; this is the check that stands in for it (a
  // /tmp/login that forks a real shell and keeps reading the tty holds fd 0 on it).
  it("refuses a login that holds the tty on any descriptor, naming them", () => {
    const loginReads = new Map([
      [60561, [0]],
      [60562, [0, 1, 2]],
    ]);

    expect(ttyHoldersAgree({ holders: loginReads, tree: LOGIN_OVER_SHELL, tty: "ttys003" })).toEqual({
      code: "LOGIN_HOLDS_TTY",
      fds: [0],
      message:
        "process 60561 (/usr/bin/login), the tab's login, holds the tab's tty ttys003 on descriptor(s) [0] in the lsof read beside it, where a real login hands the tty to its shell and keeps none, so it could read a typed line",
      name: "/usr/bin/login",
      pid: 60561,
      tty: "ttys003",
    });
  });

  // A setsid'd helper on no controlling tty keeping fd 0 on the tab's tty.
  it("refuses the first holder outside the forest, naming it and the tty", () => {
    const helper = new Map([
      [60562, [0, 1, 2]],
      [60700, [0]],
      [60701, [0]],
    ]);

    expect(ttyHoldersAgree({ holders: helper, tree: LOGIN_OVER_SHELL, tty: "ttys003" })).toEqual({
      code: "TTY_HELD_OUTSIDE_FOREST",
      message:
        "process 60700 holds the tab's tty ttys003 open in the lsof read beside it and is outside the tab's forest, so a typed line could reach it",
      pid: 60700,
      tty: "ttys003",
    });
  });

  // Second shape: `exec /bin/zsh -i </tmp/feed` keeps fds 1 and 2 on the tty and reads
  // its commands from the FIFO, so a typed line queues on the tty and reaches no reader.
  it("refuses a prompt shell that holds the tty on anything but its stdin, and one holding it on nothing", () => {
    const stdoutOnly = new Map([[60562, [1, 2]]]);
    const nothing = new Map<number, readonly number[]>();

    expect([
      ttyHoldersAgree({ holders: stdoutOnly, tree: LOGIN_OVER_SHELL, tty: "ttys003" }),
      ttyHoldersAgree({ holders: nothing, tree: LOGIN_OVER_SHELL, tty: "ttys003" }),
    ]).toEqual([
      {
        code: "SHELL_STDIN_OFF_TTY",
        fds: [1, 2],
        message:
          "process 60562 (-/bin/zsh) at the tab's prompt shape holds the tab's tty ttys003 on descriptor(s) [1, 2] in the lsof read beside it, not on its stdin, so it reads its commands from somewhere else and a typed line would reach no reader",
        name: "-/bin/zsh",
        pid: 60562,
        tty: "ttys003",
      },
      ColdGraftExecutableErrors.shellStdinOffTty({ fds: [], name: "-/bin/zsh", pid: 60562, tty: "ttys003" }),
    ]);
  });

  it("asks fd 0 only of the shells reached through shells and logins, never of one under a program", () => {
    const pipeShells = new Map([[7, [0, 1, 2]]]);

    expect(ttyHoldersAgree({ holders: pipeShells, tree: SHELL_OVER_PROGRAM, tty: "ttys003" })).toBeUndefined();
  });
});

describe("foregroundAgrees", () => {
  // MEASURED on a bare tab: the shell is its own group leader and that group is the tty's foreground
  // (`40171 40171 40171`); its login sits in a group of its own with the shell's as the foreground.
  it("accepts a prompt shell whose group is its tty's foreground group, the login's own group aside", () => {
    const measured = new Map([
      [60561, { pgid: 60561, tpgid: 60562 }],
      [60562, { pgid: 60562, tpgid: 60562 }],
    ]);

    expect([
      promptShellPids({ tree: LOGIN_OVER_SHELL }),
      foregroundAgrees({ groups: measured, tree: LOGIN_OVER_SHELL, tty: "ttys003" }),
    ]).toEqual([[60562], undefined]);
  });

  // A helper that ignored SIGTTOU, tcsetpgrp'd the tty to the login's group and exited.
  it("refuses a prompt shell in a background group, naming both groups, and one the read holds no group for", () => {
    const background = new Map([[60562, { pgid: 60562, tpgid: 60561 }]]);
    const unread = new Map([[60561, { pgid: 60561, tpgid: 60561 }]]);

    expect([
      foregroundAgrees({ groups: background, tree: LOGIN_OVER_SHELL, tty: "ttys003" }),
      foregroundAgrees({ groups: unread, tree: LOGIN_OVER_SHELL, tty: "ttys003" }),
    ]).toEqual([
      {
        code: "SHELL_NOT_FOREGROUND",
        message:
          "process 60562 (-/bin/zsh) at the tab's prompt shape is in process group 60562 while the tab's tty ttys003 has foreground group 60561 in the ps read beside it, so a line typed there would stop it with SIGTTIN and reach no prompt",
        name: "-/bin/zsh",
        pgid: 60562,
        pid: 60562,
        tpgid: 60561,
        tty: "ttys003",
      },
      ColdGraftExecutableErrors.groupUnread({ name: "-/bin/zsh", pid: 60562 }),
    ]);
  });

  it("asks the group only of the shells reached through shells and logins, never of one under a program", () => {
    expect([
      promptShellPids({ tree: SHELL_OVER_PROGRAM }),
      foregroundAgrees({ groups: new Map(), tree: SHELL_OVER_PROGRAM, tty: "ttys003" }),
    ]).toEqual([[], undefined]);
  });
});

describe("forestChanged", () => {
  it("accepts the same forest read twice, by value", () => {
    const again: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "-/bin/zsh", pid: 60562 }], name: "/usr/bin/login", pid: 60561 },
    ];

    expect(forestChanged({ after: again, before: LOGIN_OVER_SHELL })).toBeUndefined();
  });

  // A vim forked between the table read and the lsof read.
  it("refuses a child the second read holds that the first did not, naming both forests", () => {
    const withVim: readonly CmuxProcess[] = [
      {
        children: [{ children: [{ children: [], name: "vim notes.md", pid: 60600 }], name: "-/bin/zsh", pid: 60562 }],
        name: "/usr/bin/login",
        pid: 60561,
      },
    ];

    expect(forestChanged({ after: withVim, before: LOGIN_OVER_SHELL })).toEqual({
      after: ["d0 60561 /usr/bin/login", "d1 60562 -/bin/zsh", "d2 60600 vim notes.md"],
      before: ["d0 60561 /usr/bin/login", "d1 60562 -/bin/zsh"],
      code: "FOREST_CHANGED",
      message:
        "the tab's forest read after lsof is [d0 60561 /usr/bin/login, d1 60562 -/bin/zsh, d2 60600 vim notes.md] where the one read before it was [d0 60561 /usr/bin/login, d1 60562 -/bin/zsh], so a process started, ended or changed between the two reads",
    });
  });

  it("refuses a renamed process, a reused pid and a re-parented one, each with the same pids as before", () => {
    const renamed: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "-/bin/bash", pid: 60562 }], name: "/usr/bin/login", pid: 60561 },
    ];
    const reused: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "-/bin/zsh", pid: 60563 }], name: "/usr/bin/login", pid: 60561 },
    ];
    const beside: readonly CmuxProcess[] = [
      { children: [], name: "/usr/bin/login", pid: 60561 },
      { children: [], name: "-/bin/zsh", pid: 60562 },
    ];

    const before = ["d0 60561 /usr/bin/login", "d1 60562 -/bin/zsh"];

    expect([renamed, reused, beside].map((after) => forestChanged({ after, before: LOGIN_OVER_SHELL }))).toEqual([
      ColdGraftExecutableErrors.forestChanged({ after: ["d0 60561 /usr/bin/login", "d1 60562 -/bin/bash"], before }),
      ColdGraftExecutableErrors.forestChanged({ after: ["d0 60561 /usr/bin/login", "d1 60563 -/bin/zsh"], before }),
      ColdGraftExecutableErrors.forestChanged({ after: ["d0 60561 /usr/bin/login", "d0 60562 -/bin/zsh"], before }),
    ]);
  });
});

/** The table the login-over-shell forest was grafted from, under cmux app 60470. */
const LOGIN_ROWS: readonly TtyProcessRow[] = [
  { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
  { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 60561, ppid: 60470, state: "Ss", tty: "ttys003" },
  { argv: "-/bin/zsh", pid: 60562, ppid: 60561, state: "S+", tty: "ttys003" },
];

describe("tabPlacement", () => {
  it("labels each forest pid the table holds with its parent, tty and argv, and skips one it does not", () => {
    const missingShell = LOGIN_ROWS.filter((row) => row.pid !== 60562);

    expect([
      [...tabPlacement({ rows: LOGIN_ROWS, tree: LOGIN_OVER_SHELL })],
      [...tabPlacement({ rows: missingShell, tree: LOGIN_OVER_SHELL })],
    ]).toEqual([
      [
        [60561, 'under 60470 on ttys003 as "/usr/bin/login -flp ada /bin/zsh"'],
        [60562, 'under 60561 on ttys003 as "-/bin/zsh"'],
      ],
      [[60561, 'under 60470 on ttys003 as "/usr/bin/login -flp ada /bin/zsh"']],
    ]);
  });
});

describe("graftChanged", () => {
  const placed = tabPlacement({ rows: LOGIN_ROWS, tree: LOGIN_OVER_SHELL });

  it("accepts the same forest on the same tty with the same placement read twice, the state aside", () => {
    const again = tabPlacement({
      rows: LOGIN_ROWS.map((row) => (row.pid === 60562 ? { ...row, state: "S" } : row)),
      tree: LOGIN_OVER_SHELL,
    });

    expect(
      graftChanged({
        after: { placement: again, tree: LOGIN_OVER_SHELL, tty: "ttys003" },
        before: { placement: placed, tree: LOGIN_OVER_SHELL, tty: "ttys003" },
      }),
    ).toBeUndefined();
  });

  // The identical forest on the identical tty, its root under another cmux app row in
  // the second read.
  it("refuses a forest pid the second read places under another parent, naming both placements", () => {
    const otherApp = tabPlacement({
      rows: LOGIN_ROWS.map((row) => (row.pid === 60561 ? { ...row, ppid: 70000 } : row)),
      tree: LOGIN_OVER_SHELL,
    });
    const unplaced = new Map([...placed].filter(([pid]) => pid !== 60562));

    expect([
      graftChanged({
        after: { placement: otherApp, tree: LOGIN_OVER_SHELL, tty: "ttys003" },
        before: { placement: placed, tree: LOGIN_OVER_SHELL, tty: "ttys003" },
      }),
      graftChanged({
        after: { placement: unplaced, tree: LOGIN_OVER_SHELL, tty: "ttys003" },
        before: { placement: placed, tree: LOGIN_OVER_SHELL, tty: "ttys003" },
      })?.code,
    ]).toEqual([
      {
        after: 'under 70000 on ttys003 as "/usr/bin/login -flp ada /bin/zsh"',
        before: 'under 60470 on ttys003 as "/usr/bin/login -flp ada /bin/zsh"',
        code: "PLACEMENT_CHANGED",
        message:
          'process 60561 in the tab\'s forest is under 70000 on ttys003 as "/usr/bin/login -flp ada /bin/zsh" in the table read after lsof where it was under 60470 on ttys003 as "/usr/bin/login -flp ada /bin/zsh" in the one read before it, so the two reads disagree about where it sits',
        pid: 60561,
      },
      "PLACEMENT_CHANGED",
    ]);
  });

  // The identical forest, moved to another tty between the two table reads.
  it("refuses the same forest on another tty, naming both, and a changed forest on its forest first", () => {
    const moved = graftChanged({
      after: { placement: placed, tree: LOGIN_OVER_SHELL, tty: "ttys004" },
      before: { placement: placed, tree: LOGIN_OVER_SHELL, tty: "ttys003" },
    });
    const grown = graftChanged({
      after: { placement: placed, tree: SHELL_OVER_PROGRAM, tty: "ttys004" },
      before: { placement: placed, tree: LOGIN_OVER_SHELL, tty: "ttys003" },
    });

    expect([moved, grown?.code]).toEqual([
      {
        after: "ttys004",
        before: "ttys003",
        code: "TAB_TTY_CHANGED",
        message:
          "the tab's forest read after lsof is on tty ttys004 where the one read before it was on ttys003, so the holders read covered a tty the tab is no longer on",
      },
      "FOREST_CHANGED",
    ]);
  });
});
