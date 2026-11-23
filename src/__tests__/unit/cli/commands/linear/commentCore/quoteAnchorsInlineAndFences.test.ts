/*
 * `quoteAnchors`, the anchor check of a document comment: emphasis, links, list and heading markers, escapes, table
 * cells and code fences, each read as the page draws it.
 */
import { describe, expect, it } from "vitest";

import { quoteAnchors } from "../../../../../../cli/commands/linear/commentCore.js";
import { CONTENT } from "./harness.js";

describe("quoteAnchors", () => {
  it("finds a passage the stored markdown splits with emphasis and code markers", () => {
    expect(
      quoteAnchors({ content: CONTENT, quote: "Do we also switch the container entrypoint to node directly now?" }),
    ).toBe(true);
  });

  it("does not find a passage the document does not hold", () => {
    expect(quoteAnchors({ content: CONTENT, quote: "Lean: yes, now." })).toBe(false);
  });

  it("does not anchor a quote that is only markup", () => {
    expect(quoteAnchors({ content: CONTENT, quote: "**" })).toBe(false);
  });

  it("does not anchor a quote that spans a paragraph break read as a space", () => {
    expect(quoteAnchors({ content: `## Key Debates\n\n${CONTENT}`, quote: "Key Debates Do we also switch" })).toBe(
      false,
    );
  });

  it("does not read a list number or heading marker as text, but finds the heading's own words", () => {
    const content = `## Key Debates\n\n${CONTENT}`;

    expect(quoteAnchors({ content, quote: "3. Do we also switch" })).toBe(false);
    expect(quoteAnchors({ content, quote: "## Key" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Key Debates" })).toBe(true);
  });

  it("reads a link as its label, never its URL", () => {
    const content = "See [the POC branch](https://x.test/poc) for the diff.";

    expect(quoteAnchors({ content, quote: "See the POC branch for the diff." })).toBe(true);
    expect(quoteAnchors({ content, quote: "x.test" })).toBe(false);
  });

  it("keeps an underscore inside a word and drops one that delimits emphasis", () => {
    expect(quoteAnchors({ content: "rename `snake_case` keys", quote: "snakecase" })).toBe(false);
    expect(quoteAnchors({ content: "rename `snake_case` keys", quote: "rename snake_case keys" })).toBe(true);
    expect(quoteAnchors({ content: "this is _really_ it", quote: "this is really it" })).toBe(true);
  });

  it("compares the quote literally, so a quote carrying markup no reader sees is refused", () => {
    expect(quoteAnchors({ content: "**Lean: no, as a follow-up.**", quote: "**Lean: no, as a follow-up.**" })).toBe(
      false,
    );
    expect(quoteAnchors({ content: "**Lean: no, as a follow-up.**", quote: "Lean: no, as a follow-up." })).toBe(true);
  });

  it("keeps every character inside a code span, and resolves an escape to the character a reader sees", () => {
    expect(quoteAnchors({ content: "match `src/*.ts` files", quote: "match src/*.ts files" })).toBe(true);
    expect(quoteAnchors({ content: "match `src/*.ts` files", quote: "src/.ts" })).toBe(false);
    expect(quoteAnchors({ content: "open `C:\\Users\\me`", quote: "C:\\Users\\me" })).toBe(true);
    expect(quoteAnchors({ content: "open `C:\\Users\\me`", quote: "C:Usersme" })).toBe(false);
    expect(quoteAnchors({ content: "the product 5\\*3 is", quote: "5*3 is" })).toBe(true);
    expect(quoteAnchors({ content: "the product 5\\*3 is", quote: "53 is" })).toBe(false);
  });

  it("anchors to no text a reader never sees — image alt, collapsible marker", () => {
    const content = ["![architecture diagram of the pool](https://x.test/a.png)", "+++ Details"].join("\n\n");

    expect(quoteAnchors({ content, quote: "architecture diagram of the pool" })).toBe(false);
    expect(quoteAnchors({ content, quote: "+++ Details" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Details" })).toBe(true);
  });

  it("reads nothing in a document holding a link reference definition, whose references Linear may not resolve (r21)", () => {
    const content = "We lean towards [A] for launch.\n\n[A]: Postgres (recommended)";

    expect(quoteAnchors({ content, quote: "towards A for launch." })).toBe(false);
    expect(quoteAnchors({ content, quote: "We lean towards" })).toBe(false);
    expect(quoteAnchors({ content: "We lean towards [A] for launch.", quote: "We lean towards [A] for launch." })).toBe(
      true,
    );
  });

  it("reads each table cell as its own block, never the pipes or the separator row", () => {
    const content = "| Option | Lean |\n| --- | --- |\n| A | no |";

    expect(quoteAnchors({ content, quote: "Option" })).toBe(true);
    expect(quoteAnchors({ content, quote: "Option | Lean" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Option Lean" })).toBe(false);
    expect(quoteAnchors({ content, quote: "--- | ---" })).toBe(false);
    expect(quoteAnchors({ content, quote: "| Option" })).toBe(false);
  });

  it("never reads a link's URL, whatever its label or URL holds", () => {
    const bracketed = "Tracked in [[INFR-12] pool exhaustion](https://tracker.test/o/issue/INFR-12)";
    const escaped = "[the \\[draft\\] RFC](https://x.test/secret-rfc)";
    const parenthesised = "See [the logs](https://x.test/q=(a)tail) now";

    expect(quoteAnchors({ content: bracketed, quote: "[INFR-12] pool exhaustion" })).toBe(true);
    expect(quoteAnchors({ content: bracketed, quote: "tracker.test/o/issue/INFR-12" })).toBe(false);
    expect(quoteAnchors({ content: escaped, quote: "the [draft] RFC" })).toBe(true);
    expect(quoteAnchors({ content: escaped, quote: "x.test/secret-rfc" })).toBe(false);
    expect(quoteAnchors({ content: parenthesised, quote: "See the logs now" })).toBe(true);
    expect(quoteAnchors({ content: parenthesised, quote: "tail) now" })).toBe(false);
  });

  it("reads nothing in a document holding an indented code block, which Linear never writes (r22)", () => {
    const content = "The interface:\n\n    /\\*\\* Just for tracking/debugging reasons \\*/\n\nThat is all.";

    expect(quoteAnchors({ content, quote: "reasons \\*/" })).toBe(false);
    expect(quoteAnchors({ content, quote: "That is all." })).toBe(false);
    expect(quoteAnchors({ content: "```\n    indented in a fence\n```", quote: "indented in a fence" })).toBe(true);
  });

  it("reads nothing in a document whose last fence is left open, since Linear closes every block it writes (r23)", () => {
    const content =
      "Add this to CLAUDE.md:\n\n```md\n## Commands\n```bash\nyarn test\n```\n```\n\nThen **Lean:** no, as a \\*follow-up\\*.";

    expect(quoteAnchors({ content, quote: "**Lean:**" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Add this to CLAUDE.md:" })).toBe(false);
  });

  it("reads nothing when a fence touches a line of text, as a code line of backticks does (r23)", () => {
    const content = "Before.\n\n```md\nExample:\n```\n_not italic_ here\n```ts\nconst pool = 5;\n```\n\nAfter **it**.";

    expect(quoteAnchors({ content, quote: "not italic here" })).toBe(false);
    expect(quoteAnchors({ content, quote: "Before." })).toBe(false);
  });

  it("reads nothing when a code block holds a line of backticks, or nothing at all (r23)", () => {
    expect(quoteAnchors({ content: "```md\n```bash\n```\n\nAfter.", quote: "After." })).toBe(false);
    expect(quoteAnchors({ content: "```md\n```\n\nAfter.", quote: "After." })).toBe(false);
  });

  it("reads nothing when a list item beside a fence sits no further left than it, as a code line does (r24)", () => {
    const content =
      "Proposed template:\n\n```md\n## Checklist\n```\n- [ ] Tests added\n- [ ] **Docs** updated\n```\nThanks!\n```\n\nThat is all.";

    expect(quoteAnchors({ content, quote: "Docs updated" })).toBe(false);
    expect(quoteAnchors({ content, quote: "That is all." })).toBe(false);
  });

  it("reads closed code blocks set apart by blank lines or list items as written (r23)", () => {
    const content =
      "Intro.\n\n```ts\nconst pool = 5;\n```\n\nThen **Lean:** no.\n\n- step\n  ```sh\n  yarn test\n  ```\n- next";

    expect(quoteAnchors({ content, quote: "const pool = 5;" })).toBe(true);
    expect(quoteAnchors({ content, quote: "Lean: no." })).toBe(true);
    expect(quoteAnchors({ content, quote: "yarn test" })).toBe(true);
  });
});
