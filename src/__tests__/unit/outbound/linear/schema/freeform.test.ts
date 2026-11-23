/*
 * `freeformIssueSchema`, the opt-out kind: it allows a heading of its own choosing, but still requires the
 * collapsible, still refuses a raw delimiter or a multi-line heading, and refuses a heading that re-creates a
 * section the structured kind owns.
 */
import { describe, expect, it } from "vitest";

import { freeformIssueSchema } from "../../../../../outbound/linear/schema.js";
import { firstMessage } from "./harness.js";

describe("freeformIssueSchema", () => {
  it("allows a heading, which the structured kind cannot express", () => {
    const result = freeformIssueSchema.safeParse({
      aiPrompt: [{ kind: "para", text: "**Goal.** Fix it." }],
      body: [
        { alt: "hero", kind: "media", mime: "image/png", url: "https://x.test/h" },
        { kind: "heading", text: "Background" },
      ],
      kind: "freeform",
    });
    expect(result.success).toBe(true);
  });

  it("still requires the collapsible, so even the opt-out keeps progressive disclosure", () => {
    const result = freeformIssueSchema.safeParse({
      body: [{ kind: "para", text: "Just a note." }],
      kind: "freeform",
    });
    expect(result.success).toBe(false);
  });

  it("still refuses a raw delimiter in the body", () => {
    const result = freeformIssueSchema.safeParse({
      aiPrompt: [{ kind: "para", text: "**Goal.** Fix it." }],
      body: [{ kind: "para", text: "+++ nope" }],
      kind: "freeform",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a heading that re-creates a section the structured kind owns", () => {
    // Otherwise the opt-out can emit something indistinguishable from the structured shape while bypassing
    // the opening-paragraph rule, the checkbox rule and the item cap — the guarantee made worthless exactly
    // where a reader would rely on it.
    const result = freeformIssueSchema.safeParse({
      aiPrompt: [{ kind: "para", text: "**Goal.** Fix it." }],
      body: [
        { kind: "heading", text: "Problem" },
        { kind: "para", text: "A" },
      ],
      kind: "freeform",
    });
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("the structured kind owns");
  });

  it("still allows a heading of its own choosing", () => {
    const result = freeformIssueSchema.safeParse({
      aiPrompt: [{ kind: "para", text: "**Goal.** Fix it." }],
      body: [{ kind: "heading", text: "Root cause" }],
      kind: "freeform",
    });
    expect(result.success).toBe(true);
  });

  it("refuses a newline in a heading", () => {
    const result = freeformIssueSchema.safeParse({
      aiPrompt: [{ kind: "para", text: "**Goal.** Fix it." }],
      body: [{ kind: "heading", text: "One\nTwo" }],
      kind: "freeform",
    });
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("ONE line");
  });
});
