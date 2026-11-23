import { describe, expect, it } from "vitest";

import {
  CARD_READ_PROGRESS,
  cardReadProgress,
  furtherProgress,
  isCardOpened,
  isCardRead,
  isCardReadWitness,
} from "../../../desktop/e2eCallCardRead.js";
import type { CallEntry } from "../../../talk/callRecord.js";

/** A synthetic Queue ask's key, never this install's own. */
const CARD = "ask:fixture-card";
/** A synthetic hand note's key, never this install's own. */
const HAND = "hand:acme-sample-note";
const MARKER = "E2E typed abc123";
const TYPED = `${MARKER}: I don't think that is real. What does the card actually claim?`;
const AT = "2026-11-01T10:00:00.000Z";

const tool = ({ name, detail, refused }: { name: string; detail: string; refused: boolean }): CallEntry => ({
  atIso: AT,
  detail,
  kind: "tool",
  name,
  refused,
});

const segment = ({
  id,
  who,
  text,
  final,
}: {
  id: string;
  who: "owner" | "voice";
  text: string;
  final: boolean;
}): CallEntry => ({ atIso: AT, final, id, kind: "segment", text, who });

const opened = ({ key }: { key: string }): CallEntry =>
  tool({ detail: `${key}, card opened, page none, thread opened`, name: "open_card", refused: false });

const OPENED = opened({ key: CARD });
const read = ({ detail }: { detail: string }): CallEntry => tool({ detail, name: "read_card", refused: false });

const READ = read({ detail: `${CARD}, read` });
/** `read_card` of a card the owner already took off their Queue, as `site/components/voice/openCardRun.ts` writes it. */
const OFF_QUEUE_READ = read({ detail: `${CARD}, read (off the owner's Queue)` });
/** `open_card` of a card off the owner's Queue: it hands the text over but opens nothing, and the witness never takes it. */
const OFF_QUEUE_OPEN = tool({
  detail: `${CARD}, off the owner's Queue, nothing opened`,
  name: "open_card",
  refused: false,
});
const REQUEST = segment({ final: true, id: "owner-1", text: "please open my queue card fixture card", who: "owner" });
const FIRST = segment({ final: true, id: "voice-1", text: "The card says the key is a service key.", who: "voice" });
const CHALLENGE = segment({ final: true, id: "typed-in-1", text: TYPED, who: "owner" });
const SECOND = segment({
  final: true,
  id: "voice-2",
  text: "The card claims a service key, as written.",
  who: "voice",
});

const progressOf = ({ entries, cardKey = CARD }: { entries: readonly CallEntry[]; cardKey?: string }) =>
  cardReadProgress({ cardKey, challenge: TYPED, entries });

describe("cardReadProgress", () => {
  it("completes on the named card opened, an answer, the challenge, the card read and an answer", () => {
    expect(progressOf({ entries: [REQUEST, OPENED, FIRST, CHALLENGE, READ, SECOND] })).toBe("complete");
  });

  it("completes on a hand note opened, its page refused, then opened again after the challenge", () => {
    const handOpened = tool({
      detail: `${HAND}, card opened, page refused, thread none`,
      name: "open_card",
      refused: false,
    });
    expect(progressOf({ cardKey: HAND, entries: [handOpened, FIRST, CHALLENGE, handOpened, SECOND] })).toBe("complete");
  });

  it("completes on an ask re-read with open_card once more, as well as with read_card", () => {
    expect(progressOf({ entries: [OPENED, FIRST, CHALLENGE, OPENED, SECOND] })).toBe("complete");
  });

  it("does not need the owner's request's final line before the open, since the tool can run on a partial utterance", () => {
    expect(progressOf({ entries: [OPENED, FIRST, CHALLENGE, READ, SECOND] })).toBe("complete");
  });

  it("stands at each state as the witness arrives", () => {
    const sequence = [REQUEST, OPENED, FIRST, CHALLENGE, READ, SECOND];
    expect(sequence.map((_, index) => progressOf({ entries: sequence.slice(0, index + 1) }))).toEqual([
      "waiting-for-open",
      "waiting-for-first-answer",
      "ready-for-challenge",
      "waiting-for-reread",
      "waiting-for-challenged-answer",
      "complete",
    ]);
  });

  it("completes on the named card read rather than opened, before the first answer and after the challenge", () => {
    expect(progressOf({ entries: [REQUEST, READ, FIRST, CHALLENGE, READ, SECOND] })).toBe("complete");
  });

  it("completes on a card off the owner's Queue, read both times, since open_card opens nothing for one", () => {
    expect(progressOf({ entries: [REQUEST, OFF_QUEUE_READ, FIRST, CHALLENGE, OFF_QUEUE_READ, SECOND] })).toBe(
      "complete",
    );
  });

  it("never opens on open_card's line for a card off the owner's Queue, which opened nothing", () => {
    expect(progressOf({ entries: [OFF_QUEUE_OPEN, FIRST, CHALLENGE] })).toBe("waiting-for-open");
  });

  it("never opens on a different card, another kind with the same id, or a key the named one merely begins", () => {
    expect([
      progressOf({ entries: [opened({ key: "ask:another-card" }), FIRST, CHALLENGE] }),
      progressOf({ entries: [opened({ key: "hand:fixture-card" }), FIRST, CHALLENGE] }),
      progressOf({ entries: [opened({ key: `${CARD}-two` }), FIRST, CHALLENGE] }),
      progressOf({ entries: [read({ detail: "ask:another-card, read" }), FIRST, CHALLENGE] }),
      progressOf({ entries: [read({ detail: `${CARD}-two, read (off the owner's Queue)` }), FIRST, CHALLENGE] }),
    ]).toEqual(["waiting-for-open", "waiting-for-open", "waiting-for-open", "waiting-for-open", "waiting-for-open"]);
  });

  it("never opens on a refused open_card or a refused read_card", () => {
    const refused = tool({ detail: `${CARD}, card opened, page none, thread none`, name: "open_card", refused: true });
    const refusedRead = tool({ detail: `${CARD}, read`, name: "read_card", refused: true });
    expect([
      progressOf({ entries: [refused, FIRST, CHALLENGE] }),
      progressOf({ entries: [refusedRead, FIRST, CHALLENGE] }),
    ]).toEqual(["waiting-for-open", "waiting-for-open"]);
  });

  it("never opens on a card presentation skipped or refused", () => {
    const skipped = tool({
      detail: `${CARD}, card skipped, page none, thread none`,
      name: "open_card",
      refused: false,
    });
    const refused = tool({
      detail: `${CARD}, card refused, page none, thread none`,
      name: "open_card",
      refused: false,
    });
    const lookalike = tool({
      detail: `${CARD}, card opened-not-really, page none, thread none`,
      name: "open_card",
      refused: false,
    });
    expect([
      progressOf({ entries: [skipped, FIRST, CHALLENGE] }),
      progressOf({ entries: [refused, FIRST, CHALLENGE] }),
      progressOf({ entries: [lookalike, FIRST, CHALLENGE] }),
    ]).toEqual(["waiting-for-open", "waiting-for-open", "waiting-for-open"]);
  });

  it("takes no voice answer given before the open as the first answer", () => {
    expect(progressOf({ entries: [FIRST, OPENED, CHALLENGE, READ, SECOND] })).toBe("ready-for-challenge");
  });

  it("never takes a reply that names a start before the re-read, even when its first line lands after it", () => {
    const begun = ({ beganIso }: { beganIso: string }): CallEntry => ({
      atIso: AT,
      beganIso,
      final: true,
      id: "voice-2",
      kind: "segment",
      text: "The card claims a service key, as written.",
      who: "voice",
    });
    expect([
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, READ, begun({ beganIso: "2026-11-01T09:59:59.000Z" })] }),
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, READ, begun({ beganIso: "2026-11-01T10:00:01.000Z" })] }),
    ]).toEqual(["waiting-for-challenged-answer", "complete"]);
  });

  it("never takes a reply naming no start whose own line was written before the re-read", () => {
    const early: CallEntry = { ...SECOND, atIso: "2026-11-01T09:59:00.000Z" };
    expect(progressOf({ entries: [OPENED, FIRST, CHALLENGE, READ, early] })).toBe("waiting-for-challenged-answer");
  });

  it("judges by the lines' instants, so a re-read and answer from before the challenge never follow it", () => {
    const at = ({ entry, ms }: { entry: CallEntry; ms: number }): CallEntry => ({
      ...entry,
      atIso: `2026-11-01T10:00:00.00${ms}Z`,
    });
    // File order puts the challenge before the re-read; the instants say it came last.
    const landedLate = [
      at({ entry: OPENED, ms: 1 }),
      at({ entry: FIRST, ms: 2 }),
      at({ entry: CHALLENGE, ms: 5 }),
      at({ entry: READ, ms: 3 }),
      at({ entry: SECOND, ms: 4 }),
    ];
    const inOrder = [
      at({ entry: OPENED, ms: 1 }),
      at({ entry: FIRST, ms: 2 }),
      at({ entry: CHALLENGE, ms: 3 }),
      at({ entry: SECOND, ms: 5 }),
      at({ entry: READ, ms: 4 }),
    ];
    expect([progressOf({ entries: landedLate }), progressOf({ entries: inOrder })]).toEqual([
      "waiting-for-reread",
      "complete",
    ]);
  });

  it("never takes a reply one of whose earlier snapshots, landing late in the file, was written before the re-read", () => {
    const reread: CallEntry = { ...READ, atIso: "2026-11-01T10:03:00.000Z" };
    const partial: CallEntry = {
      ...segment({ final: false, id: "voice-2", text: "already", who: "voice" }),
      atIso: "2026-11-01T10:02:30.000Z",
    };
    const late: CallEntry = { ...SECOND, atIso: "2026-11-01T10:04:00.000Z" };
    expect([
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, reread, partial, late] }),
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, reread, late, partial] }),
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, reread, late] }),
    ]).toEqual(["waiting-for-challenged-answer", "waiting-for-challenged-answer", "complete"]);
  });

  it("takes a final voice line with no words as no answer, first or second", () => {
    const blankFirst = segment({ final: true, id: "voice-1", text: "  ", who: "voice" });
    const blankSecond = segment({ final: true, id: "voice-2", text: "", who: "voice" });
    expect([
      progressOf({ entries: [OPENED, blankFirst, CHALLENGE, READ] }),
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, READ, blankSecond] }),
    ]).toEqual(["waiting-for-first-answer", "waiting-for-challenged-answer"]);
  });

  it("waits on the first answer when none followed the open", () => {
    expect(progressOf({ entries: [OPENED, CHALLENGE, READ] })).toBe("waiting-for-first-answer");
  });

  it("never takes a challenge typed before the first answer", () => {
    expect(progressOf({ entries: [OPENED, CHALLENGE, FIRST, READ, SECOND] })).toBe("ready-for-challenge");
  });

  it("never takes a challenge line that is not final, one without the marker, or the marker cut short", () => {
    const partial = segment({ final: false, id: "typed-in-1", text: TYPED, who: "owner" });
    const unmarked = segment({ final: true, id: "owner-2", text: "I don't think that is real", who: "owner" });
    const cutShort = segment({ final: true, id: "typed-in-1", text: `${MARKER}: I don't`, who: "owner" });
    const markerOnly = segment({ final: true, id: "typed-in-1", text: MARKER, who: "owner" });
    expect([
      progressOf({ entries: [OPENED, FIRST, partial, READ, SECOND] }),
      progressOf({ entries: [OPENED, FIRST, unmarked, READ, SECOND] }),
      progressOf({ entries: [OPENED, FIRST, cutShort, READ, SECOND] }),
      progressOf({ entries: [OPENED, FIRST, markerOnly, READ, SECOND] }),
    ]).toEqual(["ready-for-challenge", "ready-for-challenge", "ready-for-challenge", "ready-for-challenge"]);
  });

  it("never takes a read or an open before the challenge as the re-read", () => {
    expect([
      progressOf({ entries: [OPENED, FIRST, READ, CHALLENGE, SECOND] }),
      progressOf({ entries: [OPENED, FIRST, OPENED, CHALLENGE, SECOND] }),
    ]).toEqual(["waiting-for-reread", "waiting-for-reread"]);
  });

  it("waits on the re-read when the challenged answer came without one", () => {
    expect(progressOf({ entries: [OPENED, FIRST, CHALLENGE, SECOND] })).toBe("waiting-for-reread");
  });

  it("never takes a refused read, one of another card, or open_card's line for one off the owner's Queue", () => {
    const refused = tool({ detail: `${CARD}, read`, name: "read_card", refused: true });
    const other = read({ detail: "ask:another-card, read" });
    expect([
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, refused, SECOND] }),
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, other, SECOND] }),
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, OFF_QUEUE_OPEN, SECOND] }),
    ]).toEqual(["waiting-for-reread", "waiting-for-reread", "waiting-for-reread"]);
  });

  it("never takes another card's open_card, a refused one, or a skipped one as the re-read", () => {
    const refused = tool({ detail: `${CARD}, card opened, page none, thread none`, name: "open_card", refused: true });
    const skipped = tool({
      detail: `${CARD}, card skipped, page none, thread none`,
      name: "open_card",
      refused: false,
    });
    expect([
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, opened({ key: "ask:another-card" }), SECOND] }),
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, refused, SECOND] }),
      progressOf({ entries: [OPENED, FIRST, CHALLENGE, skipped, SECOND] }),
    ]).toEqual(["waiting-for-reread", "waiting-for-reread", "waiting-for-reread"]);
  });

  it("waits on the challenged answer when none followed the re-read", () => {
    expect(progressOf({ entries: [OPENED, FIRST, CHALLENGE, READ] })).toBe("waiting-for-challenged-answer");
  });

  it("never lets one answer stand for both turns, even re-written after the re-read", () => {
    expect(progressOf({ entries: [OPENED, FIRST, CHALLENGE, READ, FIRST] })).toBe("waiting-for-challenged-answer");
  });

  it("never takes an answer that began before the tool it answers and was finalised after it", () => {
    const begun = segment({ final: false, id: "voice-2", text: "The card", who: "voice" });
    expect(progressOf({ entries: [OPENED, FIRST, CHALLENGE, begun, READ, SECOND] })).toBe(
      "waiting-for-challenged-answer",
    );
  });

  it("never manufactures a second turn from repeated tool and challenge lines", () => {
    expect(progressOf({ entries: [OPENED, OPENED, FIRST, CHALLENGE, CHALLENGE, READ, READ] })).toBe(
      "waiting-for-challenged-answer",
    );
  });

  it("judges each call alone: two halves in two calls are never one witness", () => {
    // The second half's read counts as its FIRST read, so its challenge, typed before it, never counts.
    expect([progressOf({ entries: [OPENED, FIRST] }), progressOf({ entries: [CHALLENGE, READ, SECOND] })]).toEqual([
      "ready-for-challenge",
      "ready-for-challenge",
    ]);
  });
});

describe("the card tool lines", () => {
  it("read the console's own details exactly, for an ask and a hand note", () => {
    const handRead = tool({ detail: `${HAND}, read`, name: "read_card", refused: false });
    expect([
      isCardOpened({ cardKey: CARD, entry: OPENED }),
      isCardRead({ cardKey: CARD, entry: READ }),
      isCardOpened({ cardKey: CARD, entry: READ }),
      isCardRead({ cardKey: CARD, entry: OPENED }),
      isCardOpened({ cardKey: HAND, entry: opened({ key: HAND }) }),
      isCardRead({ cardKey: HAND, entry: handRead }),
      isCardOpened({ cardKey: HAND, entry: OPENED }),
    ]).toEqual([true, true, false, false, true, true, false]);
  });

  it("read a card off the owner's Queue only through read_card, by its two exact details", () => {
    expect([
      isCardRead({ cardKey: CARD, entry: OFF_QUEUE_READ }),
      isCardRead({ cardKey: CARD, entry: read({ detail: `${CARD}-two, read` }) }),
      isCardRead({ cardKey: CARD, entry: read({ detail: `${CARD}, read (off the owner's Queue) again` }) }),
      isCardOpened({ cardKey: CARD, entry: OFF_QUEUE_OPEN }),
      isCardRead({ cardKey: CARD, entry: OFF_QUEUE_OPEN }),
    ]).toEqual([true, false, false, false, false]);
  });

  it("take either the card read or the card opened as either of the witness's reads", () => {
    expect([
      isCardReadWitness({ cardKey: CARD, entry: READ }),
      isCardReadWitness({ cardKey: CARD, entry: OFF_QUEUE_READ }),
      isCardReadWitness({ cardKey: CARD, entry: OPENED }),
      isCardReadWitness({ cardKey: HAND, entry: OPENED }),
      isCardReadWitness({ cardKey: CARD, entry: OFF_QUEUE_OPEN }),
      isCardReadWitness({ cardKey: CARD, entry: FIRST }),
    ]).toEqual([true, true, true, false, false, false]);
  });
});

describe("furtherProgress", () => {
  it("keeps whichever state is further through the witness", () => {
    expect(CARD_READ_PROGRESS.length).toBeGreaterThan(0);
    expect([
      furtherProgress({ a: "waiting-for-open", b: "ready-for-challenge" }),
      furtherProgress({ a: "complete", b: "waiting-for-reread" }),
    ]).toEqual(["ready-for-challenge", "complete"]);
  });
});
