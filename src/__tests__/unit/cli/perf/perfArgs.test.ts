import { describe, expect, it } from "vitest";
import { PERF_FLAG_NAMES, parsePerfArgs, windowMinutesOf } from "../../../../cli/commands/perf/core.js";
import { hookScriptStem } from "../../../../cli/commands/perf/hook.js";
import { matchSeat } from "../../../../cli/commands/perf/seat.js";
import { runPerfSummary } from "../../../../cli/commands/perf/summary.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { DEFAULT_WINDOW_MINUTES } from "../../../../live/perf/read.js";
import { perfReport } from "../../../../live/perf/report.js";
import { fleetReading, LOAD, seatStream, sessionLoad, streamReading } from "../../live/perf/perfFixtures.js";

const REPORT = perfReport({
  fleet: fleetReading({
    sessions: [
      sessionLoad({ pid: 35425, sessionId: "a0000083-0000-4000-8000-000000000090" }),
      sessionLoad({ pid: 33272, sessionId: "a0000104-0000-4000-8000-000000000115" }),
    ],
  }),
  hookOverruns: undefined,
  load: LOAD,
  strayDevServers: undefined,
  stream: streamReading({
    seats: [
      seatStream({
        cwd: "/w/worktrees/supervisor-sees-fleet-performance",
        sessionId: "a0000104-0000-4000-8000-000000000115",
        workspaceId: "workspace-12",
      }),
    ],
  }),
});

describe("PERF_FLAG_NAMES", () => {
  it("lists every flag the parser accepts, dash-prefixed and sorted, for the help-truth ratchet", () => {
    expect(PERF_FLAG_NAMES).toEqual(["--json", "--window-minutes"]);
  });
});

describe("parsePerfArgs", () => {
  it("refuses a stray positional on the summary, where one is a typo", () => {
    const parsed = parsePerfArgs({ rest: ["seeat"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("seeat");
  });

  it("keeps a positional for the drill-downs, which address a seat or a hook by name", () => {
    const parsed = unwrap(parsePerfArgs({ allowPositionals: true, rest: ["poll-gate", "--json"] }));
    expect(parsed.positionals).toEqual(["poll-gate"]);
    expect(parsed.values["json"]).toBe(true);
  });
});

describe("windowMinutesOf", () => {
  it("takes a positive integer as given", () => {
    expect(windowMinutesOf({ values: { "window-minutes": "15" } })).toBe(15);
  });

  it("falls back to the default rather than to zero, which would report every seat unmeasured", () => {
    expect(windowMinutesOf({ values: {} })).toBe(DEFAULT_WINDOW_MINUTES);
    expect(windowMinutesOf({ values: { "window-minutes": "0" } })).toBe(DEFAULT_WINDOW_MINUTES);
    expect(windowMinutesOf({ values: { "window-minutes": "-5" } })).toBe(DEFAULT_WINDOW_MINUTES);
    expect(windowMinutesOf({ values: { "window-minutes": "ten" } })).toBe(DEFAULT_WINDOW_MINUTES);
    expect(windowMinutesOf({ values: { "window-minutes": "1.5" } })).toBe(DEFAULT_WINDOW_MINUTES);
  });

  it("ignores a boolean value, which is what a flag typed with no argument leaves behind", () => {
    expect(windowMinutesOf({ values: { "window-minutes": true } })).toBe(DEFAULT_WINDOW_MINUTES);
  });
});

describe("matchSeat", () => {
  it("resolves a session id exactly", () => {
    expect(matchSeat({ ref: "a0000083-0000-4000-8000-000000000090", report: REPORT })!.pid).toBe(35425);
  });

  it("resolves a cmux workspace id exactly", () => {
    expect(matchSeat({ ref: "workspace-12", report: REPORT })!.pid).toBe(33272);
  });

  it("resolves a pid, which is how a `ps` reader already holds the seat", () => {
    expect(matchSeat({ ref: "33272", report: REPORT })!.sessionId).toBe("a0000104-0000-4000-8000-000000000115");
  });

  it("resolves a worktree by substring, so a board slug reaches its row without the absolute path", () => {
    expect(matchSeat({ ref: "supervisor-sees-fleet", report: REPORT })!.pid).toBe(33272);
  });

  it("prefers an exact id over a worktree substring", () => {
    expect(matchSeat({ ref: "a0000083-0000-4000-8000-000000000090", report: REPORT })!.pid).toBe(35425);
  });

  it("answers undefined for a reference that matches nothing, and for an empty one", () => {
    expect(matchSeat({ ref: "nobody", report: REPORT })).toBeUndefined();
    expect(matchSeat({ ref: "   ", report: REPORT })).toBeUndefined();
  });
});

describe("hookScriptStem", () => {
  it("adds the shim's prefix to the name anybody actually says", () => {
    expect(hookScriptStem({ name: "poll-gate" })).toBe("pretooluse-poll-gate");
  });

  it("leaves an already-prefixed name alone, either phase", () => {
    expect(hookScriptStem({ name: "pretooluse-poll-gate" })).toBe("pretooluse-poll-gate");
    expect(hookScriptStem({ name: "posttooluse-record" })).toBe("posttooluse-record");
  });

  it("drops the file extension a copied path carries", () => {
    expect(hookScriptStem({ name: "pretooluse-poll-gate.sh" })).toBe("pretooluse-poll-gate");
    expect(hookScriptStem({ name: "admit.ts" })).toBe("pretooluse-admit");
  });

  it("trims surrounding whitespace", () => {
    expect(hookScriptStem({ name: "  poll-gate  " })).toBe("pretooluse-poll-gate");
  });
});

describe("runPerfSummary", () => {
  /** An argv the router would hand the default verb: `[node, cli, perf, …rest]`. */
  const argv = ({ rest }: { rest: readonly string[] }): readonly string[] => ["node", "slopweaver", "perf", ...rest];

  it("prints usage on --help without reading the machine or the cmux log", () => {
    expect(runPerfSummary(argv({ rest: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses a stray positional before taking any reading, where one is a typo for a drill-down", () => {
    expect(runPerfSummary(argv({ rest: ["seeat"] }))).toBe(EXIT_USAGE);
  });

  it("rejects an unknown flag before it reads the machine or the cmux log", () => {
    expect(runPerfSummary(argv({ rest: ["--stalls-only"] }))).toBe(EXIT_USAGE);
  });
});
