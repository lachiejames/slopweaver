import { describe, expect, it } from "vitest";

import {
  ALERT_SUMMARY_COUNT_MAX,
  ALERT_SUMMARY_LABEL_MAX,
  ALERT_SUMMARY_LEAD_VISIBLE_MAX,
  ALERT_SUMMARY_LINE_VISIBLE_MAX,
  ALERT_SUMMARY_ROW_LABEL_MAX,
  ALERT_SUMMARY_WINDOW_MAX,
  type AlertSummaryForm,
  alertSummaryFormSchema,
  alertSummaryToUpdate,
  withoutQuotedFlags,
} from "../../../../../outbound/artifact/alertSummary.js";
import {
  ABOVE_FOLD_VISIBLE_MAX,
  INDEX_ITEM_VISIBLE_MAX,
  TABLE_MAX_ROWS,
  TLDR_VISIBLE_MAX,
  updateArtifactSchema,
} from "../../../../../outbound/artifact/schema.js";
import { ALERT_TREND_PRIOR_WINDOWS_MAX } from "../../../../../outbound/artifact/trend.js";
import { indexText, labelsOf, tallyForm, widthOf } from "./harness.js";

describe("alertSummaryToUpdate — a valid form always derives a VALID card", () => {
  /** The worst case the schema admits: every bound at its maximum, in the noisiest arrangement. */
  function maximalForm(): AlertSummaryForm {
    return {
      kind: "alert-summary",
      label: "L".repeat(ALERT_SUMMARY_LABEL_MAX),
      lead: "d".repeat(ALERT_SUMMARY_LEAD_VISIBLE_MAX),
      rows: Array.from({ length: TABLE_MAX_ROWS }, (_unused, position) => ({
        citationUrl: `https://example.invalid/q?row=${String(position)}`,
        count: ALERT_SUMMARY_COUNT_MAX,
        label: `${String(position)}${"m".repeat(ALERT_SUMMARY_ROW_LABEL_MAX - 1)}`,
        severity: "red" as const,
      })),
      // `omitted` rides the worst case too: both its counts reach the TL;DR through `deriveTotals`, so a
      // fixture without it pinned a bound the schema does not actually admit (found by a review pass).
      omitted: { count: ALERT_SUMMARY_COUNT_MAX, monitors: ALERT_SUMMARY_COUNT_MAX },
      skipped: ALERT_SUMMARY_COUNT_MAX,
      window: "w".repeat(ALERT_SUMMARY_WINDOW_MAX),
    };
  }

  it("keeps the worst-case TL;DR inside the layout's cap", () => {
    const artifact = alertSummaryToUpdate({ form: maximalForm() });

    expect(artifact.tldr.length).toBeLessThanOrEqual(TLDR_VISIBLE_MAX);
  });

  it("keeps the worst-case NOTHING-RECOGNISED TL;DR inside the cap, which is why that sentence is four words", () => {
    // A second worst case, because the branch `countSentence` takes when no row survived is one the fixture
    // above can never reach — it has rows. Every field that still contributes is at its own maximum: the
    // label, the window, a maximal `lead` (which `resolveAlertLead` now KEEPS on this window rather than
    // dropping it), a maximal `trend`, and `skipped` at its cap. The long form of the sentence,
    // `… messages read, none recognised as an alert notification.`, derives 196 here and is REFUSED.
    const artifact = alertSummaryToUpdate({
      form: {
        ...maximalForm(),
        omitted: undefined,
        rows: [],
        trend: { priorTotal: ALERT_SUMMARY_COUNT_MAX, priorWindows: ALERT_TREND_PRIOR_WINDOWS_MAX },
      },
    });

    expect(artifact.tldr).toContain("1000000 messages read, none recognised.");
    expect(artifact.tldr.length).toBeLessThanOrEqual(TLDR_VISIBLE_MAX);
  });

  it("lands the worst-case index line at-or-under the derivation's tighter width, never over it", () => {
    const artifact = alertSummaryToUpdate({ form: maximalForm() });
    const labels = labelsOf({ artifact });
    const widest = Math.max(...artifact.index.map((runs) => widthOf({ labels, runs })));

    // Untrimmed this would be 7 digits of count + 2 for the glyph + 3 for the severity dot + an 80-character
    // label + a space + a 4-character `[10]` chip = 96, over the 94 budget — so EVERY indexed line in this
    // fixture trims. `fittedIndexLine`'s own arithmetic happens to land the trimmed result back at 93, which is
    // pinned here so a change to that arithmetic is caught rather than silently drifting.
    expect(widest).toBe(93);
    expect(widest).toBeLessThanOrEqual(ALERT_SUMMARY_LINE_VISIBLE_MAX);
    expect(widest).toBeLessThanOrEqual(INDEX_ITEM_VISIBLE_MAX);
  });

  it("DOES trim the worst case now that severity's glyph is part of the line, and still shows an ellipsis", () => {
    // Severity moved this from "provably unreachable" to "reachable and handled": the trim is what keeps the
    // above-fold region inside its cap once a maximal form's line exceeds the per-line budget. See
    // `fittedIndexLine`'s own doc comment for the arithmetic.
    const artifact = alertSummaryToUpdate({ form: maximalForm() });

    expect(indexText({ index: artifact.index }).every((line) => line.includes("…"))).toBe(true);
  });

  it("keeps the whole worst-case above-fold region inside the region cap", () => {
    const artifact = alertSummaryToUpdate({ form: maximalForm() });
    const labels = labelsOf({ artifact });
    const region = artifact.tldr.length + artifact.index.reduce((total, runs) => total + widthOf({ labels, runs }), 0);

    expect(region).toBeLessThanOrEqual(ABOVE_FOLD_VISIBLE_MAX);
  });

  it("derives a card the layout schema accepts, from the worst case the form schema admits", () => {
    const form = alertSummaryFormSchema.parse(maximalForm());
    // Through the same strip the refusal itself applies: the derivation-only `quoted` flag is the one thing
    // the composed-form schema refuses on purpose, and it carries no width.
    const parsed = updateArtifactSchema.safeParse(withoutQuotedFlags({ artifact: alertSummaryToUpdate({ form }) }));

    expect(parsed.success).toBe(true);
  });

  it("trims the LABEL and never the count when a caller skipped the schema and handed over a long one", () => {
    // Reachable only this way, which is the point of testing it here. `alertSummaryToUpdate` takes a SHAPE, and
    // no type carries a string's length, so a caller that bypassed `alertSummaryFormSchema` can hand over a
    // label three times the bound. It is trimmed with a visible ellipsis rather than throwing or overflowing.
    const form: AlertSummaryForm = {
      ...tallyForm(),
      rows: [{ count: ALERT_SUMMARY_COUNT_MAX, label: "z".repeat(ALERT_SUMMARY_ROW_LABEL_MAX * 3) }],
    };
    const line = indexText({ index: alertSummaryToUpdate({ form }).index })[0]!;

    // The line now opens with the state colour and the priority, so the label starts after them — and the two
    // cells the priority column added are what must NOT give way when the label does.
    expect(line.startsWith("🟡 P4 · z")).toBe(true);
    expect(line).toContain("…");
    expect(line.endsWith(` · impact ? · ${String(ALERT_SUMMARY_COUNT_MAX)}×`)).toBe(true);
    expect(line.length).toBe(ALERT_SUMMARY_LINE_VISIBLE_MAX);
  });

  it("folds, because the chrome is five blocks and the detail supplies the sixth", () => {
    const artifact = alertSummaryToUpdate({ form: tallyForm() });

    expect(artifact.detail.length).toBeGreaterThan(0);
  });
});
