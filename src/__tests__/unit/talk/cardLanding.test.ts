/**
 * The card-landing ledger's rows and fold — which cards the owner's words are holding off the owner's queue, and how a restore
 * puts one back without the next transcript batch undoing it.
 */
import { describe, expect, it } from "vitest";

import {
  activeCardLandings,
  type CardLandedRow,
  type CardLandingRow,
  type CardRestoredRow,
  cardDispatchAsk,
  cardDispatchSlug,
  cardKeyParts,
  cardLandingRowOf,
  repeatLanding,
} from "../../../talk/cardLanding.js";

const HAND = "hand:voice-mark-step";
const PR = "pr:16406";

const landed = ({
  anchor,
  cardKey,
  atIso = "2026-09-25T15:41:00.000Z",
}: {
  anchor: string;
  cardKey: string;
  atIso?: string;
}): CardLandedRow => ({
  anchor,
  atIso,
  cardKey,
  decidedIso: "2026-09-25T15:40:00.000Z",
  kind: "landed",
  source: "transcript",
  words: "what is a voice mark",
  workSlug: "talk-card-abc",
});

const restored = ({ cardKey }: { cardKey: string }): CardRestoredRow => ({
  anchor: "run:x",
  atIso: "2026-09-25T16:00:00.000Z",
  cardKey,
  kind: "restored",
  why: "a general remark",
});

describe("activeCardLandings", () => {
  // Grown, the card still left when the utterance first landed.
  it("keeps one landing per utterance and card, the latest words, in the place and at the instant the first took", () => {
    const first = landed({ anchor: "call:c#s-1", cardKey: HAND });
    const other = landed({ anchor: "call:c#s-2", cardKey: PR });
    const grown = {
      ...landed({ anchor: "call:c#s-1", atIso: "2026-09-25T15:42:00.000Z", cardKey: HAND }),
      words: "what is a voice mark, and who reads it",
    };
    expect(activeCardLandings({ rows: [first, other, grown] })).toEqual([
      { ...grown, atIso: "2026-09-25T15:41:00.000Z" },
      other,
    ]);
  });

  it("keeps a restored utterance off its card even when it is written again", () => {
    const rows = [
      landed({ anchor: "call:c#s-1", cardKey: PR }),
      restored({ cardKey: PR }),
      landed({ anchor: "call:c#s-1", atIso: "2026-09-25T15:42:00.000Z", cardKey: PR }),
    ];
    expect(activeCardLandings({ rows })).toEqual([]);
  });

  it("holds one utterance on two cards as two landings — the owner's 'close BOTH'", () => {
    const rows = [landed({ anchor: "call:c#s-1", cardKey: HAND }), landed({ anchor: "call:c#s-1", cardKey: PR })];
    expect(activeCardLandings({ rows }).map((row) => row.cardKey)).toEqual([HAND, PR]);
  });

  it("lifts every earlier landing on a restored card, and leaves other cards alone", () => {
    const rows = [
      landed({ anchor: "call:c#s-1", cardKey: PR }),
      landed({ anchor: "talk:t", cardKey: PR }),
      landed({ anchor: "call:c#s-2", cardKey: HAND }),
      restored({ cardKey: PR }),
    ];
    expect(activeCardLandings({ rows }).map((row) => row.anchor)).toEqual(["call:c#s-2"]);
  });

  it("lets a LATER word re-land a restored card", () => {
    const rows = [
      landed({ anchor: "call:c#s-1", cardKey: PR }),
      restored({ cardKey: PR }),
      landed({ anchor: "call:c#s-9", cardKey: PR }),
    ];
    expect(activeCardLandings({ rows }).map((row) => row.anchor)).toEqual(["call:c#s-9"]);
  });
});

describe("repeatLanding", () => {
  it("still finds a restored landing, so a re-derived utterance does not land it again", () => {
    const first = landed({ anchor: "call:c#s-1", cardKey: PR });
    const rows = [first, restored({ cardKey: PR })];
    expect(
      repeatLanding({
        anchor: "call:c#s-1",
        cardKey: PR,
        laterAnchors: [],
        relayTurns: [],
        wordsCut: false,
        rows,
        words: "what is a voice mark now",
      }),
    ).toEqual(first);
  });

  it("answers undefined for the same words on a different card, and for more words on a card still held", () => {
    const rows = [landed({ anchor: "call:c#s-1", cardKey: PR })];
    expect([
      repeatLanding({
        anchor: "call:c#s-1",
        cardKey: HAND,
        laterAnchors: [],
        relayTurns: [],
        wordsCut: false,
        rows,
        words: "what is a voice mark",
      }),
      repeatLanding({
        anchor: "call:c#s-1",
        cardKey: PR,
        laterAnchors: [],
        relayTurns: [],
        wordsCut: false,
        rows,
        words: "what is a voice mark now",
      }),
    ]).toEqual([undefined, undefined]);
  });

  it("finds the exact words, and a restored later segment of the same utterance", () => {
    const exact = landed({ anchor: "call:c#s-1", cardKey: PR });
    const later = landed({ anchor: "call:c#s-2", cardKey: HAND });
    expect([
      repeatLanding({
        anchor: "call:c#s-1",
        cardKey: PR,
        laterAnchors: [],
        relayTurns: [],
        wordsCut: false,
        rows: [exact],
        words: "what is a voice mark",
      }),
      repeatLanding({
        anchor: "call:c#s-1",
        cardKey: HAND,
        laterAnchors: ["call:c#s-2"],
        relayTurns: [],
        wordsCut: false,
        rows: [later, restored({ cardKey: HAND })],
        words: "what is a voice mark and more",
      }),
    ]).toEqual([exact, later]);
  });

  // A relay landed the owner's words under its own anchor and was restored; the transcript landing the same
  // words under their call anchor pulled the card back off.
  it("reads words a restored relay landing carried as a repeat under their call anchor, and only once restored", () => {
    const turn = "a0000071-0000-4000-8000-000000000077";
    const byRelay = landed({ anchor: `talk:${turn}`, cardKey: HAND });
    const again = ({ rows }: { rows: Parameters<typeof repeatLanding>[0]["rows"] }): unknown =>
      repeatLanding({
        anchor: "call:c#s-1",
        cardKey: HAND,
        laterAnchors: [],
        relayTurns: [turn],
        rows,
        words: "ship it",
        wordsCut: false,
      });
    expect([again({ rows: [byRelay, restored({ cardKey: HAND })] }), again({ rows: [byRelay] })]).toEqual([
      byRelay,
      undefined,
    ]);
  });

  // An unfinished stretch with no words normalises away, so the call re-derives the SAME words
  // now cut. A row that read whole must not stand as the repeat, or a yes binds off it; a cut only ratchets on.
  it("lands the same words again when the call now shows them cut and no row said so, unless the card was restored", () => {
    const whole: CardLandedRow = { ...landed({ anchor: "call:c#s-1", cardKey: PR }), wordsCut: false };
    const cut: CardLandedRow = { ...whole, atIso: "2026-09-25T15:42:00.000Z", wordsCut: true };
    const again = ({ rows, wordsCut }: { rows: readonly CardLandingRow[]; wordsCut: boolean }): unknown =>
      repeatLanding({
        anchor: "call:c#s-1",
        cardKey: PR,
        laterAnchors: [],
        relayTurns: [],
        rows,
        words: "what is a voice mark",
        wordsCut,
      });
    expect([
      again({ rows: [whole], wordsCut: true }),
      again({ rows: [whole, cut], wordsCut: true }),
      again({ rows: [cut], wordsCut: false }),
      again({ rows: [whole, restored({ cardKey: PR })], wordsCut: true }),
    ]).toEqual([undefined, whole, cut, whole]);
  });
});

describe("cardLandingRowOf", () => {
  it("reads a well-formed row back as itself", () => {
    const row = landed({ anchor: "call:c#s-1", cardKey: HAND });
    expect(cardLandingRowOf({ value: row })).toEqual(row);
  });

  // One utterance of 1,002 segments carries 1,001 later anchors, and nothing bounds how many a call holds.
  it("reads back a landing whose utterance spans any number of segments", () => {
    const laterAnchors = Array.from({ length: 1001 }, (_, index) => `call:c#s-${String(index + 1)}`);
    const row: CardLandedRow = { ...landed({ anchor: "call:c#s-0", cardKey: HAND }), laterAnchors };
    expect(cardLandingRowOf({ value: row })).toEqual(row);
  });

  it("refuses a row whose card is not a card key, or whose words are empty", () => {
    expect([
      cardLandingRowOf({ value: { ...landed({ anchor: "a", cardKey: HAND }), cardKey: "slack:C1" } }),
      cardLandingRowOf({ value: { ...landed({ anchor: "a", cardKey: HAND }), words: "" } }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("the dispatch row a landing registers", () => {
  it("derives one slug per utterance, whichever card it lands on", () => {
    expect(cardDispatchSlug({ anchor: "call:c#s-1" })).toBe(cardDispatchSlug({ anchor: "call:c#s-1" }));
    expect(cardDispatchSlug({ anchor: "call:c#s-1" })).toMatch(/^talk-card-[0-9a-f]{12}$/u);
    expect(cardDispatchSlug({ anchor: "call:c#s-1" })).not.toBe(cardDispatchSlug({ anchor: "call:c#s-2" }));
  });

  it("opens with the owner's words exactly, then names the card, the restore and the anchor", () => {
    const ask = cardDispatchAsk({ anchor: "call:c#s-1", cardKey: HAND, words: "what is a voice mark" });
    expect(ask.startsWith('"what is a voice mark"\n\n')).toBe(true);
    expect(ask).toContain(`The owner said this with ${HAND} open`);
    expect(ask).toContain(`slopweaver talk restore --card ${HAND}`);
    expect(ask.endsWith("Heard at call:c#s-1.")).toBe(true);
  });
});

describe("cardKeyParts", () => {
  it("splits a card key at its first colon, and refuses anything else, a bare pr:<n> included", () => {
    expect([
      cardKeyParts({ cardKey: "ask:a-slug" }),
      cardKeyParts({ cardKey: "pr:acme.widgets.42" }),
      cardKeyParts({ cardKey: "slack:C1" }),
      cardKeyParts({ cardKey: "pr:42" }),
    ]).toEqual([{ id: "a-slug", kind: "ask" }, { id: "acme.widgets.42", kind: "pr" }, undefined, undefined]);
  });
});
