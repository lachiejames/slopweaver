/** Where a Notion page's lead ends, which is the first heading. */
import { describe, expect, it } from "vitest";

import { notionAboveFoldCells, notionBelowFoldCells } from "../../../../outbound/notion/aboveFold.js";

describe("notionAboveFoldCells", () => {
  it("reads every line before the first heading", () => {
    const markdown = ["the pool exhausted overnight.", "", "## What we changed", "we raised the ceiling."].join("\n");
    expect(notionAboveFoldCells({ markdown })).toStrictEqual([
      { path: "body lead", text: "the pool exhausted overnight.\n" },
    ]);
  });

  it("reads the whole body when it carries no heading at all", () => {
    expect(notionAboveFoldCells({ markdown: "one line only." })).toStrictEqual([
      { path: "body lead", text: "one line only." },
    ]);
  });

  it("yields no region when the body opens with a heading", () => {
    expect(notionAboveFoldCells({ markdown: "## Straight in\nthe body." })).toStrictEqual([]);
  });

  it("yields no region for a blank body", () => {
    expect(notionAboveFoldCells({ markdown: "\n\n  \n" })).toStrictEqual([]);
  });

  it("does not treat a hash inside a line as a heading", () => {
    expect(notionAboveFoldCells({ markdown: "we filed issue #12 today.\n## Next" })[0]!.text).toBe(
      "we filed issue #12 today.",
    );
  });
});

describe("notionBelowFoldCells", () => {
  it("reads the body from the first heading down, which the lead cell never covered", () => {
    const markdown = ["the pool exhausted overnight.", "", "## What we changed", "we raised the ceiling."].join("\n");
    expect(notionBelowFoldCells({ markdown })).toStrictEqual([
      { path: "body", text: "## What we changed\nwe raised the ceiling." },
    ]);
  });

  it("reads the whole page when it opens with a heading, because the lead is empty", () => {
    expect(notionBelowFoldCells({ markdown: "## Straight in\nthe body." })).toStrictEqual([
      { path: "body", text: "## Straight in\nthe body." },
    ]);
  });

  it("yields no region when the page carries no heading, because the lead already covered it", () => {
    expect(notionBelowFoldCells({ markdown: "one line only." })).toStrictEqual([]);
  });

  it("yields no region for a blank body", () => {
    expect(notionBelowFoldCells({ markdown: "\n\n  \n" })).toStrictEqual([]);
  });
});
