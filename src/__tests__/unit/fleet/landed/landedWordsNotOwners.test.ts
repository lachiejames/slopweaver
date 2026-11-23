/*
 * `landedWordsOf` never quoting as the owner's words what someone or something else typed — a voice relay, the chair's quiet
 * batch, a relay inside a paste wrapper, a turn typed outside the chair — whether the row stored it or the owner ruled at
 * it.
 */
import { describe, expect, it } from "vitest";

import type { LandedOutsideChair, LandedRow, LandedWordsAt } from "../../../../fleet/landedTypes.js";
import { landedWordsOf } from "../../../../fleet/landedWords.js";
import { ok } from "../../../../lib/result.js";
import { chairBatchLine } from "../../../../talk/chairBatchLine.js";
import { HEARD, MERGED, readsOf, rowOf, rulingOf } from "./harness.js";

describe("landedWordsOf", () => {
  it("never quotes a voice relay the console typed into a session as the owner's words, stored or ruled", () => {
    const relayed =
      '[voice relay talk-0757df532003] the owner said: "Yeah, cool" — act only if their words are a steer';
    const stored = rowOf({
      extra: `anchor: "transcript:s#t"\nownerWords: ${JSON.stringify(relayed)}\nownerWordsAnchor: "transcript:s#t"\nownerWordsIso: "2026-10-05T01:00:00.000Z"\nownerWordsWhere: "session"\nownerWordsCut: "none"\n`,
      slug: "x",
    });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row: stored, reads: HEARD })).toEqual({
      kind: "unread",
      why: "the quote stored on the row is the voice relay talk-0757df532003 typed into a session, in the relay's words rather than yours — yours are on that relay's row",
    });
    const events = [rulingOf({ anchor: "transcript:s#t", decidedIso: "2026-10-05T01:29:00.000Z" })];
    const ruled: LandedRow = { ...rowOf({ extra: "", slug: "x" }), events };
    const relayAt: LandedWordsAt = ({ anchor }) =>
      ok({ anchor, atIso: "2026-10-05T01:28:00.000Z", cut: "none", where: "session", words: relayed });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row: ruled, reads: readsOf({ wordsAt: relayAt }) })).toEqual(
      {
        kind: "unread",
        why: "you ruled on this row at transcript:s#t, but the record there is the voice relay talk-0757df532003 typed into a session, in the relay's words rather than yours — yours are on that relay's row",
      },
    );
  });

  it("never quotes the chair's quiet batch as the owner's words", () => {
    const batch = chairBatchLine({
      anchors: [{ kind: "stretch", pointer: "talk-call:a0000035-0000-4000-8000-000000000038#s1" }],
    });
    const stored = rowOf({
      extra: `anchor: "transcript:s#t"\nownerWords: ${JSON.stringify(batch)}\nownerWordsAnchor: "transcript:s#t"\nownerWordsIso: "2026-10-05T01:00:00.000Z"\nownerWordsWhere: "session"\nownerWordsCut: "none"\n`,
      slug: "x",
    });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row: stored, reads: HEARD })).toEqual({
      kind: "unread",
      why: "the quote stored on the row is the chair's quiet batch the console typed, which carries none of your words — yours are in the calls and relays it names",
    });
  });

  it("sees a relay through a paste wrapper whose quoted attribute carries a >", () => {
    const relayed = '<pasted_content id="a>b"> [voice relay talk-0757df532003] the owner said: "Yeah, cool"';
    const stored = rowOf({
      extra: `anchor: "transcript:s#t"\nownerWords: ${JSON.stringify(relayed)}\nownerWordsAnchor: "transcript:s#t"\nownerWordsIso: "2026-10-05T01:00:00.000Z"\nownerWordsWhere: "session"\nownerWordsCut: "none"\n`,
      slug: "x",
    });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, row: stored, reads: HEARD })).toEqual({
      kind: "unread",
      why: "the quote stored on the row is the voice relay talk-0757df532003 typed into a session, in the relay's words rather than yours — yours are on that relay's row",
    });
  });

  it("never quotes a turn typed into a session outside the chair as the owner's words, stored or ruled", () => {
    const outsideChair: LandedOutsideChair = ({ anchor, atIso }) =>
      anchor === "transcript:s#t" && atIso === "2026-10-05T01:00:00.000Z"
        ? "transcript:s#t was typed while that session did not hold the supervisor pin"
        : undefined;
    const stored = rowOf({
      extra: `anchor: "transcript:s#t"\nownerWords: "Read the handover end to end, then run: slopweaver handover start x"\nownerWordsAnchor: "transcript:s#t"\nownerWordsIso: "2026-10-05T01:00:00.000Z"\nownerWordsWhere: "session"\nownerWordsCut: "none"\n`,
      slug: "x",
    });
    expect(landedWordsOf({ branch: "x", mergedIso: MERGED, reads: { ...HEARD, outsideChair }, row: stored })).toEqual({
      kind: "unread",
      why: "the quote stored on the row is not read as yours: transcript:s#t was typed while that session did not hold the supervisor pin",
    });
    const events = [rulingOf({ anchor: "transcript:s#t", decidedIso: "2026-10-05T01:29:00.000Z" })];
    const ruled: LandedRow = { ...rowOf({ extra: "", slug: "x" }), events };
    const sessionAt: LandedWordsAt = ({ anchor }) =>
      ok({ anchor, atIso: "2026-10-05T01:00:00.000Z", cut: "none", where: "session", words: "go with A" });
    expect(
      landedWordsOf({ branch: "x", mergedIso: MERGED, reads: { outsideChair, wordsAt: sessionAt }, row: ruled }),
    ).toEqual({
      kind: "unread",
      why: "you ruled on this row at transcript:s#t, but the record there is not read as yours: transcript:s#t was typed while that session did not hold the supervisor pin",
    });
  });
});
