/**
 * Whether a relay's own writes may act on the owner's words (`../../../talk/relayCutHold.ts`): only a relay that says
 * they were whole stands, and the HELD clause appears only when the relay carried something it held.
 */
import { describe, expect, it } from "vitest";

import {
  heldCardKeys,
  heldTriageVerdictOf,
  relayCutHold,
  relayHeldLead,
  STILL_SPEAKING_HOLD,
  TAIL_UNSTATED_HOLD,
} from "../../../talk/relayCutHold.js";

describe("relayCutHold", () => {
  it("lets whole words act, and holds cut words and words that never said either way", () => {
    expect([
      relayCutHold({ heardTailCut: false }),
      relayCutHold({ heardTailCut: true }),
      relayCutHold({ heardTailCut: undefined }),
    ]).toEqual([undefined, STILL_SPEAKING_HOLD, TAIL_UNSTATED_HOLD]);
  });
});

describe("heldTriageVerdictOf", () => {
  const sendIt = { label: undefined, verdict: "send-it" } as const;
  const rewrite = { label: undefined, verdict: "rewrite" } as const;
  const turn = { slug: "row-1", typed: false } as const;

  it("reads a send-it on a voice relay not stated whole as unreadable, naming the hold", () => {
    expect([
      heldTriageVerdictOf({ record: { ...turn, heardTailCut: true, triageRuling: sendIt } }),
      heldTriageVerdictOf({ record: { ...turn, triageRuling: sendIt } }),
    ]).toEqual([
      { kind: "unreadable", why: `send-it heard but not applied: ${STILL_SPEAKING_HOLD}` },
      { kind: "unreadable", why: `send-it heard but not applied: ${TAIL_UNSTATED_HOLD}` },
    ]);
  });

  it("keeps a send-it on whole or typed words, and a refusing verdict on cut words, as stored", () => {
    expect([
      heldTriageVerdictOf({ record: { ...turn, heardTailCut: false, triageRuling: sendIt } }),
      heldTriageVerdictOf({ record: { ...turn, triageRuling: sendIt, typed: true } }),
      heldTriageVerdictOf({ record: { ...turn, heardTailCut: true, triageRuling: rewrite } }),
    ]).toEqual([
      { kind: "stored", ruling: sendIt },
      { kind: "stored", ruling: sendIt },
      { kind: "stored", ruling: rewrite },
    ]);
  });
});

describe("heldCardKeys", () => {
  it("names the card on screen then each also-answered register card, and no empty key or unheld card", () => {
    expect([
      heldCardKeys({ about: "ask:q1", alsoAnswers: ["draft:d1", "recipe:r1", "hand:h1"] }),
      heldCardKeys({ about: "", alsoAnswers: [] }),
      heldCardKeys({ about: "candidate:c-105", alsoAnswers: ["align:a1"] }),
    ]).toEqual([["ask:q1", "draft:d1", "hand:h1"], [], []]);
  });
});

describe("relayHeldLead", () => {
  it("opens on HELD with the reason when a held relay carried a card or a ruling", () => {
    const clause = `HELD: no Queue card landed and no ruling took effect, because ${STILL_SPEAKING_HOLD} — read the whole stretch on the call first.`;
    expect([
      relayHeldLead({ cardKeys: ["ask:q1"], hold: STILL_SPEAKING_HOLD, ruled: false }),
      relayHeldLead({ cardKeys: [], hold: STILL_SPEAKING_HOLD, ruled: true }),
    ]).toEqual([clause, clause]);
  });

  it("says nothing for whole words, nor for a held relay that carried no card and no ruling", () => {
    expect([
      relayHeldLead({ cardKeys: ["ask:q1"], hold: undefined, ruled: true }),
      relayHeldLead({ cardKeys: [], hold: TAIL_UNSTATED_HOLD, ruled: false }),
    ]).toEqual([undefined, undefined]);
  });
});
