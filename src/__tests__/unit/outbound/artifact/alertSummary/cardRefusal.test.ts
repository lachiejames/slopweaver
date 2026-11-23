import { describe, expect, it } from "vitest";

import {
  ALERT_SUMMARY_INDEXED_MAX,
  ALERT_SUMMARY_LEAD_VISIBLE_MAX,
  alertSummaryCardRefusal,
  alertSummaryFormSchema,
} from "../../../../../outbound/artifact/alertSummary.js";
import { messageOf, tallyForm } from "./harness.js";

describe("alertSummaryCardRefusal — the whole-form check over the derived card", () => {
  it("accepts a form whose fields fit, which is every form the field caps admit", () => {
    expect(alertSummaryCardRefusal({ form: tallyForm() })).toBeUndefined();
  });

  it("refuses a form the FIELD caps would have caught, and names what combines in BOTH regions", () => {
    // Driven past the field caps deliberately: `alertSummaryFormSchema` would refuse this `lead` at 900
    // characters long before the refinement ran, so the only way to exercise the check is to hand the shape over
    // directly. That is also the real second caller — see the function's own comment.
    const refusal = alertSummaryCardRefusal({ form: { ...tallyForm(), lead: "d".repeat(900) } })!;

    expect(refusal).toContain("these fields each sit inside their own limits, but the card they derive does not");
    // Both regions, because both can be the cause: a review pass measured the below-fold lanes reaching the
    // prose budget while this text still said a below-fold row was bounded only by its own width.
    expect(refusal).toContain("Above the fold: `label`, `window` and `lead` build the TL;DR");
    expect(refusal).toContain("Below it: the rows the index had no room for, every `recommendations` entry");
    expect(refusal).toContain("Shorten `lead`, `label`, `window`, a row label or a recommendation, or drop an item.");
    expect(refusal).toContain("What the layout refused:");
  });

  it("catches a below-fold row label the fold hides from the reader, because a below-fold line is not trimmed", () => {
    // Worth pinning as its own case: above the fold `fittedRowLine` trims an over-long label to fit, which would
    // make the same label look harmless below the fold too — where `alertSummaryToUpdate` uses `rowLine` directly,
    // untrimmed. Handing over a label the field caps would have refused is what proves that is actually caught
    // somewhere, rather than merely asserted safe by `rowLine`'s own doc comment.
    const rows = [
      ...Array.from({ length: ALERT_SUMMARY_INDEXED_MAX }, (_unused, position) => ({
        count: 100 - position,
        label: `filler-${String(position)}`,
      })),
      { count: 1, label: "m".repeat(600) },
    ];
    const refusal = alertSummaryCardRefusal({ form: { ...tallyForm(), rows } })!;

    expect(refusal).toContain("list item is 624 visible chars, over the 200 cap");
  });

  it("is what the FORM schema reports when the field caps do not catch it first", () => {
    const parsed = alertSummaryFormSchema.safeParse({ ...tallyForm(), lead: "d".repeat(900) });

    // The field cap on `lead` fires first here, which is the right order — a field-shaped message beats a
    // card-shaped one when both are true. The point of the assertion is that the send is refused either way.
    expect(parsed.success).toBe(false);
    expect(messageOf({ parsed })).toContain(
      `Too big: expected string to have <=${String(ALERT_SUMMARY_LEAD_VISIBLE_MAX)} characters`,
    );
  });
});
