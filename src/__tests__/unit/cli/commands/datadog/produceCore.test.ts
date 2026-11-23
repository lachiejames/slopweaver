/**
 * `datadog produce`'s pure core: its flags — every rejection collected, a day checked against the calendar and
 * against the today handed in — and the lines a run prints.
 */
import { describe, expect, it } from "vitest";

import { datadogArgsErrorLines } from "../../../../../cli/commands/datadog/errors.js";
import { parseDatadogProduceOptions, produceReportLines } from "../../../../../cli/commands/datadog/produceCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const TODAY = "2026-09-17";
const BASE = ["--producer", "daily-delivery", "--day", "2026-09-16", "--out", "/tmp/day.json"];

describe("parseDatadogProduceOptions", () => {
  it("reads a full invocation", () => {
    expect(
      unwrap(parseDatadogProduceOptions({ rest: [...BASE, "--home", "/state/home", "--json"], todayUtc: TODAY })),
    ).toEqual({ day: "2026-09-16", home: "/state/home", json: true, out: "/tmp/day.json", producer: "daily-delivery" });
  });

  it("accepts today itself", () => {
    const rest = ["--producer", "daily-delivery", "--day", TODAY, "--out", "/tmp/day.json"];
    expect(unwrap(parseDatadogProduceOptions({ rest, todayUtc: TODAY })).day).toBe(TODAY);
  });

  it("collects every missing flag at once", () => {
    const error = unwrapErr(parseDatadogProduceOptions({ rest: [], todayUtc: TODAY }));
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(datadogArgsErrorLines({ error })).toEqual([
      "--producer is required: a name declared under profile.json datadog.metricsProducers",
      "--day is required: the UTC day, YYYY-MM-DD, the producer computes",
      '--out is required: where the { "series": [...] } payload is written',
    ]);
  });

  it.each([
    ["not a date at all", "yesterday", "--day must be a UTC day as YYYY-MM-DD, got yesterday"],
    ["a date the calendar does not have", "2026-02-30", "--day must be a UTC day as YYYY-MM-DD, got 2026-02-30"],
    ["a day after today", "2026-09-18", "--day 2026-09-18 is after today (2026-09-17 UTC)"],
  ])("refuses %s", (_label, day, message) => {
    const rest = ["--producer", "daily-delivery", "--day", day, "--out", "/tmp/day.json"];
    const error = unwrapErr(parseDatadogProduceOptions({ rest, todayUtc: TODAY }));
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(datadogArgsErrorLines({ error })).toEqual([message]);
  });

  it("refuses a flag it does not know", () => {
    const error = unwrapErr(parseDatadogProduceOptions({ rest: [...BASE, "--dry-run"], todayUtc: TODAY }));
    const errors = datadogArgsErrorLines({ error });
    expect(error.code).toBe("FLAGS_INVALID");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("--dry-run");
  });
});

describe("produceReportLines", () => {
  it("says what was written and ends on the dry-run submit that checks it", () => {
    expect(
      produceReportLines({
        report: { day: "2026-09-16", out: "/tmp/day.json", pointCount: 9, producer: "daily-delivery", seriesCount: 3 },
      }),
    ).toEqual([
      "datadog produce: producer 'daily-delivery' for 2026-09-16 wrote 3 series / 9 point(s) to /tmp/day.json",
      "  next: slopweaver datadog submit --series /tmp/day.json --allow-late --dry-run",
    ]);
  });
});
