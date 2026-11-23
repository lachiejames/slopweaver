/** {@link pricedDrains} and {@link shareOf} — what a tally prices, and what it declines to. */
import { describe, expect, it } from "vitest";

import { CLAUDE_MODEL_WEIGHT_CARD } from "../../../sessions/modelWeight.js";
import { pricedDrains, shareOf } from "../../../sessions/spendDrains.js";
import { type SeatKind, type TranscriptSpend, zeroRefusals } from "../../../sessions/spendFold.js";
import { tallySpend } from "../../../sessions/spendTally.js";

describe("shareOf", () => {
  it("is the fraction of the draw, and zero over an empty window", () => {
    expect(shareOf({ total: 200, units: 50 })).toBe(0.25);
    expect(shareOf({ total: 0, units: 50 })).toBe(0);
  });
});

describe("pricedDrains", () => {
  const empty = tallySpend({ days: ["2026-09-27"], transcripts: [] });

  it("prices nothing over an empty window", () => {
    expect(
      pricedDrains({ card: CLAUDE_MODEL_WEIGHT_CARD, defaultFamily: null, tally: empty, turns: 0, units: 0 }),
    ).toEqual([]);
  });

  it("prices each refusal as one turn at the window's mean, naming the classes that fired", () => {
    const refused = { ...empty, refusals: { ...zeroRefusals(), python: 3, "whole-tree": 1 } };
    expect(
      pricedDrains({ card: CLAUDE_MODEL_WEIGHT_CARD, defaultFamily: null, tally: refused, turns: 10, units: 1_000 }),
    ).toEqual([
      {
        fix: "a refusal that names what to use instead, so the retry is right first time (never a weaker gate)",
        key: "refusals",
        savingUnits: 400,
        share: 0.4,
        what: "4 gate refusals, each a turn re-reading the context at about 100u: python 3, whole-tree 1",
      },
    ]);
  });

  // Fable 5.1: output 1,000 x 25 + cache read 100,000 x 0.125 = 37,500 units; on Opus 5.5 it is 20,000.
  const fableSeat = ({ seat }: { seat: SeatKind }): TranscriptSpend => ({
    contextFloor: null,
    cwd: "/w/acme",
    path: `/p/${seat}.jsonl`,
    refusals: zeroRefusals(),
    seat,
    unreadable: 0,
    usage: [
      {
        day: "2026-09-27",
        model: "claude-fable-5-1",
        totals: { cacheCreationTokens: 0, cacheReadTokens: 100_000, inputTokens: 0, outputTokens: 1_000, turns: 2 },
      },
    ],
  });

  it("prices a non-chair seat's model, never the chair's, which rule 5 row 1 settles", () => {
    const mixed = tallySpend({
      days: ["2026-09-27"],
      transcripts: [fableSeat({ seat: "chair" }), fableSeat({ seat: "handover-seat" })],
    });
    expect(
      pricedDrains({
        card: CLAUDE_MODEL_WEIGHT_CARD,
        defaultFamily: "opus-5.5",
        tally: mixed,
        turns: 4,
        units: 75_000,
      }),
    ).toEqual([
      {
        fix: "a ruling: rule 5 names each seat's model — moving these non-chair seats to opus-5.5",
        key: "model:non-chair:fable-5.1",
        savingUnits: 17_500,
        share: 17_500 / 75_000,
        what: "2 non-chair seat turns on fable-5.1; the same tokens on opus-5.5 would have drawn 17.5ku less",
      },
    ]);
  });

  it("prices no model drain when only the chair ran on a pricier family", () => {
    const chairOnly = tallySpend({ days: ["2026-09-27"], transcripts: [fableSeat({ seat: "chair" })] });
    expect(
      pricedDrains({
        card: CLAUDE_MODEL_WEIGHT_CARD,
        defaultFamily: "opus-5.5",
        tally: chairOnly,
        turns: 2,
        units: 37_500,
      }),
    ).toEqual([]);
  });

  it("prices no fork when every subagent opened alike", () => {
    const alike = {
      ...empty,
      openings: [1, 2, 3, 4].map(() => ({ family: "opus-5.5" as const, floor: 50_000, turns: 3 })),
    };
    expect(
      pricedDrains({ card: CLAUDE_MODEL_WEIGHT_CARD, defaultFamily: null, tally: alike, turns: 12, units: 1_000 }),
    ).toEqual([]);
  });
});
