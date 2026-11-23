/*
 * The gate's verdict on one `relay_steer` call and the wire it forms: what the owner's words, the reads after them
 * and their microphone at hand-off make of the relay, before any hand-off or post runs.
 */
import { describe, expect, it } from "vitest";

import { acceptRelay, HEARD_ONLY_SAY, type RelayAccept } from "../../components/voice/relayAttemptAccept";
import type { TalkRelayWire } from "../../lib/talkRelayRequestWire";
import { CARD, CUT, HEARD, NOT_TAKEN, SHUT_NOTHING_NEW, TURN, WHOLE_STRETCH } from "./relayAttemptFixture";

/** The whole accepted relay for "fix the tab" read with nothing after it, at the heard tail the test names. */
const acceptedWith = ({ heardTail }: { heardTail: TalkRelayWire["heardTail"] }): RelayAccept => ({
  heard: "fix the tab",
  kind: "accepted",
  shownSay: "ship the fix",
  wire: { ...CUT, heardTail, readsAfter: [], say: "ship the fix", screen: NOT_TAKEN, turnId: TURN },
});

describe("acceptRelay", () => {
  const ACCEPT = {
    about: CARD,
    alsoAnswers: [],
    candidateRuling: undefined,
    checkIn: undefined,
    discussFirst: undefined,
    micAhead: false,
    picture: NOT_TAKEN,
    say: "ship the fix",
    standing: [],
    triageRuling: undefined,
    turnId: TURN,
    workspace: undefined,
  };

  // The transcript and the relay's call ride two transports, so the microphone is the one fact the
  // page holds of speech whose fragment has not landed yet. It only ever turns `whole` into `cut`.
  it("reads a finished stretch whole, and cut once the microphone ran ahead of the words", () => {
    const accepted = [false, true].map((micAhead) => acceptRelay({ ...ACCEPT, log: WHOLE_STRETCH, micAhead }));
    expect(accepted).toEqual([acceptedWith({ heardTail: "whole" }), acceptedWith({ heardTail: "cut" })]);
  });

  it("never reads a cut stretch whole, whatever the microphone says", () => {
    const accepted = [false, true].map((micAhead) => acceptRelay({ ...ACCEPT, log: [HEARD], micAhead }));
    expect(accepted).toEqual([acceptedWith({ heardTail: "cut" }), acceptedWith({ heardTail: "cut" })]);
  });

  it("carries the voice's reading when nothing was read after the owner spoke", () => {
    expect(acceptRelay({ ...ACCEPT, log: [HEARD] })).toEqual({
      heard: "fix the tab",
      kind: "accepted",
      shownSay: "ship the fix",
      wire: { ...CUT, readsAfter: [], say: "ship the fix", screen: NOT_TAKEN, turnId: TURN },
    });
  });

  it("drops the reading after a read, or under standing data, and the line says why", () => {
    const read = acceptRelay({ ...ACCEPT, log: [HEARD, { kind: "read", tool: "context_pack" }] });
    const standing = acceptRelay({ ...ACCEPT, log: [HEARD], standing: ["code_mode"] });
    expect([read, standing]).toEqual([
      {
        heard: "fix the tab",
        kind: "accepted",
        shownSay: HEARD_ONLY_SAY,
        wire: { ...CUT, readsAfter: ["context_pack"], screen: NOT_TAKEN, turnId: TURN },
      },
      {
        heard: "fix the tab",
        kind: "accepted",
        shownSay: HEARD_ONLY_SAY,
        wire: { ...CUT, readsAfter: ["code_mode"], screen: NOT_TAKEN, turnId: TURN },
      },
    ]);
  });

  it("carries the exact copy-tray offer the owner was reacting to, the reading beside it", () => {
    const offer = { belowFold: "Rest of it", id: "offer-4", label: "reply to Ari", made: "4", text: "Head ``` here" };
    expect(acceptRelay({ ...ACCEPT, log: [{ kind: "offered", offer }, HEARD] })).toEqual({
      heard: "fix the tab",
      kind: "accepted",
      shownSay: "ship the fix",
      wire: {
        ...CUT,
        offered: offer,
        readsAfter: [],
        say: "ship the fix",
        screen: NOT_TAKEN,
        turnId: TURN,
      },
    });
  });

  it("carries the offer in heard-only mode too, where the reading is dropped and the offer is not", () => {
    const offer = { id: "offer-2", made: "2", text: "Merged, thanks all" };
    const accepted = acceptRelay({
      ...ACCEPT,
      log: [{ kind: "offered", offer }, HEARD, { kind: "read", tool: "context_pack" }],
    });
    expect(accepted).toEqual({
      heard: "fix the tab",
      kind: "accepted",
      shownSay: HEARD_ONLY_SAY,
      wire: {
        ...CUT,
        offered: offer,
        readsAfter: ["context_pack"],
        screen: NOT_TAKEN,
        turnId: TURN,
      },
    });
  });

  it("carries no offer that landed before the last relay", () => {
    const offer = { id: "offer-1", made: "1", text: "Old draft" };
    const accepted = acceptRelay({ ...ACCEPT, log: [{ kind: "offered", offer }, HEARD, { kind: "relayed" }, HEARD] });
    // Strict, so an `offered: undefined` key on the wire would fail it as surely as an old offer.
    expect(accepted).toStrictEqual({
      heard: "fix the tab",
      kind: "accepted",
      shownSay: "ship the fix",
      wire: { ...CUT, readsAfter: [], say: "ship the fix", screen: NOT_TAKEN, turnId: TURN },
    });
  });

  it("shuts when nothing new has been said since the last relay", () => {
    expect(acceptRelay({ ...ACCEPT, log: [HEARD, { kind: "relayed" }] })).toEqual({
      kind: "shut",
      why: SHUT_NOTHING_NEW,
    });
  });
});
