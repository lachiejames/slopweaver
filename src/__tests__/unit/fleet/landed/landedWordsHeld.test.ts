/*
 * `landedWordsOf` on the words a row holds and the owner's rulings on it — the stored quote, the ruling it falls to, and every
 * way a ruling cannot be placed before the merge or quoted as the owner's.
 */
import { describe, expect, it } from "vitest";

import type { LandedRow, LandedWordsAt } from "../../../../fleet/landedTypes.js";
import { landedWordsOf } from "../../../../fleet/landedWords.js";
import { HisWordsErrors } from "../../../../handover/hisWordsErrors.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { err } from "../../../../lib/result.js";
import { HEARD, HELD, heardAt, MERGED, readsOf, rowOf, rulingOf } from "./harness.js";

describe("landedWordsOf", () => {
  it("quotes the words the row holds, with where and how they were cut", () => {
    const row = rowOf({ extra: HELD, slug: "x" });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      anchor: "talk-call:7a9be0d5#turn_A",
      atIso: "2026-10-05T03:01:21.246Z",
      cut: "end",
      kind: "asked",
      where: "call",
      words: "what has landed since I last looked",
    });
  });

  it("falls to the owner's ruling when the row stores no quote and they ruled in their own words before it landed", () => {
    const events = [rulingOf({ anchor: "talk-call:abc#turn_B", decidedIso: "2026-10-05T01:29:00.000Z" })];
    const row: LandedRow = { ...rowOf({ extra: "", slug: "x" }), events };
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      anchor: "talk-call:abc#turn_B",
      atIso: "2026-10-05T01:28:00.000Z",
      cut: "none",
      decidedIso: "2026-10-05T01:29:00.000Z",
      kind: "ruling",
      recorded: "go with A",
      where: "call",
      words: "Um, yeah, let's go with A.",
    });
  });

  it("says the owner's ruling's words would not read, rather than quoting the session's record of them", () => {
    const events = [rulingOf({ anchor: "talk-call:abc#turn_B", decidedIso: "2026-10-05T01:29:00.000Z" })];
    const row: LandedRow = { ...rowOf({ extra: "", slug: "x" }), events };
    const gone: LandedWordsAt = ({ anchor }) => err(HisWordsErrors.recordMissing({ anchor, what: "no such stretch" }));
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: readsOf({ wordsAt: gone }) })).toEqual({
      kind: "unread",
      why: "you ruled on this row at talk-call:abc#turn_B, and your words there would not read: talk-call:abc#turn_B: no such stretch",
    });
  });

  it("places a front-matter ruling, which carries no decision instant, by its record's instant", () => {
    const row = rowOf({ extra: 'ruling: "go with A"\nrulingAnchor: "talk-call:abc#turn_B"\n', slug: "x" });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      anchor: "talk-call:abc#turn_B",
      atIso: "2026-10-05T01:28:00.000Z",
      cut: "none",
      decidedIso: undefined,
      kind: "ruling",
      recorded: "go with A",
      where: "call",
      words: "Um, yeah, let's go with A.",
    });
    const later = heardAt({ atIso: "2026-10-05T03:00:00.000Z" });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: later })).toEqual({
      kind: "unread",
      why: "your ruling on this row (talk-call:abc#turn_B) carries no instant it was decided, and its record dates from 2026-10-05T03:00:00.000Z, after the change landed, so it cannot be placed before it",
    });
  });

  it("never places a journal ruling whose instants will not parse before the merge on that alone", () => {
    const event: RunEvent = { anchor: "talk-call:abc#turn_B", atIso: "garbled", kind: "ruling", ruling: "go with A" };
    const row: LandedRow = { ...rowOf({ extra: "", slug: "x" }), events: [event] };
    const later = heardAt({ atIso: "2026-10-05T03:00:00.000Z" });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: later })).toEqual({
      kind: "unread",
      why: "your ruling on this row (talk-call:abc#turn_B) carries no instant it was decided, and its record dates from 2026-10-05T03:00:00.000Z, after the change landed, so it cannot be placed before it",
    });
  });

  it("never reads a ruling given after the change landed as the words behind it", () => {
    const events = [rulingOf({ anchor: "talk-call:abc#turn_C", decidedIso: "2026-10-05T04:00:00.000Z" })];
    const row: LandedRow = { ...rowOf({ extra: "origin: finding\nobservedBy: sess-9\n", slug: "x" }), events };
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      kind: "unasked",
      why: "a fleet finding observed by session sess-9",
    });
  });

  it("says the owner ruled, rather than reading unasked, when the ruling's anchor is not a record of their words", () => {
    const events = [rulingOf({ anchor: "owner turn 291-12", decidedIso: "2026-10-05T01:29:00.000Z" })];
    const row: LandedRow = { ...rowOf({ extra: "", slug: "x" }), events };
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      kind: "unread",
      why: "you ruled on this row at owner turn 291-12, which is not a record of your own words, so the ruling is not quoted",
    });
  });

  it("never quotes a ruling the backfill reconstructed from an answer", () => {
    const events = [
      rulingOf({
        anchor: "transcript:s#t",
        backfilledFrom: "2026-10-01T00:00:00.000Z",
        decidedIso: "2026-10-05T01:29:00.000Z",
      }),
    ];
    const row: LandedRow = { ...rowOf({ extra: "", slug: "x" }), events };
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      kind: "unread",
      why: "your ruling on this row (transcript:s#t) was reconstructed from an answer by the backfill, so its words are not quoted as yours",
    });
  });

  it("says a journal line it could not decode may hide a ruling, rather than reading the rest", () => {
    const events = [rulingOf({ anchor: "talk-call:abc#turn_B", decidedIso: "2026-10-05T01:29:00.000Z" })];
    const row: LandedRow = { ...rowOf({ extra: "", slug: "x" }), events, undecoded: 2 };
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row, reads: HEARD })).toEqual({
      kind: "unread",
      why: "2 line(s) of the row's run journal do not decode in this checkout, and a ruling of yours may be among them",
    });
  });
});
