/**
 * How much of a read one `talk unread` batch takes: the longest prefix of whole lines whose report fits, found by
 * asking the caller's own measure — so what fits is exactly what the caller would print, never an estimate of it.
 */
import { describe, expect, it } from "vitest";

import type { CallEntry } from "../../../talk/callRecord.js";
import { batchOf, lineCount, readThrough } from "../../../talk/unreadBatch.js";
import type { CallTail, TailLine, UnreadRead } from "../../../talk/unreadWords.js";

const CALL = "a0000035-0000-4000-8000-000000000038";
const OTHER = "a0000041-0000-4000-8000-000000000044";

const spoken = ({ id, text }: { id: string; text: string }) =>
  ({ atIso: "2026-09-26T05:00:00.000Z", final: true, id, kind: "segment", text, who: "owner" }) satisfies CallEntry;

/** One call's tail, each line's frontier its index past `from`, and the reader starting at `from`. */
const tail = ({ callId, texts, from }: { callId: string; texts: readonly string[]; from: number }): CallTail => ({
  callId,
  endedBefore: false,
  finalBefore: [],
  lines: texts.map((text, index) => ({
    after: { offset: from + index + 1, prefixSha256: `sha256:${String(from + index + 1)}` },
    entry: spoken({ id: `${callId}-${String(index)}`, text }),
    kind: "entry",
    sha256: `sha256:line-${String(index)}`,
  })),
  originBefore: undefined,
  relaysBefore: [],
  seenOriginBefore: new Map(),
  seenBefore: [],
  start: from === 0 ? undefined : { offset: from, prefixSha256: `sha256:${String(from)}` },
});

const readOf = ({ tails }: { tails: readonly CallTail[] }): UnreadRead => ({
  bootstrapFloorIso: undefined,
  cursor: { calls: {}, recordedAtIso: "2026-09-26T04:00:00.000Z" },
  quarantined: [],
  tails,
});

/** One line's text: a segment's words, an unparseable line whole. */
const textOf = ({ line }: { line: TailLine }): string => {
  if (line.kind === "unparseable") {
    return line.line.text;
  }
  return line.entry.kind === "segment" ? line.entry.text : "";
};

/** The texts a read holds, in order — what a report of it would print. */
const textsOf = ({ read }: { read: UnreadRead }): readonly string[] =>
  read.tails.flatMap((one) => one.lines.map((line) => textOf({ line })));

/** A measure that fits a read whose texts total at most `limit` characters. */
const fitsWithin =
  ({ limit }: { limit: number }) =>
  (candidate: UnreadRead): boolean =>
    textsOf({ read: candidate }).join("").length <= limit;

const READ = readOf({
  tails: [tail({ callId: CALL, from: 10, texts: ["aaaa", "bbbb"] }), tail({ callId: OTHER, from: 0, texts: ["cccc"] })],
});

describe("readThrough and lineCount", () => {
  it("counts every line across calls and cuts after the first N, calls in order", () => {
    expect(lineCount({ read: READ })).toBe(3);
    expect(textsOf({ read: readThrough({ read: READ, take: 3 }) })).toEqual(["aaaa", "bbbb", "cccc"]);
    expect(textsOf({ read: readThrough({ read: READ, take: 1 }) })).toEqual(["aaaa"]);
    expect(readThrough({ read: READ, take: 1 }).tails.map((one) => one.lines.length)).toEqual([1, 0]);
    expect(lineCount({ read: readThrough({ read: READ, take: 0 }) })).toBe(0);
  });
});

describe("batchOf", () => {
  it("takes the whole read when it fits, and says nothing remains", () => {
    expect(batchOf({ fits: fitsWithin({ limit: 12 }), read: READ })).toEqual({
      more: false,
      oversized: false,
      read: READ,
    });
  });

  it("takes the longest prefix that fits, across a call boundary, and says more remains", () => {
    const batch = batchOf({ fits: fitsWithin({ limit: 11 }), read: READ });

    expect(textsOf({ read: batch.read })).toEqual(["aaaa", "bbbb"]);
    expect(batch.more).toBe(true);
    expect(batch.oversized).toBe(false);
  });

  it("keeps exactly the lines that fit when one line alone is far larger than the rest", () => {
    const read = readOf({ tails: [tail({ callId: CALL, from: 0, texts: ["a", "b", "x".repeat(1000), "c"] })] });
    const batch = batchOf({ fits: fitsWithin({ limit: 100 }), read });

    expect(textsOf({ read: batch.read })).toEqual(["a", "b"]);
    expect(batch.more).toBe(true);
  });

  it("says the first line is oversized, and takes nothing, when even it alone does not fit", () => {
    expect(batchOf({ fits: fitsWithin({ limit: 3 }), read: READ })).toEqual({
      more: true,
      oversized: true,
      read: readThrough({ read: READ, take: 0 }),
    });
  });
});
