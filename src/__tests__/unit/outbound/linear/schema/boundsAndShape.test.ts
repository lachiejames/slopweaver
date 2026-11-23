/*
 * `structuredIssueSchema`'s bounds and required shape: the acceptance cap and its message through the
 * either-kind union, the required Problem lead and AI-prompt block, and the undeclared keys, headings and
 * media without a mime or a real url that the form refuses.
 */
import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_MAX_ITEMS,
  linearIssueArtifactSchema,
  structuredIssueSchema,
} from "../../../../../outbound/linear/schema.js";
import { firstMessage, structured } from "./harness.js";

describe("structuredIssueSchema — bounds and required shape", () => {
  it(`accepts exactly ${String(ACCEPTANCE_MAX_ITEMS)} acceptance items`, () => {
    const items = Array.from({ length: ACCEPTANCE_MAX_ITEMS }, (_, i) => `item ${String(i)}`);
    expect(structuredIssueSchema.safeParse(structured({ acceptance: items })).success).toBe(true);
  });

  it("refuses one item past the cap", () => {
    const items = Array.from({ length: ACCEPTANCE_MAX_ITEMS + 1 }, (_, i) => `item ${String(i)}`);
    expect(structuredIssueSchema.safeParse(structured({ acceptance: items })).success).toBe(false);
  });

  it("names the acceptance cap through the either-kind union, rather than a bare `Invalid input`", () => {
    const items = Array.from({ length: ACCEPTANCE_MAX_ITEMS + 1 }, (_, i) => `item ${String(i)}`);
    const result = linearIssueArtifactSchema.safeParse(structured({ acceptance: items }));

    expect(result.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)).toEqual([
      `acceptance: Too big: expected array to have <=${String(ACCEPTANCE_MAX_ITEMS)} items`,
    ]);
  });

  it("refuses an empty acceptance array — omit the section instead of shipping an empty heading", () => {
    expect(structuredIssueSchema.safeParse(structured({ acceptance: [] })).success).toBe(false);
  });

  it("requires the Problem section to OPEN with a paragraph, not an image", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ problem: [{ alt: "shot", kind: "media", mime: "image/png", url: "https://x.test/a" }] }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("must OPEN with a paragraph");
  });

  it("requires the AI-prompt block", () => {
    const form = structured({});
    delete form["aiPrompt"];
    expect(structuredIssueSchema.safeParse(form).success).toBe(false);
  });

  it("refuses an empty AI-prompt block", () => {
    expect(structuredIssueSchema.safeParse(structured({ aiPrompt: [] })).success).toBe(false);
  });

  it("makes a heading UNREPRESENTABLE in a named section", () => {
    const result = structuredIssueSchema.safeParse(structured({ solution: [{ kind: "heading", text: "Background" }] }));
    expect(result.success).toBe(false);
  });

  it("refuses an undeclared key, because these forms are authored and a stray key is a typo", () => {
    expect(structuredIssueSchema.safeParse(structured({ acceptanceCriteria: ["typo"] })).success).toBe(false);
  });

  it("refuses media with no mime, since mime decides embed versus link", () => {
    const result = structuredIssueSchema.safeParse(
      structured({
        problem: [
          { kind: "para", text: "ok" },
          { alt: "x", kind: "media", url: "https://x.test/a" },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("refuses a media url that is not a url", () => {
    const result = structuredIssueSchema.safeParse(
      structured({
        problem: [
          { kind: "para", text: "ok" },
          { alt: "x", kind: "media", mime: "image/png", url: "not-a-url" },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });
});
