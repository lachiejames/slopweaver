/**
 * The live cut of a parked draft — where a dropped draft's re-cut chain ends. The two-note chain is the fixture:
 * `sd-2a84c6d4` re-cut as `sd-1cdf3a4c`, that one superseded by `sd-19bcb871`, which was sent.
 */
import { describe, expect, it } from "vitest";

import { draftSuccessor, dropNoteIds, liveCutOf } from "../../../../outbound/slack/draftLiveCut.js";

const CHAIN = [
  {
    id: "sd-2a84c6d4",
    outcome: "re-cut as sd-1cdf3a4c in the 28 Sep finding shape: impact high, three screenshots",
    state: "dropped",
  },
  {
    id: "sd-1cdf3a4c",
    outcome: "superseded by sd-19bcb871, sent to #defects p1790604264247109 with the priority reason",
    state: "dropped",
  },
  { id: "sd-19bcb871", outcome: "C0SYN000003 1790604264.247109", state: "released" },
  { id: "sd-aaaaaaaa", state: "held" },
  { id: "sd-bbbbbbbb", outcome: "moot: Rosa approved all three", state: "dropped" },
  { id: "sd-cccccccc", outcome: "superseded by sd-99999999, which was never recorded here", state: "dropped" },
  { id: "sd-dddddddd", outcome: "sd-dddddddd was a typo; re-recorded as sd-aaaaaaaa", state: "dropped" },
  { id: "sd-eeeeeeee", outcome: "duplicate of sd-ffffffff", state: "dropped" },
  { id: "sd-ffffffff", outcome: "duplicate of sd-eeeeeeee", state: "dropped" },
  { id: "sd-12345678", outcome: "superseded by sd-aaaaaaaa9 and xsd-aaaaaaaa", state: "dropped" },
];

describe("liveCutOf", () => {
  it("follows the two-note chain through two drop notes to the cut that was sent", () => {
    const cut = liveCutOf({ id: "sd-2a84c6d4", items: CHAIN })!;
    expect(cut.live.id).toBe("sd-19bcb871");
    expect(cut.superseded.map((row) => row.id)).toEqual(["sd-2a84c6d4", "sd-1cdf3a4c"]);
  });

  it("answers a held draft as its own live cut, with nothing superseded", () => {
    const cut = liveCutOf({ id: "sd-aaaaaaaa", items: CHAIN })!;
    expect(cut.live.id).toBe("sd-aaaaaaaa");
    expect(cut.superseded).toEqual([]);
  });

  it("answers a dropped draft whose note names no draft as its own live cut", () => {
    const cut = liveCutOf({ id: "sd-bbbbbbbb", items: CHAIN })!;
    expect(cut.live.id).toBe("sd-bbbbbbbb");
    expect(cut.superseded).toEqual([]);
  });

  it("does not follow a note to an id the register does not hold", () => {
    expect(liveCutOf({ id: "sd-cccccccc", items: CHAIN })!.live.id).toBe("sd-cccccccc");
  });

  it("skips the row's own id in its note and follows the next one", () => {
    const cut = liveCutOf({ id: "sd-dddddddd", items: CHAIN })!;
    expect(cut.live.id).toBe("sd-aaaaaaaa");
    expect(cut.superseded.map((row) => row.id)).toEqual(["sd-dddddddd"]);
  });

  it("stops a looping chain at the row that would revisit one already passed", () => {
    const cut = liveCutOf({ id: "sd-eeeeeeee", items: CHAIN })!;
    expect(cut.live.id).toBe("sd-ffffffff");
    expect(cut.superseded.map((row) => row.id)).toEqual(["sd-eeeeeeee"]);
  });

  it("reads only a whole minted id in a note, never one embedded in a longer token", () => {
    expect(liveCutOf({ id: "sd-12345678", items: CHAIN })!.live.id).toBe("sd-12345678");
  });

  it("answers undefined for an id the register does not hold", () => {
    expect(liveCutOf({ id: "sd-00000000", items: CHAIN })).toBeUndefined();
  });
});

describe("draftSuccessor", () => {
  it("gives a released row no successor, whatever its outcome says", () => {
    const released = { id: "sd-19bcb871", outcome: "re-cut as sd-aaaaaaaa", state: "released" };
    expect(draftSuccessor({ items: [...CHAIN, released], row: released })).toBeUndefined();
  });

  it("gives a dropped row with no note no successor", () => {
    const bare = { id: "sd-77777777", state: "dropped" };
    expect(draftSuccessor({ items: [...CHAIN, bare], row: bare })).toBeUndefined();
  });
});

describe("dropNoteIds", () => {
  it("names every other whole id a drop note carries, held by the register or not", () => {
    expect(dropNoteIds({ row: CHAIN[5]! })).toEqual(["sd-99999999"]);
    expect(dropNoteIds({ row: CHAIN[6]! })).toEqual(["sd-aaaaaaaa"]);
  });

  it("names nothing for a row that is not dropped, a moot note, or welded ids", () => {
    expect(dropNoteIds({ row: { id: "sd-19bcb871", outcome: "re-cut as sd-aaaaaaaa", state: "released" } })).toEqual(
      [],
    );
    expect(dropNoteIds({ row: CHAIN[4]! })).toEqual([]);
    expect(dropNoteIds({ row: CHAIN[9]! })).toEqual([]);
  });
});
