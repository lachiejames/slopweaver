import { describe, expect, it } from "vitest";

import { CARD_NEXT_WINDOW_MS, cardNextMove } from "../../../desktop/e2eCallCardNext.js";
import { OWNER_SPEAKER } from "../../../desktop/e2eCallCardReadingHold.js";
import type { CallEntry } from "../../../talk/callRecord.js";

/** Synthetic Queue asks' keys, never this install's own. */
const CARD = "ask:fixture-card";
const OTHER = "ask:acme-other-card";
const OPENED_AT = "2026-11-01T10:00:00.000Z";
const ASKED_AT = "2026-11-01T10:00:20.000Z";
const ASKED_MS = Date.parse(ASKED_AT);
const PAST_WINDOW = ASKED_MS + CARD_NEXT_WINDOW_MS;
const LATER = "2026-11-01T10:00:31.500Z";

const tool = ({ name, detail, atIso }: { name: string; detail: string; atIso: string }): CallEntry => ({
  atIso,
  detail,
  kind: "tool",
  name,
  refused: false,
});

const OPENED = tool({ atIso: OPENED_AT, detail: `${CARD}, card opened, page none, thread opened`, name: "open_card" });
/** The owner's words, as a call that stalled on an open card heard them. */
const ASK: CallEntry = {
  atIso: ASKED_AT,
  final: true,
  id: "owner-2",
  kind: "segment",
  text: "All right, next card please",
  who: OWNER_SPEAKER,
};
const MOVE: CallEntry = {
  atIso: LATER,
  disposition: "moved-on",
  fromCardKey: CARD,
  fromSinceIso: OPENED_AT,
  kind: "card-move",
  requestId: "req-1",
  toCardKey: OTHER,
};
const WALK_START = tool({
  atIso: "2026-11-01T10:00:22.500Z",
  detail:
    "started the thinking model's turn itself: they asked for the next card and no turn started during the owner's words",
  name: "owed-start",
});

const moveOf = ({ entries, nowMs }: { entries: readonly CallEntry[]; nowMs: number }) =>
  cardNextMove({ cardKey: CARD, entries, nowMs });

describe("cardNextMove", () => {
  it("is moved by a card-move off the card, saying how long after their ask and by the voice's own hand-off", () => {
    expect(moveOf({ entries: [OPENED, ASK, MOVE], nowMs: ASKED_MS })).toEqual({
      kind: "moved",
      reason: `card-move at ${LATER}: ${CARD} to ${OTHER}, 11.5s after their ask, by the voice's own hand-off`,
    });
  });

  it("names the console's walk start when its owed-start came between their ask and the move", () => {
    expect(moveOf({ entries: [OPENED, ASK, WALK_START, MOVE], nowMs: ASKED_MS })).toEqual({
      kind: "moved",
      reason: `card-move at ${LATER}: ${CARD} to ${OTHER}, 11.5s after their ask, by the console's walk start`,
    });
  });

  it("is moved by an open_card of another key, and not by the same card opened again", () => {
    const other = tool({ atIso: LATER, detail: `${OTHER}, card opened, page none, thread none`, name: "open_card" });
    const again = tool({ atIso: LATER, detail: `${CARD}, card opened, page none, thread none`, name: "open_card" });
    expect(moveOf({ entries: [OPENED, ASK, other], nowMs: ASKED_MS }).kind).toBe("moved");
    expect(moveOf({ entries: [OPENED, ASK, again], nowMs: PAST_WINDOW })).toEqual({
      kind: "stuck",
      reason: `${CARD} still up 25s after their ask at ${ASKED_AT}`,
    });
  });

  it("is stuck when the card stays up the whole window, as in the stalled call", () => {
    expect(moveOf({ entries: [OPENED, ASK], nowMs: PAST_WINDOW })).toEqual({
      kind: "stuck",
      reason: `${CARD} still up 25s after their ask at ${ASKED_AT}`,
    });
  });

  it("waits one millisecond short of the window", () => {
    expect(moveOf({ entries: [OPENED, ASK], nowMs: PAST_WINDOW - 1 })).toEqual({
      kind: "waiting",
      reason: "the window after their ask is still open",
    });
  });

  it("is stuck when the only move lands once the window has passed", () => {
    const late: CallEntry = { ...MOVE, atIso: new Date(PAST_WINDOW).toISOString() };
    expect(moveOf({ entries: [OPENED, ASK, late], nowMs: PAST_WINDOW }).kind).toBe("stuck");
  });

  // A card only read is never put up, so another card opening takes nothing down.
  it("waits on a card only read, never opened, however the walk moves after their ask", () => {
    const read = tool({ atIso: OPENED_AT, detail: `${CARD}, read`, name: "read_card" });
    const other = tool({ atIso: LATER, detail: `${OTHER}, card opened, page none, thread none`, name: "open_card" });
    expect(moveOf({ entries: [read, ASK, other], nowMs: PAST_WINDOW })).toEqual({
      kind: "waiting",
      reason: `${CARD} has not been opened`,
    });
  });

  // A later move would take down some other card, never the one they asked about.
  it("waits when the card was taken down before their ask, and passes once it is opened again before it", () => {
    const left = tool({
      atIso: "2026-11-01T10:00:10.000Z",
      detail: `${OTHER}, card opened, page none, thread none`,
      name: "open_card",
    });
    const third = tool({ atIso: LATER, detail: "ask:acme-third-card, card opened, page none", name: "open_card" });
    expect(moveOf({ entries: [OPENED, left, ASK, third], nowMs: PAST_WINDOW })).toEqual({
      kind: "waiting",
      reason: `${CARD} was taken down before their ask, so it was not up when they asked`,
    });
    const reopened: CallEntry = { ...OPENED, atIso: "2026-11-01T10:00:15.000Z" };
    expect(moveOf({ entries: [OPENED, left, reopened, ASK, third], nowMs: PAST_WINDOW }).kind).toBe("moved");
  });

  it("waits on a card never opened, and on an ask heard before the card was up", () => {
    expect(moveOf({ entries: [ASK, MOVE], nowMs: PAST_WINDOW })).toEqual({
      kind: "waiting",
      reason: `${CARD} has not been opened`,
    });
    const lateOpen: CallEntry = { ...OPENED, atIso: "2026-11-01T10:00:25.000Z" };
    expect(moveOf({ entries: [ASK, lateOpen], nowMs: PAST_WINDOW })).toEqual({
      kind: "waiting",
      reason: 'no final line of theirs after the card ends on "next card please"',
    });
  });

  it("takes a comma before please, and never an interim line or words past the ask", () => {
    const comma: CallEntry = { ...ASK, text: "Next card, please." };
    const interim: CallEntry = { ...ASK, final: false };
    const onward: CallEntry = { ...ASK, text: "next card please, but first read this one" };
    expect(moveOf({ entries: [OPENED, comma, MOVE], nowMs: ASKED_MS }).kind).toBe("moved");
    expect(moveOf({ entries: [OPENED, interim, MOVE], nowMs: PAST_WINDOW }).kind).toBe("waiting");
    expect(moveOf({ entries: [OPENED, onward, MOVE], nowMs: PAST_WINDOW }).kind).toBe("waiting");
  });

  // A tie on the instant is judged by file order, as card-reading-hold judges it.
  it("is moved by a move sharing the owner's line's instant when written after it, and not by one written before it", () => {
    const tied: CallEntry = { ...MOVE, atIso: ASKED_AT };
    expect(moveOf({ entries: [OPENED, ASK, tied], nowMs: ASKED_MS }).kind).toBe("moved");
    // Written before that line, it took the card down before they asked.
    expect(moveOf({ entries: [OPENED, tied, ASK], nowMs: PAST_WINDOW })).toEqual({
      kind: "waiting",
      reason: `${CARD} was taken down before their ask, so it was not up when they asked`,
    });
  });

  // A line that names no other card is not evidence the walk left this one.
  it("never counts an open_card whose detail names no card key as a move", () => {
    const blank = tool({ atIso: LATER, detail: "", name: "open_card" });
    const keyless = tool({ atIso: LATER, detail: "no key, card opened", name: "open_card" });
    const bogus = tool({ atIso: LATER, detail: "bogus:value, card opened, page none, thread none", name: "open_card" });
    expect(moveOf({ entries: [OPENED, ASK, blank], nowMs: PAST_WINDOW }).kind).toBe("stuck");
    expect(moveOf({ entries: [OPENED, ASK, keyless], nowMs: PAST_WINDOW }).kind).toBe("stuck");
    expect(moveOf({ entries: [OPENED, ASK, bogus], nowMs: PAST_WINDOW }).kind).toBe("stuck");
  });

  // Only their FIRST ask is judged. A card that moves only once they ask again is the
  // incident's own stall, so a repeat ask's move must never pass the scenario.
  it("judges their first ask, so a move inside only a repeat ask's window is still stuck", () => {
    const again: CallEntry = { ...ASK, atIso: "2026-11-01T10:00:50.000Z", id: "owner-3" };
    const late = tool({
      atIso: "2026-11-01T10:00:55.000Z",
      detail: `${OTHER}, card opened, page none, thread none`,
      name: "open_card",
    });
    expect(moveOf({ entries: [OPENED, ASK, again, late], nowMs: PAST_WINDOW + 30_000 })).toEqual({
      kind: "stuck",
      reason: `${CARD} still up 25s after their ask at ${ASKED_AT}`,
    });
  });

  it("never counts a move after a repeat ask, even inside the first ask's window", () => {
    const again: CallEntry = { ...ASK, atIso: "2026-11-01T10:00:30.000Z", id: "owner-3", text: "Next card please" };
    const after = tool({
      atIso: "2026-11-01T10:00:31.000Z",
      detail: `${OTHER}, card opened, page none, thread none`,
      name: "open_card",
    });
    expect(moveOf({ entries: [OPENED, ASK, again, after], nowMs: PAST_WINDOW }).kind).toBe("stuck");
    const before: CallEntry = { ...after, atIso: "2026-11-01T10:00:25.000Z" };
    expect(moveOf({ entries: [OPENED, ASK, before, again], nowMs: PAST_WINDOW }).kind).toBe("moved");
  });

  it("never counts a card-move from the card to itself as a move", () => {
    const toItself: CallEntry = { ...MOVE, toCardKey: CARD };
    expect(moveOf({ entries: [OPENED, ASK, toItself], nowMs: PAST_WINDOW }).kind).toBe("stuck");
  });

  it("never counts a refused open_card as a move", () => {
    const refused: CallEntry = {
      ...tool({ atIso: LATER, detail: `${OTHER}, card opened`, name: "open_card" }),
      refused: true,
    } as CallEntry;
    expect(moveOf({ entries: [OPENED, ASK, refused], nowMs: PAST_WINDOW }).kind).toBe("stuck");
  });

  it.each(["refused", "skipped"])("never counts an open_card of another key whose card was %s as a move", (outcome) => {
    const unopened = tool({
      atIso: LATER,
      detail: `${OTHER}, card ${outcome}, page ${outcome}, thread ${outcome}`,
      name: "open_card",
    });
    expect(moveOf({ entries: [OPENED, ASK, unopened], nowMs: PAST_WINDOW })).toEqual({
      kind: "stuck",
      reason: `${CARD} still up 25s after their ask at ${ASKED_AT}`,
    });
  });
});
