/**
 * The relay turn `supervisorDelivery.test.ts`'s `relayTurnLine` cases start from — the owner's words, the voice turn they
 * answered, no picture — and the frame a relay keeps beside it. Held apart from that file to keep it under the
 * file-size ratchet's cap, and importable by any later test of the line.
 */
import type { RelayLineInput } from "../../../talk/supervisorDelivery.js";

/** The voice turn the TURN fixture's words answered. */
export const VOICE_TURN = "talk-call:a0000026-0000-4000-8000-000000000029#turn_A";

/** What a spoken line says the owner's words answered, with the TURN fixture's answer. */
export const SPOKEN = ` — answering the voice's "Option A or B?" (${VOICE_TURN}); triage verdict: none`;

/** A spoken relay of the owner's steer, answering a voice turn, with no screen shared. */
export const TURN: RelayLineInput = {
  answer: {
    triage: { kind: "none" },
    voice: {
      kind: "found",
      turn: { beganIso: "2026-09-23T13:09:50.000Z", pointer: VOICE_TURN, text: "Option A or B?" },
    },
  },
  callContext: { kind: "none" },
  heard: "okay cool, lets go with B",
  picture: { kind: "none", reason: "screen-not-shared" },
  readsAfter: [],
  slug: "talk-a00000260000",
  words: "The owner picked option B.",
  typed: false,
  wordsAlone: false,
};

/** A frame kept beside its turn, as the verb names it. */
export const SHOT = {
  bytes: 4096,
  kind: "attached",
  path: "/Users/owner/.slopweaver/talk/turns/a0000026-0000-4000-8000-000000000029.webp",
  sha256: "c".repeat(64),
} as const;
