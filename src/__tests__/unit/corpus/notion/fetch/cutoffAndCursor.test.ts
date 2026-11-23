/*
 * How the Notion fetch bounds a search it cannot filter server-side: the client-side `since` cutoff, and when a
 * `next_cursor` value means there is another page to read.
 */
import { describe, expect, it } from "vitest";
import { cutoffMs, notionNextCursor, withinCutoff } from "../../../../../corpus/notion/fetch.js";

describe("since cutoff (Notion search has no server-side date filter)", () => {
  it("has no cutoff for the --all epoch date", () => {
    expect(cutoffMs({ since: "1970-01-01" })).toBeUndefined();
    expect(withinCutoff({ cutoff: undefined, lastEdited: "1999-01-01T00:00:00.000Z" })).toBe(true);
  });

  it("keeps results at/after `since` and drops older ones", () => {
    const cutoff = cutoffMs({ since: "2026-04-01" });
    expect(cutoff).toBeGreaterThan(0);
    expect(withinCutoff({ cutoff, lastEdited: "2026-05-01T00:00:00.000Z" })).toBe(true);
    expect(withinCutoff({ cutoff, lastEdited: "2026-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("keeps an undated result defensively (never silently drops)", () => {
    expect(withinCutoff({ cutoff: cutoffMs({ since: "2026-04-01" }), lastEdited: "" })).toBe(true);
  });
});

describe("notionNextCursor", () => {
  it("returns the cursor when it is a non-empty string", () => {
    expect(notionNextCursor({ value: "cur" })).toBe("cur");
  });

  it("stops on an empty string, null, or non-string", () => {
    expect(notionNextCursor({ value: "" })).toBeUndefined();
    expect(notionNextCursor({ value: null })).toBeUndefined();
    expect(notionNextCursor({ value: 3 })).toBeUndefined();
  });
});
