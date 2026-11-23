import { describe, expect, it } from "vitest";

import { ALERT_SUMMARY_COUNT_MAX, alertSummaryFormSchema } from "../../../../../outbound/artifact/alertSummary.js";
import { TABLE_MAX_ROWS } from "../../../../../outbound/artifact/schema.js";
import { messageOf, tallyForm } from "./harness.js";

describe("alertSummaryFormSchema — every NUMBER is required, so a typo cannot report false coverage", () => {
  it("accepts the reference tally", () => {
    expect(alertSummaryFormSchema.safeParse(tallyForm()).success).toBe(true);
  });

  it("REFUSES a form with no `skipped`, rather than defaulting it to full coverage", () => {
    const { skipped: _dropped, ...withoutSkipped } = tallyForm();

    expect(alertSummaryFormSchema.safeParse(withoutSkipped).success).toBe(false);
  });

  it("REFUSES an unknown key and lists the fields, rather than dropping it because nobody is watching", () => {
    // This assertion is the INVERSE of the one it replaces, which read "STRIPS an unknown key, because this form
    // is filled unattended". That reasoning died with `strictForm`: unattended is where a dropped field is a
    // SILENT failure, not a smaller one. A `tone` is close to no field here, so no suggestion is invented.
    const parsed = alertSummaryFormSchema.safeParse({ ...tallyForm(), tone: "urgent" });

    expect(parsed.success).toBe(false);
    expect(messageOf({ parsed })).toContain(
      'unknown field "tone" — REFUSED, not ignored. No field here is close to it, so it is probably a field ' +
        "from another schema.",
    );
    expect(messageOf({ parsed })).toContain(
      "this form's fields are: behind, intro, kind, label, lead, omitted, recommendations, rows, skipped, trend, window",
    );
  });

  it("names the NEAREST field when the unknown key is a near-miss of a real one", () => {
    const parsed = alertSummaryFormSchema.safeParse({ ...tallyForm(), windows: "7d" });

    expect(parsed.success).toBe(false);
    expect(messageOf({ parsed })).toContain('unknown field "windows" — REFUSED, not ignored. Did you mean "window"?');
  });

  it("REFUSES an unknown key inside a ROW, because the row schema is strict too", () => {
    const rows = [{ count: 3, label: "one", tone: "high" }];
    const parsed = alertSummaryFormSchema.safeParse({ ...tallyForm(), rows });

    expect(parsed.success).toBe(false);
    expect(messageOf({ parsed })).toContain('unknown field "tone" — REFUSED, not ignored.');
  });

  it("REFUSES an impact whose denominator is zero, because a share of nothing is not a blast radius", () => {
    const rows = [{ count: 3, impact: { matched: 2, scope: 0, service: "core-api" }, label: "one" }];

    expect(alertSummaryFormSchema.safeParse({ ...tallyForm(), rows }).success).toBe(false);
  });

  it("REFUSES a severity outside the closed red/orange/green vocabulary", () => {
    const rows = [{ count: 3, label: "one", severity: "critical" }];
    const parsed = alertSummaryFormSchema.safeParse({ ...tallyForm(), rows });

    expect(parsed.success).toBe(false);
  });

  it("REFUSES a count past the ceiling that keeps the TL;DR arithmetic provable", () => {
    const rows = [{ count: ALERT_SUMMARY_COUNT_MAX + 1, label: "absurd" }];

    expect(alertSummaryFormSchema.safeParse({ ...tallyForm(), rows }).success).toBe(false);
  });

  it("REFUSES a negative count", () => {
    const rows = [{ count: -1, label: "impossible" }];

    expect(alertSummaryFormSchema.safeParse({ ...tallyForm(), rows }).success).toBe(false);
  });

  it("REFUSES more rows than the table can hold", () => {
    const rows = Array.from({ length: TABLE_MAX_ROWS + 1 }, (_unused, position) => ({
      count: 1,
      label: `monitor-${String(position)}`,
    }));

    expect(alertSummaryFormSchema.safeParse({ ...tallyForm(), rows }).success).toBe(false);
  });

  it("ACCEPTS an empty tally, which a digest form would refuse", () => {
    expect(alertSummaryFormSchema.safeParse({ ...tallyForm(), rows: [] }).success).toBe(true);
  });
});
