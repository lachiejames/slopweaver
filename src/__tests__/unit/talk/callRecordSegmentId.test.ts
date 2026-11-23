/*
 * A call record's segment id is the anchor a talk-call pointer carries, so a line is admitted only with an id that
 * pointer can hold.
 */
import { describe, expect, it } from "vitest";

import { type CallEntry, callEntryOf, OWNER_SPEAKER } from "../../../talk/callRecord.js";

/** One final segment line from the owner, carrying `id`. */
const segmentWithId = ({ id }: { id: string }): CallEntry => ({
  atIso: "2026-09-25T02:21:00.000Z",
  final: true,
  id,
  kind: "segment",
  text: "look at the staging pool",
  who: OWNER_SPEAKER,
});

describe("a segment line's id", () => {
  it("admits exactly the segment ids a talk-call pointer can carry, its bound counted in code points", () => {
    const admitted = [
      "segment_0_163",
      "typed-owner-message_1",
      "typed-in-message_1",
      "typed-item_1",
      "a:b,c%d",
      "\u{1D41A}".repeat(200),
    ];
    const refused = [
      "",
      "s 1",
      "a#b",
      "a\tb",
      "a\nb",
      `a${String.fromCodePoint(0xa0)}b`,
      `a${String.fromCodePoint(0x2028)}b`,
      "\u{1D41A}".repeat(201),
    ];

    expect(
      admitted.map(
        (id) => (callEntryOf({ value: segmentWithId({ id }) }) as Extract<CallEntry, { kind: "segment" }>).id,
      ),
    ).toEqual(admitted);
    expect(refused.map((id) => callEntryOf({ value: segmentWithId({ id }) }))).toEqual(refused.map(() => undefined));
  });
});
