import { describe, expect, it } from "vitest";

import { githubCommentArtifactSchema } from "../../../../outbound/github/commentSchema.js";

const SUMMARY = [{ kind: "text", text: "please re-review this pull request" }];

describe("githubCommentArtifactSchema", () => {
  it("accepts a summary alone", () => {
    const parsed = githubCommentArtifactSchema.safeParse({ summary: SUMMARY });
    expect(parsed.success).toBe(true);
  });

  it("accepts an optional detail block", () => {
    const parsed = githubCommentArtifactSchema.safeParse({
      detail: [{ content: [{ kind: "text", text: "more context" }], kind: "para" }],
      summary: SUMMARY,
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an empty summary array", () => {
    const parsed = githubCommentArtifactSchema.safeParse({ summary: [] });
    expect(parsed.success).toBe(false);
  });

  it("refuses a summary over the word cap", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${String(i)}`).join(" ");
    const parsed = githubCommentArtifactSchema.safeParse({ summary: [{ kind: "text", text: long }] });
    expect(parsed.error!.issues.map((issue) => [issue.path.join("."), issue.message])).toStrictEqual([
      [
        "summary",
        "summary is 60 words (max 50) — it is the whole message above the fold. Move the rest into detail, which renders collapsed",
      ],
    ]);
  });

  it("refuses two adjacent text runs in the summary and in a detail paragraph, at the second run", () => {
    const twice = [
      { kind: "text", text: "please re-review " },
      { kind: "text", text: "this pull request" },
    ];
    const parsed = githubCommentArtifactSchema.safeParse({
      detail: [
        { kind: "code", lang: "", text: "yarn test" },
        { content: [{ kind: "strong", text: "acme" }, ...twice], kind: "para" },
      ],
      summary: twice,
    });
    expect(parsed.error!.issues.map((issue) => [issue.path.join("."), issue.message])).toStrictEqual([
      ["summary.1", "text runs at indices 0 and 1 are adjacent and render as one run. Merge them into one text run"],
      [
        "detail.1.content.2",
        "text runs at indices 1 and 2 are adjacent and render as one run. Merge them into one text run",
      ],
    ]);
  });

  it("refuses an unrecognised field", () => {
    const parsed = githubCommentArtifactSchema.safeParse({ bogus: true, summary: SUMMARY });
    expect(parsed.success).toBe(false);
  });
});
