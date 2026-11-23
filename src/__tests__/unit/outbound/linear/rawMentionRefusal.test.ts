/**
 * Hand-written mention markup is REFUSED by the form, in an issue body and in a comment alike.
 *
 * This is the half of the mention feature that has teeth without anyone remembering it exists. Resolution
 * only helps a caller who uses `@{key}`; a caller who pastes `@[name](id)` straight into a paragraph would
 * otherwise sail past every gate and notify whoever owns that id, with nothing having checked it is the
 * person they meant — and it looks perfect in review, because an id is unreadable.
 */
import { describe, expect, it } from "vitest";

import { linearCommentFormSchema } from "../../../../outbound/linear/commentSchema.js";
import { linearIssueArtifactSchema } from "../../../../outbound/linear/schema.js";

const ID_ADA = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * Every message a failed parse produced, joined — the assertion target for a refusal's reason. Each caller has
 * already asserted `success` false, and a failed parse always carries its `error`.
 */
function reasons({
  result,
}: {
  result: { success: boolean; error?: { issues: readonly { message: string }[] } };
}): string {
  return result.error!.issues.map((issue) => issue.message).join(" | ");
}

describe("raw mention markup in an issue body", () => {
  it("is refused in a paragraph", () => {
    const result = linearIssueArtifactSchema.safeParse({
      aiPrompt: [{ kind: "para", text: "brief" }],
      kind: "structured",
      problem: [{ kind: "para", text: `@[ada](${ID_ADA}) owns this` }],
      solution: [{ kind: "para", text: "s" }],
    });

    expect(result.success).toBe(false);
    expect(reasons({ result })).toContain("Linear's own mention markup");
  });

  it("is refused inside a list item nested under another list item", () => {
    const result = linearIssueArtifactSchema.safeParse({
      aiPrompt: [{ kind: "para", text: "brief" }],
      kind: "structured",
      problem: [
        { kind: "para", text: "opens with prose" },
        { items: [{ nested: [{ kind: "para", text: `@[ada](${ID_ADA})` }], text: "step one" }], kind: "bullets" },
      ],
      solution: [{ kind: "para", text: "s" }],
    });

    expect(result.success).toBe(false);
    expect(reasons({ result })).toContain("Linear's own mention markup");
  });

  it("is ACCEPTED inside a code block, which renders literally and notifies nobody", () => {
    const result = linearIssueArtifactSchema.safeParse({
      aiPrompt: [{ kind: "para", text: "brief" }],
      kind: "structured",
      problem: [
        { kind: "para", text: "opens with prose" },
        { kind: "code", lang: "", text: `the markup is @[ada](${ID_ADA})` },
      ],
      solution: [{ kind: "para", text: "s" }],
    });

    expect(result.success).toBe(true);
  });

  it("accepts the `@{key}` token the door actually resolves", () => {
    const result = linearIssueArtifactSchema.safeParse({
      aiPrompt: [{ kind: "para", text: "brief" }],
      kind: "structured",
      problem: [{ kind: "para", text: "@{ada} owns this" }],
      solution: [{ kind: "para", text: "s" }],
    });

    expect(result.success).toBe(true);
  });

  it("accepts an ordinary markdown link, which is not a mention", () => {
    const result = linearIssueArtifactSchema.safeParse({
      aiPrompt: [{ kind: "para", text: "brief" }],
      kind: "structured",
      problem: [{ kind: "para", text: "see [the run](https://example.test/run/1)" }],
      solution: [{ kind: "para", text: "s" }],
    });

    expect(result.success).toBe(true);
  });
});

describe("raw mention markup in a comment", () => {
  it("is refused in the summary, which is the whole message above the fold", () => {
    const result = linearCommentFormSchema.safeParse({
      artifact: {
        evidence: [{ label: "the run", url: "https://example.test/run/1" }],
        summary: `@[ada](${ID_ADA}) this is idle.`,
      },
      fields: { issueId: ID_ADA },
    });

    expect(result.success).toBe(false);
    expect(reasons({ result })).toContain("Linear's own mention markup");
  });

  it("is refused in a detail paragraph", () => {
    const result = linearCommentFormSchema.safeParse({
      artifact: {
        detail: [{ kind: "para", text: `@[ada](${ID_ADA})` }],
        evidence: [{ label: "the run", url: "https://example.test/run/1" }],
        summary: "This is idle.",
      },
      fields: { issueId: ID_ADA },
    });

    expect(result.success).toBe(false);
    expect(reasons({ result })).toContain("Linear's own mention markup");
  });

  it("accepts the `@{key}` token in the summary", () => {
    const result = linearCommentFormSchema.safeParse({
      artifact: {
        evidence: [{ label: "the run", url: "https://example.test/run/1" }],
        summary: "@{ada} this is idle.",
      },
      fields: { issueId: ID_ADA },
    });

    expect(result.success).toBe(true);
  });
});
