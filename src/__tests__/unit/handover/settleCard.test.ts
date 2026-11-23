/**
 * What `handover settle` decides about a relay's hand card — the pure half, every arm with an exact outcome.
 */
import { describe, expect, it } from "vitest";

import {
  cardDispositionOf,
  cardFrontMatterFields,
  cardOutcomeLine,
  cardPlanOf,
  handCardIdOf,
  lockedCardVerdict,
  settleCardDid,
  settledByThisRow,
} from "../../../handover/settleCard.js";
import { SettleCardErrors } from "../../../handover/settleCardErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DID = "answered on handover row talk-a00000170000 — witness: https://example.invalid/p1";
const RELAY = "talk:a0000017-0000-4000-8000-000000000019";

describe("cardDispositionOf", () => {
  it("reads no flag as no disposition", () => {
    expect(unwrap(cardDispositionOf({ card: undefined, cardNew: undefined, cardWhy: undefined }))).toBe(undefined);
  });

  it("reads each disposition with its one companion, trimmed", () => {
    expect(unwrap(cardDispositionOf({ card: "done", cardNew: undefined, cardWhy: undefined }))).toEqual({
      kind: "done",
    });
    expect(unwrap(cardDispositionOf({ card: "kept", cardNew: undefined, cardWhy: "  the owner asked why  " }))).toEqual(
      {
        kind: "kept",
        why: "the owner asked why",
      },
    );
    expect(unwrap(cardDispositionOf({ card: "recut", cardNew: "iso-reply", cardWhy: undefined }))).toEqual({
      kind: "recut",
      successor: "iso-reply",
    });
  });

  it("refuses a value that is no disposition", () => {
    expect(unwrapErr(cardDispositionOf({ card: "closed", cardNew: undefined, cardWhy: undefined })).code).toBe(
      "CARD_FLAG_INVALID",
    );
  });

  it("refuses a kept card with no reason, and one whose reason is only blanks", () => {
    const missing = unwrapErr(cardDispositionOf({ card: "kept", cardNew: undefined, cardWhy: undefined }));
    expect(missing.code).toBe("CARD_COMPANION_MISSING");
    expect(missing.message).toBe(
      "--card kept needs --card-why: a card left up says why, where the next reader of the owner's queue sees it",
    );
    expect(unwrapErr(cardDispositionOf({ card: "kept", cardNew: undefined, cardWhy: "   " })).code).toBe(
      "CARD_COMPANION_MISSING",
    );
  });

  it("refuses a re-cut that names no successor", () => {
    expect(unwrapErr(cardDispositionOf({ card: "recut", cardNew: undefined, cardWhy: undefined })).message).toBe(
      "--card recut needs --card-new: the id of the card the re-cut posted",
    );
  });

  it("refuses a companion beside the wrong disposition, or with no --card", () => {
    expect(unwrapErr(cardDispositionOf({ card: "done", cardNew: undefined, cardWhy: "why" })).message).toBe(
      "--card-why does not go with --card done: --card-why is for kept, --card-new for recut",
    );
    expect(unwrapErr(cardDispositionOf({ card: "kept", cardNew: "x", cardWhy: "why" })).message).toBe(
      "--card-new does not go with --card kept: --card-why is for kept, --card-new for recut",
    );
    expect(unwrapErr(cardDispositionOf({ card: undefined, cardNew: "x", cardWhy: undefined })).message).toBe(
      "--card-new says something about a card, so it needs --card beside it",
    );
  });
});

describe("handCardIdOf", () => {
  it("names the step of a hand card and nothing for any other key", () => {
    expect(handCardIdOf({ about: "hand:gcloud-signin" })).toBe("gcloud-signin");
    expect(
      ["", "ask:stuck-chats", "draft:d1", "post:p1", "pr:owner/repo#1", "act:a1", "hand:"].map((about) =>
        handCardIdOf({ about }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("cardPlanOf", () => {
  const base = { did: DID, relayAnchor: RELAY };

  it("settles as before when the relay named no card or a card of another kind", () => {
    expect(unwrap(cardPlanOf({ ...base, about: "", disposition: undefined, fate: undefined }))).toEqual({
      kind: "none",
    });
    expect(unwrap(cardPlanOf({ ...base, about: "ask:stuck", disposition: undefined, fate: undefined }))).toEqual({
      kind: "none",
    });
  });

  it("refuses a --card on a row with no card to answer for", () => {
    expect(unwrapErr(cardPlanOf({ ...base, about: "", disposition: { kind: "done" }, fate: undefined })).message).toBe(
      "--card has nothing to answer for here: this row's relay names no card. Settle without it",
    );
    expect(
      unwrapErr(cardPlanOf({ ...base, about: "draft:d1", disposition: { kind: "done" }, fate: undefined })).message,
    ).toBe("--card has nothing to answer for here: draft:d1 is no hand card. Settle without it");
  });

  it("refuses an open card with no disposition, naming the card and all three choices", () => {
    const refused = unwrapErr(cardPlanOf({ ...base, about: "hand:x", disposition: undefined, fate: { kind: "open" } }));
    expect(refused).toEqual(SettleCardErrors.dispositionMissing({ cardKey: "hand:x" }));
    expect(refused.message).toBe(
      "this row is the relay the owner spoke with hand:x open, and that card is still on their queue — say what happens to " +
        'it: --card done (it is finished), --card kept --card-why "<why it stays up>" (answering was not finishing), ' +
        "or --card recut --card-new <new id> (after `slopweaver hand post … --supersedes <this id>`)",
    );
  });

  it("plans done and kept on an open card, and refuses recut on one nothing re-cut", () => {
    expect(
      unwrap(cardPlanOf({ ...base, about: "hand:x", disposition: { kind: "done" }, fate: { kind: "open" } })),
    ).toEqual({
      cardKey: "hand:x",
      did: DID,
      id: "x",
      kind: "done",
    });
    expect(
      unwrap(
        cardPlanOf({ ...base, about: "hand:x", disposition: { kind: "kept", why: "explain" }, fate: { kind: "open" } }),
      ),
    ).toEqual({ cardKey: "hand:x", id: "x", kind: "kept", relayAnchor: RELAY, why: "explain" });
    expect(
      unwrapErr(
        cardPlanOf({
          ...base,
          about: "hand:x",
          disposition: { kind: "recut", successor: "y" },
          fate: { kind: "open" },
        }),
      ).code,
    ).toBe("CARD_RECUT_UNVERIFIED");
  });

  it("wants the re-cut named on a superseded card, and checks the name", () => {
    const fate = { kind: "superseded", successors: ["y"] } as const;
    expect(unwrapErr(cardPlanOf({ ...base, about: "hand:x", disposition: undefined, fate })).message).toBe(
      "hand:x was re-cut as y — pass --card recut --card-new y",
    );
    expect(unwrapErr(cardPlanOf({ ...base, about: "hand:x", disposition: { kind: "done" }, fate })).code).toBe(
      "CARD_RECUT_REQUIRED",
    );
    expect(
      unwrapErr(cardPlanOf({ ...base, about: "hand:x", disposition: { kind: "recut", successor: "z" }, fate })).message,
    ).toBe("no re-cut of hand:x posted z — it was re-cut as y");
    expect(
      unwrap(cardPlanOf({ ...base, about: "hand:x", disposition: { kind: "recut", successor: "y" }, fate })),
    ).toEqual({
      cardKey: "hand:x",
      id: "x",
      kind: "recut",
      successor: "y",
    });
  });

  it("finishes a retried done whose settling is already on file, and nothing else's", () => {
    const own = { dids: [DID], kind: "settled" } as const;
    expect(unwrap(cardPlanOf({ ...base, about: "hand:x", disposition: { kind: "done" }, fate: own })).kind).toBe(
      "done",
    );
    const other = { dids: ["the owner did it themselves"], kind: "settled" } as const;
    expect(
      unwrapErr(cardPlanOf({ ...base, about: "hand:x", disposition: { kind: "done" }, fate: other })).message,
    ).toBe("--card has nothing to answer for here: hand:x is already settled. Settle without it");
    expect(unwrap(cardPlanOf({ ...base, about: "hand:x", disposition: undefined, fate: other }))).toEqual({
      kind: "none",
    });
    expect(unwrap(cardPlanOf({ ...base, about: "hand:x", disposition: undefined, fate: { kind: "absent" } }))).toEqual({
      kind: "none",
    });
  });
});

describe("settledByThisRow", () => {
  it.each([
    ["the same account", DID, true],
    [
      "another witness on the same row",
      "answered on handover row talk-a00000170000 — witness: https://example.invalid/p2",
      true,
    ],
    [
      "another settlement on the same row",
      "filed on handover row talk-a00000170000 — witness: https://example.invalid/p1",
      true,
    ],
    ["another row", "answered on handover row talk-a00000170001 — witness: https://example.invalid/p1", false],
    [
      "a row whose slug extends this one",
      "answered on handover row talk-a00000170000-2 — witness: https://example.invalid/p1",
      false,
    ],
    ["the owner's own words", "the owner pressed Done", false],
    [
      "the shape led by no settlement",
      "not-a-settlement on handover row talk-a00000170000 — witness: merely text",
      false,
    ],
  ])("reads %s as this row's settling: %s", (_what, one, expected) => {
    expect(settledByThisRow({ did: DID, dids: [one] })).toBe(expected);
  });

  it("finishes a bare retry whose first attempt named another witness, recording done", () => {
    const earlier = {
      dids: ["answered on handover row talk-a00000170000 — witness: https://example.invalid/p2"],
      kind: "settled",
    } as const;
    expect(
      unwrap(cardPlanOf({ about: "hand:x", did: DID, disposition: undefined, fate: earlier, relayAnchor: RELAY })).kind,
    ).toBe("done");
  });
});

describe("what the settled row records about its card", () => {
  it("writes the disposition and card, with the reason or the successor", () => {
    expect(cardFrontMatterFields({ plan: { kind: "none" } })).toEqual([]);
    expect(cardFrontMatterFields({ plan: { cardKey: "hand:x", did: DID, id: "x", kind: "done" } })).toEqual([
      { key: "cardDisposition", value: "done" },
      { key: "cardDispositionCard", value: "hand:x" },
    ]);
    expect(
      cardFrontMatterFields({
        plan: { cardKey: "hand:x", id: "x", kind: "kept", relayAnchor: RELAY, why: 'say "why"' },
      }),
    ).toEqual([
      { key: "cardDisposition", value: "kept" },
      { key: "cardDispositionCard", value: "hand:x" },
      { key: "cardDispositionReason", value: '"say \\"why\\""' },
    ]);
    expect(cardFrontMatterFields({ plan: { cardKey: "hand:x", id: "x", kind: "recut", successor: "y" } })).toEqual([
      { key: "cardDisposition", value: "recut" },
      { key: "cardDispositionCard", value: "hand:x" },
      { key: "cardDispositionSuccessor", value: "y" },
    ]);
  });

  it("says in one line what became of the card", () => {
    expect(cardOutcomeLine({ plan: { kind: "none" } })).toBe(undefined);
    expect(
      cardOutcomeLine({ plan: { cardKey: "hand:x", id: "x", kind: "kept", relayAnchor: RELAY, why: "explain" } }),
    ).toBe("  hand:x stays on the owner's queue, kept because: explain");
  });

  it("names the row and the witness in a done's account", () => {
    expect(
      settleCardDid({ settlement: "answered", slug: "talk-a00000170000", witness: "https://example.invalid/p1" }),
    ).toBe(DID);
  });
});

describe("lockedCardVerdict — the fate re-read under the register's lock", () => {
  const done = { cardKey: "hand:x", did: DID, id: "x", kind: "done" } as const;
  const kept = { cardKey: "hand:x", id: "x", kind: "kept", relayAnchor: RELAY, why: "explain" } as const;
  const recut = { cardKey: "hand:x", id: "x", kind: "recut", successor: "y" } as const;

  it("owes the write while the card is still open", () => {
    expect(unwrap(lockedCardVerdict({ fate: { kind: "open" }, plan: done }))).toBe("write");
    expect(unwrap(lockedCardVerdict({ fate: { kind: "open" }, plan: kept }))).toBe("write");
  });

  it("finds a done this settle already wrote, and refuses one somebody else's closing overtook", () => {
    expect(unwrap(lockedCardVerdict({ fate: { dids: [DID], kind: "settled" }, plan: done }))).toBe("already-applied");
    expect(
      unwrapErr(lockedCardVerdict({ fate: { dids: ["the owner pressed Done"], kind: "settled" }, plan: done })),
    ).toEqual(SettleCardErrors.settledOtherwise({ cardKey: "hand:x" }));
    expect(unwrapErr(lockedCardVerdict({ fate: { kind: "superseded", successors: ["y"] }, plan: kept }))).toEqual(
      SettleCardErrors.settledOtherwise({ cardKey: "hand:x" }),
    );
  });

  it("verifies a re-cut still standing, and refuses one the register no longer shows", () => {
    expect(unwrap(lockedCardVerdict({ fate: { kind: "superseded", successors: ["y"] }, plan: recut }))).toBe(
      "verified",
    );
    expect(unwrapErr(lockedCardVerdict({ fate: { kind: "open" }, plan: recut })).code).toBe("CARD_SETTLED_OTHERWISE");
  });
});
