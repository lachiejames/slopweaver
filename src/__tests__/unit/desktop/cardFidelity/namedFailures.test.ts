/*
 * `cardFidelityObservation` naming what an account got wrong: an unread briefing, a dropped option, an unquoted
 * question and an added figure; a challenge agreed around or never answered; and a first answer that ends at the owner's
 * next words.
 */
import { describe, expect, it } from "vitest";

import { cardFidelityObservation } from "../../../../desktop/cardFidelity.js";
import { BRIEFING, CHALLENGE, GOOD, KEY, said, tool } from "./harness.js";

describe("cardFidelityObservation", () => {
  it("names an unread briefing, a dropped option, an unquoted question and an added figure", () => {
    const entries = [
      GOOD[0]!,
      GOOD[1]!,
      said({ id: "v1", s: 6, text: "The export failed 5 times, so retry the nightly export once.", who: "voice" }),
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect(seen.failures.map((failure) => [failure.code, failure.detail])).toEqual([
      ["BRIEFING_NOT_READ", `not-read: board:acme-fixture-card, ${BRIEFING}`],
      ["CLAIM_DROPPED", "option B"],
      ["QUESTION_NOT_QUOTED", ""],
      ["FIGURE_UNSOURCED", "5"],
    ]);
    expect(seen.challenge).toBe("not-challenged");
  });

  it("names a challenge agreed around without a re-read, and the two things it never said", () => {
    const entries = [
      ...GOOD.slice(0, 6),
      said({ id: "v2", s: 23, text: "You're right, that is a fair point about the export.", who: "voice" }),
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect([seen.challenge, seen.concessions]).toEqual(["answered-without-reread", ["you're right", "fair point"]]);
    expect(seen.failures.map((failure) => [failure.code, failure.anchor])).toEqual([
      ["CHALLENGE_NOT_REREAD", "talk-call:c1#v2"],
      ["CHALLENGE_CONCEDED", "talk-call:c1#v2"],
      ["CARD_LIMIT_UNSAID", "talk-call:c1#v2"],
      ["UNCHECKED_UNSAID", "talk-call:c1#v2"],
    ]);
  });

  it("names a challenge never answered, and a read whose answer was not kept", () => {
    const entries = [GOOD[0]!, tool({ detail: `${KEY}, read`, name: "read_card", s: 2 }), GOOD[4]!, GOOD[5]!];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "typed",
    });
    expect(seen.failures.map((failure) => failure.code)).toEqual(["SOURCE_NOT_KEPT", "CHALLENGE_UNANSWERED"]);
    expect([seen.briefing.state, seen.sourceDigest]).toEqual(["not-measured", undefined]);
  });

  it("ends the first answer at the owner's next words, so a later turn is never read as the card's account", () => {
    const entries = [
      ...GOOD.slice(0, 5),
      said({ id: "h9", s: 10, text: "Thanks.", who: "owner" }),
      said({ id: "v9", s: 11, text: "It cost 99 dollars.", who: "voice" }),
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    expect([seen.first!.anchor, seen.first!.unsourced, seen.failures]).toEqual(["talk-call:c1#v1", [], []]);
  });
});
