/*
 * `cardFidelityObservation` on whether the card was read at all: a faithful account that re-read before answering the
 * challenge passes clean, a card never read is named, and an absence is anchored on the segment that shows it.
 */
import { describe, expect, it } from "vitest";

import { cardFidelityObservation } from "../../../../desktop/cardFidelity.js";
import { cardSourceOf } from "../../../../desktop/cardFidelitySource.js";
import type { CallEntry } from "../../../../talk/callRecord.js";
import { ANSWER, CHALLENGE, GOOD, KEY, said } from "./harness.js";

describe("cardFidelityObservation", () => {
  it("passes a faithful account that re-read before answering the challenge", () => {
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries: GOOD,
      surface: "spoken",
    });
    expect([seen.cardRead, seen.briefing.state, seen.challenge, seen.failures]).toEqual([
      true,
      "read",
      "reread-before-answer",
      [],
    ]);
    expect(seen.sourceDigest).toBe(cardSourceOf({ answer: ANSWER, cardKey: KEY })!.digest);
  });

  it("names a card never read, anchored on the voice's first words", () => {
    const entries = [GOOD[0]!, said({ id: "v1", s: 6, text: "I could not find it.", who: "voice" })];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "typed",
    });
    expect([seen.cardRead, seen.failures]).toEqual([
      false,
      [{ anchor: "talk-call:c1#v1", code: "CARD_NOT_READ", detail: `${KEY} never read` }],
    ]);
  });

  // An absence with no voice line to anchor on is anchored on the owner's ask, never on the call with no segment named.
  it("anchors an absence on the owner's ask when the voice said nothing at all", () => {
    const judge = ({ entries }: { entries: readonly CallEntry[] }): readonly (readonly string[])[] =>
      cardFidelityObservation({
        callId: "c1",
        cardKey: KEY,
        challenge: CHALLENGE,
        entries,
        surface: "spoken",
      }).failures.map((failure) => [failure.code, failure.anchor]);
    expect(judge({ entries: [GOOD[0]!] })).toEqual([["CARD_NOT_READ", "talk-call:c1#h1"]]);
    const greeted = [said({ id: "v0", s: -2, text: "Hello, how can I help?", who: "voice" }), GOOD[0]!];
    expect(judge({ entries: greeted })).toEqual([["CARD_NOT_READ", "talk-call:c1#h1"]]);
    const earlier = [
      said({ id: "h0", s: -4, text: "Hello", who: "owner" }),
      said({ id: "v0", s: -3, text: "Hi", who: "voice" }),
      GOOD[0]!,
      said({ id: "v1", s: 6, text: "I could not find that card.", who: "voice" }),
      GOOD[5]!,
      said({ id: "v2", s: 23, text: "It is not there.", who: "voice" }),
    ];
    expect(judge({ entries: earlier })).toEqual([["CARD_NOT_READ", "talk-call:c1#v1"]]);
    // With no challenge typed, a later farewell is not the card ask.
    const farewell = [
      GOOD[0]!,
      said({ id: "v1", s: 1, text: "I could not find it.", who: "voice" }),
      said({ id: "h2", s: 2, text: "Thanks anyway.", who: "owner" }),
      said({ id: "v2", s: 3, text: "Goodbye.", who: "voice" }),
    ];
    expect(judge({ entries: farewell })).toEqual([["CARD_NOT_READ", "talk-call:c1#v1"]]);
    // An ask and the typed challenge stamped the same millisecond stand in the order said.
    const sharedMs = [
      said({ id: "h0", s: -4, text: "Hello", who: "owner" }),
      said({ id: "v0", s: -3, text: "Hi", who: "voice" }),
      GOOD[0]!,
      said({ id: "h2", s: 0, text: CHALLENGE, who: "owner" }),
      said({ id: "v1", s: 1, text: "I could not find it.", who: "voice" }),
    ];
    expect(judge({ entries: sharedMs })).toEqual([["CARD_NOT_READ", "talk-call:c1#h1"]]);
    // A voice line before the ask at the ask's own millisecond is not its reply.
    const greetedSameMs = [
      said({ id: "v0", s: 0, text: "Hello", who: "voice" }),
      GOOD[0]!,
      said({ id: "v1", s: 1, text: "I could not find that card.", who: "voice" }),
      said({ id: "h2", s: 2, text: CHALLENGE, who: "owner" }),
    ];
    expect(judge({ entries: greetedSameMs })).toEqual([["CARD_NOT_READ", "talk-call:c1#v1"]]);
    // A card read with no answer after it anchors on the reply the voice gave the ask before reading.
    const unanswered = [
      GOOD[0]!,
      { ...said({ id: "v0", s: 1, text: "I cannot answer without opening it.", who: "voice" }), final: false },
      GOOD[1]!,
      GOOD[5]!,
    ];
    expect(judge({ entries: unanswered }).filter(([code]) => code === "NO_ANSWER")).toEqual([
      ["NO_ANSWER", "talk-call:c1#v0"],
    ]);
    // A call dropped mid-reply never finalises it, and that reply is still what shows the absence.
    const dropped = [
      GOOD[0]!,
      { ...said({ id: "v1", s: 1, text: "I could not find it.", who: "voice" }), final: false },
    ];
    expect(judge({ entries: dropped })).toEqual([["CARD_NOT_READ", "talk-call:c1#v1"]]);
    const sameInstant = [GOOD[0]!, said({ id: "v1", s: 0, text: "I cannot find it.", who: "voice" }), GOOD[5]!];
    expect(judge({ entries: sameInstant })).toEqual([["CARD_NOT_READ", "talk-call:c1#v1"]]);
    expect(judge({ entries: GOOD.slice(0, 4) })).toEqual([["NO_ANSWER", "talk-call:c1#h1"]]);
  });
});
