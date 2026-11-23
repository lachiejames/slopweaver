import { describe, expect, it } from "vitest";
import type { StrayDevServer } from "../../../../live/machine/devServers.js";
import {
  perfFoldLines,
  perfHookLines,
  perfJson,
  perfSeatLines,
  perfSummaryLine,
} from "../../../../live/perf/render.js";
import { perfReport } from "../../../../live/perf/report.js";
import { fleetReading, LOAD, seatStream, sessionLoad, streamReading } from "./perfFixtures.js";

const STALLED = sessionLoad({
  bootsInFlight: 6,
  cpuPct: 1.1,
  hookStallScript: "pretooluse-poll-gate",
  hookStallSeconds: 2580,
  parallelToolCalls: 3,
  pid: 100,
  sessionId: "stalled",
});
const QUIET = sessionLoad({ cpuPct: 4, pid: 200, sessionId: "quiet" });

const HEALTHY = perfReport({
  fleet: fleetReading({ sessions: [QUIET] }),
  hookOverruns: undefined,
  load: LOAD,
  strayDevServers: undefined,
  stream: streamReading({
    seats: [seatStream({ cwd: "/w/quiet", firings: 12, sessionId: "quiet", turnaroundSamples: [7, 9, 40] })],
  }),
});

const STALLED_REPORT = perfReport({
  fleet: fleetReading({ sessions: [STALLED, QUIET] }),
  hookOverruns: undefined,
  load: LOAD,
  strayDevServers: undefined,
  stream: streamReading({
    byName: [
      { count: 90, name: "agent.hook.PreToolUse" },
      { count: 4, name: "agent.hook.Stop" },
    ],
    frames: 94,
    seats: [seatStream({ cwd: "/w/stalled", firings: 3, sessionId: "stalled", workspaceId: "workspace-7" })],
  }),
});

describe("perfSummaryLine", () => {
  it("is ONE line carrying every field the sweep reads, with no hook over the line", () => {
    // The FLEET distribution pools one p50 per seat, so a one-seat fleet reads p50 == p95 == that seat's own
    // p50 (9s) — its p95 of 40s belongs on the seat line, not here.
    expect(perfSummaryLine({ report: HEALTHY })).toBe(
      "fleet perf · load 7.5 on 15 cores · 1 seat(s) · no hook over the line · 0 hook boot(s) live · " +
        "turnaround p50 9s p95 9s · 100 frame(s)/60m",
    );
    expect(HEALTHY.seats[0]!.turnaround!.p95).toBe(40);
  });

  it("names the worst stalled hook in the summary rather than only counting stalls", () => {
    expect(perfSummaryLine({ report: STALLED_REPORT })).toContain("1 seat(s) stalled, worst poll-gate hook 43m");
  });

  it("says the load was unread rather than printing zero, which reads as idle", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [QUIET] }),
      hookOverruns: undefined,
      load: { cores: 15, load1: undefined },
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(perfSummaryLine({ report })).toContain("load unread");
  });

  it("says the core count was unread rather than dividing by nothing", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [QUIET] }),
      hookOverruns: undefined,
      load: { cores: undefined, load1: 9 },
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(perfSummaryLine({ report })).toContain("load 9 on an unread core count");
  });

  it("says turnaround is unmeasured rather than printing zero seconds", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [QUIET] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ frames: 0, seats: [] }),
    });
    expect(perfSummaryLine({ report })).toContain("turnaround unmeasured");
    expect(perfSummaryLine({ report })).toContain("0 frame(s)/60m");
  });
});

describe("perfFoldLines", () => {
  it("flags the stalled seat and puts it first", () => {
    const lines = perfFoldLines({ report: STALLED_REPORT });
    expect(lines.length).toBe(2);
    expect(lines[0]!).toContain("STALLED stalled (pid 100)");
    expect(lines[0]!).toContain("3 in flight · 6 boots · poll-gate hook 43m");
    expect(lines[1]!).toContain("no hook running");
  });

  it("caps the fold at topN rows", () => {
    const many = [0, 1, 2, 3].map((n) => sessionLoad({ cpuPct: 10 - n, pid: 900 + n, sessionId: `s${String(n)}` }));
    const report = perfReport({
      fleet: fleetReading({ sessions: many }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(perfFoldLines({ report, topN: 2 }).length).toBe(2);
  });

  it("prints nothing when ps attributed no seat at all", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(perfFoldLines({ report })).toEqual([]);
  });
});

describe("perfSeatLines", () => {
  it("states the claim boundary on the turnaround line every time it prints one", () => {
    const lines = perfSeatLines({ report: HEALTHY, seat: HEALTHY.seats[0]! });
    const turnaround = lines.find((line) => line.includes("turnaround"))!;
    expect(turnaround).toContain("p50 9s, p95 40s, max 40s over 3 gap(s)");
    expect(turnaround).toContain("hook time PLUS tool time PLUS model time, never hook time alone");
  });

  it("names the live hook and the line it was graded against", () => {
    const lines = perfSeatLines({ report: STALLED_REPORT, seat: STALLED_REPORT.seats[0]! });
    expect(lines.find((line) => line.includes("live hook"))!).toBe(
      "  live hook   poll-gate hook running 43m (line 5m)",
    );
  });

  it("says no hook is running rather than reporting a zero-second one", () => {
    const lines = perfSeatLines({ report: HEALTHY, seat: HEALTHY.seats[0]! });
    expect(lines).toContain("  live hook   none running at the instant of this read");
  });

  it("says the stream never saw a seat rather than printing an empty workspace", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [QUIET] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    const lines = perfSeatLines({ report, seat: report.seats[0]! });
    expect(lines).toContain("  workspace   not seen in the hook stream");
    expect(lines).toContain("  worktree    not seen in the hook stream");
    expect(lines.find((line) => line.includes("turnaround"))!).toContain("paired into no gap");
  });
});

describe("perfHookLines", () => {
  it("names every seat the hook is live on, marking the ones over the line", () => {
    const lines = perfHookLines({
      report: STALLED_REPORT,
      script: "pretooluse-poll-gate",
      stream: streamReading({
        byName: [{ count: 90, name: "agent.hook.PreToolUse" }],
        seats: [],
      }),
    });
    expect(lines[0]!).toBe("hook pretooluse-poll-gate");
    expect(lines[1]!).toBe("  live        43m on seat stalled (pid 100) — OVER THE LINE");
    expect(lines).toContain("  stream      agent.hook.PreToolUse fired 90 time(s) in the window");
  });

  it("says no seat had it running rather than printing an empty list", () => {
    const lines = perfHookLines({
      report: HEALTHY,
      script: "pretooluse-admit",
      stream: streamReading({ seats: [] }),
    });
    expect(lines).toContain("  live        no seat had it running at the instant of this read");
  });

  it("carries the concurrency caveat on every rendering, so a reader cannot take the count as complete", () => {
    const lines = perfHookLines({ report: HEALTHY, script: "pretooluse-admit", stream: streamReading({ seats: [] }) });
    expect(lines.some((line) => line.includes("only the LONGEST live hook per seat is attributable"))).toBe(true);
  });
});

describe("perfJson", () => {
  it("carries the same summary sentence a human reader gets, so the two can never diverge", () => {
    const parsed: unknown = JSON.parse(perfJson({ report: STALLED_REPORT }));
    const document = parsed as { summary: string; stalledCount: number; react: readonly string[] };
    expect(document.summary).toBe(perfSummaryLine({ report: STALLED_REPORT }));
    expect(document.stalledCount).toBe(1);
    expect(document.react.length).toBe(1);
  });
});

describe("the stray dev-server clause", () => {
  /** One duplicate, as `../machine/devServers.ts` hands it over. */
  const STRAY: StrayDevServer = {
    argvByPid: { "211": "next dev --port 3002" },
    cpuPct: 0.2,
    elapsedSeconds: 74,
    port: 3002,
    reason: "duplicate",
    rootPid: 210,
    servePid: 211,
    treePids: [211, 210],
    why: "a second server in /w/alpha — pid 201 has been up longer and keeps serving it",
    worktree: "/w/alpha",
  };

  const reportWith = ({ stray }: { stray: readonly StrayDevServer[] | undefined }): ReturnType<typeof perfReport> =>
    perfReport({
      fleet: fleetReading({ sessions: [QUIET] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: stray,
      stream: streamReading({ seats: [] }),
    });

  it("counts them in the one line above the fold", () => {
    expect(perfSummaryLine({ report: reportWith({ stray: [STRAY] }) })).toContain("1 stray dev server(s)");
  });

  it("says nothing at all when there are none, so the position is never trained away", () => {
    expect(perfSummaryLine({ report: reportWith({ stray: [] }) })).not.toContain("stray dev server");
  });

  it("says nothing when the class was not measured either, which is a different answer", () => {
    expect(perfSummaryLine({ report: reportWith({ stray: undefined }) })).not.toContain("stray dev server");
  });

  it("owes a REACT line carrying the row's OWN reason, never one that assumes the seat is gone", () => {
    const react = reportWith({ stray: [STRAY] }).react[0]!;
    expect(react).toContain("1 docs dev server(s) outlived what started them, worst /w/alpha (pid 211:");
    expect(react).toContain("pid 201 has been up longer and keeps serving it");
    expect(react).toContain("end them with `slopweaver machine reap`");
    expect(react).not.toContain("no seat behind them");
  });

  it("owes no REACT line when nothing is stray", () => {
    expect(reportWith({ stray: [] }).react).toEqual([]);
  });
});
