/** {@link tallySpend} — the window's totals, split by seat, day and subagent, with each subagent's opening. */
import { describe, expect, it } from "vitest";

import { CLAUDE_MODEL_WEIGHT_CARD } from "../../../sessions/modelWeight.js";
import type { UsageTotals } from "../../../sessions/sessionCost.js";
import { type SeatKind, type TranscriptSpend, zeroRefusals } from "../../../sessions/spendFold.js";
import { familiesOf, tallySpend, turnsOfModels, unitsOfModels } from "../../../sessions/spendTally.js";

/** Output-only totals: on Opus 5.5 each output token is 10 units. */
function totals({ turns, output }: { turns: number; output: number }): UsageTotals {
  return { cacheCreationTokens: 0, cacheReadTokens: 0, inputTokens: 0, outputTokens: output, turns };
}

/** One transcript on Opus 5.5 with one usage entry per day given. */
function transcript({
  seat,
  days,
  floor = null,
}: {
  seat: SeatKind;
  days: readonly string[];
  floor?: number | null;
}): TranscriptSpend {
  return {
    contextFloor: floor,
    cwd: "/w/acme",
    path: `/p/${seat}.jsonl`,
    refusals: { ...zeroRefusals(), "poll-gate": 1 },
    seat,
    unreadable: 2,
    usage: days.map((day) => ({ day, model: "claude-opus-5-5", totals: totals({ output: 100, turns: 1 }) })),
  };
}

describe("tallySpend", () => {
  const tally = tallySpend({
    days: ["2026-09-26", "2026-09-27"],
    transcripts: [
      transcript({ days: ["2026-09-26", "2026-09-27"], seat: "chair" }),
      transcript({ days: ["2026-09-27"], floor: 40_000, seat: "subagent" }),
      transcript({ days: ["2026-09-20"], seat: "bot" }),
    ],
  });

  it("counts only in-window usage, but every transcript's unreadable lines", () => {
    expect(tally.transcripts).toBe(2);
    expect(tally.unreadable).toBe(6);
    expect(tally.refusals["poll-gate"]).toBe(2);
    expect(turnsOfModels({ byModel: tally.fleet })).toBe(3);
    expect(unitsOfModels({ byModel: tally.fleet, card: CLAUDE_MODEL_WEIGHT_CARD })).toBe(3_000);
  });

  it("splits seats from subagents, and every day of the window even an empty one", () => {
    expect(turnsOfModels({ byModel: tally.subagents })).toBe(1);
    expect([...tally.byDay.keys()]).toEqual(["2026-09-26", "2026-09-27"]);
    expect(turnsOfModels({ byModel: tally.byDay.get("2026-09-27")! })).toBe(2);
    expect([...tally.bySeat.keys()]).toEqual(["chair", "subagent"]);
  });

  it("keeps the chair out of the repricing split, while it still counts by seat and by day", () => {
    expect(turnsOfModels({ byModel: tally.seats })).toBe(0);
    expect(turnsOfModels({ byModel: tally.bySeat.get("chair")!.byModel })).toBe(2);
    expect(turnsOfModels({ byModel: tally.byDay.get("2026-09-26")! })).toBe(1);
  });

  it("puts every other non-subagent seat in the repricing split", () => {
    const handover = tallySpend({
      days: ["2026-09-27"],
      transcripts: [transcript({ days: ["2026-09-27"], seat: "handover-seat" })],
    });
    expect(turnsOfModels({ byModel: handover.seats })).toBe(1);
  });

  it("records a subagent's opening on its dominant family", () => {
    expect(tally.openings).toEqual([{ family: "opus-5.5", floor: 40_000, turns: 1 }]);
  });

  it("folds models into families, dropping one the card does not name", () => {
    const families = familiesOf({
      byModel: new Map([
        ["claude-opus-5-5", totals({ output: 1, turns: 1 })],
        ["not-a-claude-model", totals({ output: 1, turns: 1 })],
      ]),
    });
    expect([...families.keys()]).toEqual(["opus-5.5"]);
  });

  it("weighs an empty map at zero", () => {
    expect(unitsOfModels({ byModel: new Map(), card: CLAUDE_MODEL_WEIGHT_CARD })).toBe(0);
  });
});
