/*
 * The form makes a badly STRUCTURED issue unrepresentable while leaving the words alone, so prose the old
 * tooling would have blocked sails through: dashes, a quoted error message, a `#` mid-line.
 */
import { describe, expect, it } from "vitest";

import { structuredIssueSchema } from "../../../../../outbound/linear/schema.js";
import { structured } from "./harness.js";

describe("structuredIssueSchema — content is NOT policed", () => {
  it("accepts an em dash and an en dash, which the retired guard hard-blocked", () => {
    // Falsifiable on purpose: if anyone reintroduces a prose rule, this test is what fails.
    const result = structuredIssueSchema.safeParse(
      structured({ problem: [{ kind: "para", text: "It failed — twice – on page nine." }] }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a quoted error message containing a dash in an acceptance item", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ acceptance: ['the log reads "connection reset — retrying"'] }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a `#` that is not at the start of a line, such as an issue reference", () => {
    const result = structuredIssueSchema.safeParse(
      structured({ problem: [{ kind: "para", text: "Regressed in PR #14244, see the diff." }] }),
    );
    expect(result.success).toBe(true);
  });
});
