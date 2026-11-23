import { describe, expect, it } from "vitest";

import {
  openTypedConversationIds,
  queueSearchAnswerOf,
  queueSearchAnswerWord,
  queueSearchToolUsed,
  tornCallIds,
  typedBesideSinceRead,
} from "../../../desktop/e2eCallQueueSearch.js";
import { foldCall } from "../../../talk/callRecord.js";

const CALL = "5b0b8c1e-2f8a-4c7e-9d3a-0e6f4b2a1c9d";

const FIND_CARD = {
  atIso: "2026-10-26T11:00:00.000Z",
  detail: "read slopweaver talk find-card",
  kind: "tool" as const,
  name: "verb",
  refused: false,
};

describe("queueSearchAnswerWord", () => {
  it("reads a row that is exactly one of the three words, any case, past punctuation", () => {
    expect([
      queueSearchAnswerWord({ text: "FOUND" }),
      queueSearchAnswerWord({ text: "found." }),
      queueSearchAnswerWord({ text: "NONE!" }),
      queueSearchAnswerWord({ text: " Failed. " }),
    ]).toEqual(["FOUND", "FOUND", "NONE", "FAILED"]);
  });

  it("reads nothing from a sentence however it reads, a substring, a homophone, two words, or none", () => {
    expect([
      queueSearchAnswerWord({ text: "It found some matches, but didn't finish scanning every file." }),
      queueSearchAnswerWord({ text: "None, the queue holds no such card." }),
      queueSearchAnswerWord({ text: "FOUND — no, FAILED" }),
      queueSearchAnswerWord({ text: "unfounded" }),
      queueSearchAnswerWord({ text: "fund" }),
      queueSearchAnswerWord({ text: "FOUND NONE" }),
      queueSearchAnswerWord({ text: "" }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("keeps a digit or symbol as part of its word, so the word is no answer", () => {
    expect([
      queueSearchAnswerWord({ text: "FOUND123" }),
      queueSearchAnswerWord({ text: "N0NE" }),
      queueSearchAnswerWord({ text: "FOUND ✅" }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("queueSearchAnswerOf", () => {
  const NONCE = "E2E typed abc123";
  const question = { text: `${NONCE}: search my queue`, who: "owner" as const };

  it("reads the voice's last row after the typed question", () => {
    const rows = [
      { text: "Okay, waiting.", who: "voice" as const },
      question,
      { text: "Let me check.", who: "voice" as const },
      { text: "Found.", who: "voice" as const },
    ];
    expect(queueSearchAnswerOf({ ownerText: NONCE, rows })).toBe("FOUND");
  });

  it("waits while the last row is a preamble or the owner's, and ignores a word answering another turn", () => {
    expect([
      queueSearchAnswerOf({ ownerText: NONCE, rows: [question, { text: "Let me check.", who: "voice" }] }),
      queueSearchAnswerOf({ ownerText: NONCE, rows: [{ text: "NONE", who: "voice" }, question] }),
      queueSearchAnswerOf({
        ownerText: NONCE,
        rows: [
          { text: "nothing, or failed", who: "owner" },
          { text: "NONE", who: "voice" },
        ],
      }),
      queueSearchAnswerOf({ ownerText: NONCE, rows: [] }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("openTypedConversationIds", () => {
  const typed = { callId: "owner-typed", ended: undefined, surface: "typed" as const };

  it("names every unended typed conversation it is handed", () => {
    expect(openTypedConversationIds({ calls: [typed, { ...typed, callId: "another" }] })).toEqual([
      "owner-typed",
      "another",
    ]);
  });

  it("passes over an ended one, a voice call, and none", () => {
    expect([
      openTypedConversationIds({
        calls: [
          { ...typed, ended: { atIso: "2026-10-26T11:50:00.000Z", why: null } },
          { ...typed, surface: "voice" },
        ],
      }),
      openTypedConversationIds({ calls: [] }),
    ]).toEqual([[], []]);
  });
});

describe("tornCallIds", () => {
  it("names only a call whose record skipped a line, and none of none", () => {
    expect([
      tornCallIds({
        calls: [
          { callId: "whole", skipped: 0 },
          { callId: "torn", skipped: 2 },
        ],
      }),
      tornCallIds({ calls: [] }),
    ]).toEqual([["torn"], []]);
  });
});

describe("typedBesideSinceRead", () => {
  const NONCE = "E2E typed abc123";
  const turn = ({ who, text }: { who: "owner" | "voice"; text: string }) => ({
    atIso: "2026-10-26T12:00:01.000Z",
    beganIso: "2026-10-26T12:00:01.000Z",
    final: true,
    id: `typed-${who}`,
    open: undefined,
    text,
    who,
  });
  const tests = {
    callId: "the-tests-own",
    segments: [turn({ text: `${NONCE}: is there a card`, who: "owner" }), turn({ text: "FOUND", who: "voice" })],
    surface: "typed" as const,
  };
  const besideOwner = { ...tests, callId: "owner-just-opened", segments: [turn({ text: "what's on", who: "owner" })] };

  it("names one the owner's page never closed, one with no segment, and one only the voice quotes the nonce in", () => {
    expect(
      typedBesideSinceRead({
        calls: [
          tests,
          besideOwner,
          { ...besideOwner, callId: "no-segment-yet", segments: [] },
          { ...besideOwner, callId: "voice-quotes-it", segments: [turn({ text: NONCE, who: "voice" })] },
        ],
        ownerText: NONCE,
      }),
    ).toEqual(["owner-just-opened", "no-segment-yet", "voice-quotes-it"]);
  });

  it("passes over the test's own, a voice call, and none", () => {
    expect([
      typedBesideSinceRead({ calls: [tests, { ...besideOwner, surface: "voice" as const }], ownerText: NONCE }),
      typedBesideSinceRead({ calls: [], ownerText: NONCE }),
    ]).toEqual([[], []]);
  });
});

describe("queueSearchToolUsed", () => {
  const folded = ({ entries }: { entries: readonly (typeof FIND_CARD)[] }) =>
    foldCall({ callId: CALL, entries, skipped: 0 });

  it("holds a successful find-card run, once though a retried batch wrote it twice", () => {
    const call = folded({ entries: [FIND_CARD, FIND_CARD] });
    expect(call!.notes.length).toBe(1);
    expect(queueSearchToolUsed({ call })).toBe(true);
  });

  it("refuses a refused run, another verb, a verb whose name starts the same, another tool, and no record", () => {
    expect([
      queueSearchToolUsed({ call: folded({ entries: [{ ...FIND_CARD, refused: true }] }) }),
      queueSearchToolUsed({ call: folded({ entries: [{ ...FIND_CARD, detail: "read slopweaver store query" }] }) }),
      queueSearchToolUsed({
        call: folded({ entries: [{ ...FIND_CARD, detail: "read slopweaver talk find-cardinal" }] }),
      }),
      queueSearchToolUsed({ call: folded({ entries: [{ ...FIND_CARD, name: "recall" }] }) }),
      queueSearchToolUsed({ call: undefined }),
    ]).toEqual([false, false, false, false, false]);
  });
});
