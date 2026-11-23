/**
 * The phrase search behind the voice's `supervisor_history` tool: every searchable word must be present, the
 * newest turn comes first, and the byte cap drops whole hits and counts them rather than cutting one silently.
 */
import { describe, expect, it } from "vitest";

import {
  chairRepliesFromTail,
  HISTORY_WINDOW_CHARS,
  type HistoryTurn,
  phraseWords,
  searchHistory,
} from "../../../talk/supervisorHistory.js";

const SINCE = "2026-09-23T13:00:00.000Z";

/** A chair reply as one transcript line. */
const chairLine = ({ at, text = "a reply" }: { at: string; text?: string }): string =>
  JSON.stringify({
    message: { content: [{ text, type: "text" }], role: "assistant" },
    timestamp: at,
    type: "assistant",
    uuid: `u-${at}`,
  });

/** A chair reply whose second text block will not decode, so only its first block's text survives. */
const partlyBrokenLine = ({ at }: { at: string }): string =>
  JSON.stringify({
    message: {
      content: [
        { text: "visible", type: "text" },
        { text: 42, type: "text" },
      ],
      role: "assistant",
    },
    timestamp: at,
    type: "assistant",
    uuid: `u-partial-${at}`,
  });

const BEFORE_FLOOR = "2026-09-23T12:00:00.000Z";
const AFTER_FLOOR = "2026-09-23T14:00:00.000Z";

describe("chairRepliesFromTail", () => {
  const read = (over: { lines: readonly string[]; fromStart: boolean }) =>
    chairRepliesFromTail({ sinceIso: SINCE, tail: { sessionId: "s1", ...over } });

  it("keeps the replies at or after the floor, pointing at the chair's session", () => {
    const { turns, unread } = read({
      fromStart: true,
      lines: [chairLine({ at: BEFORE_FLOOR }), chairLine({ at: AFTER_FLOOR, text: "kept" })],
    });
    expect(turns).toEqual([{ atIso: AFTER_FLOOR, pointer: "chair:s1", text: "kept", who: "chair" }]);
    expect(unread).toEqual([]);
  });

  it("reads a tail begun at the transcript's start as whole, on the lines that past the start name a gap", () => {
    const afterTheFloorOnly = [chairLine({ at: AFTER_FLOOR })];
    expect(read({ fromStart: false, lines: afterTheFloorOnly }).unread.length).toBe(1);
    expect(read({ fromStart: true, lines: afterTheFloorOnly }).unread).toEqual([]);
    expect(read({ fromStart: false, lines: [] }).unread.length).toBe(1);
    expect(read({ fromStart: true, lines: [] }).unread).toEqual([]);
  });

  it("reads a tail begun past the start as reaching the floor when its first exchange is older", () => {
    const lines = [chairLine({ at: BEFORE_FLOOR }), chairLine({ at: AFTER_FLOOR })];
    expect(read({ fromStart: false, lines }).unread).toEqual([]);
  });

  it("names a tail begun past the start that never gets back to the floor", () => {
    expect(read({ fromStart: false, lines: [chairLine({ at: AFTER_FLOOR })] }).unread).toEqual([
      "the chair's replies: the transcript's tail began past its start and does not reach the window's floor, so older replies may be missing",
    ]);
  });

  it("names an empty tail begun past the start, which proves nothing about the floor", () => {
    expect(read({ fromStart: false, lines: [] }).unread.length).toBe(1);
  });

  it("does not trust an old first exchange when the times run backwards after it", () => {
    const lines = [chairLine({ at: BEFORE_FLOOR }), chairLine({ at: AFTER_FLOOR }), chairLine({ at: BEFORE_FLOOR })];
    expect(read({ fromStart: false, lines }).unread.length).toBe(1);
  });

  it("names undecodable lines even from the transcript's start", () => {
    const lines = ["{half a record", chairLine({ at: AFTER_FLOOR })];
    expect(read({ fromStart: true, lines }).unread).toEqual([
      "the chair's replies: 1 line(s) of the transcript could not be decoded, and a reply may be among them",
    ]);
  });

  it("names every shortfall at once, so a torn line cannot hide an undated reply or a tail short of the floor", () => {
    const lines = ["{half a record", chairLine({ at: "", text: "undated" }), chairLine({ at: AFTER_FLOOR })];
    expect(read({ fromStart: false, lines }).unread).toEqual([
      "the chair's replies: 1 line(s) of the transcript could not be decoded, and a reply may be among them",
      "the chair's replies: 1 repl(ies) carry no readable time, so the window cannot say whether they fall inside it",
      "the chair's replies: the transcript's tail began past its start and does not reach the window's floor, so older replies may be missing",
    ]);
  });

  it("names a reply that dropped a malformed block, which would otherwise print as if whole", () => {
    const { turns, unread } = read({ fromStart: true, lines: [partlyBrokenLine({ at: AFTER_FLOOR })] });
    expect(turns.map((kept) => kept.text)).toEqual(["visible"]);
    expect(unread).toEqual([
      "the chair's replies: 1 repl(ies) dropped a content block that would not decode, so each is shown in part",
    ]);
  });

  it("does not count a partly decoded reply from before the floor, which is outside the window", () => {
    const lines = [partlyBrokenLine({ at: BEFORE_FLOOR }), chairLine({ at: AFTER_FLOOR, text: "whole" })];
    const { turns, unread } = read({ fromStart: true, lines });
    expect(turns.map((kept) => kept.text)).toEqual(["whole"]);
    expect(unread).toEqual([]);
  });

  it("counts a partly decoded reply whose time will not read, since it cannot be placed outside the window", () => {
    const { unread } = read({ fromStart: true, lines: [partlyBrokenLine({ at: "" })] });
    expect(unread).toEqual([
      "the chair's replies: 1 repl(ies) dropped a content block that would not decode, so each is shown in part",
      "the chair's replies: 1 repl(ies) carry no readable time, so the window cannot say whether they fall inside it",
    ]);
  });

  it("names a reply with no readable time even from the transcript's start, rather than filtering it away", () => {
    const { turns, unread } = read({
      fromStart: true,
      lines: [chairLine({ at: "", text: "undated" }), chairLine({ at: AFTER_FLOOR, text: "kept" })],
    });
    expect(turns.map((kept) => kept.text)).toEqual(["kept"]);
    expect(unread).toEqual([
      "the chair's replies: 1 repl(ies) carry no readable time, so the window cannot say whether they fall inside it",
    ]);
  });
});

const turn = (over: Partial<HistoryTurn> = {}): HistoryTurn => ({
  atIso: "2026-09-24T09:00:00.000Z",
  pointer: "transcript:a0000007-0000-4000-8000-000000000008#33dac8fe-ef61-4b56-956f-1a3377e33841",
  text: "build the jumpcloud atlas so we can see who owns each failing device",
  who: "owner",
  ...over,
});

describe("phraseWords", () => {
  it("drops glue words and duplicates, lowercased, in order", () => {
    expect(phraseWords({ phrase: "What did I say about the JumpCloud atlas and the atlas?" })).toEqual([
      "say",
      "jumpcloud",
      "atlas",
    ]);
  });
});

describe("searchHistory", () => {
  it("keeps only turns holding every word, newest first", () => {
    const older = turn({ atIso: "2026-09-24T08:00:00.000Z", pointer: "older" });
    const newer = turn({ atIso: "2026-09-24T10:00:00.000Z", pointer: "newer", who: "chair" });
    const unrelated = turn({ pointer: "unrelated", text: "the jumpcloud tenancy is fine" });
    const answer = searchHistory({
      maxBytes: 14_000,
      phrase: "jumpcloud atlas",
      sinceIso: SINCE,
      turns: [older, unrelated, newer],
    });
    expect(answer.hits.map((hit) => hit.pointer)).toEqual(["newer", "older"]);
    expect(answer.hits.map((hit) => hit.who)).toEqual(["chair", "owner"]);
    expect(answer.omitted).toBe(0);
  });

  it("orders by instant, not by the text of the timestamp, so an offset cannot put an older turn first", () => {
    // A +02:00 instant reads later as text than a UTC one, yet is the older instant.
    const offset = turn({ atIso: "2026-09-24T10:00:00+02:00", pointer: "offset-older" });
    const zulu = turn({ atIso: "2026-09-24T09:30:00.000Z", pointer: "zulu-newer" });
    const answer = searchHistory({
      maxBytes: 14_000,
      phrase: "jumpcloud atlas",
      sinceIso: SINCE,
      turns: [offset, zulu],
    });
    expect(answer.hits.map((hit) => hit.pointer)).toEqual(["zulu-newer", "offset-older"]);
  });

  it("puts a turn whose instant will not parse last, and still orders the ones either side of it", () => {
    const old = turn({ atIso: "2026-09-24T01:00:00.000Z", pointer: "old" });
    const broken = turn({ atIso: "", pointer: "broken" });
    const recent = turn({ atIso: "2026-09-24T03:00:00.000Z", pointer: "recent" });
    const answer = searchHistory({
      maxBytes: 14_000,
      phrase: "jumpcloud atlas",
      sinceIso: SINCE,
      turns: [old, broken, recent],
    });
    expect(answer.hits.map((hit) => hit.pointer)).toEqual(["recent", "old", "broken"]);
  });

  it("matches a plural of a word", () => {
    const answer = searchHistory({
      maxBytes: 14_000,
      phrase: "atlas",
      sinceIso: SINCE,
      turns: [turn({ text: "two atlases" })],
    });
    expect(answer.hits.map((hit) => hit.excerpt)).toEqual(["two atlases"]);
  });

  it("cuts a long turn to a window around the first word, and says it cut", () => {
    const text = `${"x".repeat(HISTORY_WINDOW_CHARS + 50)} atlas ${"y".repeat(HISTORY_WINDOW_CHARS + 50)}`;
    const [hit] = searchHistory({ maxBytes: 14_000, phrase: "atlas", sinceIso: SINCE, turns: [turn({ text })] }).hits;
    expect(hit!.cut).toBe(true);
    expect(hit!.excerpt.startsWith("… ")).toBe(true);
    expect(hit!.excerpt.endsWith(" …")).toBe(true);
    expect(hit!.excerpt).toContain(" atlas ");
  });

  it("drops whole hits past the byte cap and counts them", () => {
    const turns = [turn({ pointer: "a" }), turn({ pointer: "b" }), turn({ pointer: "c" })];
    const one = Buffer.byteLength(
      JSON.stringify(searchHistory({ maxBytes: 14_000, phrase: "atlas", sinceIso: SINCE, turns: [turns[0]!] }).hits[0]),
      "utf8",
    );
    const answer = searchHistory({ maxBytes: one * 2, phrase: "atlas", sinceIso: SINCE, turns });
    expect(answer.hits.length).toBe(2);
    expect(answer.omitted).toBe(1);
  });

  it("says nothing matched, naming the window and the words, rather than returning silence", () => {
    const answer = searchHistory({ maxBytes: 14_000, phrase: "vanta device", sinceIso: SINCE, turns: [turn()] });
    expect(answer.hits).toEqual([]);
    expect(answer.note).toBe(`Nothing since ${SINCE} contains all of: vanta, device. Try fewer or different words.`);
  });

  it("refuses to match everything on a phrase of glue words alone", () => {
    const answer = searchHistory({
      maxBytes: 14_000,
      phrase: "what did i say",
      sinceIso: SINCE,
      turns: [turn({ text: "what did i say" })],
    });
    expect(answer.words).toEqual(["say"]);
    const glueOnly = searchHistory({ maxBytes: 14_000, phrase: "what is it", sinceIso: SINCE, turns: [turn()] });
    expect(glueOnly.hits).toEqual([]);
    expect(glueOnly.note).toBe("The phrase had no searchable words; ask the owner for the thing they mean.");
  });
});
