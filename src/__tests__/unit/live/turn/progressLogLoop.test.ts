/**
 * The planning loop's three facts in the progress log — a declared plan, a review round, and a stage's step
 * and writer — and the legacy lines written before any of them existed.
 */
import { describe, expect, it } from "vitest";

import { decodeProgressLogLine, foldProgressLog } from "../../../../live/turn/progressLog.js";

const TS = "2026-10-02T08:40:00.000Z";

describe("decodeProgressLogLine — the loop's events", () => {
  it("reads a plan", () => {
    expect(decodeProgressLogLine({ line: JSON.stringify({ kind: "plan", steps: ["a", "b"], tsIso: TS }) })).toEqual({
      kind: "plan",
      steps: ["a", "b"],
      tsIso: TS,
    });
  });

  it("refuses a plan with no steps, or with a step that is not text", () => {
    for (const steps of [[], ["a", 2], ["a", ""], "a"]) {
      expect(decodeProgressLogLine({ line: JSON.stringify({ kind: "plan", steps, tsIso: TS }) })).toBe(undefined);
    }
  });

  it("reads a review round, and refuses one that is not a positive whole number", () => {
    expect(decodeProgressLogLine({ line: JSON.stringify({ kind: "review", round: 2, tsIso: TS }) })).toEqual({
      kind: "review",
      round: 2,
      tsIso: TS,
    });
    for (const round of [0, 1.5, "1"]) {
      expect(decodeProgressLogLine({ line: JSON.stringify({ kind: "review", round, tsIso: TS }) })).toBe(undefined);
    }
  });

  it("keeps a stage's step and writer", () => {
    const line = JSON.stringify({ kind: "stage", step: 2, text: "found it", tsIso: TS, worker: "w1" });
    expect(decodeProgressLogLine({ line })).toEqual({
      kind: "stage",
      step: 2,
      text: "found it",
      tsIso: TS,
      worker: "w1",
    });
  });

  it("drops a malformed step or writer and keeps the stage's text", () => {
    const line = JSON.stringify({ kind: "stage", step: 0, text: "found it", tsIso: TS, worker: "" });
    expect(decodeProgressLogLine({ line })).toEqual({ kind: "stage", text: "found it", tsIso: TS });
  });
});

describe("foldProgressLog — the timeline", () => {
  it("interleaves stages, plans and rounds in file order, and leaves writes and warns out of it", () => {
    const text = [
      { kind: "stage", text: "legacy stage, no writer", tsIso: TS },
      { kind: "plan", steps: ["a"], tsIso: TS },
      { detail: "now: x", kind: "card-write", stageCount: 1, tsIso: TS },
      { kind: "review", round: 1, tsIso: TS },
      { kind: "stage", text: "after review", tsIso: TS, worker: "w2" },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    const folded = foldProgressLog({ text });
    expect(folded.timeline.map((event) => event.kind)).toEqual(["stage", "plan", "review", "stage"]);
    expect(folded.stages.map((stage) => stage.text)).toEqual(["legacy stage, no writer", "after review"]);
    expect(folded.writes).toHaveLength(1);
  });
});
