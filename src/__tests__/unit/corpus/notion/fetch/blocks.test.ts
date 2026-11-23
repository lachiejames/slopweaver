/*
 * What the Notion fetch reads off one block: its rich-text line, the child id it recurses into, and whether its
 * content is borrowed from another page rather than owned by this one.
 */
import { describe, expect, it } from "vitest";
import { blockBorrowsContent, blockChildId, blockTextLine } from "../../../../../corpus/notion/fetch.js";

describe("blockTextLine", () => {
  it("renders the rich text of a typed block body", () => {
    expect(blockTextLine({ block: { paragraph: { rich_text: [{ plain_text: "hi" }] }, type: "paragraph" } })).toBe(
      "hi",
    );
  });

  it("returns empty when the block has no rich-text body", () => {
    expect(blockTextLine({ block: { divider: {}, type: "divider" } })).toBe("");
  });
});

describe("blockChildId", () => {
  it("returns the id when the block has children", () => {
    expect(blockChildId({ block: { has_children: true, id: "b1" } })).toBe("b1");
  });

  it("returns undefined without children or a string id", () => {
    expect(blockChildId({ block: { has_children: false, id: "b1" } })).toBeUndefined();
    expect(blockChildId({ block: { has_children: true } })).toBeUndefined();
  });
});

describe("blockBorrowsContent", () => {
  it("is true for a child_page, whose text is only inlined here", () => {
    expect(blockBorrowsContent({ block: { child_page: { title: "Sub" }, type: "child_page" } })).toBe(true);
  });

  it("is true for a child_database", () => {
    expect(blockBorrowsContent({ block: { type: "child_database" } })).toBe(true);
  });

  it("is true for a synced_block, whose source lives on another page", () => {
    expect(blockBorrowsContent({ block: { type: "synced_block" } })).toBe(true);
  });

  it("is false for a paragraph, which this page owns outright", () => {
    expect(blockBorrowsContent({ block: { paragraph: { rich_text: [] }, type: "paragraph" } })).toBe(false);
  });

  it("is false for a block with no type at all", () => {
    expect(blockBorrowsContent({ block: {} })).toBe(false);
  });
});
