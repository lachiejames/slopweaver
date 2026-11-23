/**
 * A registry record is a live seat only while the process at its pid is the one it recorded — a record left behind
 * by a dead session, its pid since handed to a stranger, is not.
 */
import { describe, expect, it } from "vitest";

import { isLiveSeat, liveSeatsFromScan, parseProcessStarts, wholeRegistry } from "../../../fleet/liveSeat.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";

const STARTED = "Sat Oct  4 05:00:00 2026";

/** An interactive terminal session's registry record on pid 4242. */
function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    cwd: "/wt/a",
    entrypoint: "cli",
    kind: "interactive",
    name: "a",
    pid: 4242,
    procStart: STARTED,
    sessionId: "s-1",
    startedAtMs: 0,
    status: "busy",
    ...over,
  };
}

describe("parseProcessStarts", () => {
  it("keeps each pid's whole stamp, its doubled space before a one-digit day included", () => {
    const starts = unwrap(parseProcessStarts({ text: `    1 Fri Oct  3 22:10:04 2026\n 4242 ${STARTED}\n` }));
    expect([...starts]).toEqual([
      [1, "Fri Oct  3 22:10:04 2026"],
      [4242, STARTED],
    ]);
  });

  it("reads an empty listing and blank lines as no processes", () => {
    expect([...unwrap(parseProcessStarts({ text: "\n\n" }))]).toEqual([]);
    expect([...unwrap(parseProcessStarts({ text: "" }))]).toEqual([]);
  });

  it("refuses a row with no stamp rather than reading its process as gone", () => {
    const read = parseProcessStarts({ text: `    1 Fri Oct  3 22:10:04 2026\n 4242\n` });
    expect(unwrapErr(read)).toBe('the process listing holds a row that is not a pid and a whole start stamp: " 4242"');
  });

  it("refuses a row whose stamp is cut short rather than reading its process as a stranger", () => {
    const read = parseProcessStarts({ text: `    1 Fri Oct  3 22:10:04 2026\n 4242 Sat Oct\n` });
    expect(unwrapErr(read)).toBe(
      'the process listing holds a row that is not a pid and a whole start stamp: " 4242 Sat Oct"',
    );
  });

  it("refuses a row of the right shape whose stamp names no real day or time", () => {
    const read = parseProcessStarts({ text: ` 4242 Xxx Yyy 99 99:99:99 2026\n` });
    expect(unwrapErr(read)).toBe(
      'the process listing holds a row that is not a pid and a whole start stamp: " 4242 Xxx Yyy 99 99:99:99 2026"',
    );
  });

  it("reads the trailing padding ps puts after a stamp", () => {
    expect([...unwrap(parseProcessStarts({ text: ` 4242 ${STARTED}    \n` }))]).toEqual([[4242, STARTED]]);
  });
});

describe("isLiveSeat", () => {
  const starts = new Map([[4242, STARTED]]);

  it("reads a record live while its own process runs at its pid", () => {
    expect(isLiveSeat({ record: record(), starts })).toBe(true);
  });

  it("reads a record dead when its pid now runs a process that started at another time", () => {
    expect(isLiveSeat({ record: record({ procStart: "Fri Oct  3 01:00:00 2026" }), starts })).toBe(false);
  });

  it("reads a record dead when nothing runs at its pid", () => {
    expect(isLiveSeat({ record: record({ pid: 9 }), starts })).toBe(false);
  });

  it("reads a record with no start stamp dead, since it cannot be told from a stranger on its pid", () => {
    const { procStart: _dropped, ...unstamped } = record();
    expect(isLiveSeat({ record: unstamped, starts })).toBe(false);
  });

  it("reads a non-interactive or non-terminal record as no seat", () => {
    expect(isLiveSeat({ record: record({ kind: "sdk" }), starts })).toBe(false);
    expect(isLiveSeat({ record: record({ entrypoint: "sdk-ts" }), starts })).toBe(false);
  });
});

describe("liveSeatsFromScan", () => {
  const starts = new Map([[4242, STARTED]]);
  const live = record();
  const dead = record({ pid: 9, sessionId: "s-dead" });

  it("keeps only the live seats of a scan that read every file", () => {
    const read = liveSeatsFromScan({ scan: { records: [live, dead], refused: [], unreadable: undefined }, starts });
    expect(unwrap(read)).toEqual([live]);
  });

  it("refuses the whole read when any file was refused, even with the asked-for seat present", () => {
    const read = liveSeatsFromScan({
      scan: { records: [live], refused: ["777.json: not JSON"], unreadable: undefined },
      starts,
    });
    expect(unwrapErr(read)).toBe("the session registry holds files that would not read: 777.json: not JSON");
  });

  it("refuses with the directory's own reason when it could not be listed", () => {
    const read = liveSeatsFromScan({ scan: { records: [], refused: [], unreadable: "EACCES" }, starts });
    expect(unwrapErr(read)).toBe("EACCES");
  });

  /** A seat record that parsed but carries no start stamp, on the given pid. */
  const unstamped = ({ pid }: { pid: number }): SessionRecord => ({
    cwd: "/wt/b",
    entrypoint: "cli",
    kind: "interactive",
    name: "b",
    pid,
    sessionId: "s-unstamped",
    startedAtMs: 0,
    status: "busy",
  });

  it("refuses when an unstamped seat's pid is running, since it may be that seat", () => {
    const read = liveSeatsFromScan({
      scan: { records: [live, unstamped({ pid: 4242 })], refused: [], unreadable: undefined },
      starts,
    });
    expect(unwrapErr(read)).toBe(
      "a registry record on running pid 4242 names no start stamp or session id, so whether its session is live cannot be read",
    );
  });

  it("refuses when a running record's session id did not read", () => {
    const read = liveSeatsFromScan({
      scan: { records: [record({ sessionId: "" })], refused: [], unreadable: undefined },
      starts,
    });
    expect(unwrapErr(read)).toBe(
      "a registry record on running pid 4242 names no start stamp or session id, so whether its session is live cannot be read",
    );
  });

  it("counts a running session whose kind did not read, rather than filtering it out", () => {
    const garbled = record({ entrypoint: "", kind: "" });
    const read = liveSeatsFromScan({ scan: { records: [garbled], refused: [], unreadable: undefined }, starts });
    expect(unwrap(read)).toEqual([garbled]);
  });

  it("reads an unstamped seat whose pid runs nothing as dead", () => {
    const read = liveSeatsFromScan({
      scan: { records: [live, unstamped({ pid: 77 })], refused: [], unreadable: undefined },
      starts,
    });
    expect(unwrap(read)).toEqual([live]);
  });
});

describe("wholeRegistry", () => {
  const live = record();
  const dead = record({ pid: 9, sessionId: "s-dead" });

  it("keeps every record, dead ones included, of a scan that read every file", () => {
    expect(unwrap(wholeRegistry({ scan: { records: [live, dead], refused: [], unreadable: undefined } }))).toEqual([
      live,
      dead,
    ]);
  });

  it("refuses the whole read when any file was refused", () => {
    const read = wholeRegistry({ scan: { records: [live], refused: ["777.json: not JSON"], unreadable: undefined } });
    expect(unwrapErr(read)).toBe("the session registry holds files that would not read: 777.json: not JSON");
  });
});
