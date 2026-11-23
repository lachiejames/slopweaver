/*
 * The structural escapes a field could use to break the rendered issue are refused: a collapsible delimiter, a
 * heading, a code fence, a broken code language, a multi-line bullet or acceptance item, an unsafe media url.
 * The refusal names the offending block's exact path, and the same characters as prose are left alone.
 */
import { describe, expect, it } from "vitest";

import { structuredIssueSchema } from "../../../../../outbound/linear/schema.js";
import { firstMessage, structured } from "./harness.js";

describe("structuredIssueSchema — structural escapes are refused", () => {
  it("refuses a `+++` line, which would close the collapsible early", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ problem: [{ kind: "para", text: "Here is a diff:\n+++ b/src/index.ts\nand more." }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("collapsible delimiter");
  });

  it("ALLOWS a `+++` line inside a code block, because the fence cannot be closed early", () => {
    // A unified diff's header lines begin with `+++`. Refusing them was a false alarm that bought no safety
    // once the renderer started fencing with a backtick run longer than anything in the content.
    const result = structuredIssueSchema.safeParse(
      structured({ aiPrompt: [{ kind: "code", lang: "diff", text: "--- a/x\n+++ b/x\n@@" }] }),
    );
    expect(result.success).toBe(true);
  });

  it("refuses backticks in a code language, which would close the fence on its own opening line", () => {
    // Measured: `lang: "js```"` emitted ```` ```js``` ````, closing the block immediately.
    const result = structuredIssueSchema.safeParse(
      structured({ solution: [{ kind: "code", lang: "js```", text: "x" }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("one bare word");
  });

  it("refuses a newline in a code language, which injects a line past the section guard", () => {
    // `lang: "js\n## Sneaky"` smuggled a heading into the document; `lang` was never checked for structure.
    const result = structuredIssueSchema.safeParse(
      structured({ solution: [{ kind: "code", lang: "js\n## Sneaky", text: "x" }] }),
    );
    expect(result.success).toBe(false);
  });

  it("still accepts an ordinary language and an empty one", () => {
    expect(
      structuredIssueSchema.safeParse(structured({ solution: [{ kind: "code", lang: "ts", text: "x" }] })).success,
    ).toBe(true);
    expect(
      structuredIssueSchema.safeParse(structured({ solution: [{ kind: "code", lang: "", text: "x" }] })).success,
    ).toBe(true);
  });

  it("refuses a code FENCE inside a paragraph, which would swallow every later section", () => {
    // Verified against the renderer: an unclosed fence absorbs `## Solution` AND the collapsible, so the
    // required dropdown silently never renders and a byte golden asserts the broken bytes happily.
    const result = structuredIssueSchema.safeParse(
      structured({ problem: [{ kind: "para", text: "Evidence:\n\n```" }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("swallowed");
  });

  it("refuses a paragraph that is ONLY an image as the Problem lead", () => {
    // It satisfies `kind === "para"` while visibly opening the ticket with a screenshot.
    const result = structuredIssueSchema.safeParse(
      structured({ problem: [{ kind: "para", text: "![proof](https://x.test/a)" }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("must OPEN with a paragraph");
  });

  it("does NOT refuse an inline `+++`, which is prose rather than structure", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ problem: [{ kind: "para", text: "The score went from +++ to ---." }] }),
    );
    expect(result.success).toBe(true);
  });

  it("refuses a media url carrying whitespace or angle brackets, which break the angle-bracketed form", () => {
    const result = structuredIssueSchema.safeParse(
      structured({
        problem: [
          { kind: "para", text: "ok" },
          { alt: "x", kind: "media", mime: "image/png", url: "https://x.test/a%3E>evil" },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("refuses a heading line, which would escape the section", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ solution: [{ kind: "para", text: "Do this.\n## Sneaky\nAnd that." }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("escape the section");
  });

  it("refuses a newline inside a bullet, which would break the list", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ solution: [{ items: [{ text: "first\nsecond" }], kind: "bullets" }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("ONE line");
  });

  it("refuses a newline inside an acceptance item", () => {
    const result = structuredIssueSchema.safeParse(structured({ acceptance: ["it works\nand also this"] }));
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("ONE line");
  });

  it("reports the exact path of the offending block", () => {
    const result = structuredIssueSchema.safeParse(
      structured({
        solution: [
          { kind: "para", text: "fine" },
          { kind: "para", text: "+++ oops" },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(["solution", 1, "text"]);
  });
});
