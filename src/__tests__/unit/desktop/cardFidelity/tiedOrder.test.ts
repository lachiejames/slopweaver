/*
 * `cardFidelityObservation` and `segmentsOf` on segments that tie or arrive out of order: an answer tied with the owner's
 * challenge stays in the turn before it by the call file's order, and a segment written late but begun earlier sorts
 * before the one written first.
 */
import { describe, expect, it } from "vitest";

import { cardFidelityObservation } from "../../../../desktop/cardFidelity.js";
import { segmentsOf } from "../../../../desktop/cardFidelitySegments.js";
import { at, CHALLENGE, FAITHFUL, GOOD, KEY, said } from "./harness.js";

describe("cardFidelityObservation", () => {
  // An answer and the owner's challenge in the same millisecond are not split by instant, or the answer would read
  // as the challenge's reply and a failure would anchor on a segment that came before the challenge.
  it("keeps an answer tied with the owner's challenge in the turn before it, by the call file's order", () => {
    const entries = [
      ...GOOD.slice(0, 4),
      said({ id: "v1", s: 6, text: FAITHFUL, who: "voice" }),
      said({ id: "h2", s: 6, text: CHALLENGE, who: "owner" }),
      said({ id: "v2", s: 7, text: "You're right, that is a fair point about the export.", who: "voice" }),
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect(seen.first!.anchor).toBe("talk-call:c1#v1");
    expect(seen.failures.map((failure) => [failure.code, failure.anchor])).toEqual([
      ["CHALLENGE_NOT_REREAD", "talk-call:c1#v2"],
      ["CHALLENGE_CONCEDED", "talk-call:c1#v2"],
      ["CARD_LIMIT_UNSAID", "talk-call:c1#v2"],
      ["UNCHECKED_UNSAID", "talk-call:c1#v2"],
    ]);
  });

  // An answer begun with the owner's challenge but written after it stays before it, as the file has it.
  it("keeps a tied start in file order when the answer's line was written after the owner's challenge's", () => {
    const entries = [
      ...GOOD.slice(0, 4),
      { ...said({ id: "v1", s: 7, text: FAITHFUL, who: "voice" }), beganIso: at({ seconds: 6 }) },
      said({ id: "h2", s: 6, text: CHALLENGE, who: "owner" }),
      said({ id: "v2", s: 8, text: "You're right, that is a fair point about the export.", who: "voice" }),
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect(seen.first!.anchor).toBe("talk-call:c1#v1");
    expect(seen.failures.map((failure) => [failure.code, failure.anchor])).toEqual([
      ["CHALLENGE_NOT_REREAD", "talk-call:c1#v2"],
      ["CHALLENGE_CONCEDED", "talk-call:c1#v2"],
      ["CARD_LIMIT_UNSAID", "talk-call:c1#v2"],
      ["UNCHECKED_UNSAID", "talk-call:c1#v2"],
    ]);
  });

  // A delayed batch writes a segment after one it was spoken before. The anchor is the one the owner HEARD
  // first, by when it began, never the one the file happens to hold first.
  it("orders a segment written late but begun earlier before the one written first", () => {
    const lines = [
      said({ id: "v-late", s: 10, text: "It failed 99 times.", who: "voice" }),
      { ...said({ id: "v-early", s: 11, text: "Maybe 99 attempts.", who: "voice" }), beganIso: at({ seconds: 5 }) },
    ];
    expect(segmentsOf({ lines }).map((segment) => segment.id)).toEqual(["v-early", "v-late"]);
  });
});
