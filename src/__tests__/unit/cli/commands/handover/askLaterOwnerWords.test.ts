/**
 * `handover ask`'s later-owner-words shell: the `--read-owner-words` list as parsed, and the refusal a board that
 * could not be scanned at all earns on a row holding the owner's words — an empty board proves nothing.
 */
import { describe, expect, it } from "vitest";

import { laterOwnerWordsRefusal, readOwnerWordsOf } from "../../../../../cli/commands/handover/askLaterOwnerWords.js";
import type { HandoverDoc } from "../../../../../handover/doc.js";
import { doc } from "../../../handover/doc/harness.js";

/** A row holding the owner's words, recorded at a fixed instant. */
const HELD: HandoverDoc = {
  ...doc({ slug: "talk-aaaaaaaaaaaa" }),
  hisWords: {
    hisWords: {
      anchor: "talk:aaaa",
      atIso: "2026-11-09T03:08:49.222Z",
      cut: "none",
      where: "console-voice",
      words: "bring me one set",
    },
    kind: "held",
  },
  kind: "ask",
};

describe("readOwnerWordsOf", () => {
  it("splits the comma list, trimming each slug and dropping empties", () => {
    const parsed = { positionals: [], values: { "read-owner-words": " talk-aaaaaaaaaaaa,,talk-bbbbbbbbbbbb " } };
    expect(readOwnerWordsOf({ parsed })).toEqual(["talk-aaaaaaaaaaaa", "talk-bbbbbbbbbbbb"]);
  });

  it("is empty when the flag is absent", () => {
    expect(readOwnerWordsOf({ parsed: { positionals: [], values: {} } })).toEqual([]);
  });
});

describe("laterOwnerWordsRefusal", () => {
  it("refuses a row holding the owner's words when the board scan failed outright", () => {
    expect(
      laterOwnerWordsRefusal({ doc: HELD, gaps: { failed: "ENOENT", unreadable: [] }, read: [], rows: [] }),
    ).toEqual([
      "handover ask: cannot read the board to list the owner's later words before the write: ENOENT",
      "NOTHING was recorded. Fix the board directory, then ask again.",
    ]);
  });

  it("lets a row with no words of the owner through a failed scan, since it has no instant to measure from", () => {
    expect(
      laterOwnerWordsRefusal({
        doc: doc({ slug: "plain" }),
        gaps: { failed: "ENOENT", unreadable: [] },
        read: [],
        rows: [],
      }),
    ).toBe(undefined);
  });

  it("is undefined over a whole board holding no later words", () => {
    expect(
      laterOwnerWordsRefusal({ doc: HELD, gaps: { failed: undefined, unreadable: [] }, read: [], rows: [HELD] }),
    ).toBe(undefined);
  });
});
