/*
 * The release rule over the owner's real words: four answers were spoken over their unfinished clauses, the
 * voice starting 1 ms after their transcript closed. Pure; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { heldAnswerRefusal } from "../../lib/talkPlanHeard";

/** The first cut-in's words, as the owner's transcript closed on them. */
const MID_CLAUSE = "Um, I believe that the answer here is probably going to be some";

describe("heldAnswerRefusal", () => {
  const at = ({ nowMs, heardTail }: { nowMs: number; heardTail: string }) =>
    heldAnswerRefusal({
      blocked: undefined,
      heardAt: 0,
      heardTail,
      heardUtteranceOpen: false,
      nowMs,
      voiceAt: undefined,
    });

  it("holds an answer over the owner's unfinished clause, and gives it once they have been quiet five seconds", () => {
    expect([at({ heardTail: MID_CLAUSE, nowMs: 1 }), at({ heardTail: MID_CLAUSE, nowMs: 4_999 })]).toEqual([
      "the owner is still talking",
      "the owner is still talking",
    ]);
    expect(at({ heardTail: MID_CLAUSE, nowMs: 5_000 })).toBe(undefined);
  });

  it("holds twelve seconds when the owner's words trail off on a filler or ask the voice to wait", () => {
    const trailing = "so the next thing is, um";
    expect(at({ heardTail: trailing, nowMs: 5_000 })).toBe("the owner's words trail off or ask to wait");
    expect(at({ heardTail: "hang on", nowMs: 11_999 })).toBe("the owner's words trail off or ask to wait");
    expect(at({ heardTail: trailing, nowMs: 12_000 })).toBe(undefined);
  });

  it("gives it two seconds after the owner's code word over", () => {
    expect(at({ heardTail: "that's what I think, over", nowMs: 1_999 })).toBe("the owner is still talking");
    expect(at({ heardTail: "that's what I think, over", nowMs: 2_000 })).toBe(undefined);
  });

  it("waits out the voice's own words, and gives it at once when the owner has said nothing", () => {
    const quietOwner = { blocked: undefined, heardAt: undefined, heardTail: "", heardUtteranceOpen: false };
    expect(heldAnswerRefusal({ ...quietOwner, nowMs: 10_000, voiceAt: 9_000 })).toBe("the voice is talking");
    expect(heldAnswerRefusal({ ...quietOwner, nowMs: 10_000, voiceAt: 8_000 })).toBe(undefined);
    expect(heldAnswerRefusal({ ...quietOwner, nowMs: 0, voiceAt: undefined })).toBe(undefined);
  });

  it("names the call's own reason first", () => {
    const blocked = "a nudge is being said";
    const open = { heardAt: undefined, heardTail: "", heardUtteranceOpen: true, nowMs: 0, voiceAt: undefined };
    expect(heldAnswerRefusal({ ...open, blocked })).toBe(blocked);
  });

  // An answer went 5s after the owner's last delta, 0.69s before the done of their utterance. Open, it waits whatever
  // the quiet since that delta.
  it("holds while the owner's utterance is open, however long since its last delta", () => {
    const lastDelta = Date.parse("2026-10-22T10:43:14.040Z");
    const released = Date.parse("2026-10-22T10:43:19.040Z");
    const open = { blocked: undefined, heardAt: lastDelta, heardTail: "", nowMs: released, voiceAt: undefined };
    expect(heldAnswerRefusal({ ...open, heardUtteranceOpen: true })).toBe("the owner's utterance is still open");
    expect(heldAnswerRefusal({ ...open, heardUtteranceOpen: false })).toBe(undefined);
  });
});
