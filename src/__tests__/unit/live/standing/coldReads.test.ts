/**
 * The cold-seat verdict's three pid-scoped reads, run against THIS machine: no pid costs no tool, a name that is not
 * a tty is refused before `lsof` runs, and the group read answers for the test's own process with its own pid as
 * the key and a group it is a member of.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  readExecutables,
  readProcessGroups,
  readTtyHolders,
  readTtyModes,
} from "../../../../live/standing/coldReads.js";

describe("readExecutables and readProcessGroups", () => {
  it("answer no pids with no entries and run no tool", () => {
    expect([[...unwrap(readExecutables({ pids: [] }))], [...unwrap(readProcessGroups({ pids: [] }))]]).toEqual([
      [],
      [],
    ]);
  });

  it("read this process's own group pair under its own pid off ps", () => {
    const groups = unwrap(readProcessGroups({ pids: [process.pid] }));

    expect([
      [...groups.keys()],
      Number.isInteger(groups.get(process.pid)?.pgid),
      Number.isInteger(groups.get(process.pid)?.tpgid),
    ]).toEqual([[process.pid], true, true]);
  });
});

describe("readTtyHolders and readTtyModes", () => {
  it("refuse a name that is not a ttys<N> before lsof or stty runs, naming it", () => {
    expect([unwrapErr(readTtyHolders({ tty: "bogus" })), unwrapErr(readTtyModes({ tty: "bogus" }))]).toEqual([
      {
        cause: "bogus is not a tty name",
        code: "TTY_HOLDERS_UNREADABLE",
        message: "the processes holding tty bogus open could not be read (bogus is not a tty name)",
        tty: "bogus",
      },
      {
        cause: "bogus is not a tty name",
        code: "TTY_MODES_UNREADABLE",
        message: "the modes of tty bogus could not be read (bogus is not a tty name)",
        tty: "bogus",
      },
    ]);
  });

  it("refuses a tty device that is not there whole, off stty's own exit", () => {
    expect(unwrapErr(readTtyModes({ tty: "ttys999" })).code).toBe("TTY_MODES_UNREADABLE");
  });
});
