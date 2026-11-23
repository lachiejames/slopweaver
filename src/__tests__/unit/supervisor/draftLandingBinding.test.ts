/**
 * `draftLandingBinding.ts` — the owner's words on a card bind to the held drafts that card names, followed to the cut that
 * stands. The fixture is a chain: a yes landed on the organisation-hunt ask,
 * whose option named `sd-e8de7674`; that draft was re-cut as `sd-c61d11e4`, then superseded by `sd-c57b4ade`, which
 * sat parked for a yes already given.
 */
import { describe, expect, it } from "vitest";

import { draftLandingBindings, namesDraftsInTexts } from "../../../supervisor/draftLandingBinding.js";
import type { CardRestoredRow } from "../../../talk/cardLanding.js";
import { draftItem, landed } from "./draftItemFixture.js";

const ASK = "ask:organisation-hunt-2026-10-07";
const DECIDED = "2026-10-08T00:16:54.000Z";

const CHAIN = [
  draftItem({
    id: "sd-e8de7674",
    outcome: "re-cut as sd-c61d11e4",
    state: "dropped",
    tsIso: "2026-10-07T22:00:00.000Z",
  }),
  draftItem({
    id: "sd-c61d11e4",
    outcome: "superseded by sd-c57b4ade",
    state: "dropped",
    tsIso: "2026-10-07T23:00:00.000Z",
  }),
  draftItem({ id: "sd-c57b4ade", tsIso: "2026-10-08T00:30:00.000Z" }),
];

const LIVE = CHAIN[2]!;

const ASK_READ = {
  cardKey: ASK,
  kind: "read" as const,
  texts: ["Option A: send sd-e8de7674 to the thread as drafted", undefined, "Option B: hold it"],
};

describe("draftLandingBindings", () => {
  it("binds a landing through two drop notes to the cut that stood unsent", () => {
    const landing = landed({ cardKey: ASK, decidedIso: DECIDED });
    const bindings = draftLandingBindings({ cards: [ASK_READ], items: CHAIN, landingRows: [landing], skipped: [] });

    expect(bindings).toEqual({
      bound: [{ item: LIVE, landing, ledgerRow: 0, namedId: "sd-e8de7674" }],
      unreadable: [],
    });
  });

  it("binds a post card to its own id", () => {
    const landing = landed({ cardKey: "post:sd-c57b4ade", decidedIso: DECIDED });
    const bindings = draftLandingBindings({ cards: [], items: CHAIN, landingRows: [landing], skipped: [] });

    expect(bindings).toEqual({
      bound: [{ item: LIVE, landing, ledgerRow: 0, namedId: "sd-c57b4ade" }],
      unreadable: [],
    });
  });

  describe("a post landing written after the drop that ended its draft", () => {
    const DROPPED_AT = "2026-10-08T00:18:00.000Z";
    const dropped = ({ outcome }: { outcome: string }) => [
      draftItem({
        id: "sd-11112222",
        outcome,
        resolvedIso: DROPPED_AT,
        state: "dropped",
        tsIso: "2026-10-08T00:10:00.000Z",
      }),
    ];
    const late = { ...landed({ cardKey: "post:sd-11112222", decidedIso: DECIDED }), atIso: "2026-10-08T00:25:00.000Z" };

    it("binds the dropped cut, since the drop never weighed words landed after it", () => {
      const items = dropped({ outcome: "moot: Seth answered" });
      const bindings = draftLandingBindings({ cards: [], items, landingRows: [late], skipped: [] });

      expect(bindings).toEqual({
        bound: [{ item: items[0], landing: late, ledgerRow: 0, namedId: "sd-11112222" }],
        unreadable: [],
      });
    });

    it("orders by the ledger rows the drop judged, so one stamped before it but written after its read binds", () => {
      const counted = [{ ...dropped({ outcome: "moot: Seth answered" })[0]!, landingsRead: 1 }];
      const seen = { ...landed({ cardKey: "post:sd-99990000", decidedIso: DECIDED }), anchor: "talk:seen" };
      const gap = landed({ cardKey: "post:sd-11112222", decidedIso: DECIDED });

      expect(draftLandingBindings({ cards: [], items: counted, landingRows: [seen, gap], skipped: [] })).toEqual({
        bound: [{ item: counted[0], landing: gap, ledgerRow: 1, namedId: "sd-11112222" }],
        unreadable: [],
      });
      expect(draftLandingBindings({ cards: [], items: counted, landingRows: [gap, seen], skipped: [] })).toEqual({
        bound: [],
        unreadable: [],
      });
    });

    it("orders an utterance that grew after the drop by the row its grown words were written at", () => {
      const counted = [{ ...dropped({ outcome: "moot: Seth answered" })[0]!, landingsRead: 1 }];
      const partial = { ...landed({ cardKey: "post:sd-11112222", decidedIso: DECIDED }), words: "No, hold" };
      const grown = { ...partial, atIso: "2026-10-08T01:00:00.000Z", words: "No, hold. Actually yes, send it" };

      expect(draftLandingBindings({ cards: [], items: counted, landingRows: [partial, grown], skipped: [] })).toEqual({
        bound: [
          { item: counted[0], landing: { ...grown, atIso: partial.atIso }, ledgerRow: 1, namedId: "sd-11112222" },
        ],
        unreadable: [],
      });
      expect(draftLandingBindings({ cards: [], items: counted, landingRows: [partial], skipped: [] })).toEqual({
        bound: [],
        unreadable: [],
      });
    });

    it("binds nothing when the landing was written before the drop, which then weighed it", () => {
      const early = landed({ cardKey: "post:sd-11112222", decidedIso: DECIDED });
      const items = dropped({ outcome: "moot: Seth answered" });

      expect(draftLandingBindings({ cards: [], items, landingRows: [early], skipped: [] })).toEqual({
        bound: [],
        unreadable: [],
      });
    });

    it("binds nothing when the drop recorded the send", () => {
      const sent = dropped({ outcome: "sent C0123456789 1791418800.000100" });

      expect(draftLandingBindings({ cards: [], items: sent, landingRows: [late], skipped: [] })).toEqual({
        bound: [],
        unreadable: [],
      });
    });

    it("binds the dropped cut from an ask card naming it, exactly as from its post card", () => {
      const ask = { ...late, cardKey: ASK };
      const askRead = { ...ASK_READ, texts: ["Option A: send sd-11112222"] };
      const moot = [{ ...dropped({ outcome: "moot: Seth answered" })[0]!, landingsRead: 0 }];

      expect(draftLandingBindings({ cards: [askRead], items: moot, landingRows: [ask], skipped: [] })).toEqual({
        bound: [{ item: moot[0], landing: ask, ledgerRow: 0, namedId: "sd-11112222" }],
        unreadable: [],
      });
    });
  });

  it("binds nothing for a landing the card's restore lifted", () => {
    const restored: CardRestoredRow = {
      anchor: "talk:restore",
      atIso: "2026-10-08T00:20:00.000Z",
      cardKey: ASK,
      kind: "restored",
      why: "they took it back",
    };
    const bindings = draftLandingBindings({
      cards: [ASK_READ],
      items: CHAIN,
      landingRows: [landed({ cardKey: ASK, decidedIso: DECIDED }), restored],
      skipped: [],
    });

    expect(bindings).toEqual({ bound: [], unreadable: [] });
  });

  it("binds nothing when the chain ends in a sent draft", () => {
    const sent = [
      ...CHAIN.slice(0, 2),
      draftItem({ id: "sd-c57b4ade", outcome: "C0123 1.2", state: "released", tsIso: "2026-10-08T00:30:00.000Z" }),
    ];
    const bindings = draftLandingBindings({
      cards: [ASK_READ],
      items: sent,
      landingRows: [landed({ cardKey: ASK, decidedIso: DECIDED })],
      skipped: [],
    });

    expect(bindings).toEqual({ bound: [], unreadable: [] });
  });

  it("binds a live cut once when the card names two ids that converge on it", () => {
    const landing = landed({ cardKey: ASK, decidedIso: DECIDED });
    const both = { ...ASK_READ, texts: ["sd-e8de7674 or its re-cut sd-c61d11e4"] };
    const bindings = draftLandingBindings({ cards: [both], items: CHAIN, landingRows: [landing], skipped: [] });

    expect(bindings.bound.map((one) => [one.item.id, one.namedId])).toEqual([["sd-c57b4ade", "sd-e8de7674"]]);
  });

  it("reports a landing whose card could not be read, or was never read, rather than binding nothing", () => {
    const landing = landed({ cardKey: ASK, decidedIso: DECIDED });
    const hand = landed({ cardKey: "hand:h-1", decidedIso: DECIDED });
    const bindings = draftLandingBindings({
      cards: [{ cardKey: ASK, kind: "unreadable", why: "the ask's journal has 2 unreadable lines" }],
      items: CHAIN,
      landingRows: [landing, hand],
      skipped: [],
    });

    expect(bindings).toEqual({
      bound: [],
      unreadable: [
        { landing, ledgerRow: 0, why: "the ask's journal has 2 unreadable lines" },
        { landing: hand, ledgerRow: 1, why: "no read of hand:h-1 reached the gate" },
      ],
    });
  });

  it("binds the ids the landing kept after the card's doc was rewritten to name none", () => {
    const landing = { ...landed({ cardKey: ASK, decidedIso: DECIDED }), draftIds: ["sd-e8de7674"] };
    const settled = { cardKey: ASK, kind: "read" as const, texts: ["Settled: they answered"] };
    const bindings = draftLandingBindings({ cards: [settled], items: CHAIN, landingRows: [landing], skipped: [] });

    expect(bindings).toEqual({
      bound: [{ item: LIVE, landing, ledgerRow: 0, namedId: "sd-e8de7674" }],
      unreadable: [],
    });
  });

  it("reports a landing whose card did not read as the owner's words landed, even once it reads again", () => {
    const landing = {
      ...landed({ cardKey: ASK, decidedIso: DECIDED }),
      draftIdsUnread: "the ask's journal has 1 unreadable line",
    };
    const settled = { cardKey: ASK, kind: "read" as const, texts: ["Settled: they answered"] };
    const bindings = draftLandingBindings({ cards: [settled], items: CHAIN, landingRows: [landing], skipped: [] });

    expect(bindings).toEqual({
      bound: [],
      unreadable: [
        {
          landing,
          ledgerRow: 0,
          why: `${ASK} did not read as the owner's words landed (the ask's journal has 1 unreadable line), so which drafts it named then is unknown`,
        },
      ],
    });
  });

  it("reports a post landing whose row a passed-over register line may be, rather than binding nothing", () => {
    const landing = landed({ cardKey: "post:sd-deadbeef", decidedIso: DECIDED });
    const bindings = draftLandingBindings({
      cards: [],
      items: CHAIN,
      landingRows: [landing],
      skipped: [{ id: "sd-deadbeef" }],
    });

    expect(bindings).toEqual({
      bound: [],
      unreadable: [
        {
          landing,
          ledgerRow: 0,
          why: "a draft-register line this build passed over may be sd-deadbeef's, so whether the owner's yes on it is owed is unknown",
        },
      ],
    });
  });

  it("still binds nothing for a spent chain when the passed-over line names another row", () => {
    const sent = [
      ...CHAIN.slice(0, 2),
      draftItem({ id: "sd-c57b4ade", outcome: "C0123 1.2", state: "released", tsIso: "2026-10-08T00:30:00.000Z" }),
    ];
    const bindings = draftLandingBindings({
      cards: [ASK_READ],
      items: sent,
      landingRows: [landed({ cardKey: ASK, decidedIso: DECIDED })],
      skipped: [{ id: "sd-0000aaaa" }],
    });

    expect(bindings).toEqual({ bound: [], unreadable: [] });
  });

  it("reports a landing on a spent row when a passed-over line names no row, since it may re-park it", () => {
    const released = draftItem({ id: "sd-deadbeef", outcome: "C0123 1.2", state: "released", tsIso: DECIDED });
    const landing = landed({ cardKey: "post:sd-deadbeef", decidedIso: DECIDED });
    const bindings = draftLandingBindings({
      cards: [],
      items: [released],
      landingRows: [landing],
      skipped: [{ id: undefined }],
    });

    expect(bindings.unreadable.map((one) => one.landing)).toEqual([landing]);
  });

  it("reports a landing whose chain a passed-over line under an INTERMEDIATE cut may redirect", () => {
    const landing = landed({ cardKey: ASK, decidedIso: DECIDED });
    const bindings = draftLandingBindings({
      cards: [ASK_READ],
      items: CHAIN,
      landingRows: [landing],
      skipped: [{ id: "sd-c61d11e4" }],
    });

    expect(bindings).toEqual({
      bound: [],
      unreadable: [
        {
          landing,
          ledgerRow: 0,
          why: "a draft-register line this build passed over may be sd-e8de7674's, so whether the owner's yes on it is owed is unknown",
        },
      ],
    });
  });

  it("reports a landing on a dropped row whose note names a successor that did not read", () => {
    const dropped = draftItem({
      id: "sd-11111111",
      outcome: "re-cut as sd-22222222",
      state: "dropped",
      tsIso: DECIDED,
    });
    const landing = landed({ cardKey: "post:sd-11111111", decidedIso: DECIDED });
    const bindings = draftLandingBindings({
      cards: [],
      items: [dropped],
      landingRows: [landing],
      skipped: [{ id: "sd-22222222" }],
    });

    expect(bindings).toEqual({
      bound: [],
      unreadable: [
        {
          landing,
          ledgerRow: 0,
          why: "a draft-register line this build passed over may be sd-11111111's, so whether the owner's yes on it is owed is unknown",
        },
      ],
    });
  });

  it("reports a landing on a HELD row when a passed-over line names it, since it may be a fresh park", () => {
    const landing = landed({ cardKey: "post:sd-c57b4ade", decidedIso: DECIDED });
    const bindings = draftLandingBindings({
      cards: [],
      items: CHAIN,
      landingRows: [landing],
      skipped: [{ id: "sd-c57b4ade" }],
    });

    expect(bindings).toEqual({
      bound: [],
      unreadable: [
        {
          landing,
          ledgerRow: 0,
          why: "a draft-register line this build passed over may be sd-c57b4ade's, so whether the owner's yes on it is owed is unknown",
        },
      ],
    });
  });

  it("reads no draft off a card kind whose texts never name one", () => {
    const bindings = draftLandingBindings({
      cards: [],
      items: CHAIN,
      landingRows: [landed({ cardKey: "pr:1969", decidedIso: DECIDED })],
      skipped: [],
    });

    expect(bindings).toEqual({ bound: [], unreadable: [] });
  });
});

describe("namesDraftsInTexts", () => {
  it("is true for ask and hand cards only", () => {
    expect(["ask:x", "hand:y", "post:sd-11111111", "pr:1"].map((cardKey) => namesDraftsInTexts({ cardKey }))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
