/**
 * `fleet why`: strict argument parsing, and the run against plain injected seams — a clock, a default home, a
 * reader returning a report the real measure built, and two arrays standing in for the output channels.
 */
import { describe, expect, it } from "vitest";

import {
  type FleetWhyError,
  FleetWhyErrors,
  type FleetWhyReport,
  measureFleetWhy,
} from "../../../../../capacity/fleetWhy.js";
import { fleetCommandErrorLines } from "../../../../../cli/commands/fleet/errors.js";
import {
  FLEET_WHY_FLAG_NAMES,
  type FleetWhyDeps,
  parseFleetWhyArgs,
  runFleetWhy,
} from "../../../../../cli/commands/fleet/whyRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";

/** A report with nothing recorded — enough for the run to print and serialise. */
const REPORT: FleetWhyReport = unwrap(
  measureFleetWhy({
    ceiling: undefined,
    latestMachine: undefined,
    machineReadings: [],
    minutes: 60,
    nowIso: "2026-10-09T15:00:00.000Z",
    problems: [],
    workingSeats: undefined,
  }),
);

/** Fake seams that record every request and line, and answer the reader with `answer`. */
function fakeDeps({ answer }: { answer: Result<FleetWhyReport, FleetWhyError> }): {
  deps: FleetWhyDeps;
  requests: { home: string; minutes: number; nowIso: string }[];
  out: string[];
  diagnostics: string[];
} {
  const requests: { home: string; minutes: number; nowIso: string }[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: FleetWhyDeps = {
    defaultHome: () => "/default/home",
    now: () => "2026-10-09T15:00:00.000Z",
    readReport: (request) => {
      requests.push(request);
      return answer;
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

describe("FLEET_WHY_FLAG_NAMES", () => {
  it("names every flag the parser accepts", () => {
    expect(FLEET_WHY_FLAG_NAMES).toEqual(["--home", "--minutes", "--now", "--json"]);
  });
});

describe("parseFleetWhyArgs", () => {
  it("defaults to the last hour, human output, the default home and the wall clock", () => {
    expect(unwrap(parseFleetWhyArgs({ rest: [] }))).toEqual({
      home: undefined,
      json: false,
      minutes: 60,
      nowIso: undefined,
    });
  });

  it("reads every flag, normalising --now to an ISO instant", () => {
    expect(
      unwrap(
        parseFleetWhyArgs({ rest: ["--minutes", "1440", "--home", "/h", "--now", "2026-10-09T14:12:00Z", "--json"] }),
      ),
    ).toEqual({ home: "/h", json: true, minutes: 1440, nowIso: "2026-10-09T14:12:00.000Z" });
  });

  it("refuses every bad flag at once", () => {
    const both = unwrapErr(parseFleetWhyArgs({ rest: ["--minutes", "1441", "--now", "lunchtime"] }));
    expect(both.code).toBe("ARGUMENTS_REFUSED");
    expect(fleetCommandErrorLines({ error: both })).toEqual([
      "--minutes must be a whole number from 1 to 1440, got 1441",
      "--now lunchtime is not an ISO-8601 instant",
    ]);
    expect(fleetCommandErrorLines({ error: unwrapErr(parseFleetWhyArgs({ rest: ["--minutes", "0"] })) })).toEqual([
      "--minutes must be a whole number from 1 to 1440, got 0",
    ]);
  });
});

describe("runFleetWhy", () => {
  it("reads the default home at the wall clock and prints the report's lines", () => {
    const fake = fakeDeps({ answer: ok(REPORT) });
    expect(runFleetWhy({ deps: fake.deps, rest: [] })).toBe(EXIT_OK);
    expect(fake.requests).toEqual([{ home: "/default/home", minutes: 60, nowIso: "2026-10-09T15:00:00.000Z" }]);
    expect(fake.out).toEqual([
      "No usable machine capacity, fleet ceiling, session watch reading, so what binds the fleet is not known.",
      "No machine capacity reading landed in the last 60 min, so what the machine measured is not known.",
      "binding: unknown · window 2026-10-09T14:00:00.000Z → 2026-10-09T15:00:00.000Z",
      "problem: no usable machine capacity, fleet ceiling, session watch reading, so what binds the fleet is not known",
    ]);
    expect(fake.diagnostics).toEqual([]);
  });

  it("prints the whole report as one JSON line, sentences included, under --json", () => {
    const fake = fakeDeps({ answer: ok(REPORT) });
    expect(runFleetWhy({ deps: fake.deps, rest: ["--json", "--home", "/h", "--minutes", "30"] })).toBe(EXIT_OK);
    expect(fake.requests).toEqual([{ home: "/h", minutes: 30, nowIso: "2026-10-09T15:00:00.000Z" }]);
    expect(fake.out).toHaveLength(1);
    expect(JSON.parse(fake.out[0]!)).toEqual(REPORT);
  });

  it("exits usage on a bad flag without reading anything", () => {
    const fake = fakeDeps({ answer: ok(REPORT) });
    expect(runFleetWhy({ deps: fake.deps, rest: ["--minutes", "soon"] })).toBe(EXIT_USAGE);
    expect(fake.requests).toEqual([]);
    expect(fake.diagnostics).toEqual(["fleet why: --minutes must be a whole number from 1 to 1440, got soon"]);
  });

  it("exits error, naming why, when the ledger cannot be read", () => {
    const fake = fakeDeps({ answer: err(FleetWhyErrors.ledgerUnreadable({ why: ["readings index unreadable"] })) });
    expect(runFleetWhy({ deps: fake.deps, rest: [] })).toBe(EXIT_ERROR);
    expect(fake.out).toEqual([]);
    expect(fake.diagnostics).toEqual(["fleet why: the readings ledger could not be read: readings index unreadable"]);
  });
});
