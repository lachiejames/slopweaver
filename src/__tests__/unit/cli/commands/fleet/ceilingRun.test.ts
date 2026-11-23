/**
 * `fleet ceiling`: strict argument parsing, and the run against plain injected seams — a clock, a default
 * home, a reader returning a fixed report, a `fleet why` reader, a page publisher that records what it was handed,
 * and two arrays standing in for the output channels.
 */
import { describe, expect, it } from "vitest";
import type { FleetCeilingReport } from "../../../../../capacity/seatCeiling.js";
import { renderFleetCeilingLines } from "../../../../../capacity/seatCeilingRender.js";
import {
  FLEET_CEILING_FLAG_NAMES,
  type FleetCeilingDeps,
  parseFleetCeilingArgs,
  runFleetCeiling,
} from "../../../../../cli/commands/fleet/ceilingRun.js";
import { fleetCommandErrorLines } from "../../../../../cli/commands/fleet/errors.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { measuredFleetCeilingReport } from "../../../../fleetCeilingReportFixture.js";

/** A small report: one plan, nothing measurable — enough for the run to print and serialise. */
const REPORT: FleetCeilingReport = {
  burn: { kind: "unmeasurable", reason: "alpha has no run of weekly readings in the span" },
  ceiling: { kind: "unmeasurable", reason: "the burn per working seat is unknown" },
  combinedUnusedShareUpperBound: null,
  fromIso: "2026-09-27T13:44:00.000Z",
  observedExpiredPlanWeeks: 0,
  planAliases: ["alpha"],
  problems: [],
  seats: {
    coveredHours: 0,
    meanOpenSeats: null,
    meanWorkingSeats: null,
    peakOpenSeats: null,
    peakWorkingSeats: null,
    samples: 0,
    unknownHours: 168,
    widestGapSeconds: null,
    workingSeatHours: 0,
  },
  toIso: "2026-10-04T13:44:00.000Z",
  uncountedPlans: ["alpha: no weekly window was observed resetting in the span, so it is not counted"],
  unusedByPlan: [
    { expiredWindows: 0, planAlias: "alpha", unusedPlanWeeksUpperBound: null, widestLastReadingToResetSeconds: null },
  ],
  unusedPlanWeeksUpperBound: null,
};

/** Fake seams that record every request and line, and answer the reader with `answer`. */
function fakeDeps({
  answer,
  published = ok({ url: "file:///default/home/pages/page/index.html" }),
}: {
  answer: Result<FleetCeilingReport>;
  published?: Result<{ readonly url: string }>;
}): {
  deps: FleetCeilingDeps;
  requests: { home: string; days: number; nowIso: string }[];
  pages: { home: string; slug: string; nowIso: string }[];
  out: string[];
  diagnostics: string[];
} {
  const requests: { home: string; days: number; nowIso: string }[] = [];
  const pages: { home: string; slug: string; nowIso: string }[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: FleetCeilingDeps = {
    defaultHome: () => "/default/home",
    now: () => "2026-10-05T09:00:00.000Z",
    publish: async ({ home, slug, nowIso }) => {
      pages.push({ home, nowIso, slug });
      return published;
    },
    readReport: async (request) => {
      requests.push(request);
      return answer;
    },
    readWhy: () => ({ kind: "read", sentences: ["The supervisor's seat cap binds now."] }),
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, out, pages, requests };
}

describe("FLEET_CEILING_FLAG_NAMES", () => {
  it("names every flag the parser accepts", () => {
    expect(FLEET_CEILING_FLAG_NAMES).toEqual(["--days", "--home", "--now", "--json", "--publish"]);
  });
});

/** The rendered lines of the refusal a tail provokes. */
function linesOf({ rest }: { rest: readonly string[] }): readonly string[] {
  return fleetCommandErrorLines({ error: unwrapErr(parseFleetCeilingArgs({ rest })) });
}

describe("parseFleetCeilingArgs", () => {
  it("defaults to the last seven days, human output, the default home and the wall clock", () => {
    expect(unwrap(parseFleetCeilingArgs({ rest: [] }))).toEqual({
      days: 7,
      home: undefined,
      json: false,
      nowIso: undefined,
      publish: false,
    });
  });

  it("accepts --days at both bounds", () => {
    expect(unwrap(parseFleetCeilingArgs({ rest: ["--days", "1"] })).days).toBe(1);
    expect(unwrap(parseFleetCeilingArgs({ rest: ["--days", "28"] })).days).toBe(28);
  });

  it("refuses --days outside 1..28, naming what it got", () => {
    expect(linesOf({ rest: ["--days", "0"] })).toEqual(["--days must be a whole number from 1 to 28, got 0"]);
    expect(linesOf({ rest: ["--days", "29"] })).toEqual(["--days must be a whole number from 1 to 28, got 29"]);
    expect(unwrapErr(parseFleetCeilingArgs({ rest: ["--days", "0"] })).code).toBe("ARGUMENTS_REFUSED");
  });

  it("refuses a --days that is not a whole number", () => {
    expect(linesOf({ rest: ["--days", "1.5"] })).toEqual(["--days must be a whole number from 1 to 28, got 1.5"]);
    expect(linesOf({ rest: ["--days", "week"] })).toEqual(["--days must be a whole number from 1 to 28, got week"]);
  });

  it("normalises --now to a full ISO instant", () => {
    expect(unwrap(parseFleetCeilingArgs({ rest: ["--now", "2026-10-04T13:44:00Z"] })).nowIso).toBe(
      "2026-10-04T13:44:00.000Z",
    );
  });

  it("refuses a --now that is not an instant", () => {
    expect(linesOf({ rest: ["--now", "yesterday"] })).toEqual(["--now yesterday is not an ISO-8601 instant"]);
  });

  it("reports every rejection at once", () => {
    expect(linesOf({ rest: ["--days", "0", "--now", "yesterday"] })).toEqual([
      "--days must be a whole number from 1 to 28, got 0",
      "--now yesterday is not an ISO-8601 instant",
    ]);
  });

  it("reads --home and --json", () => {
    expect(unwrap(parseFleetCeilingArgs({ rest: ["--home", "/h", "--json"] }))).toEqual({
      days: 7,
      home: "/h",
      json: true,
      nowIso: undefined,
      publish: false,
    });
  });
});

describe("runFleetCeiling", () => {
  it("reads with the default home and the clock when neither flag is given, and prints the rendered lines", async () => {
    const fake = fakeDeps({ answer: ok(REPORT) });
    const code = await runFleetCeiling({ deps: fake.deps, rest: [] });
    expect(code).toBe(EXIT_OK);
    expect(fake.requests).toEqual([{ days: 7, home: "/default/home", nowIso: "2026-10-05T09:00:00.000Z" }]);
    expect(fake.out).toEqual(renderFleetCeilingLines({ report: REPORT }));
    expect(fake.diagnostics).toEqual([]);
    expect(fake.pages).toEqual([]);
  });

  it("reads with the named home, instant and span when they are given", async () => {
    const fake = fakeDeps({ answer: ok(REPORT) });
    await runFleetCeiling({ deps: fake.deps, rest: ["--home", "/h", "--now", "2026-10-04T13:44:00Z", "--days", "14"] });
    expect(fake.requests).toEqual([{ days: 14, home: "/h", nowIso: "2026-10-04T13:44:00.000Z" }]);
  });

  it("prints one JSON line equal to the report under --json", async () => {
    const fake = fakeDeps({ answer: ok(REPORT) });
    const code = await runFleetCeiling({ deps: fake.deps, rest: ["--json"] });
    expect(code).toBe(EXIT_OK);
    expect(fake.out).toEqual([JSON.stringify(REPORT)]);
  });

  it("exits 1 with the reader's error on the diagnostic channel, printing nothing", async () => {
    const fake = fakeDeps({ answer: err(["the accounts file does not parse", "second problem"]) });
    const code = await runFleetCeiling({ deps: fake.deps, rest: [] });
    expect(code).toBe(EXIT_ERROR);
    expect(fake.diagnostics).toEqual(["fleet ceiling: the accounts file does not parse; second problem"]);
    expect(fake.out).toEqual([]);
  });

  it("exits 2 on a bad argument before reading anything", async () => {
    const fake = fakeDeps({ answer: ok(REPORT) });
    const code = await runFleetCeiling({ deps: fake.deps, rest: ["--days", "99"] });
    expect(code).toBe(EXIT_USAGE);
    expect(fake.diagnostics).toEqual(["fleet ceiling: --days must be a whole number from 1 to 28, got 99"]);
    expect(fake.requests).toEqual([]);
    expect(fake.out).toEqual([]);
  });

  it("exits 2 on a flag it does not know", async () => {
    const fake = fakeDeps({ answer: ok(REPORT) });
    const code = await runFleetCeiling({ deps: fake.deps, rest: ["--weeks", "2"] });
    expect(code).toBe(EXIT_USAGE);
    expect(fake.requests).toEqual([]);
    expect(fake.diagnostics).toHaveLength(1);
  });

  it("publishes the slot's morning page under --publish, placing no card, when every part read", async () => {
    const fake = fakeDeps({ answer: ok(measuredFleetCeilingReport()) });
    const code = await runFleetCeiling({
      deps: fake.deps,
      rest: ["--now", "2026-01-05T19:00:00Z", "--publish"],
    });
    expect(code).toBe(EXIT_OK);
    expect(fake.pages).toEqual([
      { home: "/default/home", nowIso: "2026-10-05T09:00:00.000Z", slug: "fleet-ceiling-2026-01-06" },
    ]);
    expect(fake.diagnostics).toEqual([
      "fleet ceiling: published page fleet-ceiling-2026-01-06 → file:///default/home/pages/page/index.html · " +
        "no card placed",
    ]);
  });

  it("still publishes a broken reading's page under --publish, and exits 1 naming what broke", async () => {
    const fake = fakeDeps({ answer: ok(REPORT) });
    const code = await runFleetCeiling({
      deps: fake.deps,
      rest: ["--now", "2026-01-05T19:00:00Z", "--publish"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(fake.pages.map((page) => page.slug)).toEqual(["fleet-ceiling-2026-01-06"]);
    expect(fake.diagnostics[1]).toBe(
      "fleet ceiling: the measurement is still broken: the plans' ceiling could not be measured, " +
        "the burn per working seat is unknown",
    );
  });

  it("exits 1 naming the slug when --publish cannot write the page", async () => {
    const fake = fakeDeps({ answer: ok(measuredFleetCeilingReport()), published: err(["EACCES"]) });
    const code = await runFleetCeiling({
      deps: fake.deps,
      rest: ["--now", "2026-01-05T19:00:00Z", "--publish"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(fake.diagnostics).toEqual(["fleet ceiling: page fleet-ceiling-2026-01-06 could not be published: EACCES"]);
  });
});
