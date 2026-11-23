/**
 * The block parser behind the structure detectors.
 *
 * The case that matters most is document ORDER: the section-order check reads these blocks in sequence, so a
 * paragraph buffered above a heading and flushed after it would make a correctly ordered document look
 * reordered. That is exactly the bug the first version of this parser had.
 */
import { describe, expect, it } from "vitest";
import { parseProposalBlocks } from "../../../../../outbound/proposal/lint/blocks.js";

/** The block kinds a document produces, in order. */
function kinds({ markdown }: { markdown: string }): readonly string[] {
  return parseProposalBlocks({ markdown }).map((block) => block.type);
}

describe("parseProposalBlocks", () => {
  it("keeps a paragraph BEFORE the heading that follows it", () => {
    expect(kinds({ markdown: "some prose\n## A heading\nmore prose" })).toEqual(["paragraph", "heading", "paragraph"]);
  });

  it("collapses a multi-line paragraph into one block", () => {
    const blocks = parseProposalBlocks({ markdown: "line one\nline two\n\nline three" });
    expect(blocks.length).toBe(2);
    expect(blocks[0]!.text).toBe("line one\nline two");
  });

  it("strips the heading marker and keeps the text", () => {
    expect(parseProposalBlocks({ markdown: "## TL;DR" })[0]!.text).toBe("TL;DR");
  });

  it("collapses a run of blockquote lines into one block", () => {
    expect(kinds({ markdown: "> one\n> two\n\nprose" })).toEqual(["blockquote", "paragraph"]);
  });

  it("collapses a whole pipe table into one block", () => {
    expect(kinds({ markdown: "| a | b |\n| --- | --- |\n| 1 | 2 |" })).toEqual(["table"]);
  });

  it("collapses a bullet run into one block", () => {
    expect(kinds({ markdown: "- one\n- two\n- three" })).toEqual(["list"]);
  });

  it("treats a fenced block as code, whatever is inside it", () => {
    expect(kinds({ markdown: "```mermaid\n## not a heading\n| not | a table |\n```" })).toEqual(["code"]);
  });

  it("recognises the Notion table-of-contents block", () => {
    expect(kinds({ markdown: '<table_of_contents color="gray"/>' })).toEqual(["toc"]);
  });

  it("recognises an image line", () => {
    expect(kinds({ markdown: "![a shot](https://example.test/a.png)" })).toEqual(["image"]);
  });

  it("records a toggle's summary ON the toggle rather than leaving it as prose", () => {
    const blocks = parseProposalBlocks({
      markdown: "<details>\n<summary>Options considered</summary>\n\nbody\n\n</details>",
    });
    expect(blocks.map((block) => block.type)).toEqual(["toggle-open", "paragraph", "toggle-close"]);
    expect(blocks[0]!.text).toBe("Options considered");
  });

  it("leaves a summary line that opens no toggle out of the linter's blocks, so its counts do not move", () => {
    expect(parseProposalBlocks({ markdown: "intro\n\n<summary>Stray</summary>" })).toEqual([
      { line: 1, text: "intro", type: "paragraph" },
    ]);
  });

  it("keeps that stray summary as a paragraph when a publisher asks for it", () => {
    expect(parseProposalBlocks({ keepStraySummary: true, markdown: "intro\n\n<summary>Stray</summary>" })).toEqual([
      { line: 1, text: "intro", type: "paragraph" },
      { line: 3, text: "<summary>Stray</summary>", type: "paragraph" },
    ]);
  });

  it("reports the 1-indexed line each block starts on", () => {
    const blocks = parseProposalBlocks({ markdown: "prose\n\n## Heading\n\nmore" });
    expect(blocks.map((block) => block.line)).toEqual([1, 3, 5]);
  });

  it("produces nothing for an empty document", () => {
    expect(parseProposalBlocks({ markdown: "\n\n  \n" })).toEqual([]);
  });
});
