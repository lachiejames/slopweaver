/*
 * One call's tool lines as a page (`callTools.ts`): each folded once exactly as the call record folds them, indexed
 * among the call's own tool lines, and a page bounded so a call's answers are never read all at once.
 */
import { describe, expect, it } from "vitest";

import type { CallEntry } from "../../../talk/callRecord.js";
import { callToolsPage } from "../../../talk/callTools.js";

const CALL = "a0000041-0000-4000-8000-000000000044";

/** A tool line at the given second, answered with `answer` unless it is `undefined`. */
const tool = ({
  second,
  answer,
}: {
  second: number;
  answer: string | undefined;
}): Extract<CallEntry, { kind: "tool" }> => ({
  answer,
  atIso: `2026-11-01T02:10:0${String(second)}.000Z`,
  detail: `read ABC-${String(second)}`,
  kind: "tool",
  name: "code_read",
  refused: false,
});

const SAID: CallEntry = {
  atIso: "2026-11-01T02:09:59.000Z",
  final: true,
  id: "s-1",
  kind: "segment",
  text: "what is ABC-1",
  who: "owner",
};

describe("callToolsPage", () => {
  it("reads only the tool lines, oldest first, each with its index and exact answer", () => {
    const page = callToolsPage({
      callId: CALL,
      entries: [SAID, tool({ answer: '{"a":"x\\ny"}', second: 1 }), tool({ answer: undefined, second: 2 })],
      from: 0,
      limit: 10,
    });
    expect(page).toEqual({
      callId: CALL,
      from: 0,
      nextFrom: null,
      tools: [
        {
          answer: '{"a":"x\\ny"}',
          atIso: "2026-11-01T02:10:01.000Z",
          detail: "read ABC-1",
          index: 0,
          name: "code_read",
          opened: undefined,
          refused: false,
        },
        {
          answer: null,
          atIso: "2026-11-01T02:10:02.000Z",
          detail: "read ABC-2",
          index: 1,
          name: "code_read",
          opened: undefined,
          refused: false,
        },
      ],
      total: 2,
    });
  });

  it("pages by index, naming where the next page starts until the last row", () => {
    const entries = [1, 2, 3, 4, 5].map((second) => tool({ answer: `answer ${String(second)}`, second }));
    const first = callToolsPage({ callId: CALL, entries, from: 0, limit: 2 });
    const second = callToolsPage({ callId: CALL, entries, from: 2, limit: 2 });
    const last = callToolsPage({ callId: CALL, entries, from: 4, limit: 2 });
    expect([first.nextFrom, second.nextFrom, last.nextFrom]).toEqual([2, 4, null]);
    expect(
      [first, second, last].map((page) => page.tools.map((row) => `${String(row.index)}:${String(row.answer)}`)),
    ).toEqual([["0:answer 1", "1:answer 2"], ["2:answer 3", "3:answer 4"], ["4:answer 5"]]);
  });

  it("reads past the last row as an empty page that still counts the call's tool lines", () => {
    const page = callToolsPage({ callId: CALL, entries: [tool({ answer: "a", second: 1 })], from: 5, limit: 10 });
    expect(page).toEqual({ callId: CALL, from: 5, nextFrom: null, tools: [], total: 1 });
  });

  it("keeps a retried copy once, and two reads that came back with different answers as two", () => {
    const once = tool({ answer: "first", second: 1 });
    const page = callToolsPage({
      callId: CALL,
      entries: [once, once, { ...once, answer: "changed" }],
      from: 0,
      limit: 10,
    });
    expect(page.tools.map((row) => `${String(row.index)}:${String(row.answer)}`)).toEqual(["0:first", "1:changed"]);
    expect(page.total).toBe(2);
  });

  it("reads a call that ran no tool as an empty page", () => {
    expect(callToolsPage({ callId: CALL, entries: [SAID], from: 0, limit: 10 })).toEqual({
      callId: CALL,
      from: 0,
      nextFrom: null,
      tools: [],
      total: 0,
    });
  });
});

describe("callToolsPage over a reopened call's window steps", () => {
  const PREVIOUS = "a0000076-0000-4000-8000-000000000083";

  /** A `handed` step at the one instant, `elapsedSinceArmedMs` apart. */
  const handed = ({ elapsedSinceArmedMs }: { elapsedSinceArmedMs: number }): Extract<CallEntry, { kind: "tool" }> => ({
    answer: undefined,
    atIso: "2026-11-06T01:12:03.140Z",
    detail: "handed the reminder",
    kind: "tool",
    name: "reopen-reminder",
    refused: false,
    reopenReminder: { elapsedSinceArmedMs, phase: "handed", previousCallId: PREVIOUS, windowMs: 3_000 },
  });

  it("carries the step on its row, and folds a retried copy of it to one", () => {
    const step = handed({ elapsedSinceArmedMs: 3_002 });
    const page = callToolsPage({ callId: CALL, entries: [step, step], from: 0, limit: 10 });
    expect(page.tools).toEqual([
      {
        answer: null,
        atIso: "2026-11-06T01:12:03.140Z",
        detail: "handed the reminder",
        index: 0,
        name: "reopen-reminder",
        opened: undefined,
        refused: false,
        reopenReminder: { elapsedSinceArmedMs: 3_002, phase: "handed", previousCallId: PREVIOUS, windowMs: 3_000 },
      },
    ]);
  });

  it("keeps two steps whose detail matches but whose measurements differ", () => {
    const page = callToolsPage({
      callId: CALL,
      entries: [handed({ elapsedSinceArmedMs: 3_002 }), handed({ elapsedSinceArmedMs: 3_004 })],
      from: 0,
      limit: 10,
    });
    expect(page.tools.map((row) => row.reopenReminder!.elapsedSinceArmedMs)).toEqual([3_002, 3_004]);
  });
});
