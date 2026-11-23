/*
 * `cardFidelityObservation` on a word handed to the voice and moved in the saying: the anchor is the segment that
 * moved it, whether within one segment or across two, never an earlier one that kept it in place.
 */
import { describe, expect, it } from "vitest";

import { cardFidelityObservation } from "../../../../desktop/cardFidelity.js";
import type { CallEntry } from "../../../../talk/callRecord.js";
import { at, CHALLENGE, GOOD, KEY, said } from "./harness.js";

describe("cardFidelityObservation", () => {
  // A moved word is anchored on the segment that moved it, never on the first segment holding it in its own sentence.
  it("anchors a moved word on the segment that moved it, never an earlier one keeping it in place", () => {
    const wrote: CallEntry = {
      atIso: at({ seconds: 5 }),
      itemId: "w1",
      kind: "wrote",
      text: "Uploading needs a service key. The powerful key is optional.",
      turnId: "t1",
    };
    const entries = [
      ...GOOD.slice(0, 4),
      wrote,
      said({ id: "v1", s: 6, text: "The powerful key is optional.", who: "voice" }),
      said({ id: "v2", s: 7, text: "Uploading needs a powerful service key.", who: "voice" }),
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    const moved = seen.failures.filter((failure) => failure.code === "HANDED_WORD_MOVED");
    expect(moved.map((failure) => [failure.anchor, failure.detail])).toEqual([["talk-call:c1#v2", "powerful"]]);
  });

  // A sentence run across two segments moves a word that neither segment moves on its own.
  it("anchors a word moved across two segments on the segment that said it", () => {
    const wrote: CallEntry = {
      atIso: at({ seconds: 5 }),
      itemId: "w1",
      kind: "wrote",
      text: "The upload needs a service key. The powerful key costs more.",
      turnId: "t1",
    };
    const entries = [
      ...GOOD.slice(0, 4),
      wrote,
      said({ id: "v1", s: 6, text: "The upload needs a service key", who: "voice" }),
      said({ id: "v2", s: 7, text: "Powerful", who: "voice" }),
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    const moved = seen.failures.filter((failure) => failure.code === "HANDED_WORD_MOVED");
    expect(moved.map((failure) => [failure.anchor, failure.detail])).toEqual([["talk-call:c1#v2", "powerful"]]);
  });

  // An earlier segment keeping the word in place must not take the anchor from the one that moved it.
  it("anchors a word moved across two segments past an earlier segment that kept it in place", () => {
    const wrote: CallEntry = {
      atIso: at({ seconds: 5 }),
      itemId: "w1",
      kind: "wrote",
      text: "The upload needs a service key. The powerful key costs more.",
      turnId: "t1",
    };
    const entries = [
      ...GOOD.slice(0, 4),
      wrote,
      said({ id: "v1", s: 6, text: "The powerful key costs more.", who: "voice" }),
      said({ id: "v2", s: 7, text: "The upload needs a service", who: "voice" }),
      said({ id: "v3", s: 8, text: "powerful key.", who: "voice" }),
    ];
    const seen = cardFidelityObservation({
      callId: "c1",
      cardKey: KEY,
      challenge: CHALLENGE,
      entries,
      surface: "spoken",
    });
    const moved = seen.failures.filter((failure) => failure.code === "HANDED_WORD_MOVED");
    expect(moved.map((failure) => [failure.anchor, failure.detail])).toEqual([["talk-call:c1#v3", "powerful"]]);
  });
});
