/*
 * `readCardLandings` reads the landing ledger's payload whole or refuses it (split out of `talkActionItems.test.ts` to
 * keep that file under the size ratchet).
 */
import { describe, expect, it } from "vitest";

import { readCardLandings } from "../../components/live/readCardLandings";

/** Whether a fixture entry is an object whose fields can be read by name. */
function isBagFixture(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("readCardLandings", () => {
  it("refuses the whole reading when one landing is missing a field, rather than drawing a steered card again", () => {
    expect(
      readCardLandings({
        landings: [{ cardKey: "hand:x" }],
        moves: [],
        movesUnreadable: [],
        movesUnreadableLines: [],
        triageUnreadable: 0,
        unreadable: [],
        unreadableLines: [],
      }),
    ).toBe(undefined);
  });

  const row = {
    anchor: "talk:a",
    atIso: "2026-10-04T00:00:01.000Z",
    cardKey: "pr:1",
    decidedIso: "2026-10-04T00:00:00.000Z",
    source: "relay",
    words: "w",
    workSlug: "s",
  };

  it("carries who landed the words and when the card left the owner's list", () => {
    const read = readCardLandings({
      landings: [row],
      moves: [],
      movesUnreadable: [],
      movesUnreadableLines: [],
      triageUnreadable: 0,
      unreadable: [],
      unreadableLines: [],
    });
    expect(read!.landings.map((one) => [one.source, one.atIso])).toEqual([["relay", "2026-10-04T00:00:01.000Z"]]);
  });

  it("refuses a landing whose source is not one the ledger writes, or that carries no write instant", () => {
    expect(
      readCardLandings({
        landings: [{ ...row, source: "supervisor" }],
        moves: [],
        movesUnreadable: [],
        movesUnreadableLines: [],
        triageUnreadable: 0,
        unreadable: [],
        unreadableLines: [],
      }),
    ).toBe(undefined);
    expect(
      readCardLandings({
        landings: [{ ...row, atIso: undefined }],
        moves: [],
        movesUnreadable: [],
        movesUnreadableLines: [],
        triageUnreadable: 0,
        unreadable: [],
        unreadableLines: [],
      }),
    ).toBe(undefined);
  });

  it("carries a landing's later-segment anchors, and none when the field is absent", () => {
    const read = readCardLandings({
      landings: [{ ...row, laterAnchors: ["talk:b"] }, row],
      moves: [],
      movesUnreadable: [],
      movesUnreadableLines: [],
      triageUnreadable: 0,
      unreadable: [],
      unreadableLines: [],
    });
    expect(read!.landings.map((one) => one.laterAnchors)).toEqual([["talk:b"], []]);
  });

  it("refuses a landing whose later-segment anchors do not read", () => {
    expect(
      readCardLandings({
        landings: [{ ...row, laterAnchors: [7] }],
        moves: [],
        movesUnreadable: [],
        movesUnreadableLines: [],
        triageUnreadable: 0,
        unreadable: [],
        unreadableLines: [],
      }),
    ).toBe(undefined);
  });

  it("reads a landing's triage verdict with its label", () => {
    const triage = { label: "waiting-on-them", verdict: "park-working-session" };
    const read = readCardLandings({
      landings: [{ ...row, triage }],
      moves: [],
      movesUnreadable: [],
      movesUnreadableLines: [],
      triageUnreadable: 0,
      unreadable: [],
      unreadableLines: [],
    });
    expect(read!.landings.map((one) => one.triage)).toEqual([
      { label: "waiting-on-them", verdict: "park-working-session" },
    ]);
  });

  it("reads a landing's triage verdict without a label, leaving no label key", () => {
    const triage = { verdict: "rewrite" };
    const read = readCardLandings({
      landings: [{ ...row, triage }],
      moves: [],
      movesUnreadable: [],
      movesUnreadableLines: [],
      triageUnreadable: 0,
      unreadable: [],
      unreadableLines: [],
    });
    expect(read!.landings[0].triage).toEqual({ verdict: "rewrite" });
    expect(Object.keys(read!.landings[0].triage!)).toEqual(["verdict"]);
  });

  it("leaves no triage key on a landing whose relay carried no ruling", () => {
    const read = readCardLandings({
      landings: [row],
      moves: [],
      movesUnreadable: [],
      movesUnreadableLines: [],
      triageUnreadable: 0,
      unreadable: [],
      unreadableLines: [],
    });
    expect(Object.keys(read!.landings[0])).not.toContain("triage");
  });

  it("refuses the whole payload on a triage verdict that is not one, a label that is not one, or no object", () => {
    const refused = [
      { verdict: "send-now" },
      { verdict: 4 },
      { label: "action-now" },
      { label: "someday", verdict: "send-it" },
      { label: 7, verdict: "send-it" },
      "park-slow-triage",
      null,
      [],
    ].map((triage) =>
      readCardLandings({
        landings: [{ ...row, triage }],
        moves: [],
        movesUnreadable: [],
        movesUnreadableLines: [],
        triageUnreadable: 0,
        unreadable: [],
        unreadableLines: [],
      }),
    );
    expect(refused).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("returns how many relay lines did not read", () => {
    const read = readCardLandings({
      landings: [row],
      moves: [],
      movesUnreadable: [7, 9],
      movesUnreadableLines: [{ lineNumber: 7 }, { lineNumber: 9 }],
      triageUnreadable: 3,
      unreadable: [2],
      unreadableLines: [{ lineNumber: 2 }],
    });
    expect([read!.triageUnreadable, read!.unreadable]).toEqual([3, 3]);
  });

  /** The refused line numbers a ledger counts beside these described lines: each one's own number, as the verb prints. */
  const countedOf = ({ lines }: { lines: unknown }): readonly unknown[] =>
    Array.isArray(lines) ? lines.map((line: unknown) => (isBagFixture(line) ? line["lineNumber"] : line)) : [];

  /** A payload whose two ledgers' refused lines are these, each counted once, every other field whole. */
  const withLines = ({
    landingLines,
    moveLines,
  }: {
    landingLines: unknown;
    moveLines: unknown;
  }): Record<string, unknown> => ({
    landings: [row],
    moves: [],
    movesUnreadable: countedOf({ lines: moveLines }),
    movesUnreadableLines: moveLines,
    triageUnreadable: 0,
    unreadable: countedOf({ lines: landingLines }),
    unreadableLines: landingLines,
  });

  it("carries each refused line with the card key and instant it recorded, the landings' lines first", () => {
    const read = readCardLandings(
      withLines({
        landingLines: [{ atIso: "2026-11-08T09:28:17.485Z", cardKey: "ask:acme-Fixture 1-seats", lineNumber: 19 }],
        moveLines: [{ lineNumber: 13, cardKey: "ask:abc-1" }, { lineNumber: 14 }],
      }),
    );
    expect(read!.unreadableLines).toEqual([
      { atIso: "2026-11-08T09:28:17.485Z", cardKey: "ask:acme-Fixture 1-seats", lineNumber: 19 },
      { atIso: undefined, cardKey: "ask:abc-1", lineNumber: 13 },
      { atIso: undefined, cardKey: undefined, lineNumber: 14 },
    ]);
  });

  // A refused line the page could not read is a gap it would stop naming, so one malformed entry refuses it whole.
  it("refuses the whole payload when either ledger's refused lines are missing or one does not read", () => {
    const bad = [
      withLines({ landingLines: undefined, moveLines: [] }),
      withLines({ landingLines: [], moveLines: undefined }),
      withLines({ landingLines: [{ lineNumber: 0 }], moveLines: [] }),
      withLines({ landingLines: [{ lineNumber: 1.5 }], moveLines: [] }),
      withLines({ landingLines: [], moveLines: [{ cardKey: 7, lineNumber: 1 }] }),
      withLines({ landingLines: [], moveLines: [{ atIso: false, lineNumber: 1 }] }),
      withLines({ landingLines: ["1"], moveLines: [] }),
    ].map((payload) => readCardLandings(payload));
    expect(bad).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  // A refused line the verb counted but did not describe would be a gap no surface names.
  it("refuses a payload counting more or fewer refused lines than it describes, in either ledger", () => {
    const bad = [
      { ...withLines({ landingLines: [], moveLines: [] }), unreadable: [7] },
      { ...withLines({ landingLines: [], moveLines: [] }), movesUnreadable: [7] },
      { ...withLines({ landingLines: [{ lineNumber: 7 }], moveLines: [] }), unreadable: [] },
      { ...withLines({ landingLines: [{ lineNumber: 8 }], moveLines: [] }), unreadable: [7] },
      {
        ...withLines({ landingLines: [], moveLines: [{ lineNumber: 1 }, { lineNumber: 2 }] }),
        movesUnreadable: [2, 1],
      },
    ].map((payload) => readCardLandings(payload));
    expect(bad).toEqual([undefined, undefined, undefined, undefined, undefined]);
    const matched = { ...withLines({ landingLines: [{ lineNumber: 7 }], moveLines: [] }), unreadable: [7] };
    expect(readCardLandings(matched)!.unreadableLines).toEqual([
      { atIso: undefined, cardKey: undefined, lineNumber: 7 },
    ]);
    expect(readCardLandings(withLines({ landingLines: [], moveLines: [] }))!.unreadableLines).toEqual([]);
  });

  it("refuses a payload whose triageUnreadable is missing, negative or not an integer", () => {
    const bad = [undefined, -1, 1.5, "0", null, Number.NaN].map((triageUnreadable) =>
      readCardLandings({ ...withLines({ landingLines: [], moveLines: [] }), triageUnreadable }),
    );
    expect(bad).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    const { triageUnreadable: _absent, ...noTriage } = withLines({ landingLines: [], moveLines: [] });
    expect(readCardLandings(noTriage)).toBe(undefined);
  });

  it("reads each Queue-walk move, and refuses a payload whose moves are missing or malformed", () => {
    const move = {
      anchor: "talk-move:call-1#req-1",
      atIso: "2026-09-23T01:59:05.000Z",
      cardKey: "ask:acme-01",
      decidedIso: "2026-09-23T01:59:00.000Z",
      toCardKey: "ask:acme-02",
      words: "ok next",
    };
    const read = readCardLandings({
      landings: [],
      moves: [move],
      movesUnreadable: [],
      movesUnreadableLines: [],
      triageUnreadable: 0,
      unreadable: [],
      unreadableLines: [],
    });
    expect(read!.moves).toEqual([move]);
    const lines = { movesUnreadableLines: [], unreadableLines: [] };
    const bad = [
      { ...lines, landings: [], triageUnreadable: 0, unreadable: [] },
      { ...lines, landings: [], movesUnreadable: [], triageUnreadable: 0, unreadable: [] },
      { ...lines, landings: [], moves: [], triageUnreadable: 0, unreadable: [] },
      {
        ...lines,
        landings: [],
        moves: [{ ...move, toCardKey: 3 }],
        movesUnreadable: [],
        triageUnreadable: 0,
        unreadable: [],
      },
    ].map((payload) => readCardLandings(payload));
    expect(bad).toEqual([undefined, undefined, undefined, undefined]);
  });
});
