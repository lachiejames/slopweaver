/*
 * `landedWordsOf` when a row carries no words to quote — an ask with no anchor, a fleet finding, an anchor that is not
 * a record of the owner's words or stores no quote of them — and when no row joins at all.
 */
import { describe, expect, it } from "vitest";

import { landedWordsOf } from "../../../../fleet/landedWords.js";
import { HEARD, MERGED, rowOf } from "./harness.js";

describe("landedWordsOf", () => {
  it("never calls an ask with no anchor unasked, since an ask of the owner's may sit behind it", () => {
    const row = rowOf({ extra: "registeredBy: sess-4\n", slug: "x" });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      kind: "unread",
      why: "this ask row (registered by session sess-4) is not a fleet finding and records no anchor, so any words of yours behind it cannot be shown",
    });
  });

  it("calls a fleet finding unasked, naming who observed it", () => {
    const row = rowOf({ extra: "origin: finding\nobservedBy: sess-9\n", slug: "x" });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      kind: "unasked",
      why: "a fleet finding observed by session sess-9",
    });
  });

  it("points elsewhere when the row's anchor is not a record of the owner's words", () => {
    const row = rowOf({ extra: 'anchor: "https://github.com/o/r/pull/1"\n', slug: "x" });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      anchor: "https://github.com/o/r/pull/1",
      kind: "elsewhere",
    });
  });

  it("says the owner's words are unread when the anchor names them and no quote is stored", () => {
    const row = rowOf({ extra: 'anchor: "talk:abc"\n', slug: "x" });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      kind: "unread",
      why: "the row names your words at talk:abc and stores no quote of them",
    });
  });

  it("says no row was found, naming the branch it looked for", () => {
    expect(
      landedWordsOf({ branch: "the-console-voice", mergedIso: MERGED, row: { kind: "absent" }, reads: HEARD }),
    ).toEqual({
      kind: "not-joined",
      why: "no board row is named the-console-voice, live or archived",
    });
  });

  it("says a branch that cannot be a slug was never looked up, rather than that no row has its name", () => {
    expect(
      landedWordsOf({ branch: "renovate/x", mergedIso: MERGED, row: { kind: "not-a-slug" }, reads: HEARD }),
    ).toEqual({
      kind: "not-joined",
      why: "the branch renovate/x is not a shape a board row's slug can take",
    });
  });
});
