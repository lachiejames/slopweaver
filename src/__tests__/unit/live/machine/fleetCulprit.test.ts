/**
 * WHO a capacity reading blames. The stalled-session shape (a stalled session, a dead seat's orphans) and the
 * runaway-search one, where the culprit named a live seat and proposed `kill <session pid>` to stop six greps.
 */
import { describe, expect, it } from "vitest";

import { fleetCulprit, runawaySearchSubject } from "../../../../live/machine/fleetCulprit.js";
import { fleetLoadReading, parseElapsedRows, parseTopCpuRows } from "../../../../live/machine/fleetLoad.js";
import type { RunawaySearch } from "../../../../live/machine/runawaySearch.js";
import {
  INCIDENT_ETIME_TEXT,
  INCIDENT_PROCESSES,
  INCIDENT_TOP_CPU_TEXT,
  QUIET_SESSION_ID,
  WEDGED_SESSION_ID,
} from "./fleetLoadFixtures.js";
import { RUNAWAY_SESSION_ID } from "./runawaySearchFixtures.js";

/** The stalled-session reading: a wedged session with a stalled hook, a quiet one, and a dead seat's orphans. */
const reading = fleetLoadReading({
  cpuRows: parseTopCpuRows({ text: INCIDENT_TOP_CPU_TEXT }),
  elapsedRows: parseElapsedRows({ text: INCIDENT_ETIME_TEXT }),
  processes: INCIDENT_PROCESSES,
});

/** One runaway search, with only what a case varies overridden. */
function search(over: Partial<RunawaySearch> = {}): RunawaySearch {
  return {
    argvByPid: { "511": "ugrep -G x" },
    binary: "ugrep",
    cpuPct: 52.3,
    elapsedSeconds: 3480,
    pid: 511,
    sessionId: RUNAWAY_SESSION_ID,
    shellPid: 510,
    treePids: [511],
    ...over,
  };
}

describe("fleetCulprit", () => {
  it("blames runaway searches over a STALLED session, with the reap and never the seat's pid", () => {
    const culprit = fleetCulprit({
      chairSessionId: undefined,
      reading,
      searches: [search(), search({ cpuPct: 48, elapsedSeconds: 1200, pid: 521 })],
      stallHoldSeconds: 300,
    })!;
    expect(culprit).toEqual({
      endedBy: "seat",
      kill: "slopweaver machine reap",
      subject: `runaway searches in session ${RUNAWAY_SESSION_ID}`,
      why: "2 search(es) at 100.3% cpu, oldest 58m: 511 (ugrep), 521 (ugrep) — the seat itself is not the subject",
    });
  });

  // The pre-search cases — a stalled session, the heaviest one, a dead seat's orphans — stay in fleetLoad.test.ts.
});

/** The two live sessions and their own children, with the dead seat's orphans removed so no reap can win. */
const LIVE_ONLY = INCIDENT_PROCESSES.filter((row) => row.ppid !== 1 && row.ppid !== 300);

/** A reading of {@link LIVE_ONLY} under a given cpu sample. */
function liveReading({ cpuText }: { cpuText: string }): ReturnType<typeof fleetLoadReading> {
  return fleetLoadReading({
    cpuRows: parseTopCpuRows({ text: cpuText }),
    elapsedRows: parseElapsedRows({ text: INCIDENT_ETIME_TEXT }),
    processes: LIVE_ONLY,
  });
}

describe("fleetCulprit — the chair and unmeasured cpu", () => {
  it("names no session when the cpu sample was not read, rather than the arbitrary top row", () => {
    // The hold that offered `kill <chair pid>`: `idle unmeasured`, so every session read 0% cpu.
    const unread = liveReading({ cpuText: "" });
    expect(unread.cpuAttributed).toBe(false);
    expect(unread.sessions.map((session) => session.cpuPct)).toEqual([0, 0]);
    expect(
      fleetCulprit({ chairSessionId: undefined, reading: unread, searches: [], stallHoldSeconds: 99_999 }),
    ).toBeUndefined();
  });

  it("names no session when the sample was read but every live session sat at 0% cpu", () => {
    const elsewhere = [
      "Processes: 1 total",
      "PID    %CPU",
      "999    0.0",
      "Processes: 1 total",
      "PID    %CPU",
      "999    80.0",
      "",
    ].join("\n");
    const live = liveReading({ cpuText: elsewhere });
    expect(live.cpuAttributed).toBe(true);
    expect(
      fleetCulprit({ chairSessionId: undefined, reading: live, searches: [], stallHoldSeconds: 99_999 }),
    ).toBeUndefined();
  });

  it("passes over the chair when it is the heaviest session and names the next one by its measured cpu", () => {
    const live = liveReading({ cpuText: INCIDENT_TOP_CPU_TEXT });
    expect(live.sessions[0]!.sessionId).toBe(WEDGED_SESSION_ID);
    const culprit = fleetCulprit({
      chairSessionId: WEDGED_SESSION_ID,
      reading: live,
      searches: [],
      stallHoldSeconds: 99_999,
    })!;
    expect(culprit.subject).toBe(`session ${QUIET_SESSION_ID}`);
    expect(culprit.kill).toBe("kill 200");
    expect(culprit.why).toBe("2% cpu across 3 processes, poll-gate hook stalled 1s");
  });

  it("never offers to end the chair for a stalled hook either", () => {
    const live = liveReading({ cpuText: INCIDENT_TOP_CPU_TEXT });
    const culprit = fleetCulprit({
      chairSessionId: WEDGED_SESSION_ID,
      reading: live,
      searches: [],
      stallHoldSeconds: 300,
    })!;
    expect(culprit.subject).toBe(`session ${QUIET_SESSION_ID}`);
    expect(culprit.kill).toBe("kill 200");
  });

  it("names no session when the chair is the only one with measured cpu", () => {
    const chairOnly = [
      "Processes: 1 total",
      "PID    %CPU",
      "100    0.0",
      "Processes: 1 total",
      "PID    %CPU",
      "100    90.0",
      "",
    ].join("\n");
    const live = liveReading({ cpuText: chairOnly });
    expect(
      fleetCulprit({ chairSessionId: WEDGED_SESSION_ID, reading: live, searches: [], stallHoldSeconds: 99_999 }),
    ).toBeUndefined();
  });
});

describe("runawaySearchSubject", () => {
  it("names the one session the searches share, with no pid or count to rotate a dedupe key", () => {
    expect(runawaySearchSubject({ searches: [search(), search({ pid: 521 })] })).toBe(
      `runaway searches in session ${RUNAWAY_SESSION_ID}`,
    );
  });

  it("counts the sessions when the searches span more than one", () => {
    expect(runawaySearchSubject({ searches: [search(), search({ pid: 9, sessionId: WEDGED_SESSION_ID })] })).toBe(
      "runaway searches in 2 sessions",
    );
  });
});
