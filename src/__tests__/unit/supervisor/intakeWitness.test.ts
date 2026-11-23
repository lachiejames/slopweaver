import { describe, expect, it } from "vitest";

import type { IntakeMark } from "../../../supervisor/intake.js";
import {
  INTAKE_WITNESS_SHARE_LIMIT,
  isCheckableWitness,
  preferredMark,
  preferredMarks,
  witnessReuse,
  witnessShares,
} from "../../../supervisor/intakeWitness.js";

const SESSION = "a0000036-0000-4000-8000-000000000039";
const BOARD = new Set(["live-bot-loop-21sep-c", "the-ask"]);
const BULK = "loop report from live-bot-loop-21sep-c-a4, acted on at the tick it arrived";

/** The turn pointer for a two-hex-digit suffix, so a case can name many distinct turns. */
const at = ({ n }: { n: number }): string =>
  `transcript:${SESSION}#039e15e9-6f1d-4a9e-881f-98e74bbf7d${n.toString(16).padStart(2, "0")}`;

const mark = (over: Partial<IntakeMark> & { pointer: string; witness: string }): IntakeMark => ({
  byClaudeSessionId: SESSION,
  kind: "answered",
  markedAtIso: "2026-09-22T12:11:57.825Z",
  ...over,
});

describe("isCheckableWitness", () => {
  const checkable = ({ witness }: { witness: string }): boolean => isCheckableWitness({ slugs: BOARD, witness });

  it("takes a witness that IS a row on the board, wrapping punctuation aside", () => {
    expect(checkable({ witness: "the-ask" })).toBe(true);
    expect(checkable({ witness: " (the-ask). " })).toBe(true);
  });

  it("takes any slug the board itself accepts — underscores, capitals, and a dot even at the end", () => {
    const board = new Set(["foo_bar", "Ops.Notes", "v2."]);

    expect(["foo_bar", "Ops.Notes", "v2."].map((witness) => isCheckableWitness({ slugs: board, witness }))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("keeps a slug's own trailing punctuation when prose wraps it", () => {
    const board = new Set(["v2."]);

    expect(["(v2.)", " (v2.). ", "v2"].map((witness) => isCheckableWitness({ slugs: board, witness }))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("refuses a slug no handover verb will act on, even when a doc declares it", () => {
    expect(isCheckableWitness({ slugs: new Set(["-row", "../other"]), witness: "-row" })).toBe(false);
    expect(isCheckableWitness({ slugs: new Set(["-row", "../other"]), witness: "../other" })).toBe(false);
  });

  it("refuses a slug-shaped witness naming no row — the incident's string was one suffix off a real one", () => {
    expect(checkable({ witness: "live-bot-loop-21sep-c-a4" })).toBe(false);
    expect(checkable({ witness: "a-row-that-was-never-registered" })).toBe(false);
  });

  it("calls prose that merely MENTIONS a row free text", () => {
    expect(checkable({ witness: "row the-ask carries their revision" })).toBe(false);
    expect(checkable({ witness: BULK })).toBe(false);
  });

  it("takes an http(s) URL and refuses another scheme or a malformed one", () => {
    expect(checkable({ witness: "https://github.com/o/r/pull/2045" })).toBe(true);
    expect(checkable({ witness: "<http://example.slack.com/archives/C1/p1788220579306599>" })).toBe(true);
    expect(checkable({ witness: "ftp://example.com/x" })).toBe(false);
    expect(checkable({ witness: "https://" })).toBe(false);
  });

  it("takes a pull request by number, and refuses a list position or a number inside prose", () => {
    expect(checkable({ witness: "#2045" })).toBe(true);
    expect(checkable({ witness: "PR 2045" })).toBe(true);
    expect(checkable({ witness: "#1" })).toBe(false);
    expect(checkable({ witness: "#2045 merged, see the page" })).toBe(false);
  });

  it("takes a transcript, relay or call pointer and refuses a malformed one", () => {
    expect(checkable({ witness: at({ n: 1 }) })).toBe(true);
    expect(checkable({ witness: "talk:a0000017-0000-4000-8000-000000000019" })).toBe(true);
    expect(checkable({ witness: "talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163" })).toBe(true);
    expect(checkable({ witness: "talk:not-a-turn" })).toBe(false);
  });

  it("takes a call pointer whose segment ends in punctuation prose would unwrap", () => {
    expect(checkable({ witness: "talk-call:a0000046-0000-4000-8000-000000000049#!" })).toBe(true);
  });

  it("calls an empty witness free text", () => {
    expect(checkable({ witness: " .. " })).toBe(false);
  });
});

describe("witnessReuse", () => {
  const seeded = [1, 2, 3].map((n) => mark({ pointer: at({ n }), witness: BULK }));

  it("refuses the fourth turn one free-text string would mark, naming the three it already marks", () => {
    expect(INTAKE_WITNESS_SHARE_LIMIT).toBe(3);
    expect(witnessReuse({ marks: seeded, pointer: at({ n: 4 }), slugs: BOARD, witness: BULK })).toEqual({
      limit: 3,
      otherPointers: [at({ n: 1 }), at({ n: 2 }), at({ n: 3 })],
      witness: BULK,
    });
  });

  it("lets the third turn through", () => {
    expect(witnessReuse({ marks: seeded.slice(0, 2), pointer: at({ n: 4 }), slugs: BOARD, witness: BULK })).toBe(
      undefined,
    );
  });

  it("counts a turn re-marked many times once, and never counts the turn being marked", () => {
    const remarked = [...seeded.slice(0, 2), mark({ pointer: at({ n: 1 }), witness: BULK })];

    expect(witnessReuse({ marks: remarked, pointer: at({ n: 4 }), slugs: BOARD, witness: BULK })).toBe(undefined);
    expect(witnessReuse({ marks: seeded, pointer: at({ n: 3 }), slugs: BOARD, witness: BULK })).toBe(undefined);
  });

  it("lets a turn already carrying the string be re-marked with it, even with three others past it", () => {
    const pastLimit = [...seeded, mark({ pointer: at({ n: 4 }), witness: BULK })];

    expect(witnessReuse({ marks: pastLimit, pointer: at({ n: 1 }), slugs: BOARD, witness: BULK })).toBe(undefined);
  });

  it("still refuses a turn whose earlier mark carries a DIFFERENT witness", () => {
    const withOwn = [...seeded, mark({ pointer: at({ n: 4 }), witness: "291-53 keep it freeform" })];

    expect(witnessReuse({ marks: withOwn, pointer: at({ n: 4 }), slugs: BOARD, witness: BULK })).toEqual({
      limit: 3,
      otherPointers: [at({ n: 1 }), at({ n: 2 }), at({ n: 3 })],
      witness: BULK,
    });
  });

  it("never refuses a checkable witness, however many turns already carry it", () => {
    const many = Array.from({ length: 183 }, (_, n) => mark({ pointer: at({ n }), witness: "the-ask" }));

    expect(witnessReuse({ marks: many, pointer: at({ n: 200 }), slugs: BOARD, witness: "the-ask" })).toBe(undefined);
  });
});

describe("preferredMark", () => {
  const shared = [1, 2, 3, 4].map((n) => mark({ pointer: at({ n }), witness: BULK }));
  const pick = ({ candidates }: { candidates: readonly IntakeMark[] }): IntakeMark | undefined =>
    preferredMark({ candidates, shares: witnessShares({ marks: [...shared, ...candidates] }), slugs: BOARD });

  it("keeps an earlier specific carrier over later shared free text", () => {
    const carrier = mark({ pointer: at({ n: 1 }), witness: "291-53 keep it freeform" });

    expect(pick({ candidates: [carrier, shared[0]!] })).toEqual(carrier);
  });

  it("keeps an earlier checkable mark over later specific free text", () => {
    const row = mark({ kind: "card", pointer: at({ n: 1 }), witness: "the-ask" });
    const prose = mark({ pointer: at({ n: 1 }), witness: "handled at the tick" });

    expect(pick({ candidates: [row, prose] })).toEqual(row);
  });

  it("lets a later mark correct an earlier one at the same rank, and a later higher rank replace a lower", () => {
    const first = mark({ kind: "no-ask", pointer: at({ n: 1 }), witness: "first reading" });
    const second = mark({ pointer: at({ n: 1 }), witness: "second reading" });
    const row = mark({ kind: "card", pointer: at({ n: 1 }), witness: "the-ask" });

    expect(pick({ candidates: [first, second] })).toEqual(second);
    expect(pick({ candidates: [shared[0]!, first] })).toEqual(first);
    expect(pick({ candidates: [first, row] })).toEqual(row);
  });

  it("still returns shared free text when it is all a turn has — a preference, never a filter", () => {
    expect(pick({ candidates: [shared[0]!] })).toEqual(shared[0]);
    expect(pick({ candidates: [] })).toBe(undefined);
  });
});

describe("preferredMarks", () => {
  it("judges every turn apart", () => {
    const shared = [1, 2, 3, 4].map((n) => mark({ pointer: at({ n }), witness: BULK }));
    const carrier = mark({ pointer: at({ n: 1 }), witness: "291-53 keep it freeform" });
    const standing = preferredMarks({ marks: [carrier, ...shared], slugs: BOARD });

    expect([...standing].map(([pointer, one]) => [pointer, one.witness])).toEqual([
      [at({ n: 1 }), "291-53 keep it freeform"],
      [at({ n: 2 }), BULK],
      [at({ n: 3 }), BULK],
      [at({ n: 4 }), BULK],
    ]);
  });
});
