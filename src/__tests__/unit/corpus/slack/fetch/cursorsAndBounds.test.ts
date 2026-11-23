/*
 * The small pure helpers the crawl pages and resumes with — the thread-cursor overlay, the window's epoch-seconds
 * bounds, the next-page cursor and the warning merge. It moved here when `fetch.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { mergeSlackWarnings, slackWindowBounds } from "../../../../../corpus/slack/fetch.js";
import { slackNextCursor } from "../../../../../corpus/slack/responseMetadata.js";
import { mergeCursorUpdates } from "../../../../../corpus/slack/threadCursors.js";

describe("mergeCursorUpdates", () => {
  it("overlays updates onto the base without mutating the base", () => {
    const base = { "C:1": { ts: "10" }, "C:2": { ts: "20" } };
    const merged = mergeCursorUpdates({ base, updates: { "C:2": { ts: "25" }, "C:3": { ts: "30" } } });
    expect(merged).toEqual({ "C:1": { ts: "10" }, "C:2": { ts: "25" }, "C:3": { ts: "30" } });
    expect(base).toEqual({ "C:1": { ts: "10" }, "C:2": { ts: "20" } }); // base unmutated
  });
});

describe("slackWindowBounds", () => {
  it("converts the window to Slack epoch-seconds bounds", () => {
    expect(slackWindowBounds({ window: { since: "2023-11-01", until: "2023-12-01" } })).toEqual({
      latest: "1701388800",
      oldest: "1698796800",
    });
  });

  it("falls back to the widest sentinels for unparseable bounds", () => {
    expect(slackWindowBounds({ window: { since: "bad", until: "worse" } })).toEqual({
      latest: "9999999999",
      oldest: "0",
    });
  });
});

describe("slackNextCursor", () => {
  it("returns the cursor when present and non-empty", () => {
    expect(slackNextCursor({ metadata: { next_cursor: "abc" } })).toEqual({ nextCursor: "abc" });
  });

  it("stops on an empty cursor", () => {
    expect(slackNextCursor({ metadata: { next_cursor: "" } })).toEqual({});
  });

  it("stops on absent metadata", () => {
    expect(slackNextCursor({ metadata: undefined })).toEqual({});
  });
});

describe("mergeSlackWarnings", () => {
  it("concatenates without mutating either list", () => {
    const base = ["a"];
    const extra = ["b", "c"];
    expect(mergeSlackWarnings({ base, extra })).toEqual(["a", "b", "c"]);
    expect(base).toEqual(["a"]);
  });
});
