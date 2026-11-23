/**
 * The `stuck` grade — a tool call in flight with NOTHING running for it, which is the wedge
 * shape `stallSeconds` reports as "no hook running".
 *
 * Every case here pins one leg of the criterion, because the grade is built out of an ABSENCE and an
 * absence is exactly what passes a weak test: a seat with a live tool shell, a seat whose in-flight call is
 * not a `Bash`, and a seat under the line all satisfy "no hook process" and must NOT be graded.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_HOOK_STALL_HOLD_SECONDS } from "../../../../live/machine/fleetLoad.js";
import { perfFoldLines, perfSeatLines, perfSummaryLine } from "../../../../live/perf/render.js";
import { perfReport } from "../../../../live/perf/report.js";
import { fleetReading, LOAD, seatStream, sessionLoad, streamReading } from "./perfFixtures.js";

/** The `ps` half of a seat with no hook and no shell running — the only shape that can be graded stuck. */
const NOTHING_RUNNING = sessionLoad({ bootsInFlight: 0, pid: 100, sessionId: "held", toolShellsInFlight: 0 });

/** The stream half of a seat whose last `Bash` call began well over the line ago. */
const OLD_BASH = seatStream({
  inFlightSeconds: DEFAULT_HOOK_STALL_HOLD_SECONDS * 4,
  inFlightTool: "Bash",
  sessionId: "held",
  workspaceId: "workspace:28",
});

/** The report a case builds, with the shipped stall line unless a case pins its own. */
function reportOf({
  sessions,
  seats,
}: {
  sessions: readonly ReturnType<typeof sessionLoad>[];
  seats: readonly ReturnType<typeof seatStream>[];
}): ReturnType<typeof perfReport> {
  return perfReport({
    fleet: fleetReading({ sessions }),
    hookOverruns: undefined,
    load: LOAD,
    strayDevServers: undefined,
    stream: streamReading({ seats }),
  });
}

describe("the stuck grade", () => {
  it("grades a seat whose in-flight Bash is over the line with no hook and no shell running for it", () => {
    const report = reportOf({ seats: [OLD_BASH], sessions: [NOTHING_RUNNING] });
    expect(report.stuckCount).toBe(1);
    const seat = report.seats[0]!;
    expect(seat.stuck).toBe(true);
    expect(seat.stalled).toBe(false);
    expect(seat.inFlightSeconds).toBe(DEFAULT_HOOK_STALL_HOLD_SECONDS * 4);
    expect(seat.inFlightTool).toBe("Bash");
  });

  it("does NOT grade a seat whose tool shell is alive — that is a slow command, not a held call", () => {
    const running = sessionLoad({ bootsInFlight: 0, pid: 100, sessionId: "held", toolShellsInFlight: 1 });
    const report = reportOf({ seats: [OLD_BASH], sessions: [running] });
    expect(report.stuckCount).toBe(0);
    expect(report.seats[0]!.stuck).toBe(false);
  });

  it("does NOT grade a seat whose hook is still booting — that one is a stall, reported by stallSeconds", () => {
    const booting = sessionLoad({ bootsInFlight: 2, pid: 100, sessionId: "held", toolShellsInFlight: 0 });
    const report = reportOf({ seats: [OLD_BASH], sessions: [booting] });
    expect(report.stuckCount).toBe(0);
  });

  it("does NOT grade a tool that leaves no process, because there is nothing for an absence to mean", () => {
    const readCall = seatStream({
      inFlightSeconds: DEFAULT_HOOK_STALL_HOLD_SECONDS * 4,
      inFlightTool: "Read",
      sessionId: "held",
    });
    const report = reportOf({ seats: [readCall], sessions: [NOTHING_RUNNING] });
    expect(report.stuckCount).toBe(0);
    expect(report.seats[0]!.inFlightTool).toBe("Read");
  });

  it("grades a call exactly ON the line, and one a second under it not at all", () => {
    const onTheLine = seatStream({
      inFlightSeconds: DEFAULT_HOOK_STALL_HOLD_SECONDS,
      inFlightTool: "Bash",
      sessionId: "held",
    });
    const under = seatStream({
      inFlightSeconds: DEFAULT_HOOK_STALL_HOLD_SECONDS - 1,
      inFlightTool: "Bash",
      sessionId: "held",
    });
    expect(reportOf({ seats: [onTheLine], sessions: [NOTHING_RUNNING] }).stuckCount).toBe(1);
    expect(reportOf({ seats: [under], sessions: [NOTHING_RUNNING] }).stuckCount).toBe(0);
  });

  it("does NOT grade a seat with nothing in flight at all", () => {
    const report = reportOf({ seats: [seatStream({ sessionId: "held" })], sessions: [NOTHING_RUNNING] });
    expect(report.stuckCount).toBe(0);
    expect(report.seats[0]!.inFlightSeconds).toBeUndefined();
  });

  it("sorts a stalled seat above a stuck one, and a stuck one above a merely busy one", () => {
    const stalled = sessionLoad({
      bootsInFlight: 3,
      cpuPct: 1,
      hookStallScript: "pretooluse-poll-gate",
      hookStallSeconds: DEFAULT_HOOK_STALL_HOLD_SECONDS * 2,
      pid: 200,
      sessionId: "stalled",
    });
    const busy = sessionLoad({ cpuPct: 400, pid: 300, sessionId: "busy" });
    const report = reportOf({
      seats: [OLD_BASH, seatStream({ sessionId: "stalled" }), seatStream({ sessionId: "busy" })],
      sessions: [busy, NOTHING_RUNNING, stalled],
    });
    expect(report.seats.map((seat) => seat.sessionId)).toEqual(["stalled", "held", "busy"]);
  });

  it("owes a REACT line that says look before acting, and names the seat by its workspace", () => {
    const report = reportOf({ seats: [OLD_BASH], sessions: [NOTHING_RUNNING] });
    expect(report.react.length).toBe(1);
    expect(report.react[0]!).toContain("seat held has had a Bash call in flight 20m");
    expect(report.react[0]!).toContain("no hook process and no tool shell running for it");
    expect(report.react[0]!).toContain("slopweaver perf seat workspace:28");
    expect(report.react[0]!).toContain("Look before acting");
  });

  it("puts the count above the fold, flags the seat row, and expands the caveat in the drill-down", () => {
    const report = reportOf({ seats: [OLD_BASH], sessions: [NOTHING_RUNNING] });
    expect(perfSummaryLine({ report })).toContain("1 seat(s) with nothing running for an in-flight Bash, oldest 20m");
    expect(perfFoldLines({ report })[0]!).toContain("STUCK held");
    const drilldown = perfSeatLines({ report, seat: report.seats[0]! }).join("\n");
    expect(drilldown).toContain("Bash began 20m ago with no later frame — and NOTHING is running for it");
    expect(drilldown).toContain("SUSPICION, not a verdict");
  });

  it("says nothing about stuck seats above the fold when there are none", () => {
    const report = reportOf({ seats: [seatStream({ sessionId: "held" })], sessions: [NOTHING_RUNNING] });
    expect(perfSummaryLine({ report })).not.toContain("nothing running");
    expect(perfSeatLines({ report, seat: report.seats[0]! }).join("\n")).toContain(
      "closed out by a later frame or a turn boundary",
    );
  });
});
