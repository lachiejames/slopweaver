/*
 * A triage answer over a record read that did not arrive names what it could not read, so "every card seen" or
 * a pass's summary over an empty read never reads as the whole Queue.
 */
import { describe, expect, it } from "vitest";

import { TOOL_OUTPUT_MAX, toolOutputOf } from "../../components/live/talkSession";
import { runTriageEnd } from "../../components/voice/triageClockRun";
import { runTriageNext, type TriageSeams } from "../../components/voice/triageRun";
import type { UnreadSource } from "../../lib/talkActionItems";
import { NOT_CARRIED, withRecordUnread } from "../../lib/voiceRecordQueue";
import { fakes } from "./triageRunFixture";

/** The record read past its deadline: every source unread, and no card read. */
const TIMED_OUT: readonly UnreadSource[] = [
  { source: "the board", why: "the voice record read did not answer within 20 s" },
  { source: "card deferrals", why: "the voice record read did not answer within 20 s" },
];

/**
 * The seams, their cards read off a record that did not arrive.
 *
 * @param seams the seams over a whole Queue
 * @returns the same seams over no cards, every source named unread
 */
function unreadQueue({ seams }: { seams: TriageSeams }): TriageSeams {
  return { ...seams, cards: () => ({ ...seams.cards(), rows: [], unread: TIMED_OUT }) };
}

describe("withRecordUnread", () => {
  it("leaves an answer over a whole read exactly as it was", () => {
    const answer = { done: true };
    expect(withRecordUnread({ answer, capBytes: TOOL_OUTPUT_MAX, unread: [] })).toBe(answer);
  });

  it("puts the unread sources beside an object answer's own fields", () => {
    expect(withRecordUnread({ answer: { done: true }, capBytes: TOOL_OUTPUT_MAX, unread: TIMED_OUT })).toStrictEqual({
      done: true,
      unread: TIMED_OUT,
    });
  });

  it("wraps an answer that is not an object, keeping it whole", () => {
    expect(withRecordUnread({ answer: "ended", capBytes: TOOL_OUTPUT_MAX, unread: TIMED_OUT })).toStrictEqual({
      answer: "ended",
      unread: TIMED_OUT,
    });
  });

  it("replaces a list the answer already carries, never counting it as room taken", () => {
    const carried = { done: true, unread: [{ source: "x".repeat(3000), why: "old" }] };
    expect(withRecordUnread({ answer: carried, capBytes: 200, unread: TIMED_OUT.slice(0, 1) })).toStrictEqual({
      done: true,
      unread: TIMED_OUT.slice(0, 1),
    });
  });

  // A card whose own fields leave less than the 2 KiB reserve, beside a 2 KiB list.
  it("shortens the list into the room a near-cap card leaves, and the whole answer stays under the cap", () => {
    const card = { card: { key: "ask:acme", what: "w".repeat(23_000) } };
    const unread = Array.from({ length: 16 }, (_, at) => ({ source: `source ${String(at)}`, why: "y".repeat(110) }));
    const answer = withRecordUnread({ answer: card, capBytes: TOOL_OUTPUT_MAX, unread }) as {
      readonly card: unknown;
      readonly unread: readonly UnreadSource[];
    };
    expect(answer.card).toEqual(card.card);
    expect(answer.unread.length).toBeGreaterThan(0);
    expect(toolOutputOf({ answer, tool: "read_card" })).toBe(JSON.stringify(answer));
  });

  it("says the answer is not carried, naming the sources, when even the folded entry leaves no room", () => {
    const card = { card: { key: "ask:acme", what: "w".repeat(TOOL_OUTPUT_MAX - 60) } };
    expect(withRecordUnread({ answer: card, capBytes: TOOL_OUTPUT_MAX, unread: TIMED_OUT })).toStrictEqual({
      notCarried: NOT_CARRIED,
      unread: TIMED_OUT,
    });
  });
});

describe("triage over a record read that did not arrive", () => {
  it("names the unread sources when triage_next finds no card, rather than saying every card was seen", async () => {
    const { seams } = fakes({ walk: undefined });
    const done = await runTriageNext({ minutes: undefined, seams: unreadQueue({ seams }) });
    expect(done.detail).toBe("triage done, 0 of 0 seen");
    expect((done.answer as { unread: readonly UnreadSource[] }).unread).toStrictEqual(TIMED_OUT);
  });

  it("names the unread sources on triage_end's summary", async () => {
    const { seams } = fakes({ walk: undefined });
    await runTriageNext({ minutes: undefined, seams });
    const ended = runTriageEnd({ seams: unreadQueue({ seams }) });
    expect(ended.detail).toBe("triage ended, 1 of 1 seen");
    expect((ended.answer as { unread: readonly UnreadSource[] }).unread).toStrictEqual(TIMED_OUT);
  });

  it("names a source unread at a later card read, as an overlapping call replaces the record mid-open", async () => {
    const { seams } = fakes({ walk: undefined });
    const priorities = { source: "workstream priorities", why: "the verb exited 1" };
    let read = 0;
    // The first read is whole; every read after it is another call's record, the same cards and one register failed.
    const cards: TriageSeams["cards"] = () => {
      read += 1;
      const whole = seams.cards();
      return read === 1 ? whole : { ...whole, unread: [priorities] };
    };
    const ran = await runTriageNext({ minutes: undefined, seams: { ...seams, cards } });
    expect(ran.refused).toBe(false);
    expect((ran.answer as { unread: readonly UnreadSource[] }).unread).toStrictEqual([priorities]);
  });

  it("names a source unread at the card read a card left the Queue on as it opened", async () => {
    const { seams } = fakes({ walk: undefined });
    const board = { source: "the board", why: "timed out" };
    const removed = { atIso: "2026-10-04T09:00:00.000Z", why: "settled" };
    let read = 0;
    // The first read is whole; the open's is another call's record, the card left and the board register failed.
    const cards: TriageSeams["cards"] = () => {
      read += 1;
      const whole = seams.cards();
      if (read === 1) {
        return whole;
      }
      return { ...whole, recentlyLeft: [{ removed, row: whole.rows[0] }], rows: [], unread: [board] };
    };
    const ran = await runTriageNext({ minutes: undefined, seams: { ...seams, cards } });
    expect([ran.refused, ran.answer]).toStrictEqual([
      false,
      {
        left: true,
        note: "this card left the owner's Queue as it opened, so there is nothing to rule: call triage_next for the next",
        unread: [board],
      },
    ]);
  });

  it("carries no unread field when the read arrived whole", async () => {
    const { seams } = fakes({ walk: undefined });
    await runTriageNext({ minutes: undefined, seams });
    const ended = runTriageEnd({ seams });
    expect(Object.keys(ended.answer as object)).toEqual(["ended", "note", "rulings", "summary"]);
  });
});
