import { describe, expect, it } from "vitest";

import {
  alertSummaryFormSchema,
  alertSummaryToUpdate,
  deriveTotals,
} from "../../../../../outbound/artifact/alertSummary.js";
import { messageOf, NO_TREND_SENTENCE, paragraphTexts, tallyForm } from "./harness.js";

describe("deriveTotals — the counts are summed, never accepted", () => {
  it("sums every row's count, and counts the rows as monitors", () => {
    expect(deriveTotals({ form: tallyForm() })).toEqual({ monitors: 4, total: 361, unrecognised: 0 });
  });

  it("is zero for an empty tally", () => {
    expect(deriveTotals({ form: { ...tallyForm(), rows: [] } })).toEqual({ monitors: 0, total: 0, unrecognised: 0 });
  });

  it("counts a folded tail INTO both numbers, so neither describes only the visible rows", () => {
    // The row cap is what makes this reachable: a channel with more distinct monitors than the table can hold
    // has its quiet tail folded away, and a total that quietly meant "of the ten you can see" would be a wrong
    // number sitting directly above a table that could not contradict it.
    const form = { ...tallyForm(), omitted: { count: 23, monitors: 7 } };

    expect(deriveTotals({ form })).toEqual({ monitors: 11, total: 384, unrecognised: 0 });
    expect(alertSummaryToUpdate({ form }).tldr).toBe(
      "Gateway 7d · P4 · 384 fired across 11 monitors. The top two are the same deploy.",
    );
  });

  it("says the folded tail is missing from the LIST and not from the total", () => {
    const artifact = alertSummaryToUpdate({ form: { ...tallyForm(), omitted: { count: 23, monitors: 7 } } });

    // The reference tally's four rows all fit above the fold and none is measured, so the trend paragraph is
    // the only thing above the coverage note.
    expect(paragraphTexts({ detail: artifact.detail })).toEqual([
      NO_TREND_SENTENCE,
      "7 quieter monitors fired 23 times between them and are counted in the total above, but are not listed.",
    ]);
  });

  it("agrees the whole sentence with one folded monitor that fired once", () => {
    const artifact = alertSummaryToUpdate({ form: { ...tallyForm(), omitted: { count: 1, monitors: 1 } } });

    expect(paragraphTexts({ detail: artifact.detail })).toEqual([
      NO_TREND_SENTENCE,
      "1 quieter monitor fired once and is counted in the total above, but is not listed.",
    ]);
  });

  it("puts the SUMMED total in the TL;DR, so no composer can assert one", () => {
    const form = alertSummaryFormSchema.parse(tallyForm());

    expect(alertSummaryToUpdate({ form }).tldr).toBe(
      "Gateway 7d · P4 · 361 fired across 4 monitors. The top two are the same deploy.",
    );
  });

  it("REFUSES a fabricated `total` rather than dropping it, so the disagreement is never silent", () => {
    // The form has no `total` field, and under `strictForm` a composer that asserts one is REFUSED — where the
    // parked version of this test asserted the key was stripped. Both keep the wrong number out of the card; the
    // difference is that a refusal tells the composer its number was ignored, and a strip does not.
    const parsed = alertSummaryFormSchema.safeParse({ ...tallyForm(), total: 9 });

    expect(parsed.success).toBe(false);
    expect(messageOf({ parsed })).toContain('unknown field "total" — REFUSED, not ignored.');
  });
});
