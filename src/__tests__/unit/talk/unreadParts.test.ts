/**
 * A line too large for a batch prints in parts: the same cut every time, on code-point boundaries, each part within
 * its byte and line budget, and each part's mark a frontier that stays at the line's start until the last.
 */
import { describe, expect, it } from "vitest";

import type { CallEntry } from "../../../talk/callRecord.js";
import { coverEnd, nextPart, partsOf, UNREAD_PART_BYTES, UNREAD_PART_LINES } from "../../../talk/unreadParts.js";
import type { CallFrontier, CallTail, UnreadRead } from "../../../talk/unreadWords.js";

const CALL = "a0000035-0000-4000-8000-000000000038";
const OTHER = "a0000041-0000-4000-8000-000000000044";
const EMPTY = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const AFTER: CallFrontier = { offset: 20_000, prefixSha256: "sha256:after" };

const segment = ({ text }: { text: string }) =>
  ({
    atIso: "2026-09-26T05:00:00.000Z",
    final: true,
    id: "s",
    kind: "segment",
    text,
    who: "owner",
  }) satisfies CallEntry;

const readOf = ({ tails }: { tails: readonly CallTail[] }): UnreadRead => ({
  bootstrapFloorIso: undefined,
  cursor: { calls: {}, recordedAtIso: "2026-09-26T04:00:00.000Z" },
  quarantined: [],
  tails,
});

const tailWith = ({ start, text }: { start: CallFrontier | undefined; text: string }): CallTail => ({
  callId: CALL,
  endedBefore: false,
  finalBefore: [],
  lines: [{ after: AFTER, entry: segment({ text }), kind: "entry", sha256: "sha256:line" }],
  originBefore: undefined,
  relaysBefore: [],
  seenOriginBefore: new Map(),
  seenBefore: [],
  start,
});

/** A snapshot of the owner's stretch `id`, as the page appends one each time it grows. */
const snapshot = ({ id, text, final = false }: { id: string; text: string; final?: boolean }) =>
  ({ atIso: "2026-09-26T05:00:00.000Z", final, id, kind: "segment", text, who: "owner" }) satisfies CallEntry;

/** A line no report prints: a tool the voice called. */
const tool = {
  atIso: "2026-09-26T05:00:01.000Z",
  detail: "",
  kind: "tool",
  name: "recall",
  refused: false,
} as const satisfies CallEntry;

/** A stretch's snapshot `words` words long — each continues every shorter one; 1,000 to 1,200 print in two parts. */
const growing = ({ words }: { words: number }): string =>
  Array.from({ length: words }, (_, index) => `word${String(index)}`).join(" ");

/** A tail of the given entries, line `i` ending at byte `100 * (i + 1)` and hashed by its index. */
const tailOf = ({ entries, start }: { entries: readonly CallEntry[]; start?: CallFrontier }): CallTail => ({
  callId: CALL,
  endedBefore: false,
  finalBefore: [],
  lines: entries.map((entry, index) => ({
    after: { offset: 100 * (index + 1), prefixSha256: `sha256:through-${String(index)}` },
    entry,
    kind: "entry",
    sha256: `sha256:line-${String(index)}`,
  })),
  originBefore: undefined,
  relaysBefore: [],
  seenOriginBefore: new Map(),
  seenBefore: [],
  start,
});

describe("partsOf", () => {
  it("cuts at the byte budget and rejoins to the whole text", () => {
    const text = "a".repeat(UNREAD_PART_BYTES * 2 + 1);
    const parts = partsOf({ text });

    expect(parts.map((part) => part.length)).toEqual([UNREAD_PART_BYTES, UNREAD_PART_BYTES, 1]);
    expect(parts.join("")).toBe(text);
  });

  it("weighs a character by its JSON escape, and never splits a code point", () => {
    // "\u0001" escapes to six bytes, so a part holds a sixth as many of them as its budget.
    const perPart = Math.floor(UNREAD_PART_BYTES / 6);
    expect(partsOf({ text: "\u0001".repeat(perPart * 6) }).map((part) => part.length)).toEqual(
      Array.from({ length: 6 }, () => perPart),
    );
    const emoji = "🚀".repeat(UNREAD_PART_BYTES);
    const parts = partsOf({ text: emoji });
    expect(parts.every((part) => part.replaceAll("🚀", "") === "")).toBe(true);
    expect(parts.join("")).toBe(emoji);
  });

  it("cuts before the line break past the line budget", () => {
    const parts = partsOf({ text: "x\n".repeat(UNREAD_PART_LINES + 1) });

    expect(parts.map((part) => part.split("\n").length - 1)).toEqual([UNREAD_PART_LINES, 1]);
  });

  it("gives one empty part for an empty text", () => {
    expect(partsOf({ text: "" })).toEqual([""]);
  });
});

describe("nextPart", () => {
  const text = "b".repeat(UNREAD_PART_BYTES * 2 + 5);

  it("starts a never-read file's first line at byte 0, recording one part against the line's hash", () => {
    const part = nextPart({ read: readOf({ tails: [tailWith({ start: undefined, text })] }) })!;

    expect(part).toEqual({
      byteOffset: 0,
      callId: CALL,
      frontier: { offset: 0, part: { lineSha256: "sha256:line", printed: 1 }, prefixSha256: EMPTY },
      index: 1,
      of: 3,
      passes: 1,
      pointer: `talk-call:${CALL}#s`,
      text: "b".repeat(UNREAD_PART_BYTES),
    });
  });

  it("prints the part after those a mark recorded, and the last one moves the frontier past the line", () => {
    const start = { offset: 40, part: { lineSha256: "sha256:line", printed: 2 }, prefixSha256: "sha256:p" };
    const part = nextPart({ read: readOf({ tails: [tailWith({ start, text })] }) })!;

    expect([part.index, part.of, part.byteOffset, part.text, part.frontier]).toEqual([3, 3, 40, "bbbbb", AFTER]);
  });

  it("skips a call with no unread line, and has nothing for a read with none", () => {
    const empty: CallTail = {
      callId: OTHER,
      endedBefore: false,
      finalBefore: [],
      lines: [],
      originBefore: undefined,
      relaysBefore: [],
      seenOriginBefore: new Map(),
      seenBefore: [],
      start: undefined,
    };

    expect(nextPart({ read: readOf({ tails: [empty, tailWith({ start: undefined, text })] }) })!.callId).toBe(CALL);
    expect(nextPart({ read: readOf({ tails: [empty] }) })).toBe(undefined);
  });
});

describe("nextPart over a stretch the call wrote as many growing snapshots", () => {
  const newest = growing({ words: 1200 });
  const grown = tailOf({
    entries: [
      snapshot({ id: "a", text: growing({ words: 1000 }) }),
      tool,
      snapshot({ id: "a", text: growing({ words: 1100 }) }),
      tool,
      snapshot({ final: true, id: "a", text: newest }),
      snapshot({ final: true, id: "b", text: "Cool" }),
    ],
  });

  it("prints the newest snapshot in place of every one it continues, bound to that line's own offset", () => {
    const part = nextPart({ read: readOf({ tails: [grown] }) })!;

    expect([part.index, part.of, part.passes, part.text]).toEqual([1, 2, 5, partsOf({ text: newest })[0]]);
    expect(part.frontier).toEqual({
      offset: 0,
      part: { lineOffset: 400, lineSha256: "sha256:line-4", printed: 1 },
      prefixSha256: EMPTY,
    });
  });

  it("moves its last part's mark past every snapshot and every unprinted line it stands for, and no further", () => {
    const start: CallFrontier = {
      offset: 0,
      part: { lineOffset: 400, lineSha256: "sha256:line-4", printed: 1 },
      prefixSha256: EMPTY,
    };
    const part = nextPart({ read: readOf({ tails: [{ ...grown, start }] }) })!;

    expect([part.index, part.of, part.text]).toEqual([2, 2, partsOf({ text: newest })[1]]);
    expect(part.frontier).toEqual({ offset: 500, prefixSha256: "sha256:through-4" });
  });

  it("goes on with the line a begun run named, though a newer snapshot landed since", () => {
    const start: CallFrontier = {
      offset: 0,
      part: { lineOffset: 100, lineSha256: "sha256:line-1", printed: 1 },
      prefixSha256: EMPTY,
    };
    const begun = growing({ words: 1100 });
    const tail = tailOf({
      entries: [
        snapshot({ id: "a", text: growing({ words: 1000 }) }),
        snapshot({ id: "a", text: begun }),
        snapshot({ id: "a", text: newest }),
      ],
      start,
    });
    const part = nextPart({ read: readOf({ tails: [tail] }) })!;

    expect([part.index, part.text, part.passes]).toEqual([2, partsOf({ text: begun })[1], 2]);
    expect(part.frontier).toEqual({ offset: 200, prefixSha256: "sha256:through-1" });
  });

  it("passes a later partial the newest snapshot prints — a partial overtaken in flight by its final", () => {
    const tail = tailOf({
      entries: [
        snapshot({ id: "a", text: growing({ words: 1000 }) }),
        snapshot({ final: true, id: "a", text: growing({ words: 1100 }) }),
        snapshot({ id: "a", text: growing({ words: 1050 }) }),
      ],
    });
    const part = nextPart({ read: readOf({ tails: [tail] }) })!;

    expect([part.passes, part.frontier.part!.lineOffset]).toEqual([3, 100]);
  });

  it.each([
    ["another stretch", snapshot({ final: true, id: "b", text: "Cool" })],
    ["a snapshot it does not continue", snapshot({ id: "a", text: `revised ${growing({ words: 1100 })}` })],
  ])("stops at %s, which the next batch prints", (_label, between) => {
    const tail = tailOf({
      entries: [snapshot({ id: "a", text: growing({ words: 1000 }) }), between, snapshot({ id: "a", text: newest })],
    });
    const part = nextPart({ read: readOf({ tails: [tail] }) })!;

    expect([part.passes, part.frontier.part]).toEqual([1, { lineSha256: "sha256:line-0", printed: 1 }]);
  });
});

describe("coverEnd", () => {
  const lines = tailOf({
    entries: [
      snapshot({ id: "a", text: growing({ words: 10 }) }),
      snapshot({ final: true, id: "b", text: "Cool" }),
      snapshot({ id: "a", text: growing({ words: 20 }) }),
    ],
  }).lines;

  it("refuses a cover that does not print a stretch of the owner's before it", () => {
    expect(coverEnd({ cover: 2, lines })).toBe(undefined);
  });

  it("passes only the first line for a cover there, when the next stretch is another", () => {
    expect(coverEnd({ cover: 0, lines })).toBe(0);
  });
});
