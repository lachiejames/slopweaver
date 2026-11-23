/**
 * The cmux app picked out of a `ps` listing — never the bundled CLI sharing its name — and whether a process runs
 * under it.
 */
import { describe, expect, it } from "vitest";

import {
  cmuxAppOf,
  descendsFrom,
  parsePsRows,
  parsePsRowsStrict,
  psStartMs,
  soleCmuxAppOf,
} from "../../../cmux/appProcess.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("psStartMs", () => {
  it("reads the stamp as UTC, the zone the listing runs under", () => {
    expect(new Date(psStartMs({ start: "Sat Oct 10 23:45:46 2026" })!).toISOString()).toBe("2026-10-10T23:45:46.000Z");
  });

  it("reads a single-digit day the way ps pads it", () => {
    expect(new Date(psStartMs({ start: "Fri Oct  2 08:00:00 2026" })!).toISOString()).toBe("2026-10-02T08:00:00.000Z");
  });

  it("refuses a stamp that is not that shape", () => {
    expect([psStartMs({ start: "" }), psStartMs({ start: "Sat Foo 10 23:45:46 2026" })]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("refuses an impossible app start, so the sweep reads the app as unreadable", () => {
    expect([
      psStartMs({ start: "Sun Feb 31 12:00:00 2026" }),
      psStartMs({ start: "Mon Oct 10 23:45:46 2026" }),
    ]).toEqual([undefined, undefined]);
  });
});

/** A listing shaped as `ps -ax -o pid=,ppid=,lstart=,comm=` prints it under the C locale. */
const LISTING = [
  "    1     0 Sat Oct 10 08:00:00 2026     /sbin/launchd",
  "24622     1 Sat Oct 10 23:45:46 2026     /Applications/cmux.app/Contents/MacOS/cmux",
  "24700 24622 Sat Oct 10 23:45:50 2026     /bin/zsh",
  "24701 24700 Sat Oct 10 23:46:02 2026     /Applications/cmux.app/Contents/Resources/bin/cmux",
  "30000     1 Sat Oct 10 23:50:00 2026     /Applications/Slopweaver Desktop.app/Contents/MacOS/Slopweaver Desktop",
  "not a row",
  "",
].join("\n");

describe("parsePsRows", () => {
  it("reads pid, parent, the five-field start and a command carrying spaces, and skips a non-row", () => {
    const rows = parsePsRows({ text: LISTING });
    expect(rows.length).toBe(5);
    expect(rows[1]).toEqual({
      command: "/Applications/cmux.app/Contents/MacOS/cmux",
      pid: 24622,
      ppid: 1,
      start: "Sat Oct 10 23:45:46 2026",
    });
    expect(rows[4]!.command).toBe("/Applications/Slopweaver Desktop.app/Contents/MacOS/Slopweaver Desktop");
  });

  it("reads nothing from an empty listing", () => {
    expect(parsePsRows({ text: "" })).toEqual([]);
  });
});

describe("parsePsRowsStrict", () => {
  it("fails the whole read on a line that is not a row, where the lenient parse skips it", () => {
    const malformed = "33532 ? Sun Sep  3 08:50:00 2026 /usr/local/bin/claude";
    expect(unwrapErr(parsePsRowsStrict({ text: LISTING }))).toContain('"not a row"');
    expect(unwrapErr(parsePsRowsStrict({ text: malformed }))).toContain("33532 ?");
  });

  it("reads every row of a whole listing, blank lines skipped", () => {
    const whole = LISTING.replace("not a row\n", "");
    expect(unwrap(parsePsRowsStrict({ text: whole }))).toEqual(parsePsRows({ text: whole }));
    expect(unwrap(parsePsRowsStrict({ text: whole })).length).toBe(5);
  });
});

describe("cmuxAppOf", () => {
  it("picks the app and never the bundled CLI of the same name", () => {
    expect(cmuxAppOf({ rows: parsePsRows({ text: LISTING }) })!.pid).toBe(24622);
  });

  it("answers undefined when the app is not running", () => {
    expect(cmuxAppOf({ rows: parsePsRows({ text: "    1     0 Sat Oct 10 08:00:00 2026     /sbin/launchd" }) })).toBe(
      undefined,
    );
  });

  it("picks the lowest pid when two run", () => {
    const text = [
      "900     1 Sat Oct 10 23:45:46 2026     /Applications/cmux.app/Contents/MacOS/cmux",
      "800     1 Sat Oct 10 23:45:47 2026     /Users/x/Applications/cmux.app/Contents/MacOS/cmux",
    ].join("\n");
    expect(cmuxAppOf({ rows: parsePsRows({ text }) })!.pid).toBe(800);
  });
});

describe("soleCmuxAppOf", () => {
  it("answers the one app, and nothing when two run or none does", () => {
    const two = [
      "900     1 Sat Oct 10 23:45:46 2026     /Applications/cmux.app/Contents/MacOS/cmux",
      "800     1 Sat Oct 10 23:45:47 2026     /Users/x/Applications/cmux.app/Contents/MacOS/cmux",
    ].join("\n");
    expect(soleCmuxAppOf({ rows: parsePsRows({ text: LISTING }) })!.pid).toBe(24622);
    expect(soleCmuxAppOf({ rows: parsePsRows({ text: two }) })).toBeUndefined();
    expect(soleCmuxAppOf({ rows: [] })).toBeUndefined();
  });
});

describe("descendsFrom", () => {
  const rows = parsePsRows({ text: LISTING });

  it("finds a grandchild of the app", () => {
    expect(descendsFrom({ ancestorPid: 24622, pid: 24701, rows })).toBe(true);
  });

  it("counts the app itself", () => {
    expect(descendsFrom({ ancestorPid: 24622, pid: 24622, rows })).toBe(true);
  });

  it("never counts a process launchd started, such as the desktop app", () => {
    expect(descendsFrom({ ancestorPid: 24622, pid: 30000, rows })).toBe(false);
  });

  it("stops on a pid the listing does not hold", () => {
    expect(descendsFrom({ ancestorPid: 24622, pid: 55555, rows })).toBe(false);
  });

  it("stops on a parent cycle rather than looping", () => {
    const looped = parsePsRows({
      text: ["10 11 Sat Oct 10 23:45:46 2026 /bin/a", "11 10 Sat Oct 10 23:45:46 2026 /bin/b"].join("\n"),
    });
    expect(descendsFrom({ ancestorPid: 24622, pid: 10, rows: looped })).toBe(false);
  });
});
