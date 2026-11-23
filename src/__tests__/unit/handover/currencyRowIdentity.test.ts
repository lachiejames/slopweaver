/**
 * One currency row per card identity: rows sharing a key and floor merge when identical and, when they disagree,
 * become one row that says so rather than one picked by order.
 */
import { describe, expect, it } from "vitest";

import type { CurrencyRow } from "../../../handover/currency.js";
import { oneRowPerCard } from "../../../handover/currencyRowIdentity.js";

const FLOOR = "2026-10-02T11:00:00.000Z";
const CHECKED = "2026-10-02T12:00:00.000Z";
const SINCE = { gaps: [], standing: [], words: [] };

const confirmed = { atIso: CHECKED, by: "the last landing poll", kind: "confirmed" } as const;

describe("oneRowPerCard", () => {
  it("answers no rows for no rows", () => {
    expect(oneRowPerCard({ rows: [] })).toEqual([]);
  });

  it("merges two identical rows sharing a key and floor, keeping a different floor of that key as its own row", () => {
    const pr: CurrencyRow = { fact: confirmed, floorIso: FLOOR, key: "pr:1", since: SINCE };
    const older: CurrencyRow = { ...pr, floorIso: "2026-10-02T09:00:00.000Z" };

    expect(oneRowPerCard({ rows: [pr, { ...pr }, older] })).toEqual([pr, older]);
  });

  it("merges two rows carrying the same data whatever order their fields were built in", () => {
    const built: CurrencyRow = { fact: confirmed, floorIso: FLOOR, key: "pr:1", since: SINCE };
    const reordered = Object.fromEntries(Object.entries(built).toReversed()) as CurrencyRow;

    expect(Object.keys(reordered)).toEqual(["since", "key", "floorIso", "fact"]);
    expect(oneRowPerCard({ rows: [built, reordered] })).toEqual([built]);
  });

  it("keeps a row with no floor apart from one whose floor is the string `undefined`", () => {
    const undated: CurrencyRow = { fact: confirmed, floorIso: undefined, key: "ask:x", since: SINCE };
    const literal: CurrencyRow = { ...undated, floorIso: "undefined" };

    expect(oneRowPerCard({ rows: [undated, literal] })).toEqual([undated, literal]);
  });

  it("makes two disagreeing rows one row, not confirmed and with no done-check, never the first by order", () => {
    const first: CurrencyRow = {
      askedIso: FLOOR,
      done: { kind: "not-yet", readAtIso: CHECKED },
      fact: { atIso: CHECKED, by: "a re-ask in its thread", kind: "confirmed" },
      floorIso: FLOOR,
      key: "ask:same-slug",
      since: SINCE,
    };
    const second: CurrencyRow = {
      ...first,
      fact: { kind: "not-confirmed", why: "nothing has re-confirmed it since it was asked" },
    };

    expect(oneRowPerCard({ rows: [first, second] })).toEqual([
      {
        askedIso: FLOOR,
        fact: {
          kind: "not-confirmed",
          why: "two sources mint this card's key and floor and disagree on its reading, so neither is confirmed",
        },
        floorIso: FLOOR,
        key: "ask:same-slug",
        since: SINCE,
      },
    ]);
  });
});
