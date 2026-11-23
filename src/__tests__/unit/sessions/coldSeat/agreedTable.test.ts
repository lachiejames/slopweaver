/*
 * `agreedTable` and `strayOnTabTty`: a table both reads agree on is indexed by pid and the first disagreement is a
 * typed error, and a process on the tab's tty the forest does not hold is found as a stray.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { TtyProcessRow } from "../../../../live/standing/processes.js";
import { agreedTable, strayOnTabTty } from "../../../../sessions/coldGraftAgreement.js";
import { ColdGraftErrors } from "../../../../sessions/coldGraftErrors.js";
import { BARE_SHELL, TABLE } from "./harness.js";

describe("agreedTable and strayOnTabTty", () => {
  it("indexes a table both reads agree on by pid, and refuses the first disagreement as a typed error", () => {
    const byPid = unwrap(agreedTable({ rows: TABLE, trees: [], ttyPids: [60561, 60562] }));

    expect([...byPid.keys()]).toEqual(TABLE.map((row) => row.pid));
    expect(unwrapErr(agreedTable({ rows: [...TABLE, ...TABLE], trees: [], ttyPids: [] }))).toEqual(
      ColdGraftErrors.tableListsTwice({ pid: 60470 }),
    );
    expect(unwrapErr(agreedTable({ rows: TABLE, trees: [], ttyPids: [60561, 60561] }))).toEqual(
      ColdGraftErrors.ttyPidListedTwice({ pid: 60561 }),
    );
  });

  it("finds a stray on the tab's tty against a forest whose every root is tabled, and nothing on a clean tab", () => {
    const rows: readonly TtyProcessRow[] = [
      ...TABLE,
      { argv: "-/bin/zsh", pid: 10, ppid: 60470, state: "S", tty: "ttys005" },
      { argv: "sleep 100", pid: 30, ppid: 1, state: "S", tty: "ttys005" },
    ];
    const byPid = new Map(rows.map((row) => [row.pid, row]));

    expect(strayOnTabTty({ byPid, roots: BARE_SHELL, rows })).toEqual(
      ColdGraftErrors.strayOnTty({ name: "sleep", pid: 30, tty: "ttys005" }),
    );
    expect(strayOnTabTty({ byPid, roots: [...BARE_SHELL, { children: [], name: "sleep", pid: 30 }], rows })).toBe(
      undefined,
    );
    expect(strayOnTabTty({ byPid: new Map(), roots: BARE_SHELL, rows })).toBe(undefined);
  });
});
