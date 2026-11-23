/**
 * `answerCarrying` — where the door's freshness note lands on an answer, and what it leaves alone. Pure:
 * every case is a plain call against a literal answer form.
 */
import { describe, expect, it } from "vitest";

import { answerCarrying } from "../../../../live/turn/answerFreshnessNote.js";
import { answerDigestOf } from "../../../../live/turn/posterAnswer.js";
import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";

const NOTE =
  "as of 03:17Z, 2 messages landed in here after the point i read up to, and none of them touched anything i claim above.";

const ANSWER: AnswerFormAnswer = {
  body: [{ runs: [{ text: "the substance", type: "text" }], type: "paragraph" }],
  citations: [],
  documents: [],
  grounding: {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing was out of reach" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "conversation",
    provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
    reason: "read the thread",
  },
  images: [],
  index: [[{ text: "the one index row", type: "text" }]],
  kind: "answer",
  lead: "yeah so,",
  measurements: [],
};

describe("answerCarrying", () => {
  it("returns the answer untouched when the thread did not move", () => {
    expect(answerCarrying({ answer: ANSWER, freshnessNote: undefined })).toBe(ANSWER);
  });

  it("prepends the note as the FIRST block of the fold", () => {
    const carried = answerCarrying({ answer: ANSWER, freshnessNote: NOTE });
    expect(carried.body).toEqual([
      { runs: [{ text: NOTE, type: "text" }], type: "paragraph" },
      { runs: [{ text: "the substance", type: "text" }], type: "paragraph" },
    ]);
  });

  it("never touches the index, so a freshness caveat cannot displace a substantive row", () => {
    const carried = answerCarrying({ answer: ANSWER, freshnessNote: NOTE });
    expect(carried.index).toEqual([[{ text: "the one index row", type: "text" }]]);
  });

  it("never touches the lead, which is what a reader sees first", () => {
    const carried = answerCarrying({ answer: ANSWER, freshnessNote: NOTE });
    expect(carried.lead).toBe("yeah so,");
  });

  it("does not mutate the answer it was given, so the digest-bound value survives", () => {
    answerCarrying({ answer: ANSWER, freshnessNote: NOTE });
    expect(ANSWER.body).toEqual([{ runs: [{ text: "the substance", type: "text" }], type: "paragraph" }]);
  });

  it("carries the note onto an answer whose fold was empty", () => {
    const carried = answerCarrying({ answer: { ...ANSWER, body: [] }, freshnessNote: NOTE });
    expect(carried.body).toEqual([{ runs: [{ text: NOTE, type: "text" }], type: "paragraph" }]);
  });
});

describe("the note must not change the digest a verdict binds to", () => {
  it("leaves answerDigestOf({ answer }) untouched, because the note is never part of the answer", () => {
    const before = answerDigestOf({ answer: ANSWER });
    answerCarrying({ answer: ANSWER, freshnessNote: NOTE });
    expect(answerDigestOf({ answer: ANSWER })).toBe(before);
  });

  it("DOES change the digest once carried — which is why it is applied after the gate, never before it", () => {
    // The measured defect this pins: the first draft injected the note in `turn answer`, so the door hashed
    // the noted answer, the digest never matched the verdict, and every send carrying a note was refused.
    const carried = answerCarrying({ answer: ANSWER, freshnessNote: NOTE });
    expect(answerDigestOf({ answer: carried })).not.toBe(answerDigestOf({ answer: ANSWER }));
  });
});
