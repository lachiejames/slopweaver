/**
 * The narrowing a turn file passes through on every read: a known shape becomes a record, anything else
 * becomes nothing, and a record written before a field existed reads as having carried none of it.
 */
import { describe, expect, it } from "vitest";

import { asTurnRecord } from "../../../talk/turnRecordShape.js";

const TURN = "a0000017-0000-4000-8000-000000000019";

const stored = {
  anchor: `talk:${TURN}`,
  delivery: null,
  digest: "d",
  registeredAtIso: null,
  slug: "talk-a00000170000",
  stagedAtIso: "2026-09-24T00:00:00.000Z",
  state: "registering",
  turnId: TURN,
  words: "look",
};

describe("asTurnRecord", () => {
  it("reads every turn state, a registering one included", () => {
    const states = ["intended", "registering", "registered"].map(
      (state) => asTurnRecord({ value: { ...stored, state } })!.state,
    );
    expect(states).toEqual(["intended", "registering", "registered"]);
  });

  it("refuses a state it does not know, and a value that is not an object", () => {
    expect([asTurnRecord({ value: { ...stored, state: "adopted" } }), asTurnRecord({ value: "turn" })]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("reads a record written before words-alone retries as not one, and a stored one as one", () => {
    expect([
      asTurnRecord({ value: stored })!.wordsAlone,
      asTurnRecord({ value: { ...stored, wordsAlone: true } })!.wordsAlone,
    ]).toEqual([false, true]);
  });

  it("reads a record written before typed steers as spoken, and a stored typed one as typed", () => {
    expect([
      asTurnRecord({ value: stored })!.typed,
      asTurnRecord({ value: { ...stored, typed: true } })!.typed,
    ]).toEqual([false, true]);
  });

  it("reads whether the relay kept only the tail of what was heard, and leaves an older record's unknown", () => {
    expect([
      asTurnRecord({ value: stored })!.heardTruncated,
      asTurnRecord({ value: { ...stored, heardTruncated: true } })!.heardTruncated,
      asTurnRecord({ value: { ...stored, heardTruncated: "yes" } })!.heardTruncated,
    ]).toEqual([undefined, true, undefined]);
  });

  it("reads a typed steer's missing image as not attached", () => {
    expect(asTurnRecord({ value: { ...stored, picture: { kind: "none", reason: "not-attached" } } })!.picture).toEqual({
      kind: "none",
      reason: "not-attached",
    });
  });

  it("reads a record written before pictures as carrying none, and why", () => {
    expect(asTurnRecord({ value: stored })!.picture).toEqual({ kind: "none", reason: "predates-pictures" });
  });

  it("reads a stored copy-tray offer whole, and a record written before offers as carrying none", () => {
    const offered = { belowFold: "rest", id: "offer-2", label: "reply", made: "2", text: "Merged" };
    expect([
      asTurnRecord({ value: { ...stored, offered } })!.offered,
      asTurnRecord({ value: stored })!.offered,
    ]).toStrictEqual([offered, undefined]);
  });

  it("reads a stored triage ruling whole, null as none, and a record written before rulings as unknown", () => {
    const triageRuling = { feedback: "no-receipts", verdict: "needs-more-info" };
    const labelled = { label: "action-now", verdict: "send-it" };
    expect([
      asTurnRecord({ value: { ...stored, triageRuling } })!.triageRuling,
      asTurnRecord({ value: { ...stored, triageRuling: labelled } })!.triageRuling,
      asTurnRecord({ value: { ...stored, triageRuling: null } })!.triageRuling,
      "triageRuling" in asTurnRecord({ value: stored })!,
    ]).toEqual([{ ...triageRuling, label: undefined }, labelled, null, false]);
  });

  it("refuses the whole record when its triage ruling is there and malformed, rather than dropping the class", () => {
    expect([
      asTurnRecord({ value: { ...stored, triageRuling: { verdict: "maybe" } } }),
      asTurnRecord({ value: { ...stored, triageRuling: { label: "someday", verdict: "send-it" } } }),
      asTurnRecord({ value: { ...stored, triageRuling: { feedback: "no-receipts", verdict: "send-it" } } }),
      asTurnRecord({ value: { ...stored, triageRuling: { feedback: "too-long", verdict: "rewrite" } } }),
      asTurnRecord({ value: { ...stored, triageRuling: { mood: "cross", verdict: "rewrite" } } }),
      asTurnRecord({ value: { ...stored, triageRuling: "rewrite" } }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("reads a stored discuss-first record whole, null as none, and a record written before it as unknown", () => {
    const put = { repository: "acme/acme-admin", status: "put" };
    const override = { ...put, priorTurnId: TURN, status: "override" };
    expect([
      asTurnRecord({ value: { ...stored, discussFirst: put } })!.discussFirst,
      asTurnRecord({ value: { ...stored, discussFirst: override } })!.discussFirst,
      asTurnRecord({ value: { ...stored, discussFirst: null } })!.discussFirst,
      "discussFirst" in asTurnRecord({ value: stored })!,
    ]).toEqual([{ ...put, thread: undefined }, { ...override, thread: undefined }, null, false]);
  });

  // Read as none, a damaged record would let an answer's check fall through to a question that was never put.
  it("refuses the whole record when its discuss-first record is there and malformed", () => {
    const put = { repository: "acme/acme-admin", status: "put" };
    expect([
      asTurnRecord({ value: { ...stored, discussFirst: { ...put, status: "maybe" } } }),
      asTurnRecord({ value: { ...stored, discussFirst: { ...put, repository: "acme/acme-admin.git" } } }),
      asTurnRecord({ value: { ...stored, discussFirst: { ...put, priorTurnId: TURN } } }),
      asTurnRecord({ value: { ...stored, discussFirst: { ...put, mood: "cross" } } }),
      asTurnRecord({ value: { ...stored, discussFirst: { ...put, thread: 3 } } }),
      asTurnRecord({ value: { ...stored, discussFirst: "put" } }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("reads stored also-answered cards in order, and a record written before them as naming none it stored", () => {
    expect([
      asTurnRecord({ value: { ...stored, alsoAnswers: ["pr:42", "ask:split-files"] } })!.alsoAnswers,
      asTurnRecord({ value: { ...stored, alsoAnswers: [] } })!.alsoAnswers,
      "alsoAnswers" in asTurnRecord({ value: stored })!,
    ]).toEqual([["pr:42", "ask:split-files"], [], false]);
  });

  // Read as none, a damaged list would let a replay's targets go unaudited.
  it("refuses the whole record when its also-answered cards are there and malformed", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((id) => `ask:${id}`);
    expect([
      asTurnRecord({ value: { ...stored, alsoAnswers: "pr:42" } }),
      asTurnRecord({ value: { ...stored, alsoAnswers: ["split files"] } }),
      asTurnRecord({ value: { ...stored, alsoAnswers: [42] } }),
      asTurnRecord({ value: { ...stored, alsoAnswers: six } }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("refuses the whole record when its offer is there and malformed, rather than dropping the offer", () => {
    expect([
      asTurnRecord({ value: { ...stored, offered: "Merged" } }),
      asTurnRecord({ value: { ...stored, offered: { id: "offer-3", made: "2", text: "Merged" } } }),
      asTurnRecord({ value: { ...stored, offered: null } }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("reads a record written before the owner's words as carrying none, and refuses one whose words are not text", () => {
    const older = asTurnRecord({ value: stored })!;
    expect([older.heard, older.about]).toEqual(["", ""]);
    expect([
      asTurnRecord({ value: { ...stored, heard: 7 } }),
      asTurnRecord({ value: { ...stored, heard: null } }),
      asTurnRecord({ value: { ...stored, about: 7 } }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
