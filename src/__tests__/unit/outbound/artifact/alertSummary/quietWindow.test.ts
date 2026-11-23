import { describe, expect, it } from "vitest";

import { alertSummaryToUpdate } from "../../../../../outbound/artifact/alertSummary.js";
import { updateArtifactSchema } from "../../../../../outbound/artifact/schema.js";
import { NO_TREND_SENTENCE, tallyForm } from "./harness.js";

describe("alertSummaryToUpdate — a quiet window is a RESULT, not a failure", () => {
  it("states the absence as a paragraph, because a table cannot have zero rows", () => {
    const artifact = alertSummaryToUpdate({ form: { ...tallyForm(), lead: undefined, rows: [] } });

    expect(artifact.detail).toEqual([
      { runs: [{ text: "No alerts fired in this window.", type: "text" }], type: "paragraph" },
      { runs: [{ text: NO_TREND_SENTENCE, type: "text" }], type: "paragraph" },
    ]);
    expect(artifact.index).toEqual([]);
    expect(artifact.tldr).toBe("Gateway 7d · nothing fired.");
  });

  it("REFUSES to say nothing fired when every message read went unrecognised", () => {
    // The measured case, on the Knock alerts channel: 18 read, 18 skipped, 0 recognised over 14d,
    // and the card led above the fold with `nothing fired.` while the honest line sat below Show more.
    const artifact = alertSummaryToUpdate({
      form: { ...tallyForm(), lead: undefined, rows: [], skipped: 18, window: "14d" },
    });

    expect(artifact.tldr).toBe("Gateway 14d · 18 messages read, none recognised.");
  });

  it("says it in the singular when exactly one message went unrecognised", () => {
    const artifact = alertSummaryToUpdate({
      form: { ...tallyForm(), lead: undefined, rows: [], skipped: 1 },
    });

    expect(artifact.tldr).toBe("Gateway 7d · 1 message read, none recognised.");
  });

  it("still says nothing fired when the window held nothing to read, which does prove it", () => {
    const artifact = alertSummaryToUpdate({
      form: { ...tallyForm(), lead: undefined, rows: [], skipped: 0 },
    });

    expect(artifact.tldr).toBe("Gateway 7d · nothing fired.");
  });

  it("keeps saying what fired when rows survived, however many were skipped beside them", () => {
    const artifact = alertSummaryToUpdate({ form: { ...tallyForm(), lead: undefined, skipped: 900 } });

    expect(artifact.tldr).toBe("Gateway 7d · P4 · 361 fired across 4 monitors.");
  });

  it("still derives a card the layout accepts, so the scheduled send goes out", () => {
    const artifact = alertSummaryToUpdate({ form: { ...tallyForm(), rows: [] } });

    expect(updateArtifactSchema.safeParse(artifact).success).toBe(true);
  });
});
