import { describe, expect, it } from "vitest";

import {
  ALERT_SUMMARY_INDEXED_MAX,
  type AlertSummaryForm,
  alertSummaryToUpdate,
} from "../../../../../outbound/artifact/alertSummary.js";
import { TABLE_MAX_ROWS } from "../../../../../outbound/artifact/schema.js";
import type { DetailBlock } from "../../../../../outbound/artifact/types.js";
import { indexText, tallyForm } from "./harness.js";

/** The one below-fold list in a derived detail — the rows the index had no room for. */
function listOf({ detail }: { detail: readonly DetailBlock[] }): Extract<DetailBlock, { type: "list" }> {
  return detail.find((block) => block.type === "list")!;
}

describe("alertSummaryToUpdate — the structure is derived, not authored", () => {
  it("falls back to count DESCENDING, ties on the label, when every row derives the same priority", () => {
    const artifact = alertSummaryToUpdate({ form: tallyForm() });

    // No row here carries a severity or an impact, so all four land in the same `absent × unknown` cell and the
    // count is what separates them. The noisiest row is the cited one, so its flattened text carries the
    // leading space that sits between the `[1]` chip and the label. Asserted with the space rather than
    // trimmed away: the separator is a real run, and a helper that hid it would let the chip drift onto the
    // label without any test noticing.
    expect(indexText({ index: artifact.index })).toEqual([
      "🟡  P4 · upstream timeout · impact ? · 240×",
      "🟡 P4 · token refresh 401 · impact ? · 97×",
      "🟡 P4 · cache miss storm · impact ? · 12×",
      "🟡 P4 · queue-drain stalled · impact ? · 12×",
    ]);
  });

  it("ranks by PRIORITY first, so a quieter red alert with a broad blast radius outranks a noisy green one", () => {
    const form: AlertSummaryForm = {
      ...tallyForm(),
      lead: undefined,
      rows: [
        { count: 400, label: "nightly backup chatter", severity: "green" },
        { count: 2, impact: { matched: 30, scope: 100, service: "core-api" }, label: "checkout down", severity: "red" },
        {
          count: 90,
          impact: { matched: 2, scope: 100_000, service: "jobs-api" },
          label: "token refresh 401",
          severity: "orange",
        },
      ],
    };
    const artifact = alertSummaryToUpdate({ form });

    expect(indexText({ index: artifact.index })).toEqual([
      "🔴 P0 · checkout down · ~30.0% · 2×",
      "🟠 P3 · token refresh 401 · <0.1% · 90×",
      "🟢 P4 · nightly backup chatter · impact ? · 400×",
    ]);
    // The TL;DR carries the channel's WORST priority, which is the token eleven of these are scanned for.
    expect(artifact.tldr).toBe("Gateway 7d · P0 · 492 fired across 3 monitors.");
  });

  it("renders the ranked index as Slack's own NUMBERED list, so `ranked` is drawn and not merely claimed", () => {
    expect(alertSummaryToUpdate({ form: tallyForm() }).indexStyle).toBe("ordered");
  });

  it("leads the line with the severity glyph, then the chip, then the priority, then the bold label", () => {
    const form = {
      ...tallyForm(),
      rows: [
        {
          citationUrl: "https://example.invalid/logs?q=timeout",
          count: 3,
          label: "checkout down",
          severity: "red" as const,
        },
      ],
    };
    const artifact = alertSummaryToUpdate({ form });

    expect(artifact.index[0]).toEqual([
      { text: "🔴", type: "text" },
      { text: " ", type: "text" },
      { citationId: "c1", type: "citation" },
      { text: " ", type: "text" },
      { text: "P2 · ", type: "text" },
      { bold: true, quoted: true, text: "checkout down", type: "text" },
      { text: " · impact ? · 3×", type: "text" },
    ]);
  });

  it("indexes only the noisiest few, while every remaining row still gets its own cited line below the fold", () => {
    const rows = Array.from({ length: TABLE_MAX_ROWS }, (_unused, position) => ({
      count: TABLE_MAX_ROWS - position,
      label: `monitor-${String(position)}`,
    }));
    const artifact = alertSummaryToUpdate({ form: { ...tallyForm(), rows } });

    expect(artifact.index.length).toBe(ALERT_SUMMARY_INDEXED_MAX);
    expect(listOf({ detail: artifact.detail }).items.length).toBe(TABLE_MAX_ROWS - ALERT_SUMMARY_INDEXED_MAX);
  });

  it("numbers citations positionally in ranked order and places the chip BEFORE the priority", () => {
    const artifact = alertSummaryToUpdate({ form: tallyForm() });

    expect(artifact.citations).toEqual([{ id: "c1", label: "[1]", url: "https://example.invalid/logs?q=timeout" }]);
    expect(artifact.index[0]).toEqual([
      { text: "🟡", type: "text" },
      { text: " ", type: "text" },
      { citationId: "c1", type: "citation" },
      { text: " ", type: "text" },
      { text: "P4 · ", type: "text" },
      { bold: true, quoted: true, text: "upstream timeout", type: "text" },
      { text: " · impact ? · 240×", type: "text" },
    ]);
  });

  it("says `1 monitor` for a single row", () => {
    const form = { ...tallyForm(), lead: undefined, rows: [{ count: 3, label: "only one" }] };

    expect(alertSummaryToUpdate({ form }).tldr).toBe("Gateway 7d · P4 · 3 fired across 1 monitor.");
  });
});
