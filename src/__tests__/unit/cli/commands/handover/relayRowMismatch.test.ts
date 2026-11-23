/**
 * Which field of a relay turn disagrees with the row being settled, and when a relay's card is still owed.
 *
 * The case this exists for is the finding `a-row-anchored-to-a-cardless-voice-relay-settled-answered-cannot-be-
 * settled`: a row cut from a relay was refused on its slug for good, because its relay had been settled `answered`
 * — which an intake mark now does before any row is cut. The slug check only ties a card to the row that owes it,
 * so it is waived while no card is owed, and the anchor and state checks, which are about whether the turn is this
 * row's at all, still bite.
 */
import { describe, expect, it } from "vitest";

import { cardOwedOf, relayRowMismatchOf } from "../../../../../cli/commands/handover/settleCardRun.js";

const ANCHOR = "talk:a0000020-0000-4000-8000-000000000023";
const TURN = { anchor: ANCHOR, slug: "talk-a00000200000", state: "registered" as const };

describe("relayRowMismatchOf", () => {
  it("accepts the relay's own row", () => {
    expect(
      relayRowMismatchOf({ anchor: ANCHOR, cardOwed: true, filedFrom: [], slug: TURN.slug, turn: TURN }),
    ).toBeUndefined();
  });

  it("accepts a row cut from a relay that owes no card, whose relay row was answered rather than filed", () => {
    expect(
      relayRowMismatchOf({
        anchor: ANCHOR,
        cardOwed: false,
        filedFrom: [],
        slug: "voice-lookup-reasoning-effort-default",
        turn: TURN,
      }),
    ).toBeUndefined();
  });

  it("still refuses a cut row on its slug while the relay's card is owed and nothing filed it", () => {
    expect(relayRowMismatchOf({ anchor: ANCHOR, cardOwed: true, filedFrom: [], slug: "the-cut-row", turn: TURN })).toBe(
      "slug",
    );
  });

  it("accepts a cut row of a relay owing a card once the relay is filed into it", () => {
    const filedFrom = [{ anchor: ANCHOR, slug: TURN.slug }];

    expect(
      relayRowMismatchOf({ anchor: ANCHOR, cardOwed: true, filedFrom, slug: "the-cut-row", turn: TURN }),
    ).toBeUndefined();
  });

  it("still refuses a turn owing no card whose anchor or state disagrees", () => {
    expect(
      relayRowMismatchOf({
        anchor: ANCHOR,
        cardOwed: false,
        filedFrom: [],
        slug: "x",
        turn: { ...TURN, anchor: "talk:other" },
      }),
    ).toBe("anchor");
    expect(
      relayRowMismatchOf({
        anchor: ANCHOR,
        cardOwed: false,
        filedFrom: [],
        slug: "x",
        turn: { ...TURN, state: "registering" },
      }),
    ).toBe("state");
  });
});

describe("cardOwedOf", () => {
  it("owes nothing for a relay over no hand card", () => {
    expect(cardOwedOf({ fate: undefined })).toBe(false);
  });

  it("owes nothing for a card already settled, re-cut or never posted", () => {
    expect(cardOwedOf({ fate: { dids: ["settle:other-row"], kind: "settled" } })).toBe(false);
    expect(cardOwedOf({ fate: { kind: "superseded", successors: ["hand:the-recut"] } })).toBe(false);
    expect(cardOwedOf({ fate: { kind: "absent" } })).toBe(false);
  });

  it("owes a disposition for an open card", () => {
    expect(cardOwedOf({ fate: { kind: "open" } })).toBe(true);
  });
});
