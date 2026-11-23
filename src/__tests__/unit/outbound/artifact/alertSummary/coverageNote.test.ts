import { describe, expect, it } from "vitest";

import { alertSummaryToUpdate } from "../../../../../outbound/artifact/alertSummary.js";
import { NO_TREND_SENTENCE, paragraphTexts, tallyForm } from "./harness.js";

describe("alertSummaryToUpdate — the coverage note", () => {
  it("says nothing about coverage when nothing was skipped, and the trend paragraph is the whole detail", () => {
    // The reference tally's four rows all fit above the fold, none carries a severity and none is measured, so
    // the trend sentence is the ONLY block — and a card that does not fold still needs a sixth one. See
    // `deriveDetail`'s own comment on why the filler line that used to stand here is gone.
    const artifact = alertSummaryToUpdate({ form: { ...tallyForm(), skipped: 0 } });

    expect(paragraphTexts({ detail: artifact.detail })).toEqual([NO_TREND_SENTENCE]);
  });

  it("says so when messages were not recognised, so a quiet window is distinguishable from an unparsed one", () => {
    const artifact = alertSummaryToUpdate({ form: { ...tallyForm(), skipped: 4 } });

    expect(paragraphTexts({ detail: artifact.detail })).toEqual([
      NO_TREND_SENTENCE,
      "4 messages in this window were not recognised as alert notifications and are not counted above.",
    ]);
  });

  it("agrees the whole sentence with a single skipped message, not just the noun", () => {
    const artifact = alertSummaryToUpdate({ form: { ...tallyForm(), skipped: 1 } });

    expect(paragraphTexts({ detail: artifact.detail })).toEqual([
      NO_TREND_SENTENCE,
      "1 message in this window was not recognised as an alert notification and is not counted above.",
    ]);
  });
});
