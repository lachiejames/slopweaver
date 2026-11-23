/*
 * Which of the owner's words a reader has not read: snapshots of one segment folded to the newest, an earlier one the
 * transcriber revised carried beside it, a stretch growing since read, a segment cut at its cap, the bootstrap
 * floor, the relay recorded next after a word, and every unparseable line handed back.
 */
import { describe, expect, it } from "vitest";

import { CALL_TEXT_CHARS, type CallEntry } from "../../../../talk/callRecord.js";
import { selectUnreadWords } from "../../../../talk/unreadWords.js";
import { CALL, FRONTIER, OTHER, readOf, said, tail } from "./harness.js";

const relay = ({ atIso, turnId, outcome }: { atIso: string; turnId: string | null; outcome: string }) =>
  ({ about: "a", atIso, detail: "", heard: "h", kind: "relay", outcome, say: "s", turnId }) satisfies CallEntry;

describe("selectUnreadWords", () => {
  it("keeps only the owner's words, a blank one included since a mark counts it read, oldest first", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              said({ atIso: "2026-09-26T04:10:00.000Z", id: "b", text: "second" }),
              { atIso: "2026-09-26T04:10:30.000Z", final: true, id: "v", kind: "segment", text: "voice", who: "voice" },
              said({ atIso: "2026-09-26T04:11:00.000Z", id: "c", text: "   " }),
            ],
          }),
          tail({ callId: OTHER, entries: [said({ atIso: "2026-09-26T04:09:00.000Z", id: "a", text: "first" })] }),
        ],
      }),
    });

    expect(selection.words.map((word) => [word.pointer, word.text])).toEqual([
      [`talk-call:${OTHER}#a`, "first"],
      [`talk-call:${CALL}#b`, "second"],
      [`talk-call:${CALL}#c`, "   "],
    ]);
  });

  it("folds snapshots of one segment to the newest, and a partial landing after the final never undoes it", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              said({ atIso: "2026-09-26T04:00:00.000Z", final: false, id: "s", text: "merge the" }),
              said({ atIso: "2026-09-26T04:00:08.000Z", id: "s", text: "merge the notion page" }),
              said({ atIso: "2026-09-26T04:00:04.000Z", final: false, id: "s", text: "merge the no" }),
            ],
          }),
        ],
      }),
    });

    expect(selection.words.map((word) => [word.text, word.final, word.atIso])).toEqual([
      ["merge the notion page", true, "2026-09-26T04:00:08.000Z"],
    ]);
  });

  it("keeps a word inside the first-read window when only a revision after its old final falls inside it", () => {
    const selection = selectUnreadWords({
      read: readOf({
        bootstrapFloorIso: "2026-09-25T12:00:00.000Z",
        tails: [
          tail({
            entries: [
              said({ atIso: "2026-09-24T00:00:00.000Z", id: "s", text: "old words" }),
              said({ atIso: "2026-09-26T11:00:00.000Z", final: false, id: "s", text: "RECENT SECRET" }),
            ],
          }),
        ],
      }),
    });

    expect(selection.beforeFloor).toBe(0);
    expect(selection.words.map((word) => [word.text, word.revisions, word.latestAtIso])).toEqual([
      ["old words", ["RECENT SECRET"], "2026-09-26T11:00:00.000Z"],
    ]);
  });

  it("shows the final snapshot even when it was appended later but stamped earlier", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              said({ atIso: "2026-09-26T06:05:00.001Z", final: false, id: "s", text: "merge" }),
              said({ atIso: "2026-09-26T06:00:01.000Z", id: "s", text: "merge it" }),
            ],
          }),
        ],
      }),
    });

    expect(selection.words.map((word) => [word.text, word.atIso, word.final])).toEqual([
      ["merge it", "2026-09-26T06:00:01.000Z", true],
    ]);
  });

  it("carries an earlier snapshot the transcriber revised, and none the shown text begins with", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              said({ atIso: "2026-09-26T04:00:00.000Z", final: false, id: "s", text: "please" }),
              said({ atIso: "2026-09-26T04:00:04.000Z", final: false, id: "s", text: "please delete the account" }),
              said({ atIso: "2026-09-26T04:00:08.000Z", id: "s", text: "please  create the account" }),
            ],
          }),
        ],
      }),
    });

    expect(selection.words.map((word) => [word.text, word.revisions])).toEqual([
      ["please  create the account", ["please delete the account"]],
    ]);
  });

  it.each([
    ["a word the later text only extends", "please do not", "please do nothing", ["please do not"]],
    ["a word made longer", "approve", "approved", ["approve"]],
    ["a word followed by more words", "approve", "approve it", []],
    ["a word followed by punctuation", "okay", "okay, so", []],
    ["a word an apostrophe extends", "I don", "I don't", ["I don"]],
    ["the same text, spaced apart", "approve  it", "approve it", []],
    ["a letter past the BMP extending a word", "\u{10400}", "\u{10400}\u{10401}", ["\u{10400}"]],
    ["a lone surrogate the later text pairs up", "\u{D801}", "\u{10400}", ["\u{D801}"]],
    ["an emoji followed by another", "\u{1F600}", "\u{1F600}\u{1F600}", []],
    ["a combining mark added to the last letter", "cafe", "cafe\u0301", ["cafe"]],
  ])(
    "prints an earlier snapshot only when the shown text does not continue it without extending a word: %s",
    (_label, earlier, later, revised) => {
      const selection = selectUnreadWords({
        read: readOf({
          tails: [
            tail({
              entries: [
                said({ atIso: "2026-09-26T04:00:00.000Z", final: false, id: "s", text: earlier }),
                said({ atIso: "2026-09-26T04:00:04.000Z", id: "s", text: later }),
              ],
            }),
          ],
        }),
      });

      expect(selection.words.map((word) => [word.text, word.revisions])).toEqual([[later, revised]]);
    },
  );

  it("keeps an unfinished segment and says the call was still in it", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [tail({ entries: [said({ atIso: "2026-09-26T04:00:00.000Z", final: false, id: "s", text: "and" })] })],
      }),
    });

    expect(selection.words.map((word) => word.final)).toEqual([false]);
  });

  it("calls a stretch growing since read only when it is unfinished on an open call and its start is behind the cursor", () => {
    const partial = ({ id, text }: { id: string; text: string }) =>
      said({ atIso: "2026-10-01T15:30:00.000Z", final: false, id, text });
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              partial({ id: "growing", text: "so I was looking at the screen and" }),
              said({ atIso: "2026-10-01T15:30:01.000Z", id: "finished", text: "merge it" }),
              partial({ id: "unseen", text: "and another" }),
              partial({ id: "cut", text: "x".repeat(CALL_TEXT_CHARS) }),
            ],
            seenBefore: ["growing", "finished", "cut"],
          }),
          tail({
            callId: OTHER,
            endedBefore: true,
            entries: [partial({ id: "ended", text: "dropped mid" })],
            seenBefore: ["ended"],
          }),
        ],
      }),
    });

    expect(selection.words.map((word) => [word.segmentId, word.growingSinceRead])).toEqual([
      ["growing", true],
      ["unseen", false],
      ["cut", false],
      ["ended", false],
      ["finished", false],
    ]);
  });

  it("judges a call ended by its last open or closed line, so a reopened call id grows again", () => {
    const closed = { atIso: "2026-10-01T15:29:00.000Z", kind: "closed", why: null } satisfies CallEntry;
    const opened = {
      atIso: "2026-10-01T15:29:30.000Z",
      kind: "open",
      model: "m",
      sessionId: "second",
      voice: "v",
    } satisfies CallEntry;
    const partial = said({ atIso: "2026-10-01T15:30:00.000Z", final: false, id: "s", text: "still going" });
    const growing = ({ entries, endedBefore }: { entries: readonly CallEntry[]; endedBefore: boolean }) =>
      selectUnreadWords({ read: readOf({ tails: [tail({ endedBefore, entries, seenBefore: ["s"] })] }) }).words.map(
        (word) => word.growingSinceRead,
      );

    expect(growing({ endedBefore: false, entries: [partial, closed] })).toEqual([false]);
    expect(growing({ endedBefore: true, entries: [opened, partial] })).toEqual([true]);
  });

  it("flags a segment the call store cut at its cap", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              said({ atIso: "2026-09-26T04:00:00.000Z", id: "long", text: "x".repeat(CALL_TEXT_CHARS) }),
              said({ atIso: "2026-09-26T04:01:00.000Z", id: "short", text: "x".repeat(CALL_TEXT_CHARS - 1) }),
            ],
          }),
        ],
      }),
    });

    expect(selection.words.map((word) => [word.segmentId, word.cut])).toEqual([
      ["long", true],
      ["short", false],
    ]);
  });

  it("with no cursor, leaves out words older than the bootstrap floor and keeps one exactly on it", () => {
    const selection = selectUnreadWords({
      read: readOf({
        bootstrapFloorIso: "2026-09-25T06:00:00.000Z",
        tails: [
          tail({
            entries: [
              said({ atIso: "2026-09-25T05:59:59.999Z", id: "old", text: "old" }),
              said({ atIso: "2026-09-25T06:00:00.000Z", id: "edge", text: "edge" }),
            ],
          }),
        ],
      }),
    });

    expect(selection.words.map((word) => word.segmentId)).toEqual(["edge"]);
    expect(selection.beforeFloor).toBe(1);
  });

  it("once a cursor exists, shows a line appended late with an old page-clock instant", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [tail({ entries: [said({ atIso: "2020-01-01T00:00:00.000Z", id: "late", text: "l" })] })],
      }),
    });

    expect(selection.words.map((word) => word.segmentId)).toEqual(["late"]);
  });

  it("names the relay recorded next after a word with its turn's newest outcome, and none after the last relay", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              said({ atIso: "2026-09-26T04:00:00.000Z", id: "a", text: "steer one" }),
              relay({ atIso: "2026-09-26T04:00:05.000Z", outcome: "sending", turnId: "t1" }),
              relay({ atIso: "2026-09-26T04:00:09.000Z", outcome: "relayed", turnId: "t1" }),
              said({ atIso: "2026-09-26T04:00:20.000Z", id: "b", text: "steer two" }),
            ],
          }),
        ],
      }),
    });

    expect(selection.words.map((word) => [word.segmentId, word.nextRelay])).toEqual([
      ["a", { atIso: "2026-09-26T04:00:05.000Z", outcome: "relayed", turnId: "t1" }],
      ["b", undefined],
    ]);
  });

  it("hands back every unparseable line across calls", () => {
    const line = { byteOffset: 7, callId: CALL, text: "{not json" };
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          { ...tail({ entries: [] }), lines: [{ after: FRONTIER, kind: "unparseable", line, sha256: "sha256:x" }] },
        ],
      }),
    });

    expect(selection).toEqual({ beforeFloor: 0, foreign: [], unparseable: [line], words: [] });
  });
});
