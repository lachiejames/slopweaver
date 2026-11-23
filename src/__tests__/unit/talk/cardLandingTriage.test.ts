/**
 * The owner's triage ruling carried onto the landing their words made (`../../../talk/cardLandingTriage.ts`): joined on the
 * relay's own anchor, so an ask card whose work is the ask still carries it, then on the relay row a transcript
 * landing points its work at.
 */
import { describe, expect, it } from "vitest";

import type { CardLandedRow } from "../../../talk/cardLanding.js";
import { landingsWithTriage } from "../../../talk/cardLandingTriage.js";
import type { TurnRecord } from "../../../talk/relayStore.js";

const TURN = "a0000028-0000-4000-8000-000000000031";
const RELAY = "talk-a00000280000";
const AT = "2026-10-13T23:38:42.192Z";

/** A spoken relay that parked the card for a working session and never said whether the owner had finished speaking. */
const UNSTATED: TurnRecord = {
  about: "ask:q1",
  anchor: `talk:${TURN}`,
  delivery: null,
  digest: "d",
  heard: "park it for a working session, waiting on them",
  picture: { kind: "none", reason: "screen-not-shared" },
  readsAfter: [],
  registeredAtIso: AT,
  slug: RELAY,
  stagedAtIso: AT,
  state: "registered",
  triageRuling: { label: "waiting-on-them", verdict: "park-working-session" },
  turnId: TURN,
  typed: false,
  words: "park it for a working session, waiting on them",
  wordsAlone: false,
};

/** `talk relay`'s receipt for that park, said whole. */
const PARKED: TurnRecord = { ...UNSTATED, heardTailCut: false };

/**
 * A landing of those words.
 *
 * @param anchor the utterance it landed under
 * @param cardKey the card it landed on
 * @param workSlug the board row its work is
 * @returns the ledger row
 */
function landing({ anchor, cardKey, workSlug }: { anchor: string; cardKey: string; workSlug: string }): CardLandedRow {
  return { anchor, atIso: AT, cardKey, decidedIso: AT, kind: "landed", source: "relay", words: "park it", workSlug };
}

describe("landingsWithTriage", () => {
  // An ask landing's work is the ask's own slug, so a join on the work row alone dropped the owner's park.
  it("carries a park onto an ask card's landing, whose work is the ask, by the relay's anchor", () => {
    const landed = landingsWithTriage({
      landings: [landing({ anchor: `talk:${TURN}`, cardKey: "ask:q1", workSlug: "q1" })],
      relays: [PARKED],
    });
    expect(landed.map((one) => one.triage)).toEqual([{ label: "waiting-on-them", verdict: "park-working-session" }]);
  });

  // A relay with no ruling was missing from the anchor join, so an older park on the work row stood in.
  it("takes the ruling of the relay whose anchor it landed under, none included, over an older park on its work row", () => {
    const fresh: TurnRecord = { ...PARKED, anchor: "talk:new", slug: "talk-new", triageRuling: null, turnId: "new" };
    const landed = landingsWithTriage({
      landings: [landing({ anchor: "talk:new", cardKey: "ask:q1", workSlug: RELAY })],
      relays: [PARKED, fresh],
    });
    expect(landed.map((one) => Object.hasOwn(one, "triage"))).toEqual([false]);
  });

  it("carries it onto a transcript landing whose work is the relay's row, and onto none other", () => {
    const landed = landingsWithTriage({
      landings: [
        landing({ anchor: "call:c1#s1", cardKey: "hand:h1", workSlug: RELAY }),
        landing({ anchor: "call:c1#s2", cardKey: "hand:h2", workSlug: "dispatch-1" }),
      ],
      relays: [PARKED],
    });
    expect(landed.map((one) => Object.hasOwn(one, "triage"))).toEqual([true, false]);
  });

  // A park the voice read off words cut short drew the card parked on the Queue.
  // A spoken relay that never said kept its park, so a later landing drew a ruling never stated whole.
  it("carries no ruling from a spoken relay marked cut or never saying, by its anchor or its row; a whole or typed one keeps it", () => {
    const cut: TurnRecord = { ...PARKED, heardTailCut: true };
    const typed: TurnRecord = { ...UNSTATED, typed: true };
    const landings = [
      landing({ anchor: `talk:${TURN}`, cardKey: "ask:q1", workSlug: "q1" }),
      landing({ anchor: "call:c1#s1", cardKey: "hand:h1", workSlug: RELAY }),
    ];
    const triaged = ({ relay }: { relay: TurnRecord }): boolean[] =>
      landingsWithTriage({ landings, relays: [relay] }).map((one) => Object.hasOwn(one, "triage"));
    expect([cut, UNSTATED, PARKED, typed].map((relay) => triaged({ relay }))).toEqual([
      [false, false],
      [false, false],
      [true, true],
      [true, true],
    ]);
  });

  it("lets a cut relay on the same row shadow an older park, never fall back to it", () => {
    const cut: TurnRecord = { ...PARKED, anchor: "talk:new", heardTailCut: true, turnId: "new" };
    const landed = landingsWithTriage({
      landings: [landing({ anchor: "call:c1#s1", cardKey: "hand:h1", workSlug: RELAY })],
      relays: [PARKED, cut],
    });
    expect(landed.map((one) => Object.hasOwn(one, "triage"))).toEqual([false]);
  });
});
