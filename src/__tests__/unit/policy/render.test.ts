import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { layoutPolicy, PAGE, type RenderedBlock, type RenderedLine } from "../../../policy/render/layout.js";
import { imageFormatOf, pngPixels } from "../../../policy/render/pdf.js";
import { type RenderRefusal, undrawableCharacters } from "../../../policy/render/source.js";
import { markdownWords, renderedWords, verifyRender } from "../../../policy/render/verify.js";
import type { TextWidth } from "../../../policy/render/wrap.js";

/** A fixed-width font: every character is one point wide at every size. Enough to pin every wrap. */
const measure: TextWidth = ({ text }) => text.length;

/** The text column, in the units `measure` counts in. */
const COLUMN = PAGE.width - PAGE.margin * 2;

/** The text lines of a layout, which every case below but the image ones is made of. */
function textLines({ blocks }: { blocks: readonly RenderedBlock[] }): readonly RenderedLine[] {
  return blocks.filter((block): block is RenderedLine => block.kind === "text");
}

/** Lay a document out and return its text lines, failing the test on a refusal. */
function laidLines({ markdown }: { markdown: string }): readonly RenderedLine[] {
  return textLines({ blocks: unwrap(layoutPolicy({ markdown, measure })) });
}

describe("layoutPolicy", () => {
  it("skips the front matter the mirror writes, so no git provenance reaches the PDF", () => {
    const lines = laidLines({
      markdown: ["---", 'vanta_policy_id: "x"', "---", "", "# Title", "", "Body."].join("\n"),
    });
    expect(lines.map((line) => line.text)).toStrictEqual(["Title", "Body."]);
  });

  it("sets a heading bold and larger than the body", () => {
    const lines = laidLines({ markdown: "## Purpose\n\nTo ensure security." });
    expect(lines[0]!.font).toBe("bold");
    expect(lines[0]!.size).toBeGreaterThan(lines[1]!.size);
    expect(lines[1]!.font).toBe("regular");
  });

  it("draws a list item with a bullet and an indent", () => {
    const lines = laidLines({ markdown: "- Never input PII" });
    expect(lines[0]!.text).toBe("•  Never input PII");
    expect(lines[0]!.indent).toBe(18);
  });

  it("wraps a paragraph at the column without breaking a word", () => {
    const lines = laidLines({ markdown: "a ".repeat(400).trim() });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.text.length <= COLUMN)).toBe(true);
  });

  it("hard-breaks a single word wider than the whole column, so it cannot run off the page", () => {
    const word = "x".repeat(Math.ceil(COLUMN) + 50);
    const lines = laidLines({ markdown: word });
    expect(lines.length).toBe(2);
    expect(lines.map((line) => line.text).join("")).toBe(word);
  });

  it("joins consecutive source lines into one paragraph, rather than one paragraph per line", () => {
    const lines = laidLines({ markdown: "The rules are\nalready written." });
    expect(lines.map((line) => line.text)).toStrictEqual(["The rules are already written."]);
  });

  it("draws a table as stacked rows: the header once in bold, each row's first cell bold, the rest indented", () => {
    const lines = laidLines({
      markdown: "| Field | Value |\n|---|:--|\n| Owner | Platform Lead |\n| Review | Annually |",
    });
    expect(lines.map((line) => [line.text, line.font, line.indent])).toStrictEqual([
      ["Field · Value", "bold", 0],
      ["Owner", "bold", 0],
      ["Platform Lead", "regular", 18],
      ["Review", "bold", 0],
      ["Annually", "regular", 18],
    ]);
  });

  it("keeps a numbered item's number, nests an indented item, and joins its continuation line", () => {
    const lines = laidLines({
      markdown: ["1. **Change review.**", "   - Carried out by: a ticket", "     is required.", "2. Approval."].join(
        "\n",
      ),
    });
    expect(lines.map((line) => [line.text, line.indent])).toStrictEqual([
      ["1.  **Change review.**", 18],
      ["•  Carried out by: a ticket is required.", 36],
      ["2.  Approval.", 18],
    ]);
  });

  it("joins a block quote into one indented paragraph", () => {
    const lines = laidLines({ markdown: "> Provide documentation\n> that demonstrates adherence." });
    expect(lines.map((line) => [line.text, line.indent])).toStrictEqual([
      ["Provide documentation that demonstrates adherence.", 18],
    ]);
  });

  it("places an image alone on its line as an image block naming its source and line", () => {
    const blocks = unwrap(layoutPolicy({ markdown: "### Figure 1\n\n![The proposal](evidence/01.png)", measure }));
    expect(blocks[1]).toStrictEqual({
      kind: "image",
      line: 3,
      source: "evidence/01.png",
      spaceBefore: PAGE.bodySize * 0.7,
    });
  });

  it("refuses an image inside a line of text, which would otherwise print as its own syntax", () => {
    const refusals: readonly RenderRefusal[] = unwrapErr(layoutPolicy({ markdown: "See ![x](a.png) here.", measure }));
    expect(refusals).toStrictEqual([
      { line: 1, reason: "an image inside a line of text is not one this renderer can draw" },
    ]);
  });

  it("refuses two images on one line, rather than drawing the last and dropping the first", () => {
    const refusals: readonly RenderRefusal[] = unwrapErr(
      layoutPolicy({ markdown: "![a](a.png) see [details](b.png)", measure }),
    );
    expect(refusals).toStrictEqual([
      { line: 1, reason: "an image inside a line of text is not one this renderer can draw" },
    ]);
  });

  it("refuses an image inside a heading, which would otherwise print as its own syntax", () => {
    const refusals: readonly RenderRefusal[] = unwrapErr(layoutPolicy({ markdown: "# Figure ![x](a.png)", measure }));
    expect(refusals[0]!.reason).toBe("an image inside a line of text is not one this renderer can draw");
  });

  it("reads a heading indented under four spaces as a heading", () => {
    const lines = laidLines({ markdown: "  # Title" });
    expect(lines.map((line) => [line.text, line.font])).toStrictEqual([["Title", "bold"]]);
  });

  it("refuses a table separator row with no header above it", () => {
    const refusals: readonly RenderRefusal[] = unwrapErr(layoutPolicy({ markdown: "|---|---|\n| a | b |", measure }));
    expect(refusals).toStrictEqual([
      { line: 1, reason: "a table separator row with no header row above it is not a table" },
    ]);
  });

  it("reads a CRLF file's lines without their carriage returns", () => {
    const lines = laidLines({ markdown: "```\r\nkeep\r\n```\r\nBody." });
    expect(lines.map((line) => line.text)).toStrictEqual(["keep", "Body."]);
  });

  it("refuses a line that opens and closes ``` itself, rather than reading it as a fence that swallows the rest", () => {
    const refusals: readonly RenderRefusal[] = unwrapErr(
      layoutPolicy({ markdown: "```npm``` is the tool\n\nAfter.", measure }),
    );
    expect(refusals.map((refusal) => refusal.line)).toStrictEqual([1]);
  });

  it("reads a leading --- with no closing one as a horizontal rule, never as front matter swallowing the file", () => {
    const refusals: readonly RenderRefusal[] = unwrapErr(layoutPolicy({ markdown: "---\n\nBody.", measure }));
    expect(refusals[0]!.reason).toContain("a horizontal rule");
  });

  it("draws a line starting with ``` inside a fence, closing only on a bare run at least as long as the opener", () => {
    const lines = laidLines({ markdown: ["````", "```js", "``` then text", "```", "````", "After."].join("\n") });
    expect(lines.map((line) => [line.text, line.font])).toStrictEqual([
      ["```js", "mono"],
      ["``` then text", "mono"],
      ["```", "mono"],
      ["After.", "regular"],
    ]);
  });

  it("draws a table body row made of dashes, since only the row under the header is the separator", () => {
    const lines = laidLines({ markdown: "| A | B |\n|---|---|\n| - | - |" });
    expect(lines.map((line) => line.text)).toStrictEqual(["A · B", "-", "-"]);
  });

  it("refuses a ~~~ fence, whose lines would otherwise be read as markdown", () => {
    const refusals: readonly RenderRefusal[] = unwrapErr(
      layoutPolicy({ markdown: "~~~\n# not a heading\n~~~", measure }),
    );
    expect(refusals.map((refusal) => refusal.line)).toStrictEqual([1, 3]);
    expect(refusals[0]!.reason).toContain("a code fence written with ~~~");
  });

  it("still refuses an indented code block outside a list", () => {
    const refusals: readonly RenderRefusal[] = unwrapErr(layoutPolicy({ markdown: "Body.\n\n    code", measure }));
    expect(refusals[0]!.line).toBe(3);
    expect(refusals[0]!.reason).toContain("an indented code block");
  });

  it("refuses a horizontal rule rather than dropping it", () => {
    const laid = layoutPolicy({ markdown: "Body.\n\n***\n", measure });
    expect(unwrapErr(laid)[0]!.reason).toContain("a horizontal rule");
  });

  it("keeps a fenced block's lines verbatim, in the monospaced face", () => {
    const lines = laidLines({ markdown: "```\n  keep   this\n```" });
    expect(lines[0]!.text).toBe("  keep   this");
    expect(lines[0]!.font).toBe("mono");
    expect(lines[0]!.size).toBe(PAGE.bodySize - 1);
  });

  it("shrinks a fenced block whose widest line would run off the page, since it is never wrapped", () => {
    const lines = laidLines({ markdown: ["```", "x".repeat(140), "short", "```"].join("\n") });
    expect(lines[0]!.size).toBeCloseTo((COLUMN - 18) / (140 * 0.6), 6);
    expect(lines[1]!.size).toBe(lines[0]!.size);
  });

  it("refuses a fenced line too wide to set at a readable size, naming its own line", () => {
    const refusals: readonly RenderRefusal[] = unwrapErr(
      layoutPolicy({ markdown: ["Body.", "", "```", "short", "x".repeat(16_000), "```"].join("\n"), measure }),
    );
    expect(refusals).toStrictEqual([
      {
        line: 5,
        reason: "a fenced line of 16000 characters, wider than the page holds at a readable size (at most 149)",
      },
    ]);
  });

  it("lays out a fence of 200,000 lines without overflowing the stack", () => {
    const lines = laidLines({ markdown: ["```", ...Array.from({ length: 200_000 }, () => "a"), "```"].join("\n") });
    expect(lines.length).toBe(200_000);
  });

  it("sets a list six levels deep, and refuses a seventh rather than set it past the page edge", () => {
    const six = laidLines({ markdown: `- a\n${" ".repeat(24)}- six` });
    expect(six[1]!.indent).toBe(7 * 18);
    const refusals: readonly RenderRefusal[] = unwrapErr(
      layoutPolicy({ markdown: `- a\n${" ".repeat(25)}- seven\n\n${" ".repeat(120)}deep paragraph`, measure }),
    );
    expect(refusals).toStrictEqual([
      { line: 2, reason: "a list nested 7 levels deep, deeper than the 6 this renderer sets" },
      { line: 4, reason: "a list nested 30 levels deep, deeper than the 6 this renderer sets" },
    ]);
  });

  it("lays out nothing for an empty document", () => {
    const laid = layoutPolicy({ markdown: "", measure });
    expect(unwrap(laid).length).toBe(0);
  });
});

describe("undrawableCharacters", () => {
  const drawable: ReadonlySet<number> = new Set("abc -".split("").map((character) => character.codePointAt(0)!));

  it("names the first undrawable character on each line, outside the front matter", () => {
    expect(undrawableCharacters({ drawable, markdown: "---\n▶\n---\nabc\na ──▶ b" })).toStrictEqual([
      { line: 5, reason: '"─" (U+2500) is a character the PDF\'s standard fonts cannot draw' },
    ]);
  });

  it("names a tab or other control character, which the standard fonts cannot encode either", () => {
    expect(undrawableCharacters({ drawable, markdown: "a\tb" })).toStrictEqual([
      { line: 1, reason: '"\\t" (U+0009) is a character the PDF\'s standard fonts cannot draw' },
    ]);
  });

  it("refuses nothing when every character is drawable", () => {
    expect(undrawableCharacters({ drawable, markdown: "abc - cab" })).toStrictEqual([]);
  });
});

describe("imageFormatOf", () => {
  it("reads PNG and JPEG from their signatures, and nothing else", () => {
    expect(imageFormatOf({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]) })).toBe("png");
    expect(imageFormatOf({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) })).toBe("jpeg");
    expect(imageFormatOf({ bytes: new Uint8Array([0x47, 0x49, 0x46]) })).toBe(null);
  });
});

describe("pngPixels", () => {
  it("reads width times height from the IHDR header, and nothing from a file too short to hold one", () => {
    const header = new Uint8Array(24);
    const view = new DataView(header.buffer);
    view.setUint32(16, 65535);
    view.setUint32(20, 65535);
    expect(pngPixels({ bytes: header })).toBe(65535 * 65535);
    expect(pngPixels({ bytes: new Uint8Array(10) })).toBe(null);
  });
});

describe("markdownWords", () => {
  it("drops the front matter and the syntax that is an instruction to the renderer", () => {
    expect([
      ...markdownWords({ markdown: ["---", 'a: "b"', "---", "", "## Scope", "", "- One", "Two"].join("\n") }),
    ]).toStrictEqual(["Scope", "One", "Two"]);
  });

  it("keeps inline emphasis, because the renderer passes it through verbatim", () => {
    expect([...markdownWords({ markdown: "Users **must** comply." })]).toStrictEqual(["Users", "**must**", "comply."]);
  });

  it("drops quote markers, table pipes, the separator row and an image line, and keeps a number", () => {
    const markdown = ["> Quoted", "| A | B |", "|---|---|", "| c | d |", "![fig](x.png)", "1. One", "   - Two"].join(
      "\n",
    );
    expect([...markdownWords({ markdown })]).toStrictEqual(["Quoted", "A", "B", "c", "d", "1.", "One", "Two"]);
  });

  it("agrees with the layout's own words on every new construct, so a faithful render verifies", () => {
    const markdown = ["> Quoted", "| A | B |", "|---|---|", "| c | d |", "![fig](x.png)", "1. One", "   - Two"].join(
      "\n",
    );
    const drawn = textLines({ blocks: unwrap(layoutPolicy({ markdown, measure })) }).map((line) => line.text);
    const verification = verifyRender({
      rendered: renderedWords({ text: drawn.join("\n") }),
      source: markdownWords({ markdown }),
    });
    expect(verification.matched).toBe(true);
  });

  it("verifies a faithful render of a standalone middle dot and an indented heading", () => {
    const markdown = "  # Title\n\nOwner · Platform Lead";
    const drawn = laidLines({ markdown }).map((line) => line.text);
    const verification = verifyRender({
      rendered: renderedWords({ text: drawn.join("\n") }),
      source: markdownWords({ markdown }),
    });
    expect(verification.matched).toBe(true);
  });

  it("agrees with the layout on a nested fence and a dash-only table row, so each faithful render verifies", () => {
    const markdown = ["````", "``` then text", "````", "| A | B |", "|---|---|", "| - | - |"].join("\n");
    const drawn = laidLines({ markdown }).map((line) => line.text);
    const verification = verifyRender({
      rendered: renderedWords({ text: drawn.join("\n") }),
      source: markdownWords({ markdown }),
    });
    expect([...markdownWords({ markdown })]).toStrictEqual(["```", "then", "text", "A", "B", "-", "-"]);
    expect(verification.matched).toBe(true);
  });

  it("agrees with the layout on a marker followed only by whitespace, which the layout draws as its text", () => {
    const markdown = ["Owners:", "", "- ", "- Alice", "", "# ", "", "- "].join("\n");
    const drawn = laidLines({ markdown }).map((line) => line.text);
    const verification = verifyRender({
      rendered: renderedWords({ text: drawn.join("\n") }),
      source: markdownWords({ markdown }),
    });
    expect([...markdownWords({ markdown })]).toStrictEqual(["Owners:", "-", "Alice", "#", "-"]);
    expect(verification.matched).toBe(true);
  });

  it("lays out one table cell, and one word, too long to spread as call arguments", () => {
    // At 200pt a character, a word sets two characters to a line and an indented cell one word: both pass
    // the ~120,000 lines at which spreading them as call arguments overflowed. The header wraps to 3 lines.
    const wide: TextWidth = ({ text }) => text.length * 200;
    const cell = layoutPolicy({ markdown: `| A | B |\n|---|---|\n| x | ${"a ".repeat(300_000)}|`, measure: wide });
    const word = layoutPolicy({ markdown: "b".repeat(300_000), measure: wide });
    expect(unwrap(cell).length).toBe(300_004);
    expect(unwrap(word).length).toBe(150_000);
  });

  it("keeps a fenced line verbatim, even one that starts like a list item", () => {
    expect([...markdownWords({ markdown: "```\n- not a bullet\n```" })]).toStrictEqual(["-", "not", "a", "bullet"]);
  });
});

describe("renderedWords", () => {
  it("drops the bullet the renderer draws, which is not a word of the policy", () => {
    expect([...renderedWords({ text: "•  Never input PII" })]).toStrictEqual(["Never", "input", "PII"]);
  });
});

describe("verifyRender", () => {
  it("matches when the same characters come back in the same order", () => {
    const verification = verifyRender({ rendered: ["Never", "input", "PII"], source: ["Never", "input", "PII"] });
    expect(verification.matched).toBe(true);
    expect(verification.firstDivergence).toBe(-1);
    expect(verification.sourceLength).toBe(13);
  });

  it("matches across a word the renderer hard-broke, because whitespace is not compared", () => {
    const verification = verifyRender({ rendered: ["https://exa", "mple.com"], source: ["https://example.com"] });
    expect(verification.matched).toBe(true);
  });

  it("reports the first divergence in context", () => {
    const verification = verifyRender({
      rendered: ["used", "in", "any", "offical", "capacity"],
      source: ["used", "in", "any", "official", "capacity"],
    });
    expect(verification.matched).toBe(false);
    expect(verification.firstDivergence).toBe(14);
    expect(verification.context).toContain("markdown: ialcapacity");
    expect(verification.context).toContain("pdf: alcapacity");
  });

  it("reports a PDF that ran out of characters as a divergence at the end", () => {
    const verification = verifyRender({ rendered: ["abc"], source: ["abcdef"] });
    expect(verification.matched).toBe(false);
    expect(verification.renderedLength).toBe(3);
    expect(verification.context).toContain("pdf: <end>");
  });

  it("matches two empty documents", () => {
    expect(verifyRender({ rendered: [], source: [] }).matched).toBe(true);
  });
});
