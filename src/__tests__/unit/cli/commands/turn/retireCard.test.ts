/**
 * `turn retire-card`'s two pure halves: which flags it requires, and what it says for each answer Slack gives.
 */
import { describe, expect, it } from "vitest";

import { retireCardInputs, retireCardReport } from "../../../../../cli/commands/turn/retireCard.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";

const CARD = { turnId: "turn-first", workingTs: "1785000001.000100" };

describe("retireCardInputs", () => {
  it("reads all three required flags", () => {
    const read = retireCardInputs({
      values: { channel: "C1", "message-ts": "1785000000.000100", "working-ts": "1785000001.000100" },
    });

    expect(read).toEqual({
      inputs: { channel: "C1", messageTs: "1785000000.000100", workingTs: "1785000001.000100" },
      kind: "ready",
    });
  });

  it("names every missing flag — the card ts is never defaulted to the ask's current card", () => {
    expect(retireCardInputs({ values: { channel: "C1" } })).toEqual({
      flags: ["--message-ts", "--working-ts"],
      kind: "missing",
    });
  });
});

describe("retireCardReport", () => {
  it("reports a delete Slack confirmed as retired, exit 0", () => {
    expect(retireCardReport({ card: CARD, channel: "C1", outcome: { kind: "gone" } })).toEqual({
      exit: EXIT_OK,
      line: "retired orphaned card C1/1785000001.000100",
      stream: "out",
    });
  });

  it("reads Slack's already-gone as the job already done, exit 0", () => {
    const report = retireCardReport({ card: CARD, channel: "C1", outcome: { kind: "already-gone" } });

    expect(report.exit).toBe(EXIT_OK);
    expect(report.line).toBe("orphaned card C1/1785000001.000100 was already gone from Slack — nothing to retire");
  });

  it("reports a refused delete with Slack's reason, exit 1", () => {
    const report = retireCardReport({
      card: CARD,
      channel: "C1",
      outcome: { kind: "failed", reason: "cant_delete_message" },
    });

    expect(report).toEqual({
      exit: EXIT_ERROR,
      line: "turn retire-card: C1/1785000001.000100 was not deleted — cant_delete_message",
      stream: "error",
    });
  });
});
