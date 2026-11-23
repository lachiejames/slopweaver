/*
 * `quoteAnchors`, the anchor check of a document comment: rules, character references, fenced code, line endings,
 * exact whitespace, raw HTML, Unicode boundaries, bare URLs and mermaid blocks.
 */
import { describe, expect, it } from "vitest";

import { quoteAnchors } from "../../../../../../cli/commands/linear/commentCore.js";

describe("quoteAnchors", () => {
  it("reads no text in a rule or a setext underline", () => {
    const content = ["para", "", "---", "", "Title", "====="].join("\n");

    expect(quoteAnchors({ content, quote: "---" })).toBe(false);
    expect(quoteAnchors({ content, quote: "=====" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Title" })).toBe(true);
  });

  it("breaks at a character reference, since the page may show it as typed (r18), and reads link syntax in a code span as written", () => {
    expect(quoteAnchors({ content: "salt &amp;amp; pepper", quote: "salt &amp; pepper" })).toBe(false);
    expect(quoteAnchors({ content: "salt &amp;amp; pepper", quote: "salt &amp;amp; pepper" })).toBe(false);
    expect(quoteAnchors({ content: "salt &amp;amp; pepper", quote: "salt" })).toBe(true);
    expect(quoteAnchors({ content: "| a &amp;rarr; b |\n| - |", quote: "a → b" })).toBe(false);
    expect(quoteAnchors({ content: "call `arr[i](x)y` here", quote: "arr[i](x)y" })).toBe(true);
    expect(quoteAnchors({ content: "call `arr[i](x)y` here", quote: "arriy" })).toBe(false);
  });

  it("keeps a ~~~ line inside a backtick fence as code, so the prose after it stays prose", () => {
    const content = "```\n~~~\n```\n\nsee [it](https://x.test/secret) here";

    expect(quoteAnchors({ content, quote: "see it here" })).toBe(true);
    expect(quoteAnchors({ content, quote: "x.test/secret" })).toBe(false);
  });

  it("reads a fenced code block's lines verbatim, heading-like markers included", () => {
    const content = "```bash\n# install the deps\nyarn install\n```";

    expect(quoteAnchors({ content, quote: "# install the deps" })).toBe(true);
  });

  it("does not read a diff's `+++` header in a code block as a collapsible title (fallback review r4)", () => {
    const content = "```diff\n--- a/src/pool.ts\n+++ b/src/pool.ts\n```";

    expect(quoteAnchors({ content, quote: "a/src/pool.ts b/src/pool.ts" })).toBe(false);
    expect(quoteAnchors({ content, quote: "+++ b/src/pool.ts" })).toBe(true);
  });

  it("does not anchor across a code block's line ending or a paragraph's soft break", () => {
    expect(quoteAnchors({ content: "```\nyarn install\nyarn build\n```", quote: "yarn install yarn build" })).toBe(
      false,
    );
    expect(quoteAnchors({ content: "first line\nsecond line", quote: "first line second line" })).toBe(false);
    expect(quoteAnchors({ content: "first line\nsecond line", quote: "second line" })).toBe(true);
  });

  it("compares whitespace exactly: a plain space never matches a non-breaking one, nor one space two", () => {
    expect(quoteAnchors({ content: "a gap", quote: "a gap" })).toBe(false);
    expect(quoteAnchors({ content: "a gap", quote: "a gap" })).toBe(true);
    expect(quoteAnchors({ content: "two  spaces", quote: "two spaces" })).toBe(false);
    expect(quoteAnchors({ content: "two spaces", quote: "two  spaces" })).toBe(false);
  });

  it("never joins the text on the two sides of raw HTML, whatever the HTML parser keeps (fallback review r5)", () => {
    expect(quoteAnchors({ content: 'alpha<input\ntype="text">beta', quote: "alphabeta" })).toBe(false);
    expect(quoteAnchors({ content: "alpha</em\n    >beta", quote: "alphabeta" })).toBe(false);
    expect(quoteAnchors({ content: "foo<input>bar", quote: "foobar" })).toBe(false);
    expect(quoteAnchors({ content: "foo<td>bar", quote: "foobar" })).toBe(false);
    expect(quoteAnchors({ content: "foo<body>bar", quote: "foobar" })).toBe(false);
    expect(quoteAnchors({ content: 'Ship it<input type="checkbox" checked> now', quote: "Ship it now" })).toBe(false);
  });

  it("anchors nothing in a document holding raw HTML anywhere, since what it hides has no boundary (r6, r7)", () => {
    // Text between tags, and an element left open into the blocks after it.
    expect(quoteAnchors({ content: "before <style>secret note</style> after", quote: "secret note" })).toBe(false);
    expect(quoteAnchors({ content: "| a |\n|---|\n| <style>secret note</style> |", quote: "secret note" })).toBe(false);
    expect(quoteAnchors({ content: "intro <b hidden>x\n\nquotable secret", quote: "quotable secret" })).toBe(false);
    expect(quoteAnchors({ content: "- outer <i hidden>\n  - quotable secret", quote: "quotable secret" })).toBe(false);
    expect(quoteAnchors({ content: "kept\n\n<div hidden>\n\nsecret note\n\n</div>", quote: "secret note" })).toBe(
      false,
    );
    // A comment or `<script>` a container ends while a browser keeps it open.
    expect(quoteAnchors({ content: "> <!--\n\nquotable secret", quote: "quotable secret" })).toBe(false);
    expect(quoteAnchors({ content: "- <script>\n\nquotable secret", quote: "quotable secret" })).toBe(false);
    // Text before the HTML, and a closed comment: refused too, since a `<style>` can hide what sits above it.
    expect(quoteAnchors({ content: "kept before\n\n<style>p{display:none}</style>", quote: "kept before" })).toBe(
      false,
    );
    expect(quoteAnchors({ content: "<!-- a note -->\n\nplain after", quote: "plain after" })).toBe(false);
    expect(quoteAnchors({ content: "kept before\n\nplain after", quote: "plain after" })).toBe(true);
  });

  it("does not anchor across a Unicode line or paragraph separator", () => {
    const LINE_SEPARATOR = String.fromCharCode(0x2028);
    const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

    expect(quoteAnchors({ content: `one${LINE_SEPARATOR}two`, quote: `one${LINE_SEPARATOR}two` })).toBe(false);
    expect(quoteAnchors({ content: `one${PARAGRAPH_SEPARATOR}two`, quote: "two" })).toBe(true);
  });

  it("does not anchor in a bare URL carrying a character its address percent-encodes", () => {
    const content = "tracked in https://linear.app/o/issue/INFR-12/pool-exhaustión for now";

    expect(quoteAnchors({ content, quote: "linear.app/o/issue/INFR-12" })).toBe(false);
    expect(quoteAnchors({ content: "see https://x.test/100% here", quote: "x.test/100%" })).toBe(false);
    expect(quoteAnchors({ content: "see <https://x.test/ä> here", quote: "x.test/ä" })).toBe(false);
    expect(quoteAnchors({ content: "see www.x.test/ä here", quote: "x.test/ä" })).toBe(false);
    expect(quoteAnchors({ content, quote: "for now" })).toBe(true);
  });

  it("does not anchor across a line ending inside a code span", () => {
    expect(quoteAnchors({ content: "run `yarn\ninstall` now", quote: "yarn install" })).toBe(false);
    expect(quoteAnchors({ content: "run `yarn\ninstall` now", quote: "install" })).toBe(true);
  });

  it("does not anchor in a mermaid block, which Linear draws as a diagram (fallback review r8)", () => {
    const content = "```mermaid\ngraph TD\n  Client-->Gateway\n```\n\nThe pool.";

    expect(quoteAnchors({ content, quote: "Client-->Gateway" })).toBe(false);
    expect(quoteAnchors({ content: "```Mermaid\ngraph TD\n```", quote: "graph TD" })).toBe(false);
    expect(quoteAnchors({ content: "```ts\nconst pool = 5;\n```", quote: "const pool = 5;" })).toBe(true);
    expect(quoteAnchors({ content, quote: "The pool." })).toBe(true);
  });

  it("refuses a quote no reader could select: a lone surrogate, half a character, or nothing visible", () => {
    const grinning = String.fromCodePoint(0x1f600);
    const australia = String.fromCodePoint(0x1f1e6, 0x1f1fa);
    const zeroWidthSpace = String.fromCodePoint(0x200b);

    expect(quoteAnchors({ content: `Ship it ${grinning} today.`, quote: String.fromCharCode(0xd83d) })).toBe(false);
    expect(quoteAnchors({ content: `the cafe${String.fromCodePoint(0x0301)} menu`, quote: "the cafe" })).toBe(false);
    expect(quoteAnchors({ content: `flag ${australia} here`, quote: String.fromCodePoint(0x1f1e6) })).toBe(false);
    expect(quoteAnchors({ content: `foo${zeroWidthSpace}bar`, quote: zeroWidthSpace })).toBe(false);
    expect(quoteAnchors({ content: "foo&shy;bar", quote: String.fromCodePoint(0x00ad) })).toBe(false);
    expect(quoteAnchors({ content: `flag ${australia} here`, quote: `flag ${australia}` })).toBe(true);
  });

  it("finds character boundaries on the run as drawn, before any trim (fallback review r9)", () => {
    const acute = String.fromCodePoint(0x0301);
    const arabicNumberSign = String.fromCodePoint(0x0600);

    expect(quoteAnchors({ content: `\`\`\`\n ${acute}abc\n\`\`\``, quote: `${acute}abc` })).toBe(false);
    expect(quoteAnchors({ content: `see ![a](https://x.test/a.png) ${acute}tail`, quote: `${acute}tail` })).toBe(false);
    expect(quoteAnchors({ content: `\`\`\`\nabc${arabicNumberSign} \n\`\`\``, quote: `abc${arabicNumberSign}` })).toBe(
      false,
    );
    expect(quoteAnchors({ content: `see ![a](https://x.test/a.png) ${acute}tail`, quote: "tail" })).toBe(true);
  });

  it("does not anchor a quote of default-ignorable characters, which draw as nothing (fallback review r9)", () => {
    for (const ignorable of [0xfe0f, 0x034f, 0x180b, 0x115f]) {
      const quote = String.fromCodePoint(ignorable);

      expect(quoteAnchors({ content: `foo${quote}bar`, quote })).toBe(false);
    }
  });

  it("does not anchor in a code block whose language only starts with mermaid (fallback review r9)", () => {
    expect(quoteAnchors({ content: "```mermaid{x}\ngraph TD\n```", quote: "graph TD" })).toBe(false);
  });
});
