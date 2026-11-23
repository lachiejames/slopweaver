/**
 * The owner-turn receipt ledger: what a row is, whose reading it records, and how a chunk is taken.
 */
import { describe, expect, it } from "vitest";

import { sha256Text } from "../../../lib/hash.js";
import {
  collapseRulingCopies,
  nextTurnChunk,
  OWNER_TURN_CHUNK_BYTES,
  type OwnerTurnReceipt,
  parseOwnerTurnReceipt,
  type ReadableTurn,
  readTurnPointers,
  receiptedPointers,
  receiptForTurn,
} from "../../../supervisor/ownerTurnReceipts.js";

/** One turn of the shape the reader hands over. */
const turn = (over: Partial<ReadableTurn> & { pointer: string }): ReadableTurn => ({
  instantIso: "2026-09-14T10:00:00.000Z",
  source: "chair",
  text: "keep capacity maxing",
  ...over,
});

/** The Claude Code session most cases read as. */
const MINE = { host: "claude-code", id: "mine" } as const;

describe("parseOwnerTurnReceipt", () => {
  it("reads a legacy row's `claudeSessionId` as the Claude session it always named, defaulting only the byte count", () => {
    const line = '{"pointer":"transcript:s#t","claudeSessionId":"abc","readAtIso":"2026-09-15T00:00:00.000Z"}';

    expect(parseOwnerTurnReceipt({ line })).toEqual({
      bytes: 0,
      pointer: "transcript:s#t",
      readAtIso: "2026-09-15T00:00:00.000Z",
      session: { host: "claude-code", id: "abc" },
    });
  });

  it("reads a canonical row naming a Codex thread, and refuses a row carrying both shapes", () => {
    const codex = '{"pointer":"p","session":{"host":"codex","id":"t1"},"readAtIso":"2026-09-15T00:00:00.000Z"}';
    const both = '{"pointer":"p","claudeSessionId":"a","session":{"host":"codex","id":"t1"},"readAtIso":"t"}';

    expect(parseOwnerTurnReceipt({ line: codex })).toEqual({
      bytes: 0,
      pointer: "p",
      readAtIso: "2026-09-15T00:00:00.000Z",
      session: { host: "codex", id: "t1" },
    });
    expect(parseOwnerTurnReceipt({ line: both })).toBeUndefined();
  });

  it("skips a blank line, a line that is not JSON, and a row missing any required field", () => {
    expect(parseOwnerTurnReceipt({ line: "  " })).toBeUndefined();
    expect(parseOwnerTurnReceipt({ line: "{oops" })).toBeUndefined();
    expect(parseOwnerTurnReceipt({ line: '{"pointer":"p","claudeSessionId":"a"}' })).toBeUndefined();
    expect(parseOwnerTurnReceipt({ line: '["not","a","row"]' })).toBeUndefined();
  });

  it("keeps a ruling receipt's hash of its words, and reads a row written before that field without one", () => {
    const hashed = '{"pointer":"ruling:/a#1","claudeSessionId":"abc","readAtIso":"t","bytes":3,"textSha256":"ab12"}';

    expect(parseOwnerTurnReceipt({ line: hashed })).toEqual({
      bytes: 3,
      pointer: "ruling:/a#1",
      readAtIso: "t",
      session: { host: "claude-code", id: "abc" },
      textSha256: "ab12",
    });
    expect(Object.keys(parseOwnerTurnReceipt({ line: hashed.replace(',"textSha256":"ab12"', "") })!)).toEqual([
      "bytes",
      "pointer",
      "readAtIso",
      "session",
    ]);
  });
});

describe("receiptedPointers", () => {
  it("answers for ONE session on host AND id, so neither another chair nor a Codex thread sharing the id counts", () => {
    const rows: readonly OwnerTurnReceipt[] = [
      { bytes: 1, pointer: "a", readAtIso: "2026-09-15T00:00:00.000Z", session: MINE },
      { bytes: 1, pointer: "b", readAtIso: "2026-09-15T00:00:00.000Z", session: { host: "claude-code", id: "theirs" } },
      { bytes: 1, pointer: "c", readAtIso: "2026-09-15T00:00:00.000Z", session: { host: "codex", id: "mine" } },
    ];

    expect([...receiptedPointers({ receipts: rows, session: MINE })]).toEqual(["a"]);
  });
});

describe("collapseRulingCopies", () => {
  it("keeps ONE turn per ruling's words, the earliest copy, and passes chair turns through untouched", () => {
    const words = "- RULING 12 Oct the one-pager set https://example.slack.com/p1";
    const turns = [
      turn({ instantIso: "2026-10-19T23:46:00.000Z", pointer: "ruling:/a/2347.md#36", source: "ruling", text: words }),
      turn({ instantIso: "2026-10-18T12:00:00.000Z", pointer: "ruling:/a/1246.md#40", source: "ruling", text: words }),
      turn({ instantIso: "2026-10-18T12:00:00.000Z", pointer: "ruling:/a/1245.md#9", source: "ruling", text: words }),
      turn({ pointer: "transcript:s#u1", text: words }),
      turn({ pointer: "transcript:s#u2", text: words }),
    ];

    expect(collapseRulingCopies({ turns }).map((entry) => entry.pointer)).toEqual([
      "ruling:/a/1245.md#9",
      "transcript:s#u1",
      "transcript:s#u2",
    ]);
  });

  it("keeps two rulings whose words differ by a single character, because edited words are new words", () => {
    const turns = [
      turn({ pointer: "ruling:/a/x.md#1", source: "ruling", text: "- RULING one https://e/1" }),
      turn({ pointer: "ruling:/a/y.md#1", source: "ruling", text: "- RULING one https://e/1." }),
    ];

    expect(collapseRulingCopies({ turns }).map((entry) => entry.pointer)).toEqual([
      "ruling:/a/x.md#1",
      "ruling:/a/y.md#1",
    ]);
  });
});

describe("readTurnPointers", () => {
  const words = "- RULING 12 Oct the one-pager set https://example.slack.com/p1";
  const READ_AT = "2026-10-19T13:00:00.000Z";
  const fresh = turn({
    instantIso: "2026-10-19T23:46:00.000Z",
    pointer: "ruling:/a/2347.md#36",
    source: "ruling",
    text: words,
  });
  /** A receipt this session holds, legacy unless it names a hash. */
  const receipt = ({ pointer, textSha256 }: { pointer: string; textSha256?: string }): OwnerTurnReceipt => ({
    bytes: 1,
    session: MINE,
    pointer,
    readAtIso: READ_AT,
    ...(textSha256 === undefined ? {} : { textSha256 }),
  });

  it("reads a ruling a new archive re-addressed, by the hash of its words on a receipt for another copy", () => {
    const read = readTurnPointers({
      session: MINE,
      receipts: [receipt({ pointer: "ruling:/a/gone.md#40", textSha256: sha256Text({ text: words }) })],
      turns: [fresh],
    });

    expect([...read]).toEqual(["ruling:/a/2347.md#36"]);
  });

  it("never reads a ruling by its pointer alone: not words edited onto a receipted line, not a LEGACY receipt", () => {
    const edited = turn({ pointer: "ruling:/a/1246.md#40", source: "ruling", text: `${words}.` });
    const read = readTurnPointers({
      session: MINE,
      receipts: [
        receipt({ pointer: "ruling:/a/1246.md#40", textSha256: sha256Text({ text: words }) }),
        receipt({ pointer: "ruling:/a/2347.md#36" }),
      ],
      turns: [edited, fresh],
    });

    expect([...read]).toEqual(["ruling:/a/2347.md#36"]);
    expect([
      ...readTurnPointers({
        session: MINE,
        receipts: [receipt({ pointer: "ruling:/a/2347.md#36" })],
        turns: [fresh],
      }),
    ]).toEqual([]);
  });

  it("reads a chair turn by its pointer only, never by matching words, and never on another session's receipt", () => {
    const chair = turn({ pointer: "transcript:s#u1", text: words });
    const read = readTurnPointers({
      session: MINE,
      receipts: [
        receipt({ pointer: "ruling:/a/x.md#1", textSha256: sha256Text({ text: words }) }),
        { ...receipt({ pointer: "transcript:s#u2" }), session: { host: "claude-code", id: "theirs" } },
        receipt({ pointer: "transcript:s#u3" }),
      ],
      turns: [chair, turn({ pointer: "transcript:s#u2" }), turn({ pointer: "transcript:s#u3" }), fresh],
    });

    expect([...read]).toEqual(["transcript:s#u3", "ruling:/a/2347.md#36"]);
  });

  it("ignores a hash carried on a CHAIR receipt, which is no claim about any archived ruling", () => {
    const read = readTurnPointers({
      session: MINE,
      receipts: [receipt({ pointer: "transcript:s#u1", textSha256: sha256Text({ text: words }) })],
      turns: [fresh],
    });

    expect([...read]).toEqual([]);
  });
});

describe("receiptForTurn", () => {
  it("hashes a ruling's words and records nothing more than the pointer for a chair turn", () => {
    const ruling = turn({ pointer: "ruling:/a.md#5", source: "ruling", text: "- RULING x https://e.example/p1" });
    const chair = turn({ pointer: "transcript:s#u1" });

    expect(
      receiptForTurn({
        session: { host: "claude-code", id: "s" },
        readAtIso: "2026-10-20T00:00:00.000Z",
        turn: ruling,
      }),
    ).toEqual({
      bytes: 31,
      session: { host: "claude-code", id: "s" },
      pointer: "ruling:/a.md#5",
      readAtIso: "2026-10-20T00:00:00.000Z",
      textSha256: sha256Text({ text: "- RULING x https://e.example/p1" }),
    });
    expect(
      receiptForTurn({ session: { host: "claude-code", id: "s" }, readAtIso: "2026-10-20T00:00:00.000Z", turn: chair }),
    ).toEqual({
      bytes: 20,
      session: { host: "claude-code", id: "s" },
      pointer: "transcript:s#u1",
      readAtIso: "2026-10-20T00:00:00.000Z",
    });
  });
});

describe("nextTurnChunk", () => {
  it("takes the unread turns oldest first, up to the byte budget, and says what is left", () => {
    const chunk = nextTurnChunk({
      alreadyRead: new Set(["b"]),
      budgetBytes: 12,
      turns: [
        turn({ instantIso: "2026-09-14T12:00:00.000Z", pointer: "c", text: "later" }),
        turn({ instantIso: "2026-09-14T09:00:00.000Z", pointer: "a", text: "earliest" }),
        turn({ instantIso: "2026-09-14T10:00:00.000Z", pointer: "b", text: "already read" }),
      ],
    });

    expect(chunk.turns.map((entry) => entry.pointer)).toEqual(["a"]);
    expect(chunk.remaining).toBe(1);
    expect(chunk.remainingBytes).toBe(5);
  });

  it("delivers a turn larger than the whole budget ALONE rather than splitting or skipping it", () => {
    const chunk = nextTurnChunk({
      alreadyRead: new Set(),
      budgetBytes: 4,
      turns: [turn({ pointer: "big", text: "a very long voice dump indeed" })],
    });

    expect(chunk.turns.map((entry) => entry.pointer)).toEqual(["big"]);
    expect(chunk.remaining).toBe(0);
  });

  it("takes nothing at all on a zero budget, which is how a gate counts without spending a receipt", () => {
    const chunk = nextTurnChunk({ alreadyRead: new Set(), budgetBytes: 0, turns: [turn({ pointer: "a" })] });

    expect(chunk.turns).toEqual([]);
    expect(chunk.remaining).toBe(1);
  });

  it("reports an empty chunk and nothing remaining once every turn has a receipt", () => {
    const chunk = nextTurnChunk({ alreadyRead: new Set(["a"]), turns: [turn({ pointer: "a" })] });

    expect(chunk.turns).toEqual([]);
    expect(chunk.remaining).toBe(0);
    expect(chunk.remainingBytes).toBe(0);
    expect(OWNER_TURN_CHUNK_BYTES).toBe(61_440);
  });
});
