/** The `datadog` verbs' typed failures: the alert-digest and produce factories, and what each renders. */
import { describe, expect, it } from "vitest";

import {
  DatadogArgsErrors,
  DatadogProduceErrors,
  datadogArgsErrorLines,
  datadogProduceErrorLines,
} from "../../../../../cli/commands/datadog/errors.js";

describe("alert-digest factories", () => {
  it("names a missing probe set and a missing label", () => {
    const probes = DatadogArgsErrors.alertDigestProbesMissing();
    const label = DatadogArgsErrors.alertDigestLabelMissing();
    expect([probes.code, probes.flag]).toEqual(["FLAG_MISSING", "--probes"]);
    expect([label.code, label.flag]).toEqual(["FLAG_MISSING", "--label"]);
    expect(datadogArgsErrorLines({ error: probes })).toEqual([
      "--probes is required: the declared probe set, as a JSON document, a path to one, or - for stdin",
    ]);
    expect(datadogArgsErrorLines({ error: label })).toEqual([
      "--label is required: the card's subject, which prefixes its TL;DR",
    ]);
  });

  it("states the width caps with the measured length", () => {
    const label = DatadogArgsErrors.alertDigestLabelTooLong({ label: "L".repeat(41), max: 40 });
    const window = DatadogArgsErrors.alertDigestWindowTooLong({ max: 12, window: "1789352086508" });
    expect(label.code).toBe("INVALID_FLAG_VALUE");
    expect(label.message).toBe(
      "--label is 41 characters and the card's subject is capped at 40 — it prefixes the TL;DR, which has its own width to fit",
    );
    expect(window.message).toBe(
      "--window is 13 characters and the card's window label is capped at 12 — write it as a duration (90m, 24h, 7d, 2w)",
    );
  });

  it("refuses both output modes at once as an options refusal", () => {
    const error = DatadogArgsErrors.alertDigestOutputModesConflict();
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(datadogArgsErrorLines({ error })).toEqual([
      "pass --form or --json, not both: --form emits the digest form ALONE for piping, --json contains it",
    ]);
  });
});

describe("produce factories", () => {
  it("names each required flag", () => {
    expect(DatadogArgsErrors.producerMissing().message).toBe(
      "--producer is required: a name declared under profile.json datadog.metricsProducers",
    );
    expect(DatadogArgsErrors.dayMissing().message).toBe(
      "--day is required: the UTC day, YYYY-MM-DD, the producer computes",
    );
    expect(DatadogArgsErrors.outMissing().message).toBe(
      '--out is required: where the { "series": [...] } payload is written',
    );
  });

  it("refuses a day that is not a calendar day or is still ahead", () => {
    const notADay = DatadogArgsErrors.dayNotACalendarDay({ day: "2026-02-30" });
    const ahead = DatadogArgsErrors.dayAfterToday({ day: "2026-09-18", todayUtc: "2026-09-17" });
    expect([notADay.code, notADay.flag, notADay.got]).toEqual(["INVALID_FLAG_VALUE", "--day", "2026-02-30"]);
    expect(notADay.message).toBe("--day must be a UTC day as YYYY-MM-DD, got 2026-02-30");
    expect(ahead.message).toBe("--day 2026-09-18 is after today (2026-09-17 UTC)");
  });

  it("carries an options refusal's reasons one per line", () => {
    const error = DatadogArgsErrors.optionsRefused({ reasons: ["a", "b"] });
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(datadogArgsErrorLines({ error })).toEqual(["a", "b"]);
  });
});

describe("DatadogProduceErrors", () => {
  it("renders a payload write failure as the path and the cause", () => {
    const cause = new Error("EACCES: denied");
    const error = DatadogProduceErrors.payloadWriteFailed({ cause, out: "/tmp/day.json" });
    expect(error.code).toBe("PAYLOAD_WRITE_FAILED");
    expect(error.out).toBe("/tmp/day.json");
    expect(error.cause).toBe(cause);
    expect(datadogProduceErrorLines({ error })).toEqual(["could not write /tmp/day.json — EACCES: denied"]);
  });
});
