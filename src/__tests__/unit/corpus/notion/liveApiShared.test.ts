/**
 * The live Notion seam's shared constants and pure helpers: a page of 100 and six items in flight, a next
 * cursor kept only until the `since` cutoff is reached and only when Notion gave a usable one, and a skip
 * appended to the list only when one was produced.
 */
import { describe, expect, it } from "vitest";

import {
  NOTION_ITEM_CONCURRENCY,
  PAGE_SIZE,
  pushIfDefined,
  searchNextCursor,
} from "../../../../corpus/notion/liveApiShared.js";
import type { NotionSkip } from "../../../../corpus/notion/skips.js";

describe("paging constants", () => {
  it("pages by 100 and keeps six items in flight", () => {
    expect(PAGE_SIZE).toBe(100);
    expect(NOTION_ITEM_CONCURRENCY).toBe(6);
  });
});

describe("searchNextCursor", () => {
  it("keeps paging on the cursor before the cutoff and stops on the same cursor once it is reached", () => {
    expect(searchNextCursor({ nextCursor: "cursor-2", reachedCutoff: false })).toBe("cursor-2");
    expect(searchNextCursor({ nextCursor: "cursor-2", reachedCutoff: true })).toBeUndefined();
  });

  it("stops on a null, empty or non-string cursor", () => {
    expect(
      [null, "", 42, undefined].map((nextCursor) => searchNextCursor({ nextCursor, reachedCutoff: false })),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("pushIfDefined", () => {
  it("appends a present skip and leaves the list unchanged for an absent one", () => {
    const first: NotionSkip = { operation: "notion.pages.retrieve", reason: "restricted", subject: "page" };
    const second: NotionSkip = { operation: "notion.search", reason: "rate-limit", subject: "data_source" };
    const into: NotionSkip[] = [first];

    pushIfDefined({ into, value: undefined });
    expect(into).toEqual([{ operation: "notion.pages.retrieve", reason: "restricted", subject: "page" }]);

    pushIfDefined({ into, value: second });
    expect(into).toEqual([
      { operation: "notion.pages.retrieve", reason: "restricted", subject: "page" },
      { operation: "notion.search", reason: "rate-limit", subject: "data_source" },
    ]);
  });
});
