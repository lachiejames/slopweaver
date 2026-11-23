/**
 * `fleet burn`: strict argument parsing, the line each host reads as, and the run against plain injected seams — a
 * clock, a default home, a scanner returning a fixed report, and two arrays standing in for the output channels.
 */
import { describe, expect, it } from "vitest";

import {
  FLEET_BURN_FLAG_NAMES,
  type FleetBurnDeps,
  hostBurnLine,
  parseFleetBurnArgs,
  runFleetBurn,
} from "../../../../../cli/commands/fleet/burnRun.js";
import { fleetCommandErrorLines } from "../../../../../cli/commands/fleet/errors.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { FleetBurnReport } from "../../../../../fleet/hostBurn.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** A report with one measured host and one unavailable one. */
const REPORT: FleetBurnReport = {
  activeWithinMinutes: 10,
  fromIso: "2026-10-07T09:00:00.000Z",
  hosts: {
    claude: {
      activeSessions: 4,
      kind: "measured",
      outputTokens: 8_950_000,
      projectedWeekTokens: 20_510_000_000,
      sessions: 210,
      totalTokens: 2_930_000_000,
    },
    codex: { kind: "unavailable", why: "the plan register names no Codex home" },
  },
  observedAtIso: "2026-10-08T09:00:00.000Z",
  windowHours: 24,
};

/** Fake seams that record every request and line. */
function fakeDeps(): {
  deps: FleetBurnDeps;
  requests: { home: string; nowIso: string }[];
  out: string[];
  diagnostics: string[];
} {
  const requests: { home: string; nowIso: string }[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: FleetBurnDeps = {
    defaultHome: () => "/default/home",
    now: () => "2026-10-08T09:00:00.000Z",
    readReport: async (request) => {
      requests.push(request);
      return REPORT;
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, out, requests };
}

describe("FLEET_BURN_FLAG_NAMES", () => {
  it("names every flag the parser accepts", () => {
    expect(FLEET_BURN_FLAG_NAMES).toEqual(["--home", "--now", "--json"]);
  });
});

describe("parseFleetBurnArgs", () => {
  it("normalises --now to an ISO instant and reads --home and --json", () => {
    expect(unwrap(parseFleetBurnArgs({ rest: ["--now", "2026-10-08T01:00:00Z", "--home", "/h", "--json"] }))).toEqual({
      home: "/h",
      json: true,
      nowIso: "2026-10-08T01:00:00.000Z",
    });
  });

  it("refuses a --now that is not an instant", () => {
    const error = unwrapErr(parseFleetBurnArgs({ rest: ["--now", "tuesday"] }));
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    expect(fleetCommandErrorLines({ error })).toEqual(["--now tuesday is not an ISO-8601 instant"]);
  });
});

describe("hostBurnLine", () => {
  it("says a measured host's burn, its output, its sessions and its seven-day amount", () => {
    expect(hostBurnLine({ burn: REPORT.hosts.claude, name: "Claude" })).toBe(
      "Claude: 2.93B tokens in 24h (8.95M output) across 210 sessions, 4 drawing now · 20.5B over 7 days at this rate",
    );
  });

  it("calls a partial burn a lower bound with no projection, and an unavailable one not measured", () => {
    const partial = {
      activeSessions: 0,
      kind: "partial",
      outputTokens: 2000,
      problems: ["/r.jsonl: its cumulative token counter fell inside the window"],
      sessions: 3,
      totalTokens: 41_000,
    } as const;
    expect([
      hostBurnLine({ burn: partial, name: "Codex" }),
      hostBurnLine({ burn: REPORT.hosts.codex, name: "Codex" }),
    ]).toEqual([
      "Codex: at least 41.0k tokens in 24h (2.00k output) across 3 sessions, 0 drawing now; no projection, 1 problem(s) — /r.jsonl: its cumulative token counter fell inside the window",
      "Codex: burn not measured — the plan register names no Codex home",
    ]);
  });
});

describe("runFleetBurn", () => {
  it("prints the report as one JSON document, measured at the clock's instant under the default home", async () => {
    const fake = fakeDeps();
    expect(await runFleetBurn({ deps: fake.deps, rest: ["--json"] })).toBe(EXIT_OK);
    expect([fake.requests, fake.out.map((line) => JSON.parse(line) as unknown)]).toEqual([
      [{ home: "/default/home", nowIso: "2026-10-08T09:00:00.000Z" }],
      [REPORT],
    ]);
  });

  it("prints the window and one line per host for a human", async () => {
    const fake = fakeDeps();
    expect(await runFleetBurn({ deps: fake.deps, rest: [] })).toBe(EXIT_OK);
    expect(fake.out).toEqual([
      'fleet burn: 2026-10-07T09:00:00.000Z → 2026-10-08T09:00:00.000Z; "drawing now" is the last 10 minutes',
      "Claude: 2.93B tokens in 24h (8.95M output) across 210 sessions, 4 drawing now · 20.5B over 7 days at this rate",
      "Codex: burn not measured — the plan register names no Codex home",
    ]);
  });

  it("refuses an unknown flag before anything is read", async () => {
    const fake = fakeDeps();
    expect(await runFleetBurn({ deps: fake.deps, rest: ["--days", "3"] })).toBe(EXIT_USAGE);
    expect([fake.requests.length, fake.diagnostics.length]).toEqual([0, 1]);
  });
});
