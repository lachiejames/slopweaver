import { describe, expect, it } from "vitest";

import { fleetCulprit } from "../../../../live/machine/fleetCulprit.js";
import {
  briefDuration,
  claudeSessionIdOf,
  elapsedSeconds,
  fleetLoadLines,
  fleetLoadReading,
  hookScriptOf,
  liveShellSnapshots,
  orphanedFleetShells,
  parseElapsedRows,
  parseTopCpuRows,
  shellSnapshotOf,
  stalledHookLabel,
  stalledSessions,
} from "../../../../live/machine/fleetLoad.js";
import {
  BUSY_SEAT,
  DEAD_SEAT,
  INCIDENT_ETIME_TEXT,
  INCIDENT_PROCESSES,
  INCIDENT_TOP_CPU_TEXT,
  QUIET_SESSION_ID,
  WEDGED_SESSION_ID,
} from "./fleetLoadFixtures.js";

/** The reading every assertion below is taken from — the whole stalled-session shape in one snapshot. */
const reading = fleetLoadReading({
  cpuRows: parseTopCpuRows({ text: INCIDENT_TOP_CPU_TEXT }),
  elapsedRows: parseElapsedRows({ text: INCIDENT_ETIME_TEXT }),
  processes: INCIDENT_PROCESSES,
});

describe("elapsedSeconds", () => {
  it("reads MM:SS", () => {
    expect(elapsedSeconds({ etime: "43:12" })).toBe(2592);
  });

  it("reads HH:MM:SS", () => {
    expect(elapsedSeconds({ etime: "10:17:05" })).toBe(37_025);
  });

  it("reads DD-HH:MM:SS", () => {
    expect(elapsedSeconds({ etime: "1-02:00:00" })).toBe(93_600);
  });

  it("refuses anything else rather than reading it as zero", () => {
    expect(elapsedSeconds({ etime: "later" })).toBeUndefined();
  });
});

describe("parseElapsedRows", () => {
  it("decodes every well-formed row and drops the rest", () => {
    expect(parseElapsedRows({ text: "  7  1:00\nheader row here\n  9  bad\n 11  2-00:00:00\n" })).toEqual([
      { pid: 7, seconds: 60 },
      { pid: 11, seconds: 172_800 },
    ]);
  });
});

describe("parseTopCpuRows", () => {
  it("reads the FINAL sample's per-process rows, never the first sample's zeros", () => {
    const rows = parseTopCpuRows({ text: INCIDENT_TOP_CPU_TEXT });
    expect(rows.length).toBe(8);
    expect(rows[0]).toEqual({ cpuPct: 40, pid: 100 });
    expect(rows.find((row) => row.pid === 302)!.cpuPct).toBe(20);
  });

  it("reads nothing from a one-sample report", () => {
    const first = INCIDENT_TOP_CPU_TEXT.split("Processes: 8 total")[0]!;
    expect(parseTopCpuRows({ text: first })).toEqual([]);
  });
});

describe("the three argv shapes", () => {
  it("reads a session id out of a claude argv", () => {
    expect(claudeSessionIdOf({ argv: `/x/claude --session-id ${WEDGED_SESSION_ID} --settings {}` })).toBe(
      WEDGED_SESSION_ID,
    );
  });

  it("reads no session id out of a tool shell", () => {
    expect(
      claudeSessionIdOf({ argv: "/bin/zsh -c source /a/.claude/shell-snapshots/snapshot-zsh-1-a.sh" }),
    ).toBeUndefined();
  });

  it("reads the shell snapshot a tool shell sources", () => {
    expect(shellSnapshotOf({ argv: `/bin/zsh -c source ${DEAD_SEAT} 2>/dev/null` })).toBe(DEAD_SEAT);
  });

  it("reads the hook script a shim runs, by either spelling", () => {
    expect(hookScriptOf({ argv: "bash /x/scripts/pretooluse-poll-gate.sh" })).toBe("pretooluse-poll-gate");
    expect(hookScriptOf({ argv: "node /x/tsx /x/hooks/pretooluse-admit.ts" })).toBe("pretooluse-admit");
  });

  it("reads the FOLDED hook, which is the only one a current install runs", () => {
    // The ten guards became one process. A pattern demanding the old `-<name>` suffix went
    // blind to it — silently retiring the gauge that diagnosed that very incident — so both spellings are
    // pinned here rather than left to the next reader of the regex.
    expect(hookScriptOf({ argv: "bash /x/scripts/pretooluse.sh" })).toBe("pretooluse");
    expect(hookScriptOf({ argv: "node /x/tsx /x/hooks/pretooluse.ts" })).toBe("pretooluse");
    expect(hookScriptOf({ argv: "node /x/.hook-build/pretooluse.mjs" })).toBe("pretooluse");
  });

  it("reads no hook script out of an ordinary node process", () => {
    expect(hookScriptOf({ argv: "node /x/node_modules/.bin/vitest run" })).toBeUndefined();
  });
});

describe("orphan selection", () => {
  it("names every reparented fleet shell and nothing else", () => {
    expect(orphanedFleetShells({ processes: INCIDENT_PROCESSES }).map((row) => row.pid)).toEqual([300, 301, 310]);
  });

  it("counts a snapshot as LIVE only when an un-reparented process sources it", () => {
    const live = liveShellSnapshots({ processes: INCIDENT_PROCESSES });
    expect(live.has(BUSY_SEAT)).toBe(true);
    expect(live.has(DEAD_SEAT)).toBe(false);
  });
});

describe("fleetLoadReading", () => {
  it("attributes a session's whole tree, its parallel calls and its longest hook stall", () => {
    const wedged = reading.sessions.find((row) => row.sessionId === WEDGED_SESSION_ID)!;
    expect(wedged.pid).toBe(100);
    expect(wedged.processCount).toBe(8);
    expect(wedged.cpuPct).toBe(50);
    // Three concurrent copies of pretooluse-poll-gate is three tool calls in flight; two of admit is two.
    expect(wedged.parallelToolCalls).toBe(3);
    expect(wedged.hookStallSeconds).toBe(2592);
  });

  it("counts one firing once however many processes tsx boots under it", () => {
    const wedged = reading.sessions.find((row) => row.sessionId === WEDGED_SESSION_ID)!;
    // Six live hook processes — five roots plus pid 101's tsx loader child — over three poll-gate firings.
    expect(wedged.bootsInFlight).toBe(6);
    expect(wedged.parallelToolCalls).toBe(3);
  });

  it("counts the tool shells a session has live, so an absence can tell a held call from a slow one", () => {
    // Each session owns exactly one `/bin/zsh -c source …/shell-snapshots/…` row; the dead seat's three
    // are orphans, owned by no session, and must not be counted against either live one.
    expect(reading.sessions.find((row) => row.sessionId === WEDGED_SESSION_ID)!.toolShellsInFlight).toBe(1);
    expect(reading.sessions.find((row) => row.sessionId === QUIET_SESSION_ID)!.toolShellsInFlight).toBe(1);
  });

  it("names WHICH hook the longest live one is, not just how long it has run", () => {
    const wedged = reading.sessions.find((row) => row.sessionId === WEDGED_SESSION_ID)!;
    expect(wedged.hookStallScript).toBe("pretooluse-poll-gate");
    expect(stalledHookLabel({ script: wedged.hookStallScript })).toBe("poll-gate hook");
  });

  it("falls back to the generic label when the snapshot resolved no script", () => {
    expect(stalledHookLabel({ script: undefined })).toBe("oldest PreToolUse hook");
  });

  it("reads a quiet session as one call in flight and a hook measured in seconds", () => {
    const quiet = reading.sessions.find((row) => row.sessionId === QUIET_SESSION_ID)!;
    expect(quiet.parallelToolCalls).toBe(1);
    expect(quiet.bootsInFlight).toBe(1);
    expect(quiet.hookStallSeconds).toBe(1);
  });

  it("groups orphans by their dead seat and sums the whole tree's cpu, descendants included", () => {
    expect(reading.orphans.length).toBe(2);
    const group = reading.orphans[0]!;
    expect(group.snapshot).toBe(DEAD_SEAT);
    expect(group.seatLive).toBe(false);
    expect(group.pids).toEqual([300, 301]);
    // 11 + 12 + its child's 20.
    expect(group.cpuPct).toBe(43);
    expect(group.oldestSeconds).toBe(93_600);
    expect(reading.orphanCount).toBe(2);
    expect(reading.orphanCpuPct).toBe(43);
  });

  it("reports a LIVE seat's orphan but keeps it out of the reapable totals", () => {
    const liveSeat = reading.orphans.find((group) => group.snapshot === BUSY_SEAT)!;
    expect(liveSeat.pids).toEqual([310]);
    expect(liveSeat.seatLive).toBe(true);
    expect(reading.orphanCount).toBe(2);
    expect(reading.orphanCpuPct).toBe(43);
  });

  it("says CPU was unattributed rather than reading every session as free", () => {
    const blind = fleetLoadReading({ cpuRows: [], elapsedRows: [], processes: INCIDENT_PROCESSES });
    expect(blind.cpuAttributed).toBe(false);
    expect(blind.sessions.every((row) => row.cpuPct === 0)).toBe(true);
  });
});

describe("stalledSessions", () => {
  it("selects the session whose hook crossed the line, and only it", () => {
    expect(stalledSessions({ reading, stallHoldSeconds: 300 }).map((row) => row.sessionId)).toEqual([
      WEDGED_SESSION_ID,
    ]);
  });

  it("selects nobody when the line is above every reading", () => {
    expect(stalledSessions({ reading, stallHoldSeconds: 99_999 })).toEqual([]);
  });
});

describe("fleetCulprit", () => {
  it("blames the STALLED session outright, naming its calls, its stall and the command that ends it", () => {
    const culprit = fleetCulprit({
      chairSessionId: undefined,
      parallelCallAlert: 2,
      reading,
      searches: [],
      stallHoldSeconds: 300,
    })!;
    expect(culprit.subject).toBe(`session ${WEDGED_SESSION_ID}`);
    expect(culprit.why).toContain("3 tool calls in flight");
    expect(culprit.why).toContain("poll-gate hook stalled 43m");
    expect(culprit.kill).toBe("kill 100");
  });

  it("blames the heaviest SESSION when nothing is stalled and it outweighs the orphans", () => {
    const culprit = fleetCulprit({ chairSessionId: undefined, reading, searches: [], stallHoldSeconds: 99_999 })!;
    expect(culprit.subject).toBe(`session ${WEDGED_SESSION_ID}`);
    expect(culprit.kill).toBe("kill 100");
  });

  it("blames the DEAD seat's orphans when they outweigh every session, never a live seat's", () => {
    const orphansOnly = fleetLoadReading({
      cpuRows: parseTopCpuRows({ text: INCIDENT_TOP_CPU_TEXT }),
      elapsedRows: parseElapsedRows({ text: INCIDENT_ETIME_TEXT }),
      processes: INCIDENT_PROCESSES.filter((row) => row.pid !== 100 && row.ppid !== 100),
    });
    // Removing the wedged session takes its live tool shell with it, so its seat is dead too: 3 shells, 2 seats.
    expect(orphansOnly.orphanCount).toBe(3);
    const culprit = fleetCulprit({
      chairSessionId: undefined,
      reading: orphansOnly,
      searches: [],
      stallHoldSeconds: 99_999,
    })!;
    expect(culprit.subject).toBe("3 orphaned fleet shell(s), 2 dead seat(s), top seat zsh-1789700000000-dead11");
    expect(culprit.kill).toBe("slopweaver machine reap");
  });

  it("blames nobody on an empty machine", () => {
    const empty = fleetLoadReading({ cpuRows: [], elapsedRows: [], processes: [] });
    expect(fleetCulprit({ chairSessionId: undefined, reading: empty, searches: [] })).toBeUndefined();
  });
});

describe("briefDuration", () => {
  it("prints seconds, minutes and hours at the scales a one-line clause wants", () => {
    expect(briefDuration({ seconds: 18 })).toBe("18s");
    expect(briefDuration({ seconds: 2592 })).toBe("43m");
    expect(briefDuration({ seconds: 93_600 })).toBe("26h");
  });
});

describe("fleetLoadLines", () => {
  it("prints one row per session and one per orphan group, each with its own kill route", () => {
    const lines = fleetLoadLines({ reading });
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain(`session ${WEDGED_SESSION_ID}`);
    expect(lines[0]).toContain("3 in flight");
    expect(lines[0]).toContain("6 boots");
    expect(lines[0]).toContain("poll-gate hook 43m");
    expect(lines[2]).toContain("ORPHANS 2 shell(s) from seat zsh-1789700000000-dead11");
    expect(lines[2]).toContain("slopweaver machine reap");
    expect(lines[3]).toContain("seat still live, not reapable");
  });
});
