/*
 * `graftTtyProcesses`, the graft itself: a 0.65.2 tab's unattributed login and shell graft into one tree the judge
 * reads as a bare shell, and cmux's read and the process table must agree on which processes the tab holds, what
 * each one is, and which sits under which, or the graft refuses.
 */
import { describe, expect, it } from "vitest";

import type { CmuxProcess } from "../../../../cmux/client.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../live/standing/processes.js";
import { graftTtyProcesses } from "../../../../sessions/coldGraft.js";
import { isPromptShellTree, judgeColdSeat } from "../../../../sessions/coldSeat.js";
import {
  ALL_ON_DISK,
  BARE_SHELL,
  BOUND,
  binding,
  GRAFTED_SHELL,
  LOGIN_SHELL,
  RUNNING_CLAUDE,
  TABLE,
} from "./harness.js";

describe("graftTtyProcesses", () => {
  // The whole failure: `processes: []` plus these two pids read as `no-process`, and `fleet resume`
  // refused the pinned chair and every reopened worker `NO_LIVE_SESSION`.
  it("grafts a 0.65.2 tab's unattributed login and shell into one tree the judge reads as a bare shell", () => {
    const tree = unwrap(graftTtyProcesses({ rows: TABLE, trees: [], ttyPids: [60561, 60562] }));

    expect(tree).toEqual(LOGIN_SHELL);
    expect(
      judgeColdSeat({
        binding: binding({ cwd: "/wt/tab" }),
        liveRecords: [],
        pinnedSessionId: undefined,
        transcriptExists: ALL_ON_DISK,
        tree,
        workspaceCwd: "/wt/seat",
      }),
    ).toEqual({
      argv: `--model opus --resume ${BOUND}`,
      cwd: "/wt/seat",
      kind: "cold",
      mismatch: undefined,
      sessionId: BOUND,
    });
  });

  it("places the shell's own child under it and drops the attributed root that repeats it, so the tab is not a prompt", () => {
    const claude: CmuxProcess = { children: [], name: "2.1.310", pid: 914 };
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/Users/l/.local/bin/claude --resume x", pid: 914, ppid: 60562, state: "S", tty: "ttys003" },
    ];

    const tree = unwrap(graftTtyProcesses({ rows, trees: [claude], ttyPids: [60561, 60562] }));

    expect(tree).toEqual([
      {
        children: [
          { children: [{ children: [], name: "/Users/l/.local/bin/claude", pid: 914 }], name: "-/bin/zsh", pid: 60562 },
        ],
        name: "/usr/bin/login",
        pid: 60561,
      },
    ]);
    expect(isPromptShellTree({ tree })).toBe(false);
  });

  it("keeps an attributed root the table holds but does not place under a tty pid", () => {
    const other: CmuxProcess = { children: [], name: "vim", pid: 7777 };
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "vim", pid: 7777, ppid: 60470, state: "S", tty: "ttys003" },
    ];

    expect(unwrap(graftTtyProcesses({ rows, trees: [other], ttyPids: [60561, 60562] }))).toEqual([
      ...LOGIN_SHELL,
      other,
    ]);
  });

  // A tree the table never confirmed was a tree no second read checked, so an attributed
  // process the table does not hold is refused, listed tty pids or none.
  it("refuses an attributed process the table does not hold, with and without tty pids listed", () => {
    const other: CmuxProcess = { children: [], name: "vim", pid: 7777 };

    expect(unwrapErr(graftTtyProcesses({ rows: TABLE, trees: [other], ttyPids: [60561, 60562] })).message).toBe(
      "process(es) 7777 cmux attributed to the tab are not in the process table read beside it",
    );
    expect(unwrapErr(graftTtyProcesses({ rows: TABLE, trees: RUNNING_CLAUDE, ttyPids: [] })).message).toBe(
      "process(es) 10, 393 cmux attributed to the tab are not in the process table read beside it",
    );
  });

  // `parseProcessRows` drops a row it cannot decode and still answers, so a table missing a tty
  // pid cmux listed could leave `login → shell` alone where a foreground process was — the graft refuses, never guesses.
  it("refuses a table that does not hold every tty pid cmux listed, naming the missing ones", () => {
    expect(unwrapErr(graftTtyProcesses({ rows: TABLE, trees: [], ttyPids: [60561, 60562, 99999] })).message).toBe(
      "tty pid(s) 99999 cmux listed are not in the process table read beside it",
    );
    expect(unwrapErr(graftTtyProcesses({ rows: [], trees: [], ttyPids: [60561, 60562] })).message).toBe(
      "tty pid(s) 60561, 60562 cmux listed are not in the process table read beside it",
    );
  });

  // An attributed root the graft placed was dropped WHOLESALE, so a child only cmux reported
  // under it (a `vim` the table did not hold) vanished and the tab read as a prompt — the graft refuses that too.
  it("refuses an attributed root it placed when cmux reported a process under it the table does not hold", () => {
    const attributed: CmuxProcess = {
      children: [{ children: [{ children: [], name: "vim", pid: 914 }], name: "zsh", pid: 60562 }],
      name: "login",
      pid: 60561,
    };

    expect(unwrapErr(graftTtyProcesses({ rows: TABLE, trees: [attributed], ttyPids: [60561, 60562] })).message).toBe(
      "process(es) 914 cmux attributed to the tab are not in the process table read beside it",
    );
  });

  // A pid is confirmed by membership alone, so a shell's pid reused by `vim`
  // between cmux's read and `ps` confirmed a shell that was gone — the two names must agree on shell-ness.
  it("refuses a pid cmux calls a shell that the table holds as something else, and the reverse", () => {
    const staleShell: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "vim notes.md", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
    ];
    const staleProgram: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: staleShell, trees: BARE_SHELL, ttyPids: [] })).message).toBe(
      "process 10 cmux reports as zsh is vim in the process table read beside it",
    );
    expect(
      unwrapErr(graftTtyProcesses({ rows: staleProgram, trees: [{ children: [], name: "vim", pid: 10 }], ttyPids: [] }))
        .message,
    ).toBe("process 10 cmux reports as vim is -/bin/zsh in the process table read beside it");
  });

  // A `zsh` to cmux and a `bash` to the table were one class, so a pid handed
  // to another shell between the reads confirmed the shell that was gone. Two shells must be the same shell by bare
  // name; a login shell's `-` and its directory are not the name.
  it("refuses a pid cmux calls one shell that the table holds as another, and accepts one shell spelled two ways", () => {
    const otherShell: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/bash", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
    ];
    const sameShell: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: otherShell, trees: BARE_SHELL, ttyPids: [] })).message).toBe(
      "process 10 cmux reports as zsh is -/bin/bash in the process table read beside it",
    );
    expect(unwrap(graftTtyProcesses({ rows: sameShell, trees: BARE_SHELL, ttyPids: [] }))).toEqual(GRAFTED_SHELL);
  });

  // Shell-ness alone let a `login` cmux saw agree with a `vim` the table
  // holds, and the reverse, and the graft rebuilt `login → zsh` as the prompt shape — `login` is its own class.
  it("refuses a pid cmux calls login that the table holds as a program, and the reverse", () => {
    const loginGone: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "vim notes.md", pid: 10, ppid: 0, state: "S", tty: "ttys005" },
      { argv: "/bin/zsh", pid: 11, ppid: 10, state: "S", tty: "ttys005" },
    ];
    const loginArrived: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/usr/bin/login -flp owner /bin/zsh", pid: 100, ppid: 1, state: "S", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 101, ppid: 100, state: "S", tty: "ttys005" },
    ];
    const loginTree: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "zsh", pid: 11 }], name: "/usr/bin/login", pid: 10 },
    ];
    const vimTree: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "zsh", pid: 101 }], name: "vim", pid: 100 },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: loginGone, trees: loginTree, ttyPids: [] })).message).toBe(
      "process 10 cmux reports as /usr/bin/login is vim in the process table read beside it",
    );
    expect(unwrapErr(graftTtyProcesses({ rows: loginArrived, trees: vimTree, ttyPids: [100, 101] })).message).toBe(
      "process 100 cmux reports as vim is /usr/bin/login in the process table read beside it",
    );
  });

  // A cmux-listed shell under the tab's login sat on ANOTHER tty, stopped,
  // and every check keyed on the root's tty walked past it; `login → zsh` rebuilt as the prompt shape. A forest
  // member on a real tty that is not the tab's is refused; one on no tty (a claude's pipe children) is not.
  it("refuses a forest member on another real tty, and accepts one on no tty", () => {
    const listed: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/usr/bin/login", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 11, ppid: 10, state: "T", tty: "ttys006" },
    ];
    const piped: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "claude", pid: 11, ppid: 10, state: "S+", tty: "ttys005" },
      { argv: "/bin/zsh -c ps", pid: 12, ppid: 11, state: "S", tty: "??" },
    ];
    const shellWithClaude: readonly CmuxProcess[] = [
      {
        children: [{ children: [{ children: [], name: "zsh", pid: 12 }], name: "claude", pid: 11 }],
        name: "zsh",
        pid: 10,
      },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: listed, trees: [], ttyPids: [10, 11] })).message).toBe(
      "process 11 in the tab's forest sits on tty ttys006 in the process table read beside it, not the tab's ttys005, so what it runs is unread by the tab's tty",
    );
    expect(unwrap(graftTtyProcesses({ rows: piped, trees: shellWithClaude, ttyPids: [] }))).toEqual([
      {
        children: [{ children: [{ children: [], name: "/bin/zsh", pid: 12 }], name: "claude", pid: 11 }],
        name: "-/bin/zsh",
        pid: 10,
      },
    ]);
  });

  // A program at `/tmp/zsh`, childless and reading its stdin, was a shell to
  // every name-only check and the cold arm typed into it.
  it("refuses a childless shell spelled by bare name or from outside the system shell directories", () => {
    const planted: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/tmp/zsh", pid: 10, ppid: 60470, state: "S+", tty: "ttys005" },
    ];
    const bare: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
    ];
    // MEASURED: a script filename beginning with a newline reaches the table as `\012` on the shell's own
    // row, a second word, so the shell is refused off its argv.
    const newlineScript: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/bin/zsh \\01220 999 ?? S fake", pid: 10, ppid: 60470, state: "S+", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: planted, trees: BARE_SHELL, ttyPids: [] })).message).toBe(
      'process 10 on the tab\'s tty ttys005 is a shell started as "/tmp/zsh" in the process table read beside it, by bare name or from outside the system shell directories, not the shell cmux starts a tab on',
    );
    expect(unwrapErr(graftTtyProcesses({ rows: bare, trees: BARE_SHELL, ttyPids: [] })).code).toBe(
      "SHELL_OFF_SYSTEM_PATH",
    );
    expect(unwrapErr(graftTtyProcesses({ rows: newlineScript, trees: [], ttyPids: [10] })).code).toBe(
      "SHELL_RUNS_SCRIPT",
    );
  });

  // A program at `/tmp/login` that forked a real `/bin/zsh -i` and kept reading
  // the tty was a `login` to every name-only check, and `login → zsh` rebuilt as the prompt shape.
  it("refuses a login on the tab's tty that is not /usr/bin/login", () => {
    const planted: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/tmp/login", pid: 10, ppid: 60470, state: "S+", tty: "ttys005" },
      { argv: "/bin/zsh -i", pid: 11, ppid: 10, state: "S+", tty: "ttys005" },
    ];
    const system: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/usr/bin/login -flp ada /bin/zsh", pid: 10, ppid: 60470, state: "Ss", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 11, ppid: 10, state: "S+", tty: "ttys005" },
    ];
    const loginShell: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "zsh", pid: 11 }], name: "login", pid: 10 },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows: planted, trees: loginShell, ttyPids: [] })).message).toBe(
      'process 10 on the tab\'s tty ttys005 is a login started as "/tmp/login" in the process table read beside it, not /usr/bin/login, the one that hands a tab to its shell',
    );
    expect(unwrap(graftTtyProcesses({ rows: system, trees: loginShell, ttyPids: [] }))).toEqual([
      { children: [{ children: [], name: "-/bin/zsh", pid: 11 }], name: "/usr/bin/login", pid: 10 },
    ]);
  });

  // cmux's tree showed a childless shell while `ps` already held a `vim` under it,
  // and the childless shell read as a prompt — the table's children are unioned in, so either read's child counts.
  it("adds the children the table shows under an attributed shell that cmux omitted, so the tab is not a prompt", () => {
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "vim notes.md", pid: 11, ppid: 10, state: "S", tty: "ttys005" },
    ];

    const tree = unwrap(graftTtyProcesses({ rows, trees: BARE_SHELL, ttyPids: [] }));

    expect(tree).toEqual([{ children: [{ children: [], name: "vim", pid: 11 }], name: "-/bin/zsh", pid: 10 }]);
    expect(isPromptShellTree({ tree })).toBe(false);
  });

  // A newline inside one argv split into a second row for a pid already listed, and
  // a last-row-wins map let the forged row hide the real one — a table listing a pid twice is refused.
  it("refuses a table that lists one pid twice", () => {
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "vim notes.md", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows, trees: BARE_SHELL, ttyPids: [] })).message).toBe(
      "the process table read beside the tab lists pid 10 more than once",
    );
  });

  // A reply in which cmux repeats the login's pid under the shell, or
  // lists the shell's pid twice, would have the repeat dropped by the walk's `seen` set, rebuilding login → childless
  // shell, the prompt shape, over a child cmux showed.
  it("refuses a reply in which cmux reports one pid for the tab twice, rather than dropping the repeat", () => {
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/usr/bin/login", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 11, ppid: 10, state: "S", tty: "ttys005" },
    ];
    const loginUnderShell: readonly CmuxProcess[] = [
      {
        children: [{ children: [{ children: [], name: "/usr/bin/login", pid: 10 }], name: "-/bin/zsh", pid: 11 }],
        name: "/usr/bin/login",
        pid: 10,
      },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows, trees: loginUnderShell, ttyPids: [] })).message).toBe(
      "cmux attributed pid 10 to the tab more than once",
    );
    expect(unwrapErr(graftTtyProcesses({ rows, trees: [], ttyPids: [10, 11, 11] })).message).toBe(
      "cmux listed tty pid 11 for the tab more than once",
    );
  });

  // cmux showed the login UNDER the shell, the table the shell under the login; the
  // graft read parentage off the table alone and rebuilt login → childless shell, discarding the child cmux reported.
  it("refuses a child cmux shows under one parent that the table shows under another", () => {
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/usr/bin/login", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 11, ppid: 10, state: "S", tty: "ttys005" },
    ];
    const inverted: readonly CmuxProcess[] = [
      { children: [{ children: [], name: "login", pid: 10 }], name: "zsh", pid: 11 },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows, trees: inverted, ttyPids: [10, 11] })).message).toBe(
      "process 10 cmux shows under 11 is under 60470 in the process table read beside it",
    );
  });

  // cmux showed the vim BESIDE the shell, the table under it; the graft placed it
  // under the shell off the table and kept it as a root too, so one pid sat in the tree twice.
  it("refuses a root cmux shows beside another attributed process that the table puts under it", () => {
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "vim notes.md", pid: 12, ppid: 10, state: "S", tty: "ttys005" },
    ];
    const viaHelper: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "helper", pid: 11, ppid: 10, state: "S", tty: "ttys005" },
      { argv: "vim notes.md", pid: 12, ppid: 11, state: "S", tty: "ttys005" },
    ];
    const beside: readonly CmuxProcess[] = [
      { children: [], name: "zsh", pid: 10 },
      { children: [], name: "vim", pid: 12 },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows, trees: beside, ttyPids: [] })).message).toBe(
      "process 12 cmux shows as a root of the tab is under 10 in the process table read beside it",
    );
    expect(unwrapErr(graftTtyProcesses({ rows: viaHelper, trees: beside, ttyPids: [] })).message).toBe(
      "process 12 cmux shows as a root of the tab is under 10 in the process table read beside it",
    );
  });

  // A listed shell two table rows under the listed login was rooted beside it and
  // so placed twice, once under the login's walk and once as its own root.
  it("roots a listed pid once when another listed pid is above it in the table, however many rows between", () => {
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "/usr/bin/login", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "helper", pid: 11, ppid: 10, state: "S", tty: "ttys005" },
      { argv: "/bin/zsh", pid: 12, ppid: 11, state: "S", tty: "ttys005" },
    ];
    const shell: readonly CmuxProcess[] = [{ children: [], name: "zsh", pid: 12 }];

    const tree = unwrap(graftTtyProcesses({ rows, trees: shell, ttyPids: [12, 10] }));

    expect(tree).toEqual([
      {
        children: [{ children: [{ children: [], name: "/bin/zsh", pid: 12 }], name: "helper", pid: 11 }],
        name: "/usr/bin/login",
        pid: 10,
      },
    ]);
    expect(isPromptShellTree({ tree })).toBe(false);
  });

  // A shell cmux attributed as a lone root, the table under a `vim` cmux neither
  // listed nor attributed, rebuilt as the prompt shape.
  it("refuses a root whose table parent is not the cmux app, so a shell under an unreported program is never a prompt", () => {
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "vim notes.md", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "-/bin/zsh", pid: 11, ppid: 10, state: "S", tty: "ttys005" },
    ];

    expect(
      unwrapErr(graftTtyProcesses({ rows, trees: [{ children: [], name: "zsh", pid: 11 }], ttyPids: [] })).message,
    ).toBe(
      "process 11 cmux shows as a root of the tab is under 10 in the process table read beside it, which is not the cmux app that owns the tab",
    );
  });
});
