/*
 * `cardFidelityObservation` on which read an answer answers: the call file's order settles a tie with a card read, a
 * read after the challenge is never both reads, the owner's line never inherits a voice segment's position, and a read or an
 * answer whose file order and instant disagree is never counted on the side its instant claims.
 */
import { describe, expect, it } from "vitest";

import { cardFidelityObservation } from "../../../../desktop/cardFidelity.js";
import { ANSWER, at, CHALLENGE, FAITHFUL, GOOD, KEY, said, tool } from "./harness.js";

describe("cardFidelityObservation", () => {
  // An answer written BEFORE the card read in the same millisecond is not an answer to it, or a call that answered
  // first and read second would pass clean. The file's order settles a tie.
  it("never takes an answer written before the card read in its millisecond as an answer to that read", () => {
    const entries = [
      GOOD[0]!,
      said({ id: "v1", s: 2, text: FAITHFUL, who: "voice" }),
      ...GOOD.slice(1, 4),
      ...GOOD.slice(5),
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect([seen.cardRead, seen.first]).toEqual([true, undefined]);
    expect(seen.failures.map((failure) => [failure.code, failure.anchor])).toEqual([["NO_ANSWER", "talk-call:c1#v1"]]);
  });

  // One read typed only after the challenge is not both the first read and the re-read.
  it("never takes one read after the challenge as both the first read and the re-read", () => {
    const entries = [
      GOOD[0]!,
      said({ id: "v1", s: 6, text: "I think the export failed.", who: "voice" }),
      GOOD[5]!,
      GOOD[6]!,
      GOOD[7]!,
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect([seen.cardRead, seen.challenge]).toEqual([false, "not-challenged"]);
    expect(seen.failures).toEqual([
      { anchor: "talk-call:c1#v1", code: "CARD_NOT_READ", detail: `${KEY} first read only after the challenge` },
    ]);
  });

  // The owner's challenge reusing a voice segment's id must not inherit that segment's earlier position, or a read
  // written before the challenge would count as the re-read after it.
  it("never lets the owner's line inherit a voice segment's position by sharing its id", () => {
    const entries = [
      ...GOOD.slice(0, 5),
      { ...said({ id: "shared", s: 8, text: "noise", who: "voice" }), final: false },
      tool({ answer: ANSWER, detail: `${KEY}, read`, name: "read_card", s: 9 }),
      said({ id: "shared", s: 20, text: CHALLENGE, who: "owner" }),
      GOOD[7]!,
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect(seen.challenge).toBe("answered-without-reread");
    expect(seen.failures.map((failure) => failure.code)).toContain("CHALLENGE_NOT_REREAD");
  });

  // A segment that began as other words and took the challenge in a later snapshot must not make a read written
  // between the two count as the re-read after the challenge.
  it("judges a re-read against the line that first carries the challenge, never the segment's earlier start", () => {
    const entries = [
      ...GOOD.slice(0, 5),
      { ...said({ id: "h2", s: 10, text: "Thanks.", who: "owner" }), final: false },
      tool({ answer: ANSWER, detail: `${KEY}, read`, name: "read_card", s: 11 }),
      { ...said({ id: "h2", s: 20, text: CHALLENGE, who: "owner" }), beganIso: at({ seconds: 10 }) },
      GOOD[7]!,
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect(seen.challenge).toBe("answered-without-reread");
    expect(seen.failures.map((failure) => failure.code)).toContain("CHALLENGE_NOT_REREAD");
  });

  // A delayed read line landing after the challenge but stamped before it is not the re-read. A read whose file order and instant disagree is neither the first read nor the re-read.
  it("never counts a read written after the challenge but stamped before it as the re-read", () => {
    const entries = [
      ...GOOD.slice(0, 6),
      tool({ answer: ANSWER, detail: `${KEY}, read`, name: "read_card", s: 10 }),
      GOOD[7]!,
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect(seen.challenge).toBe("answered-without-reread");
    expect(seen.failures.map((failure) => failure.code)).toContain("CHALLENGE_NOT_REREAD");
  });

  // A challenged answer written before the re-read but stamped after it does not count as re-read first.
  it("never counts an answer written before the re-read but stamped after it as answered after the re-read", () => {
    const entries = [...GOOD.slice(0, 6), GOOD[7]!, GOOD[6]!];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect(seen.challenge).toBe("no-challenged-answer");
    expect(seen.failures.map((failure) => failure.code)).toContain("CHALLENGE_UNANSWERED");
  });

  // A segment written before the read must not join the turn behind one written after it.
  it("keeps every segment of an answer to those written after the read, not only its first", () => {
    const entries = [
      GOOD[0]!,
      said({ id: "v-before", s: 6, text: FAITHFUL, who: "voice" }),
      ...GOOD.slice(1, 4),
      said({ id: "v-after", s: 5, text: "Here is what it says.", who: "voice" }),
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect(seen.first!.anchor).toBe("talk-call:c1#v-after");
    expect(seen.failures.map((failure) => failure.code)).toContain("QUESTION_NOT_QUOTED");
  });

  it("still takes an answer written after the card read in its millisecond", () => {
    const entries = [...GOOD.slice(0, 4), said({ id: "v1", s: 2, text: FAITHFUL, who: "voice" }), ...GOOD.slice(5)];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect([seen.first!.anchor, seen.failures]).toEqual(["talk-call:c1#v1", []]);
  });

  it("never counts a challenged answer written before the re-read in its millisecond as re-read first", () => {
    const entries = [
      ...GOOD.slice(0, 6),
      said({ id: "v2", s: 21, text: "You're right, that is a fair point about the export.", who: "voice" }),
      GOOD[6]!,
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect(seen.challenge).toBe("no-challenged-answer");
    expect(seen.failures.map((failure) => failure.code)).toContain("CHALLENGE_UNANSWERED");
  });
});
