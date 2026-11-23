/*
 * The move-on rule: the walk's `card-move` lines fold into moves, a moved-on card
 * leaves the owner's Queue until a restore, and a "come back to it" defers rather than removes.
 */
import { describe, expect, it } from "vitest";

import { voiceDeferralRow } from "../../../queueDefer/cardDeferral.js";
import { type CallEntry, callEntryOf } from "../../../talk/callRecord.js";
import type { CardLandingRow } from "../../../talk/cardLanding.js";
import { type CardWalkMove, cardMoveAnchor, cardWalkMoves, removedByMove } from "../../../talk/cardMove.js";
import { activeCardMoves, type CardMovedOnRow, movedOnRowToWrite } from "../../../talk/cardMoveLedger.js";
import { CARD_MOVE_FIELDS } from "../../../talk/cardMoveLine.js";

const OPEN = { atIso: "2026-11-02T12:30:00.000Z", kind: "open", model: "m", sessionId: "x", voice: "v" } as const;

/** One stretch of the owner's, begun at `at` with `open` the card on the page. */
function said({ id, at, open, text }: { id: string; at: string; open: string; text: string }): CallEntry {
  return callEntryOf({
    value: { atIso: at, beganIso: at, final: true, id, kind: "segment", open, text, who: "owner" },
  })!;
}

/** The page's `card-move` line. */
function moveLine(over: Record<string, unknown> = {}): CallEntry {
  return callEntryOf({
    value: {
      atIso: "2026-11-02T12:37:16.000Z",
      disposition: "moved-on",
      fromCardKey: "ask:acme-1",
      fromSinceIso: "2026-11-02T12:35:00.000Z",
      kind: "card-move",
      requestId: "req-1",
      toCardKey: "ask:acme-2",
      ...over,
    },
  })!;
}

describe("card-move call lines", () => {
  it("parses a whole line, and refuses one whose key, disposition or request id fails the shape", () => {
    expect(Object.keys(CARD_MOVE_FIELDS).length).toBeGreaterThan(0);
    expect(moveLine().kind).toBe("card-move");
    const base = { atIso: "2026-11-02T12:37:16.000Z", fromSinceIso: "2026-11-02T12:35:00.000Z", kind: "card-move" };
    const bad = [
      { ...base, disposition: "moved-on", fromCardKey: "nope", requestId: "r", toCardKey: "ask:acme-2" },
      { ...base, disposition: "later", fromCardKey: "ask:acme-1", requestId: "r", toCardKey: "ask:acme-2" },
      { ...base, disposition: "moved-on", fromCardKey: "ask:acme-1", requestId: "", toCardKey: "ask:acme-2" },
    ].map((value) => callEntryOf({ value }));
    expect(bad).toEqual([undefined, undefined, undefined]);
  });
});

describe("removedByMove and cardMoveAnchor", () => {
  it("removes ask, draft, post, review and pr cards, never a hand step, an import, a check-in, a bare pr:<n> or a malformed key", () => {
    const keys = [
      "ask:a",
      "draft:d",
      "post:p",
      "review:r",
      "pr:acme.widgets.1",
      "hand:h",
      "import:i",
      "act:a",
      "pr:1",
      "nonsense",
    ];
    expect(keys.map((cardKey) => removedByMove({ cardKey }))).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("names the call and the request", () => {
    expect(cardMoveAnchor({ callId: "c-1", requestId: "req-1" })).toBe("call:c-1#move:req-1");
  });
});

describe("cardWalkMoves", () => {
  it("folds each request once, carrying only the owner's words over the card they left inside the window", () => {
    const entries: CallEntry[] = [
      OPEN,
      said({ at: "2026-11-02T12:34:00.000Z", id: "s0", open: "ask:acme-1", text: "before the window" }),
      said({ at: "2026-11-02T12:35:10.000Z", id: "s1", open: "ask:acme-1", text: "hmm   ok" }),
      said({ at: "2026-11-02T12:36:00.000Z", id: "s2", open: "ask:acme-9", text: "another card" }),
      said({ at: "2026-11-02T12:37:00.000Z", id: "s3", open: "ask:acme-1", text: "next one" }),
      moveLine(),
      moveLine({ toCardKey: "ask:acme-7" }),
      moveLine({ disposition: "come-back", fromCardKey: "ask:acme-2", requestId: "req-2", toCardKey: "ask:acme-3" }),
    ];
    expect(cardWalkMoves({ callId: "c-1", entries })).toEqual([
      {
        anchor: "call:c-1#move:req-1",
        decidedIso: "2026-11-02T12:37:16.000Z",
        disposition: "moved-on",
        fromCardKey: "ask:acme-1",
        toCardKey: "ask:acme-2",
        words: "hmm ok next one",
      },
      {
        anchor: "call:c-1#move:req-2",
        decidedIso: "2026-11-02T12:37:16.000Z",
        disposition: "come-back",
        fromCardKey: "ask:acme-2",
        toCardKey: "ask:acme-3",
      },
    ]);
  });

  it("makes no move on a call with no move line, nor on the desktop test instance's call", () => {
    const testOpen = callEntryOf({
      value: {
        ...OPEN,
        origin: { checkoutRoot: "/w/main", defaultPort: 3000, instance: "e2e", mainWorktree: true, port: 3000 },
      },
    })!;
    expect([
      cardWalkMoves({ callId: "c-1", entries: [OPEN] }),
      cardWalkMoves({ callId: "c-1", entries: [testOpen, moveLine()] }),
    ]).toEqual([[], []]);
  });
});

const MOVE: CardWalkMove = {
  anchor: "call:c-1#move:req-1",
  decidedIso: "2026-11-02T12:37:16.000Z",
  disposition: "moved-on",
  fromCardKey: "ask:acme-1",
  toCardKey: "ask:acme-2",
};
const T1 = "2026-11-02T12:38:00.000Z";
const T2 = "2026-11-02T12:39:00.000Z";

/** A card-wide restore of a card, written at `at`. */
function restore({ cardKey, at }: { cardKey: string; at: string }): CardLandingRow {
  return { anchor: "run:x", atIso: at, cardKey, kind: "restored", why: "general" };
}

describe("movedOnRowToWrite", () => {
  it("writes a first move, and nothing for a come-back or a card movement never removes", () => {
    expect(movedOnRowToWrite({ landings: [], move: MOVE, moves: [], nowIso: T1 })).toEqual({
      anchor: MOVE.anchor,
      atIso: T1,
      cardKey: "ask:acme-1",
      decidedIso: MOVE.decidedIso,
      kind: "moved-on",
      toCardKey: "ask:acme-2",
    });
    const others = [
      { ...MOVE, disposition: "come-back" as const },
      { ...MOVE, fromCardKey: "hand:h-1" },
    ];
    expect(others.map((move) => movedOnRowToWrite({ landings: [], move, moves: [], nowIso: T1 }))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("writes the same move again only when it carries new words, and never once a restore lifted it", () => {
    const first = movedOnRowToWrite({ landings: [], move: MOVE, moves: [], nowIso: T1 })!;
    const grown = { ...MOVE, words: "ok next" };
    expect([
      movedOnRowToWrite({ landings: [], move: MOVE, moves: [first], nowIso: T2 }),
      movedOnRowToWrite({ landings: [], move: grown, moves: [first], nowIso: T2 })!.words,
      movedOnRowToWrite({
        landings: [restore({ at: T2, cardKey: "ask:acme-1" })],
        move: grown,
        moves: [first],
        nowIso: T2,
      }),
    ]).toEqual([undefined, "ok next", undefined]);
  });
});

describe("activeCardMoves", () => {
  const row = (over: Partial<CardMovedOnRow> = {}): CardMovedOnRow => ({
    anchor: MOVE.anchor,
    atIso: T1,
    cardKey: "ask:acme-1",
    decidedIso: MOVE.decidedIso,
    kind: "moved-on",
    toCardKey: "ask:acme-2",
    ...over,
  });

  it("keeps the latest row per move, dated by the first", () => {
    expect(activeCardMoves({ landings: [], moves: [row(), row({ atIso: T2, words: "ok" })] })).toEqual([
      row({ words: "ok" }),
    ]);
  });

  it("lifts a move a restore of its card wrote at or after it, and keeps one restored before it", () => {
    const later = row({ anchor: "call:c-1#move:req-2", atIso: T2, cardKey: "ask:acme-5" });
    expect(
      activeCardMoves({
        landings: [restore({ at: T1, cardKey: "ask:acme-1" }), restore({ at: T1, cardKey: "ask:acme-5" })],
        moves: [row(), later],
      }),
    ).toEqual([later]);
  });
});

describe("voiceDeferralRow", () => {
  it("defers a come-back once, keyed by the move's anchor, and never a move on", () => {
    const back: CardWalkMove = { ...MOVE, disposition: "come-back" };
    const row = voiceDeferralRow({ move: back, rows: [] })!;
    expect(row).toEqual({
      action: "defer",
      bySession: MOVE.anchor,
      cardKey: "ask:acme-1",
      pressedIso: MOVE.decidedIso,
    });
    expect([voiceDeferralRow({ move: back, rows: [row] }), voiceDeferralRow({ move: MOVE, rows: [] })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
