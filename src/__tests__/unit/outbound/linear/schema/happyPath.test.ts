/*
 * `structuredIssueSchema` accepts the enforced shape: with or without an acceptance section, and with
 * positional media, an image or a non-image attachment, inside a section.
 */
import { describe, expect, it } from "vitest";

import { structuredIssueSchema } from "../../../../../outbound/linear/schema.js";
import { structured } from "./harness.js";

describe("structuredIssueSchema — the happy path", () => {
  it("accepts the enforced shape", () => {
    expect(structuredIssueSchema.safeParse(structured({ acceptance: ["it works"] })).success).toBe(true);
  });

  it("accepts an issue with no acceptance section at all", () => {
    expect(structuredIssueSchema.safeParse(structured({})).success).toBe(true);
  });

  it("accepts positional media inside a section", () => {
    const result = structuredIssueSchema.safeParse(
      structured({
        solution: [
          { kind: "para", text: "Before." },
          { alt: "shot", kind: "media", mime: "image/png", url: "https://x.test/a" },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a non-image attachment", () => {
    const result = structuredIssueSchema.safeParse(
      structured({
        problem: [
          { kind: "para", text: "Rows are wrong." },
          { alt: "export", kind: "media", mime: "text/csv", url: "https://x.test/b" },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});
