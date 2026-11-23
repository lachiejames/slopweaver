/*
 * The document `talk log --json` prints: a listing carries no receipt field, and a `--turn` read carries the chair's
 * receipt at the document's level — `null` when there is none — for whoever checks whether the chair has a relay.
 */
import { describe, expect, it } from "vitest";

import { talkLogListDocument, talkLogTurnDocument } from "../../../cli/commands/talk/logDocument.js";
import type { TurnRecord } from "../../../talk/relayStore.js";

const ROW: TurnRecord = {
  about: "",
  anchor: "talk:a0000010-0000-4000-8000-000000000011",
  delivery: { atIso: "2026-10-19T10:45:03.574Z", detail: "d", kind: "stranded", via: "direct" },
  digest: "d",
  heard: "",
  picture: { kind: "none", reason: "not-taken-this-turn" },
  readsAfter: [],
  registeredAtIso: "2026-10-19T10:45:00.297Z",
  slug: "talk-a00000100000",
  stagedAtIso: "2026-10-19T10:45:00.130Z",
  state: "registered",
  turnId: "a0000010-0000-4000-8000-000000000011",
  typed: false,
  words: "",
  wordsAlone: false,
};

describe("talk log --json documents", () => {
  it("prints a listing with no receipt field", () => {
    expect(talkLogListDocument({ home: "/h", rows: [ROW] })).toEqual({ home: "/h", rows: [ROW] });
  });

  it("prints a turn's receipt beside the row, never inside it", () => {
    const receipt = {
      atIso: "2026-10-19T10:45:02.345Z",
      kind: "line",
      pointer: "transcript:s#u",
      turnId: ROW.turnId,
    } as const;
    expect(talkLogTurnDocument({ home: "/h", receipt, row: ROW })).toEqual({
      chairReceipt: receipt,
      home: "/h",
      rows: [ROW],
    });
  });

  // A receipt read for another relay keeps that relay's turn, so the console reads it unknown.
  it("never re-stamps a receipt read for another relay with this row's turn", () => {
    const receipt = {
      atIso: "2026-10-19T10:59:16.854Z",
      kind: "read-unread",
      turnId: "a0000087-0000-4000-8000-000000000094",
    } as const;
    expect(talkLogTurnDocument({ home: "/h", receipt, row: ROW })).toEqual({
      chairReceipt: {
        atIso: "2026-10-19T10:59:16.854Z",
        kind: "read-unread",
        turnId: "a0000087-0000-4000-8000-000000000094",
      },
      home: "/h",
      rows: [ROW],
    });
  });

  it("prints null for a turn the chair holds no receipt for", () => {
    expect(talkLogTurnDocument({ home: "/h", receipt: undefined, row: ROW })).toEqual({
      chairReceipt: null,
      home: "/h",
      rows: [ROW],
    });
  });
});
