/*
 * A details fold, on either issue kind: its words never count toward the Problem cap, and every way its title
 * or blocks could escape the fold on Linear's grammar is refused at the offending path — an empty fold, a
 * blank or heading title, any line ending, a trailing `+++`, raw HTML, and the AI prompt's own title.
 */
import { describe, expect, it } from "vitest";

import { freeformIssueSchema, structuredIssueSchema } from "../../../../../outbound/linear/schema.js";
import { SECTION_MAX_WORDS } from "../../../../../outbound/linear/sectionWords.js";
import { RAW_HTML_CORRECTION } from "../../../../../outbound/linear/structuralEscapes.js";
import { firstMessage, structured } from "./harness.js";

describe("details folds", () => {
  const para = ({ text }: { text: string }): Record<string, unknown> => ({ kind: "para", text });
  /** Every line ending `documentReader.ts` splits Linear's text on: LF, CR, VT, FF, NEL, LS and PS. */
  const LINE_ENDINGS = [0x0a, 0x0d, 0x0b, 0x0c, 0x85, 0x2028, 0x2029];

  it("accepts a fold on either kind, and its words never count toward the Problem cap", () => {
    const long = Array.from({ length: SECTION_MAX_WORDS * 2 }, () => "word").join(" ");
    expect(
      structuredIssueSchema.safeParse(
        structured({ details: [{ blocks: [para({ text: long })], title: "Options weighed" }] }),
      ).success,
    ).toBe(true);
    expect(
      freeformIssueSchema.safeParse({
        aiPrompt: [para({ text: "brief" })],
        body: [para({ text: "Lead." })],
        details: [{ blocks: [para({ text: "More." })], title: "Detail" }],
        kind: "freeform",
      }).success,
    ).toBe(true);
  });

  it("refuses an empty details array, which would declare folds and render none", () => {
    expect(structuredIssueSchema.safeParse(structured({ details: [] })).success).toBe(false);
  });

  it("refuses a fold with no blocks, which a reader would open onto nothing", () => {
    expect(structuredIssueSchema.safeParse(structured({ details: [{ blocks: [], title: "Detail" }] })).success).toBe(
      false,
    );
  });

  it("refuses a blank title", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "x" })], title: "  " }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("may not be blank");
  });

  it("refuses a title opening a heading, addressed at the title", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "x" })], title: "### Detail" }] }),
    );
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(["details", 0, "title"]);
  });

  it("refuses a bare `###` title or paragraph line, which renders as an empty heading", () => {
    const title = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "x" })], title: "###" }] }),
    );
    const block = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "before\n  ##" })], title: "Detail" }] }),
    );
    expect([title, block].map((result) => result.error!.issues.map((issue) => issue.path))).toEqual([
      [["details", 0, "title"]],
      [["details", 0, "blocks", 0, "text"]],
    ]);
    expect(firstMessage({ result: title })).toContain("markdown heading");
  });

  it("refuses a delimiter, heading or fence any line ending puts on its own line in a fold", () => {
    const smuggle = ({ code, line }: { code: number; line: string }): string => {
      const result = freeformIssueSchema.safeParse({
        aiPrompt: [para({ text: "prompt" })],
        body: [para({ text: "Lead." })],
        details: [{ blocks: [para({ text: `before${String.fromCodePoint(code)}${line}` })], title: "Detail" }],
        kind: "freeform",
      });
      expect(result.error!.issues[0]!.path).toEqual(["details", 0, "blocks", 0, "text"]);
      return firstMessage({ result });
    };
    const delimiters = LINE_ENDINGS.map((code) => smuggle({ code, line: "+++" }).includes("collapsible delimiter"));
    expect(delimiters).toEqual(LINE_ENDINGS.map(() => true));
    expect(smuggle({ code: 0x0c, line: "## Heading" })).toContain("markdown heading");
    expect(smuggle({ code: 0x85, line: "```" })).toContain("code fence");
  });

  it("refuses every line ending in a title, which would split the opener line", () => {
    const separators = LINE_ENDINGS.map((code) =>
      structuredIssueSchema.safeParse(
        structured({
          details: [{ blocks: [para({ text: "x" })], title: `Rollout${String.fromCodePoint(code)}Tail` }],
        }),
      ),
    );
    expect(separators.map((result) => firstMessage({ result }).includes("ONE line"))).toEqual(
      LINE_ENDINGS.map(() => true),
    );
  });

  it("refuses a title ending in `+++` followed by trailing spaces", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "x" })], title: "Rollout +++   " }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("renders as text");
  });

  it("refuses a heading block inside a fold, which escapes the block on Linear's grammar", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [{ kind: "heading", text: "Sneaky" }], title: "Detail" }] }),
    );
    expect(result.success).toBe(false);
  });

  it("refuses a `+++` line in a fold's paragraph, addressed at that block", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "ok" }), para({ text: "+++" })], title: "Detail" }] }),
    );
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(["details", 0, "blocks", 1, "text"]);
    expect(firstMessage({ result })).toContain("collapsible delimiter");
  });

  it("refuses an unterminated HTML comment in a fold's paragraph, which swallows its closer and the AI fold", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "<!--" })], title: "Detail" }] }),
    );
    expect(result.error!.issues.map((issue) => issue.path)).toEqual([["details", 0, "blocks", 0, "text"]]);
    expect(firstMessage({ result })).toContain("raw HTML");
  });

  it("refuses raw HTML in a fold title and a list item, but not in a media alt, which renders escaped", () => {
    const blocks = [
      { items: [{ text: "an <div> item" }], kind: "bullets" },
      { alt: "an Array<string> diagram", kind: "media", mime: "image/png", url: "https://example.test/a.png" },
    ];
    const result = structuredIssueSchema.safeParse(structured({ details: [{ blocks, title: "<span>Detail" }] }));
    expect(result.error!.issues.map((issue) => issue.path)).toEqual([
      ["details", 0, "title"],
      ["details", 0, "blocks", 0, "items", 0, "text"],
    ]);
  });

  it("refuses a tab-indented open comment in a list item, which renders as `- \\t<!--`, an HTML block", () => {
    const blocks = [{ items: [{ text: "\t<!--" }], kind: "bullets" }];
    const result = structuredIssueSchema.safeParse(structured({ details: [{ blocks, title: "Detail" }] }));
    expect(result.error!.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["details", 0, "blocks", 0, "items", 0, "text"], RAW_HTML_CORRECTION],
    ]);
  });

  it("refuses a title ending in `+++`, the one-line form Linear renders as text", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "x" })], title: "Rollout +++" }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("renders as text");
  });

  it("refuses a newline in a title", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "x" })], title: "One\nTwo" }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("ONE line");
  });

  it("refuses the AI prompt's own title, in any case, which tooling reads as the agent brief", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "x" })], title: " prompt for AI agents " }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("agent brief");
  });

  it("refuses an undeclared key on a fold", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ details: [{ blocks: [para({ text: "x" })], open: true, title: "Detail" }] }),
    );
    expect(result.success).toBe(false);
  });
});
