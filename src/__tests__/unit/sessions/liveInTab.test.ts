/**
 * `liveSessionsInTab`: a tab running a live Claude session reads live on the session's own pid, whatever the shell
 * forest around it looks like. Each shape below is one the graft refused on a live seat, MEASURED
 * (`$SLOPWEAVER_HOME/fleet/resume.jsonl`, and the handover
 * `fleet-resume-misreads-eight-live-seats-as-bare-shells-on-defunct-children-and-tty-mismatch`). The doc carries the pids and the refusals, not the whole `ps` table, so each table here is the minimal one
 * encoding that measured relationship rather than a verbatim copy.
 */
import { describe, expect, it } from "vitest";

import type { CmuxProcess } from "../../../cmux/client.js";
import { unwrapErr } from "../../../lib/result.js";
import type { TtyProcessRow } from "../../../live/standing/processes.js";
import { graftTtyProcesses } from "../../../sessions/coldGraft.js";
import {
  liveSessionsInTab,
  liveSessionsTouchingTab,
  pidInTab,
  reportedTabPids,
  type TabReport,
} from "../../../sessions/liveInTab.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";

const APP: TtyProcessRow = {
  argv: "/Applications/cmux.app/Contents/MacOS/cmux",
  pid: 900,
  ppid: 1,
  state: "S",
  tty: "??",
};
const LOGIN: TtyProcessRow = {
  argv: "/usr/bin/login -flp ada /bin/zsh",
  pid: 901,
  ppid: 900,
  state: "Ss",
  tty: "ttys004",
};
const ZSH: TtyProcessRow = { argv: "-/bin/zsh", pid: 902, ppid: 901, state: "S", tty: "ttys004" };
const CLAUDE: TtyProcessRow = { argv: "claude", pid: 4242, ppid: 902, state: "S+", tty: "ttys004" };

/** The seat's session, live, on the `claude` above. */
const SEAT: SessionRecord = {
  cwd: "/w/seat",
  entrypoint: "cli",
  kind: "interactive",
  name: "seat",
  pid: 4242,
  sessionId: "a0000096-0000-4000-8000-000000000103",
  startedAtMs: 0,
  status: "idle",
};

/** The tab as cmux attributes it while the seat runs: its shell, with the session under it. */
const ATTRIBUTED: readonly CmuxProcess[] = [
  { children: [{ children: [], name: "claude", pid: 4242 }], name: "zsh", pid: 902 },
];

/**
 * What cmux reported for a one-surface tab, the tab's `login` listed beside the trees unless a case names other tty
 * pids, and no surface tty unless a case names one.
 */
function report({
  trees,
  ttyPids = [901],
  ttys = [],
  surfaces = 1,
}: {
  trees: readonly CmuxProcess[];
  ttyPids?: readonly number[];
  ttys?: readonly string[];
  surfaces?: number;
}): TabReport {
  return { surfaces, trees, ttys, unattributedTtyPids: ttyPids };
}

describe("liveSessionsInTab — a tab cmux attributed no pid to is tied by its own tty", () => {
  // MEASURED: cmux reported neither
  // a tree nor a tty pid for workspace:1000030980 while its claude, pid 56608, ran on the tab's `ttys001`.
  const nothing = { trees: [], ttyPids: [] };

  it("reads the live session whose own pid the table puts on the tab's one tty", () => {
    expect(
      liveSessionsInTab({
        liveRecords: [SEAT],
        report: report({ ...nothing, ttys: ["ttys004"] }),
        rows: [APP, LOGIN, ZSH, CLAUDE],
      }),
    ).toEqual([SEAT]);
  });

  it("reads nothing when the session sits on another tty, no tty was sent, or the tab pools two surfaces", () => {
    const rows = [APP, LOGIN, ZSH, CLAUDE];
    expect([
      liveSessionsInTab({ liveRecords: [SEAT], report: report({ ...nothing, ttys: ["ttys005"] }), rows }),
      liveSessionsInTab({ liveRecords: [SEAT], report: report({ ...nothing }), rows }),
      liveSessionsInTab({
        liveRecords: [SEAT],
        report: report({ ...nothing, surfaces: 2, ttys: ["ttys004", "ttys005"] }),
        rows,
      }),
      liveSessionsInTab({ liveRecords: [SEAT], report: report({ ...nothing, surfaces: 2, ttys: ["ttys004"] }), rows }),
    ]).toEqual([[], [], [], []]);
  });

  it("names every live session on the tty, so the caller that stops one can refuse two", () => {
    const second: SessionRecord = { ...SEAT, pid: 4243, sessionId: "a0000074-0000-4000-8000-000000000080" };
    const rows = [APP, LOGIN, ZSH, CLAUDE, { ...CLAUDE, pid: 4243 }];

    expect(
      liveSessionsInTab({ liveRecords: [SEAT, second], report: report({ ...nothing, ttys: ["ttys004"] }), rows }),
    ).toEqual([SEAT, second]);
  });

  it("never reads the tty while cmux reports any pid: a same-tty session outside the reported forest stays out", () => {
    const rows = [APP, LOGIN, { ...ZSH, ppid: 1 }, CLAUDE];

    expect(
      liveSessionsInTab({
        liveRecords: [SEAT],
        report: report({ trees: [], ttyPids: [901], ttys: ["ttys004"] }),
        rows,
      }),
    ).toEqual([]);
  });

  it("is what liveSessionsTouchingTab reads too, and pidInTab never does", () => {
    const tied = report({ ...nothing, ttys: ["ttys004"] });

    expect(liveSessionsTouchingTab({ liveRecords: [SEAT], report: tied, rows: [APP, LOGIN, ZSH, CLAUDE] })).toEqual([
      SEAT,
    ]);
    expect(pidInTab({ pid: 4242, report: tied, rows: [APP, LOGIN, ZSH, CLAUDE] })).toBe(false);
  });
});

describe("liveSessionsInTab — every shape the graft refused on a live seat reads live", () => {
  it("a defunct `Z+` child on the tab's tty, which cmux does not list", () => {
    const zombie: TtyProcessRow = { argv: "(git)", pid: 4300, ppid: 4242, state: "Z+", tty: "ttys004" };

    expect(
      liveSessionsInTab({
        liveRecords: [SEAT],
        report: report({ trees: ATTRIBUTED }),
        rows: [APP, LOGIN, ZSH, CLAUDE, zombie],
      }),
    ).toEqual([SEAT]);
  });

  it("the session on `tty ??`, not the tab's tty (workspace:1000010044, pid 11874)", () => {
    const rows = [APP, LOGIN, ZSH, { ...CLAUDE, tty: "??" }];

    expect(unwrapErr(graftTtyProcesses({ rows, trees: ATTRIBUTED, ttyPids: [901] })).code).toBe("PLACED_ON_OTHER_TTY");
    expect(liveSessionsInTab({ liveRecords: [SEAT], report: report({ trees: ATTRIBUTED }), rows })).toEqual([SEAT]);
  });

  it("a hook's `/bin/sh` where cmux last saw a `bash`", () => {
    const trees: readonly CmuxProcess[] = [
      {
        children: [{ children: [{ children: [], name: "bash", pid: 4400 }], name: "claude", pid: 4242 }],
        name: "zsh",
        pid: 902,
      },
    ];
    const rows = [
      APP,
      LOGIN,
      ZSH,
      CLAUDE,
      { argv: "/bin/sh -c hook", pid: 4400, ppid: 4242, state: "S+", tty: "ttys004" },
    ];

    expect(unwrapErr(graftTtyProcesses({ rows, trees, ttyPids: [901] })).code).toBe("PID_RENAMED");
    expect(liveSessionsInTab({ liveRecords: [SEAT], report: report({ trees }), rows })).toEqual([SEAT]);
  });

  it("a shell rooted under pid 1, not under the cmux app", () => {
    const rows = [APP, { ...ZSH, ppid: 1 }, CLAUDE];

    expect(unwrapErr(graftTtyProcesses({ rows, trees: ATTRIBUTED, ttyPids: [] })).code).toBe("ROOT_NOT_UNDER_APP");
    expect(
      liveSessionsInTab({ liveRecords: [SEAT], report: report({ trees: ATTRIBUTED, ttyPids: [] }), rows }),
    ).toEqual([SEAT]);
  });

  it("the shell outside the tty's foreground group, which Claude holds (workspace:1000010043): no group is read", () => {
    // The group pair is not an input here at all, so the SIGTTIN shape cannot reach this answer; the reseat-level
    // case in `cmux/reseatPass/coldResumeWorkspace.test.ts` proves the group read is never made for a live tab.
    expect(
      liveSessionsInTab({
        liveRecords: [SEAT],
        report: report({ trees: ATTRIBUTED }),
        rows: [APP, LOGIN, ZSH, CLAUDE],
      }),
    ).toEqual([SEAT]);
  });

  it("the shell mid-exec, printed `(zsh)` where cmux names `zsh`", () => {
    const rows = [APP, LOGIN, { ...ZSH, argv: "(zsh)" }, CLAUDE];

    expect(unwrapErr(graftTtyProcesses({ rows, trees: ATTRIBUTED, ttyPids: [901] })).code).toBe("PID_RENAMED");
    expect(liveSessionsInTab({ liveRecords: [SEAT], report: report({ trees: ATTRIBUTED }), rows })).toEqual([SEAT]);
  });

  it("a pid cmux attributes that the table does not hold (workspace:1000010018, pid 17350)", () => {
    const rows = [APP, LOGIN, ZSH];

    expect(unwrapErr(graftTtyProcesses({ rows, trees: ATTRIBUTED, ttyPids: [901] })).code).toBe("ATTRIBUTED_MISSING");
    expect(liveSessionsInTab({ liveRecords: [SEAT], report: report({ trees: ATTRIBUTED }), rows })).toEqual([SEAT]);
  });

  it("cmux attributing nothing, listing only the tab's login and shell: the session reaches them through the table", () => {
    expect(
      liveSessionsInTab({
        liveRecords: [SEAT],
        report: report({ trees: [], ttyPids: [901, 902] }),
        rows: [APP, LOGIN, ZSH, CLAUDE],
      }),
    ).toEqual([SEAT]);
  });
});

describe("liveSessionsInTab — what never reads live", () => {
  it("a bare shell with no live session in it", () => {
    expect(
      liveSessionsInTab({
        liveRecords: [],
        report: report({ trees: [], ttyPids: [901, 902] }),
        rows: [APP, LOGIN, ZSH],
      }),
    ).toEqual([]);
  });

  it("a live session in ANOTHER tab's forest", () => {
    const otherShell: TtyProcessRow = { argv: "-/bin/zsh", pid: 952, ppid: 900, state: "S", tty: "ttys005" };
    const elsewhere: SessionRecord = { ...SEAT, pid: 5151 };
    const rows = [APP, LOGIN, ZSH, otherShell, { ...CLAUDE, pid: 5151, ppid: 952, tty: "ttys005" }];

    expect(
      liveSessionsInTab({ liveRecords: [elsewhere], report: report({ trees: [], ttyPids: [901, 902] }), rows }),
    ).toEqual([]);
  });

  it("a tab cmux reported nothing for, even with this tab's session live in its directory", () => {
    expect(
      liveSessionsInTab({
        liveRecords: [SEAT],
        report: report({ trees: [], ttyPids: [] }),
        rows: [APP, LOGIN, ZSH, CLAUDE],
      }),
    ).toEqual([]);
  });

  it("a table whose parent column loops ends the walk unmatched", () => {
    const rows: readonly TtyProcessRow[] = [
      { argv: "claude", pid: 4242, ppid: 4243, state: "S+", tty: "ttys004" },
      { argv: "node", pid: 4243, ppid: 4242, state: "S", tty: "ttys004" },
    ];

    expect(liveSessionsInTab({ liveRecords: [SEAT], report: report({ trees: [], ttyPids: [902] }), rows })).toEqual([]);
  });
});

describe("liveSessionsTouchingTab — the never-type read also counts a session whose CHILD cmux reported", () => {
  // cmux reporting only the session's child left the tab to the graft.
  const child: TtyProcessRow = { argv: "node", pid: 4300, ppid: 4242, state: "S+", tty: "ttys004" };
  const onlyChild = report({ trees: [{ children: [], name: "node", pid: 4300 }], ttyPids: [] });

  it("a tab cmux reports only the session's child for touches the session, while the hosting read does not", () => {
    const rows = [APP, { ...ZSH, ppid: 1 }, { ...CLAUDE, tty: "??" }, child];

    expect(liveSessionsTouchingTab({ liveRecords: [SEAT], report: onlyChild, rows })).toEqual([SEAT]);
    expect(liveSessionsInTab({ liveRecords: [SEAT], report: onlyChild, rows })).toEqual([]);
  });

  it("names every session liveSessionsInTab names", () => {
    expect(
      liveSessionsTouchingTab({
        liveRecords: [SEAT],
        report: report({ trees: ATTRIBUTED }),
        rows: [APP, LOGIN, ZSH, CLAUDE],
      }),
    ).toEqual([SEAT]);
  });

  it("a session whose tree holds no reported pid does not touch the tab", () => {
    const elsewhere: SessionRecord = { ...SEAT, pid: 5151 };
    const rows = [APP, LOGIN, ZSH, CLAUDE, child, { ...CLAUDE, pid: 5151, ppid: 900, tty: "ttys005" }];

    expect(liveSessionsTouchingTab({ liveRecords: [elsewhere], report: onlyChild, rows })).toEqual([]);
  });

  it("a tab cmux reported nothing for touches nothing", () => {
    expect(
      liveSessionsTouchingTab({
        liveRecords: [SEAT],
        report: report({ trees: [], ttyPids: [] }),
        rows: [CLAUDE, child],
      }),
    ).toEqual([]);
  });
});

describe("reportedTabPids", () => {
  it("is every attributed pid and every listed tty pid, each once", () => {
    expect([...reportedTabPids({ report: report({ trees: ATTRIBUTED, ttyPids: [901, 902] }) })]).toEqual([
      902, 4242, 901,
    ]);
  });
});

describe("pidInTab — a self-close's own pass is tied to the tab by its process, never by its screen", () => {
  /** A `fleet resume` pass the seat's shell typed, under the shell cmux attributed. */
  const PASS: TtyProcessRow = {
    argv: "node slopweaver fleet resume",
    pid: 5150,
    ppid: 902,
    state: "S+",
    tty: "ttys004",
  };
  /** Another tab's shell and the pass running there, which a stale `CMUX_WORKSPACE_ID` would point away from. */
  const OTHER_ZSH: TtyProcessRow = { argv: "-/bin/zsh", pid: 7002, ppid: 900, state: "S", tty: "ttys009" };
  const ELSEWHERE: TtyProcessRow = {
    argv: "node slopweaver fleet resume",
    pid: 7150,
    ppid: 7002,
    state: "S+",
    tty: "ttys009",
  };

  it("the pass descends through the parent column from the shell cmux reported", () => {
    expect(pidInTab({ pid: 5150, report: report({ trees: ATTRIBUTED }), rows: [APP, LOGIN, ZSH, CLAUDE, PASS] })).toBe(
      true,
    );
  });

  it("a pass running in another tab is not this tab's, whatever this tab's screen shows", () => {
    const thisTab = report({ trees: [{ children: [], name: "zsh", pid: 902 }], ttyPids: [] });

    expect(pidInTab({ pid: 7150, report: thisTab, rows: [APP, LOGIN, ZSH, OTHER_ZSH, ELSEWHERE] })).toBe(false);
  });

  it("a tab cmux reported nothing for hosts nothing, even a pid the table holds", () => {
    expect(pidInTab({ pid: 5150, report: report({ trees: [], ttyPids: [] }), rows: [APP, LOGIN, ZSH, PASS] })).toBe(
      false,
    );
  });

  it("a pid the table does not hold is placed only by being reported itself", () => {
    expect(pidInTab({ pid: 902, report: report({ trees: ATTRIBUTED }), rows: [] })).toBe(true);
    expect(pidInTab({ pid: 5150, report: report({ trees: ATTRIBUTED }), rows: [] })).toBe(false);
  });
});
