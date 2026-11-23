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
    const long = Array.from({ length: 60 }, (_, i) => ({ kind: "text" as const, text: `word${String(i)} ` }));
    const parsed = githubCommentArtifactSchema.safeParse({ summary: long });
    expect(parsed.success).toBe(false);
  });

  it("refuses an unrecognised field", () => {
    const parsed = githubCommentArtifactSchema.safeParse({ bogus: true, summary: SUMMARY });
    expect(parsed.success).toBe(false);
  });
});
