/**
 * `claude forecast`: its argument parse, and the exit a journal-less install gets.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeCommandErrorLines } from "../../../../../cli/commands/claude/errors.js";
import { parseClaudeForecastArgs, runClaudeForecast } from "../../../../../cli/commands/claude/forecastRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

describe("parseClaudeForecastArgs", () => {
  it("defaults to four weeks at trailing demand", () => {
    expect(unwrap(parseClaudeForecastArgs({ rest: [] }))).toEqual({
      demandBasis: "trailing",
      home: undefined,
      json: false,
      nowIso: undefined,
      weeks: 4,
    });
  });

  it("normalises --now to a canonical instant", () => {
    expect(unwrap(parseClaudeForecastArgs({ rest: ["--now", "2026-09-21T00:00Z", "--demand", "peak"] }))).toEqual({
      demandBasis: "peak",
      home: undefined,
      json: false,
      nowIso: "2026-09-21T00:00:00.000Z",
      weeks: 4,
    });
  });

  it("refuses a horizon outside 1..12, an unknown demand and a bad instant, all at once", () => {
    const parsed = parseClaudeForecastArgs({ rest: ["--weeks", "13", "--demand", "mean", "--now", "soon"] });
    const error = unwrapErr(parsed);
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    expect(claudeCommandErrorLines({ error })).toEqual([
      "--weeks must be a whole number from 1 to 12, got 13",
      "--demand is trailing or peak, got mean",
      "--now soon is not an ISO-8601 instant",
    ]);
  });
});

describe("runClaudeForecast", () => {
  const homes: string[] = [];
  afterEach(() => {
    homes.splice(0).forEach((home) => {
      rmSync(home, { force: true, recursive: true });
    });
  });

  it("exits usage on a bad flag, before reading anything", async () => {
    const diagnostics: string[] = [];
    const code = await runClaudeForecast({
      deps: {
        defaultHome: () => "/nonexistent",
        now: () => "2026-10-01T00:00:00.000Z",
        port: unavailablePlanRegisterPort(),
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: () => undefined,
      },
      rest: ["--weeks", "0"],
    });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics).toEqual(["claude forecast: --weeks must be a whole number from 1 to 12, got 0"]);
  });

  it("exits error naming the outage when the plan register's store is unreachable", async () => {
    const home = mkdtempSync(join(tmpdir(), "forecast-outage-"));
    homes.push(home);
    const diagnostics: string[] = [];
    const out: string[] = [];
    const code = await runClaudeForecast({
      deps: {
        defaultHome: () => "/nonexistent",
        now: () => "2026-10-01T00:00:00.000Z",
        port: unavailablePlanRegisterPort(),
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: (line) => out.push(line),
      },
      rest: ["--home", home],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("ECONNREFUSED");
  });

  it("exits expected-empty with the reason when no plan is configured", async () => {
    const home = mkdtempSync(join(tmpdir(), "forecast-"));
    homes.push(home);
    const out: string[] = [];
    const code = await runClaudeForecast({
      deps: {
        defaultHome: () => "/nonexistent",
        now: () => "2026-10-01T00:00:00.000Z",
        port: memoryPlanRegisterPort(),
        writeDiagnostic: () => undefined,
        writeOut: (line) => out.push(line),
      },
      rest: ["--home", home],
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out).toEqual([
      "claude historical trend: unmeasurable — no Claude plan is configured, so there is no fleet to forecast",
    ]);
  });
});
