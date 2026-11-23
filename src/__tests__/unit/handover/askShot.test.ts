/*
 * An ask's picture, boxed where the owner is meant to look (a red box around the evidence, labelled stale or missing): what a write refuses, what a journal line decodes to, and when two are the same.
 */
import { describe, expect, it } from "vitest";

import type { HandShot } from "../../../hand/shot.js";
import { askShotOf, askShotProblems, questionShotEvent, sameAskShot } from "../../../handover/askShot.js";

const SHOT: HandShot = {
  boxes: [{ height: 36, label: "stale", width: 380, x: 40, y: 212 }],
  height: 900,
  sha256: "a".repeat(64),
  width: 1440,
};

const QUESTION = "Is running OpenTelemetry for traces beside dd-trace worth it?";

describe("askShotProblems", () => {
  it("passes a whole picture with one box", () => {
    expect(askShotProblems({ value: SHOT })).toEqual([]);
  });

  it("refuses a missing picture", () => {
    expect(askShotProblems({ value: undefined })).toEqual([
      "shot is missing — a question-shot line carries the picture it attaches",
    ]);
  });

  it("refuses a picture with no box — the box is the point", () => {
    const problems = askShotProblems({ value: { ...SHOT, boxes: [] } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("carries 1 to 9 boxes");
  });

  it("refuses a box running past the picture", () => {
    const problems = askShotProblems({ value: { ...SHOT, boxes: [{ ...SHOT.boxes[0]!, width: 1500 }] } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("runs past the 1440x900 picture");
  });
});

describe("askShotOf", () => {
  it("reads a whole picture back as itself", () => {
    expect(askShotOf({ value: SHOT })).toEqual(SHOT);
  });

  it("reads an absent or broken one as none", () => {
    expect(askShotOf({ value: undefined })).toBe(undefined);
    expect(askShotOf({ value: { ...SHOT, sha256: "nope" } })).toBe(undefined);
  });
});

describe("questionShotEvent", () => {
  const AT = "2026-10-06T03:00:00.000Z";

  it("decodes a line carrying a question and a picture that reads", () => {
    expect(questionShotEvent({ atIso: AT, payload: { question: QUESTION, shot: SHOT } })).toEqual({
      atIso: AT,
      kind: "question-shot",
      question: QUESTION,
      shot: SHOT,
    });
  });

  it("decodes no event when the picture does not read, so an earlier picture is not cleared by a broken one", () => {
    expect(questionShotEvent({ atIso: AT, payload: { question: QUESTION, shot: { ...SHOT, boxes: [] } } })).toBe(
      undefined,
    );
  });

  it("decodes no event when the line names no question", () => {
    expect(questionShotEvent({ atIso: AT, payload: { shot: SHOT } })).toBe(undefined);
  });
});

describe("sameAskShot", () => {
  it("is true for two absent pictures and for the same bytes boxed the same", () => {
    expect(sameAskShot({ left: undefined, right: undefined })).toBe(true);
    expect(sameAskShot({ left: SHOT, right: { ...SHOT, boxes: [{ ...SHOT.boxes[0]! }] } })).toBe(true);
  });

  it("is false for one absent, other bytes, or a box relabelled", () => {
    expect(sameAskShot({ left: SHOT, right: undefined })).toBe(false);
    expect(sameAskShot({ left: SHOT, right: { ...SHOT, sha256: "b".repeat(64) } })).toBe(false);
    expect(sameAskShot({ left: SHOT, right: { ...SHOT, boxes: [{ ...SHOT.boxes[0]!, label: "missing" }] } })).toBe(
      false,
    );
  });
});
