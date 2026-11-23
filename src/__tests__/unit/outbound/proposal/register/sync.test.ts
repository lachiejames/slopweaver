/** `proposal sync`'s pure discovery half: turning raw Notion blocks into candidates. No network. */
import { describe, expect, it } from "vitest";
import { canonicalNotionUrl, childPagesOf } from "../../../../../outbound/proposal/register/sync.js";

describe("canonicalNotionUrl", () => {
  it("builds the bare-id URL form, stripping dashes", () => {
    expect(canonicalNotionUrl({ pageId: "00000000-0000-0000-0000-00000000a001" })).toBe(
      "https://www.notion.so/0000000000000000000000000000a001",
    );
  });
});

describe("childPagesOf", () => {
  it("extracts id and title from every child_page block", () => {
    const results = [
      { child_page: { title: "First proposal" }, id: "page-1", type: "child_page" },
      { child_page: { title: "Second proposal" }, id: "page-2", type: "child_page" },
    ];
    expect(childPagesOf({ results })).toEqual([
      { pageId: "page-1", title: "First proposal" },
      { pageId: "page-2", title: "Second proposal" },
    ]);
  });

  it("ignores a block that is not a child_page", () => {
    const results = [{ id: "block-1", paragraph: { rich_text: [] }, type: "paragraph" }];
    expect(childPagesOf({ results })).toEqual([]);
  });

  it("ignores a malformed child_page block missing a title", () => {
    const results = [{ child_page: {}, id: "page-1", type: "child_page" }];
    expect(childPagesOf({ results })).toEqual([]);
  });

  it("ignores a non-object entry rather than throwing", () => {
    expect(childPagesOf({ results: [null, "not a block", 42] })).toEqual([]);
  });

  it("preserves Notion's own ordering", () => {
    const results = [
      { child_page: { title: "Z" }, id: "page-z", type: "child_page" },
      { child_page: { title: "A" }, id: "page-a", type: "child_page" },
    ];
    expect(childPagesOf({ results }).map((candidate) => candidate.pageId)).toEqual(["page-z", "page-a"]);
  });
});
