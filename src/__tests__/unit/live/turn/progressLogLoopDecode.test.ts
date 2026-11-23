import { describe, expect, it } from "vitest";

import { decodeLoopRecord, decodeStageRecord } from "../../../../live/turn/progressLogLoopDecode.js";

const TS = "2026-10-02T10:00:00.000Z";

describe("decodeStageRecord", () => {
  it("keeps a well-formed step and writer", () => {
    expect(decodeStageRecord({ record: { step: 2, worker: "w1" }, text: "found it", tsIso: TS })).toEqual({
      kind: "stage",
      step: 2,
      text: "found it",
      tsIso: TS,
      worker: "w1",
    });
  });

  it("drops a step that is not a positive integer and an empty writer, keeping the stage itself", () => {
    expect(decodeStageRecord({ record: { step: 0, worker: "" }, text: "found it", tsIso: TS })).toEqual({
      kind: "stage",
      text: "found it",
      tsIso: TS,
    });
  });
});

describe("decodeLoopRecord", () => {
  it("decodes a review round", () => {
    expect(decodeLoopRecord({ record: { kind: "review", round: 2 }, tsIso: TS })).toEqual({
      kind: "review",
      round: 2,
      tsIso: TS,
    });
  });

  it("refuses a review round that is not a positive integer", () => {
    expect(decodeLoopRecord({ record: { kind: "review", round: 1.5 }, tsIso: TS })).toBe(undefined);
  });

  it("decodes a plan", () => {
    expect(decodeLoopRecord({ record: { kind: "plan", steps: ["a", "b"] }, tsIso: TS })).toEqual({
      kind: "plan",
      steps: ["a", "b"],
      tsIso: TS,
    });
  });

  it("refuses an empty plan, and one carrying any unreadable step", () => {
    expect(decodeLoopRecord({ record: { kind: "plan", steps: [] }, tsIso: TS })).toBe(undefined);
    expect(decodeLoopRecord({ record: { kind: "plan", steps: ["a", ""] }, tsIso: TS })).toBe(undefined);
  });
});
