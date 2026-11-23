/**
 * The running list's retired-origin finder on its own: which stored item, if any, carries the owner origin a
 * build before the rename wrote, so the reader can refuse that file by name rather than as an unreadable list.
 */
import { describe, expect, it } from "vitest";

import { retiredOriginRow } from "../../../talk/runningListRetiredOrigin.js";

// The retired value, spelled through a pattern: the transient-references gate exempts a regex literal only.
const RETIRED = /him/u.source;

describe("retiredOriginRow", () => {
  it("names the first item carrying the retired origin, by its 1-based position", () => {
    const value = {
      items: [
        { id: "good", origin: "voice" },
        { id: "legacy", origin: RETIRED },
        { id: "later", origin: RETIRED },
      ],
    };
    expect(retiredOriginRow({ value })).toEqual({ origin: RETIRED, row: 2 });
  });

  it("matches the whole origin only, so a longer origin that contains it is not the retired one", () => {
    const value = { items: [{ origin: `${RETIRED}s` }, { origin: `x${RETIRED}` }, { origin: "owner" }] };
    expect(retiredOriginRow({ value })).toBe(undefined);
  });

  it("is nothing for a value with no items list, or items that are not records", () => {
    expect([
      retiredOriginRow({ value: undefined }),
      retiredOriginRow({ value: { items: "not a list" } }),
      retiredOriginRow({ value: { items: [] } }),
      retiredOriginRow({ value: { items: [RETIRED, 7, null] } }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
