import { describe, expect, it } from "vitest";

import { parseDatadogSubmitOptions, submitPlanLines } from "../../../../../cli/commands/datadog/core.js";
import { DatadogArgsErrors } from "../../../../../cli/commands/datadog/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseDatadogSubmitOptions", () => {
  it("requires --series", () => {
    const parsed = parseDatadogSubmitOptions({ rest: [] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("--series is required");
  });

  it("refuses a blank --series rather than reading a file called ''", () => {
    const refused = unwrapErr(parseDatadogSubmitOptions({ rest: ["--series", "   "] }));
    expect(refused).toEqual(DatadogArgsErrors.seriesMissing());
    expect(refused.message).toBe(
      '--series is required: the path to a { "series": [...] } payload file, or - for stdin',
    );
  });

  it("defaults both safety flags to off, so a backfill has to say so", () => {
    const parsed = unwrap(parseDatadogSubmitOptions({ rest: ["--series", "p.json"] }));
    expect(parsed.allowLate).toBe(false);
    expect(parsed.dryRun).toBe(false);
    expect(parsed.json).toBe(false);
    expect(parsed.home).toBe(undefined);
  });

  it("reads every flag it accepts", () => {
    const parsed = unwrap(
      parseDatadogSubmitOptions({
        rest: ["--series", "p.json", "--allow-late", "--dry-run", "--json", "--home", "/tmp/h"],
      }),
    );
    expect(parsed.series).toBe("p.json");
    expect(parsed.allowLate).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.json).toBe(true);
    expect(parsed.home).toBe("/tmp/h");
  });

  it("keeps - as the stdin sentinel rather than treating it as a flag", () => {
    expect(unwrap(parseDatadogSubmitOptions({ rest: ["--series", "-"] })).series).toBe("-");
  });
});

describe("submitPlanLines", () => {
  const plan = {
    earliestIso: "2026-09-04T00:00:00.000Z",
    latePointCount: 5394,
    latestIso: "2026-09-06T14:11:51.000Z",
    pointCount: 7252,
    seriesCount: 7252,
    utcDays: ["2026-09-04", "2026-09-05", "2026-09-06"],
  };

  it("spells out every day rather than summarising them as a count", () => {
    const lines = submitPlanLines({ plan, verb: "submitted" });
    expect(lines[1]).toBe("  UTC days: 2026-09-04, 2026-09-05, 2026-09-06");
  });

  it("leads with the verb it was given", () => {
    expect(submitPlanLines({ plan, verb: "would submit" })[0]).toBe(
      "datadog submit: would submit 7252 series / 7252 point(s)",
    );
  });

  it("reports the span and the backdated count", () => {
    const lines = submitPlanLines({ plan, verb: "submitted" });
    expect(lines[2]).toBe("  span: 2026-09-04T00:00:00.000Z → 2026-09-06T14:11:51.000Z");
    expect(lines[3]).toBe("  backdated points: 5394");
  });
});
