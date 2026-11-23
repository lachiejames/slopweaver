import { describe, expect, it } from "vitest";

import { cardReadingHold, READING_HOLD_WINDOW_MS } from "../../../desktop/e2eCallCardReadingHold.js";
import type { CallEntry } from "../../../talk/callRecord.js";

/** A synthetic Queue ask's key, never this install's own. */
const CARD = "ask:fixture-card";
const OTHER = "ask:acme-other-card";
const OPENED_AT = "2026-11-01T10:00:00.000Z";
const SAID_AT = "2026-11-01T10:00:05.000Z";
const SAID_MS = Date.parse(SAID_AT);
const PAST_WINDOW = SAID_MS + READING_HOLD_WINDOW_MS;

const tool = ({ name, detail, atIso }: { name: string; detail: string; atIso: string }): CallEntry => ({
  atIso,
  detail,
  kind: "tool",
  name,
  refused: false,
});

const OPENED = tool({ atIso: OPENED_AT, detail: `${CARD}, card opened, page none, thread opened`, name: "open_card" });
/** The owner's words, as a call that stalled on a reading hold ended on them. */
const READING: CallEntry = {
  atIso: SAID_AT,
  final: true,
  id: "owner-2",
  kind: "segment",
  text: "Right, I only just started. But uh, let me just keep reading.",
  who: "owner",
};
const ANSWER: CallEntry = {
  atIso: "2026-11-01T10:00:07.000Z",
  final: true,
  id: "voice-2",
  kind: "segment",
  text: "Sure.",
  who: "voice",
};
const LATER = "2026-11-01T10:00:12.000Z";

const holdOf = ({ entries, nowMs }: { entries: readonly CallEntry[]; nowMs: number }) =>
  cardReadingHold({ cardKey: CARD, entries, nowMs });

describe("cardReadingHold", () => {
  it("holds when the card is up, the owner says they are reading, and only an answer follows through the window", () => {
    expect(holdOf({ entries: [OPENED, READING, ANSWER], nowMs: PAST_WINDOW })).toEqual({ kind: "held" });
  });

  it("waits while the window is still open, one millisecond short of it", () => {
    expect(holdOf({ entries: [OPENED, READING, ANSWER], nowMs: PAST_WINDOW - 1 })).toEqual({
      kind: "waiting",
      reason: "the observation window is still open",
    });
  });

  it("waits on a card never opened or read, however long it has been", () => {
    expect(holdOf({ entries: [READING], nowMs: PAST_WINDOW })).toEqual({
      kind: "waiting",
      reason: `${CARD} has not been read or opened`,
    });
  });

  it("waits until the owner has said they are reading, and an interim line does not count", () => {
    const interim: CallEntry = { ...READING, final: false };
    expect(holdOf({ entries: [OPENED, interim], nowMs: PAST_WINDOW })).toEqual({
      kind: "waiting",
      reason: 'the owner\'s last final line does not end on "let me just keep reading"',
    });
  });

  // Words after the phrase hand the floor back, so there is no hold to witness.
  it("waits when the owner's line goes on past the phrase", () => {
    const thenAct: CallEntry = { ...READING, text: "let me just keep reading, then send it" };
    expect(holdOf({ entries: [OPENED, thenAct], nowMs: PAST_WINDOW })).toEqual({
      kind: "waiting",
      reason: 'the owner\'s last final line does not end on "let me just keep reading"',
    });
  });

  // A combining mark on the last letter makes it another word, never punctuation.
  it("waits when a combining mark follows the phrase", () => {
    const marked: CallEntry = { ...READING, text: "let me just keep readinǵ" };
    expect(holdOf({ entries: [OPENED, marked], nowMs: PAST_WINDOW })).toEqual({
      kind: "waiting",
      reason: 'the owner\'s last final line does not end on "let me just keep reading"',
    });
  });

  // The owner's LAST final line is judged, so a later one releases an earlier hold.
  it("waits when a later final line of the owner's no longer ends on the phrase", () => {
    const thenSend: CallEntry = {
      ...READING,
      atIso: "2026-11-01T10:00:10.000Z",
      id: "owner-3",
      text: "Actually, send it.",
    };
    expect(holdOf({ entries: [OPENED, READING, thenSend], nowMs: PAST_WINDOW + 5000 })).toEqual({
      kind: "waiting",
      reason: 'the owner\'s last final line does not end on "let me just keep reading"',
    });
  });

  // One object listed twice is judged at its LAST place, never its first.
  it("holds when the same line object is listed again after a resume at its instant", () => {
    const resume = tool({ atIso: SAID_AT, detail: "before the owner's last line", name: "resume" });
    expect(holdOf({ entries: [OPENED, READING, resume, READING], nowMs: PAST_WINDOW })).toEqual({ kind: "held" });
  });

  // A second witness of the card opens its own window past the first one's.
  it("is moved by a resume inside a later witness's window, past the first one's", () => {
    const reopenedMs = PAST_WINDOW - 10_000;
    const reopened: CallEntry = { ...OPENED, atIso: new Date(reopenedMs).toISOString() };
    const atIso = new Date(PAST_WINDOW + 5_000).toISOString();
    const resume = tool({ atIso, detail: "late", name: "resume" });
    expect(
      holdOf({ entries: [OPENED, READING, reopened, resume], nowMs: reopenedMs + READING_HOLD_WINDOW_MS }),
    ).toEqual({ kind: "moved", reason: `resume at ${atIso}: late` });
  });

  it("is moved by the page's resume, as in the stalled call", () => {
    const resume = tool({ atIso: LATER, detail: "the page resumed the answer", name: "resume" });
    expect(holdOf({ entries: [OPENED, READING, resume], nowMs: SAID_MS })).toEqual({
      kind: "moved",
      reason: `resume at ${LATER}: the page resumed the answer`,
    });
  });

  it("is moved by a resume's own start, and not by a nudge's", () => {
    const resumeStart = tool({
      atIso: LATER,
      detail: "started the thinking model's turn itself: the resume made the answer the thinking model's",
      name: "owed-start",
    });
    const nudgeStart = tool({
      atIso: LATER,
      detail: "started the thinking model's turn itself: the voice took the owner's nudge and handed nothing over",
      name: "owed-start",
    });
    expect(holdOf({ entries: [OPENED, READING, resumeStart], nowMs: PAST_WINDOW }).kind).toBe("moved");
    expect(holdOf({ entries: [OPENED, READING, nudgeStart], nowMs: PAST_WINDOW })).toEqual({ kind: "held" });
  });

  // The owner's next-card ask starts a walk turn, which moves them as surely as a resume's.
  it("is moved by a next-card ask's own start", () => {
    const walkStart = tool({
      atIso: LATER,
      detail:
        "started the thinking model's turn itself: they asked for the next card and no turn started during the owner's words",
      name: "owed-start",
    });
    expect(holdOf({ entries: [OPENED, READING, walkStart], nowMs: PAST_WINDOW }).kind).toBe("moved");
  });

  it("is moved by another card opened, and not by the same card opened again", () => {
    const other = tool({ atIso: LATER, detail: `${OTHER}, card opened, page none, thread none`, name: "open_card" });
    const again = tool({ atIso: LATER, detail: `${CARD}, card opened, page none, thread none`, name: "open_card" });
    expect(holdOf({ entries: [OPENED, READING, other], nowMs: PAST_WINDOW })).toEqual({
      kind: "moved",
      reason: `open_card at ${LATER}: ${OTHER}, card opened, page none, thread none`,
    });
    // The same card opened again is a witness of its own, so its window must pass too.
    const againPassed = Date.parse(LATER) + READING_HOLD_WINDOW_MS;
    expect(holdOf({ entries: [OPENED, READING, again], nowMs: againPassed })).toEqual({ kind: "held" });
  });

  it("is moved by a triage step, and not by a refused one", () => {
    const step = tool({ atIso: LATER, detail: `${OTHER}, opened`, name: "triage_next" });
    const refused: CallEntry = { ...step, refused: true } as CallEntry;
    expect(holdOf({ entries: [OPENED, READING, step], nowMs: PAST_WINDOW }).kind).toBe("moved");
    expect(holdOf({ entries: [OPENED, READING, refused], nowMs: PAST_WINDOW })).toEqual({ kind: "held" });
  });

  it("judges by instant, so a resume BEFORE the owner's words never counts even when it lands later in the file", () => {
    const early = tool({ atIso: "2026-11-01T10:00:02.000Z", detail: "earlier", name: "resume" });
    expect(holdOf({ entries: [OPENED, READING, early], nowMs: PAST_WINDOW })).toEqual({ kind: "held" });
  });

  // A strict "after the owner's instant" test would drop a move sharing it.
  it("is moved by a resume sharing the owner's line's instant when it is written after that line", () => {
    const sameInstant = tool({ atIso: SAID_AT, detail: "same instant", name: "resume" });
    expect(holdOf({ entries: [OPENED, READING, sameInstant], nowMs: SAID_MS + 1_000 })).toEqual({
      kind: "moved",
      reason: `resume at ${SAID_AT}: same instant`,
    });
  });

  it("holds when the only resume comes once the whole window has passed, and is moved by one a millisecond inside it", () => {
    const after = tool({ atIso: new Date(PAST_WINDOW).toISOString(), detail: "after", name: "resume" });
    const inside = tool({ atIso: new Date(PAST_WINDOW - 1).toISOString(), detail: "inside", name: "resume" });
    expect([
      holdOf({ entries: [OPENED, READING, after], nowMs: PAST_WINDOW + 6_000 }).kind,
      holdOf({ entries: [OPENED, READING, inside], nowMs: PAST_WINDOW + 6_000 }).kind,
    ]).toEqual(["held", "moved"]);
  });

  it("starts the window at the card when the card opens after the owner's words", () => {
    const lateOpen: CallEntry = { ...OPENED, atIso: LATER };
    expect(holdOf({ entries: [READING, lateOpen], nowMs: PAST_WINDOW }).kind).toBe("waiting");
    expect(holdOf({ entries: [READING, lateOpen], nowMs: Date.parse(LATER) + READING_HOLD_WINDOW_MS })).toEqual({
      kind: "held",
    });
  });
});
