/** A Linear document's markdown as a reader sees it, one selectable run at a time. */
import { describe, expect, it } from "vitest";

import { readerRuns } from "../../../../../cli/commands/linear/documentReader.js";

describe("readerRuns", () => {
  it("reads a heading, a list item and each table cell as its own run, markup drawn away", () => {
    const content = [
      "## Key Debates",
      "",
      "3. **Do we also switch the container entrypoint to** `node` **directly now?**",
      "",
      "| Option | Lean |",
      "| --- | --- |",
      "| A | no |",
    ].join("\n");

    expect(readerRuns({ content })).toEqual([
      "Key Debates",
      "Do we also switch the container entrypoint to node directly now?",
      "Option",
      "Lean",
      "A",
      "no",
    ]);
  });

  it("splits a paragraph at an image and a line break, so nothing is quoted across either", () => {
    expect(readerRuns({ content: "before ![diagram](https://x.test/a.png) after  \nnext line" })).toEqual([
      "before",
      "after",
      "next line",
    ]);
  });

  it("draws Linear's collapsible marker as its title alone, its own run", () => {
    expect(readerRuns({ content: "+++ Details\nbody text\n+++" })).toEqual(["Details", "body text"]);
  });

  it("keeps a code block's `+++` line as code, one run per line (fallback review r4)", () => {
    const content = ["```diff", "--- a/src/pool.ts", "+++ b/src/pool.ts", "```"].join("\n");

    expect(readerRuns({ content })).toEqual(["--- a/src/pool.ts", "+++ b/src/pool.ts"]);
  });

  it("splits a paragraph at a soft break, so no run spans two source lines", () => {
    expect(readerRuns({ content: "first line\nsecond line" })).toEqual(["first line", "second line"]);
  });

  it("breaks at a character reference rather than decoding it, since the page may show it as typed (r18)", () => {
    expect(readerRuns({ content: "a&nbsp;gap &lt;slug&gt; here" })).toEqual(["a", "gap", "slug", "here"]);
  });

  it("keeps a double space and a non-breaking space exactly as drawn", () => {
    expect(readerRuns({ content: "two  spaces and a gap" })).toEqual(["two  spaces and a gap"]);
  });

  it("reads a bare URL and an angle-bracket autolink as breaks, and a labelled link as its label", () => {
    const content = "see https://linear.app/x/issue/ABC-1 or <https://x.test/y> or [the doc](https://x.test/z) now";

    expect(readerRuns({ content })).toEqual(["see", "or", "or the doc now"]);
  });

  it("reads nothing from an empty document", () => {
    expect(readerRuns({ content: "" })).toEqual([]);
  });
});
