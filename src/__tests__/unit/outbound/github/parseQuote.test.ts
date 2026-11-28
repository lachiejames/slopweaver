/**
 * A quote slot read back from the blocks the renderer writes after its first block: the source line, then the fold.
 */
import { describe, expect, it } from "vitest";

import { isQuoteSourceLine, quoteSlotAt } from "../../../../outbound/github/parseQuote.js";
import { t } from "./fixtures.js";

/** The three blocks a quote of `text` in a `fence` leaves after its proves-and-source block. */
function foldBlocks({ fence, text }: { fence: string; text: string }): string[] {
  return ["<details>\n<summary>Quoted output</summary>", `${fence}text\n${text}\n${fence}`, "</details>"];
}

/** Read a quote from `blocks` with a code-run source line, returning the slot and where the cursor stopped. */
function read({ blocks, sourceLine }: { blocks: string[]; sourceLine: string }): readonly unknown[] {
  const cursor = { at: 0, blocks };
  const slot = quoteSlotAt({ cursor, proves: t({ text: "it fails" }), runBy: "agent", sourceLine });
  return [slot, cursor.at];
}

describe("isQuoteSourceLine", () => {
  it("tells a source line from a screenshot's picture line", () => {
    expect([
      isQuoteSourceLine({ line: "<p>Source: <code>widgets checks</code></p>" }),
      isQuoteSourceLine({ line: '<p><img src="https://github.com/user-attachments/assets/a" alt="a"></p>' }),
    ]).toEqual([true, false]);
  });
});

describe("quoteSlotAt", () => {
  const source = "<p>Source: <code>widgets checks</code></p>";

  it("reads the source and the fenced output, leaving the cursor after the fold", () => {
    expect(read({ blocks: foldBlocks({ fence: "```", text: "a\nb" }), sourceLine: source })).toEqual([
      {
        kind: "quote",
        lang: "text",
        proves: t({ text: "it fails" }),
        runBy: "agent",
        source: { kind: "code", text: "widgets checks" },
        text: "a\nb",
      },
      3,
    ]);
  });

  it("refuses a fence the renderer would not pick for that text", () => {
    expect(read({ blocks: foldBlocks({ fence: "````", text: "a" }), sourceLine: source })[0]).toBe(undefined);
  });

  it("refuses a source of plain text, or of two runs", () => {
    const blocks = foldBlocks({ fence: "```", text: "a" });
    expect([
      read({ blocks, sourceLine: "<p>Source: the log</p>" })[0],
      read({ blocks, sourceLine: "<p>Source: <code>a</code> and <code>b</code></p>" })[0],
    ]).toEqual([undefined, undefined]);
  });

  it("refuses an empty quote and a missing fold close", () => {
    expect([
      read({ blocks: foldBlocks({ fence: "```", text: "" }), sourceLine: source })[0],
      read({ blocks: foldBlocks({ fence: "```", text: "a" }).slice(0, 2), sourceLine: source })[0],
    ]).toEqual([undefined, undefined]);
  });
});
