/*
 * A page identity carrying the page's reading (split out of `desktopBridge.test.ts` to keep that file under the size
 * ratchet).
 */
import { describe, expect, it } from "vitest";

import { PAGE_READING_WIRE_MAX_CHARS, parsePageIdentity } from "../../src/desktopBridge";

const page = { path: "/queue", title: "Queue" };

describe("parsePageIdentity over a page's reading", () => {
  it("keeps a reading opaque, as the string the console sent", () => {
    const reading = JSON.stringify({ shows: { cards: [] } });
    expect(parsePageIdentity({ value: { ...page, open: "ask:acme-1", reading } })).toStrictEqual({
      ...page,
      open: "ask:acme-1",
      reading,
    });
  });

  it("keeps null, the page's word that it registers none", () => {
    expect(parsePageIdentity({ value: { ...page, reading: null } })).toStrictEqual({ ...page, reading: null });
  });

  it("takes a reading at the bound and drops one past it", () => {
    const atBound = "x".repeat(PAGE_READING_WIRE_MAX_CHARS);
    expect(parsePageIdentity({ value: { ...page, reading: atBound } })).toStrictEqual({ ...page, reading: atBound });
    expect(parsePageIdentity({ value: { ...page, reading: `${atBound}x` } })).toBe(undefined);
  });

  it("drops a reading that is neither a string nor null", () => {
    expect(parsePageIdentity({ value: { ...page, reading: { shows: 1 } } })).toBe(undefined);
    expect(parsePageIdentity({ value: { ...page, reading: undefined } })).toBe(undefined);
  });

  it("still drops a key it does not know", () => {
    expect(parsePageIdentity({ value: { ...page, reading: null, sourceTab: "tab-2" } })).toBe(undefined);
  });
});
