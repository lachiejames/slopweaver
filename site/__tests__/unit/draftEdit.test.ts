/*
 * `draftEdit.ts` — the page aims a live draft edit at the card the owner has open, quotes the owner's latest turn, and
 * hands the verb exactly what it built, the words on stdin.
 */
import { describe, expect, it } from "vitest";

import {
  type DraftEditRow,
  draftEditAnchorOf,
  draftEditTargetOf,
  draftReadingOf,
  latestOwnerWords,
  parseTalkDraftRequest,
  type TalkDraftWire,
  talkDraftArgv,
} from "../../lib/draftEdit";

/** A held as-me row the voice can revise. */
function row({ over = {} }: { over?: Partial<NonNullable<DraftEditRow["post"]>> } = {}): DraftEditRow {
  return {
    key: "post:sd-11112222",
    post: { actor: "me", editableText: "Can you look?", id: "sd-11112222", state: "held", ...over },
  };
}

describe("draftEditTargetOf", () => {
  it("aims at the open parked draft, reading as v1 until it is revised", () => {
    expect(draftEditTargetOf({ open: "post:sd-11112222", rows: [row()] })).toEqual({
      id: "sd-11112222",
      text: "Can you look?",
      version: 1,
    });
    const revised = row({ over: { versions: [{}, {}, {}] } });
    expect(draftEditTargetOf({ open: "post:sd-11112222", rows: [revised] })).toEqual({
      id: "sd-11112222",
      text: "Can you look?",
      version: 3,
    });
  });

  it("refuses with no draft card open, naming open_card", () => {
    expect(draftEditTargetOf({ open: undefined, rows: [row()] })).toEqual({
      why: "the owner has no parked Slack draft open: open its card first (open_card), then start the edit",
    });
    expect(draftEditTargetOf({ open: "ask:some-slug", rows: [row()] })).toEqual({
      why: "the owner has no parked Slack draft open: open its card first (open_card), then start the edit",
    });
  });

  it("refuses a resolved row, a bot row and a row with no editable words", () => {
    const open = "post:sd-11112222";
    expect(draftEditTargetOf({ open, rows: [row({ over: { state: "released" } })] })).toEqual({
      why: "sd-11112222 is not a draft still waiting on the owner's yes, so there is nothing to edit",
    });
    expect(draftEditTargetOf({ open, rows: [] })).toEqual({
      why: "sd-11112222 is not a draft still waiting on the owner's yes, so there is nothing to edit",
    });
    expect(draftEditTargetOf({ open, rows: [row({ over: { actor: "bot" } })] })).toEqual({
      why: "sd-11112222 posts as the bot, and only a draft that posts under the owner's identity can be edited live; re-record it",
    });
    const fixed = draftEditTargetOf({ open, rows: [row({ over: { editableText: undefined } })] });
    expect(fixed).toEqual({ why: expect.stringContaining("approved (hold it first)") });
  });
});

describe("latestOwnerWords", () => {
  it("quotes the owner's last finished turn, whitespace folded, skipping the voice and an unfinished turn", () => {
    const segments = [
      { final: true, id: "a", text: "first", who: "owner" as const },
      { final: true, id: "b", text: "  make it\n warmer ", who: "owner" as const },
      { final: true, id: "c", text: "On it", who: "voice" as const },
      { final: false, id: "d", text: "and", who: "owner" as const },
    ];
    expect(latestOwnerWords({ segments })).toBe("make it warmer");
  });

  it("keeps the last 600 characters of a long turn, cut at a word", () => {
    const text = `${"x".repeat(10)} ${"word ".repeat(150)}end`;
    const quoted = latestOwnerWords({ segments: [{ final: true, id: "a", text, who: "owner" }] })!;
    expect(quoted.length).toBeLessThanOrEqual(600);
    expect(quoted.startsWith("word ")).toBe(true);
    expect(quoted.endsWith(" end")).toBe(true);
  });

  it("answers undefined before the owner has said anything", () => {
    expect(latestOwnerWords({ segments: [] })).toBeUndefined();
  });
});

describe("draftReadingOf and draftEditAnchorOf", () => {
  it("trims a reading and refuses an empty, overlong or blank one", () => {
    expect(draftReadingOf({ value: [" Warmer opening "] })).toEqual(["Warmer opening"]);
    const why = "reading must be 1 to 5 short lines of what you will change, each at most 120 characters";
    expect(draftReadingOf({ value: [] })).toEqual({ why });
    expect(draftReadingOf({ value: ["a", "b", "c", "d", "e", "f"] })).toEqual({ why });
    expect(draftReadingOf({ value: [" "] })).toEqual({ why });
    expect(draftReadingOf({ value: ["x".repeat(121)] })).toEqual({ why });
  });

  it("mints talk-call:<call>#<turn>, and nothing from an id that would not make one", () => {
    expect(draftEditAnchorOf({ call: "c1", turn: "turn_A" })).toBe("talk-call:c1#turn_A");
    expect(draftEditAnchorOf({ call: "bc 09", turn: "turn_A" })).toBeUndefined();
  });
});

/** A body the page built, parsed, throwing on a refusal so the assertion stays unconditional. */
function wireOf({ body }: { body: Record<string, unknown> }): TalkDraftWire {
  const parsed = parseTalkDraftRequest({ raw: JSON.stringify(body) });
  if ("why" in parsed) {
    throw new Error(parsed.why);
  }
  return parsed;
}

describe("parseTalkDraftRequest and talkDraftArgv", () => {
  const base = { anchor: "talk-call:c1#turn_A", heard: "make it warmer", id: "sd-11112222" };

  it("reads a revise and runs it with the words on stdin, never argv", () => {
    const body = { ...base, mode: "revise", reading: ["Warmer opening"], text: "Hey, could you look?" };
    const wire = wireOf({ body });
    expect(wire).toEqual(body);
    expect(talkDraftArgv({ wire })).toEqual({
      argv: [
        "slack",
        "draft",
        "revise",
        "sd-11112222",
        "--text",
        "-",
        "--heard",
        "make it warmer",
        "--reading",
        '["Warmer opening"]',
        "--anchor",
        "talk-call:c1#turn_A",
        "--json",
      ],
      stdin: "Hey, could you look?",
    });
  });

  it("reads a restore and runs it by version", () => {
    const wire = wireOf({ body: { ...base, mode: "restore", reading: ["Put v1 back"], version: 1 } });
    expect(talkDraftArgv({ wire }).argv.slice(0, 6)).toEqual([
      "slack",
      "draft",
      "restore",
      "sd-11112222",
      "--version",
      "1",
    ]);
    expect(talkDraftArgv({ wire }).stdin).toBeUndefined();
  });

  it("refuses a body the page would not have built", () => {
    const read = (body: Record<string, unknown>): unknown => parseTalkDraftRequest({ raw: JSON.stringify(body) });
    const revise = { ...base, mode: "revise", reading: ["x"], text: "hi" };
    expect(read({ ...revise, id: "../etc" })).toEqual({ why: "id must be a parked draft id" });
    expect(read({ ...revise, anchor: "slack:C0#1" })).toEqual({ why: "anchor must be talk-call:<call>#<turn>" });
    expect(read({ ...revise, send: true })).toEqual({ why: "the edit carries a field the revise route does not take" });
    expect(read({ ...revise, version: 1 })).toEqual({ why: "the edit carries a field the revise route does not take" });
    expect(read({ ...revise, text: " " })).toEqual({
      why: "text must be the whole new message, at most 8192 characters",
    });
    expect(read({ ...base, mode: "restore", reading: ["x"], version: 0 })).toEqual({
      why: "version must be a whole number from 1",
    });
    expect(read({ ...base, mode: "post", reading: ["x"] })).toEqual({ why: "mode must be revise or restore" });
    expect(parseTalkDraftRequest({ raw: "{" })).toEqual({ why: "the edit is not JSON" });
  });
});
