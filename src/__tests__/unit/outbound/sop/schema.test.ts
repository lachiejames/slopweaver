/**
 * The SOP form's refusals — the ones that make a broken procedure unrepresentable rather than reviewable.
 *
 * Every case here is a shape the org's own SOPs, or the incidents around them, produced: an unfilled `TODO`
 * section, a step naming nobody, a scope that never says what it excludes.
 */
import { describe, expect, it } from "vitest";
import { SOP_FORM_EXAMPLE } from "../../../../cli/commands/sop/formExample.js";
import { countWords, PURPOSE_MAX_WORDS, STEP_MAX, sopFormSchema } from "../../../../outbound/sop/schema.js";
import type { SopForm } from "../../../../outbound/sop/types.js";

/** The shipped example, with one field replaced — the same form every refusal below is measured against. */
const form = (over: Partial<SopForm> = {}): unknown => ({ ...SOP_FORM_EXAMPLE, ...over });

/** The first refusal message, so a test asserts on what an operator actually reads. */
function firstIssue({ value }: { value: unknown }): string {
  const parsed = sopFormSchema.safeParse(value);
  expect(parsed.success).toBe(false);
  return parsed.success ? "" : parsed.error.issues[0]!.message;
}

describe("the shipped example is valid", () => {
  it("parses", () => {
    expect(sopFormSchema.safeParse(SOP_FORM_EXAMPLE).success).toBe(true);
  });
});

describe("an unfilled placeholder is unpublishable", () => {
  it.each(["TODO: decide this", "Approval: TBD", "owner tbc", "who approves ???"])("refuses %s", (purpose) => {
    expect(firstIssue({ value: form({ purpose }) })).toContain("placeholder");
  });

  it("leaves a brace URL template alone, because the Zendesk SOP publishes one", () => {
    const detail = "The direct link is https://example.test/members/{USER_ID}#product-roles";
    const value = form({ steps: [{ action: "Open the profile", detail, who: "a tool admin" }] });
    expect(sopFormSchema.safeParse(value).success).toBe(true);
  });
});

describe("scope must say what it excludes", () => {
  it("refuses an empty doesNotCover", () => {
    const value = form({ scope: { covers: ["everything"], doesNotCover: [] } });
    expect(firstIssue({ value })).toContain("does NOT cover");
  });
});

describe("a step names who performs it", () => {
  it("refuses a step with no actor", () => {
    const parsed = sopFormSchema.safeParse(form({ steps: [{ action: "Do the thing" } as never] }));
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."))).toContain("steps.0.who");
  });
});

describe("the caps are the ones measured against the org's own SOPs", () => {
  it("refuses a purpose past the cap", () => {
    const purpose = Array.from({ length: PURPOSE_MAX_WORDS + 1 }, () => "word").join(" ");
    expect(countWords({ text: purpose })).toBe(PURPOSE_MAX_WORDS + 1);
    expect(firstIssue({ value: form({ purpose }) })).toContain(String(PURPOSE_MAX_WORDS));
  });

  it("accepts a purpose exactly at the cap", () => {
    const purpose = Array.from({ length: PURPOSE_MAX_WORDS }, () => "word").join(" ");
    expect(sopFormSchema.safeParse(form({ purpose })).success).toBe(true);
  });

  it("refuses more steps than one procedure holds", () => {
    const steps = Array.from({ length: STEP_MAX + 1 }, (_unused, index) => ({
      action: `Step ${String(index)}`,
      who: "the rota",
    }));
    expect(firstIssue({ value: form({ steps }) })).toContain("two procedures");
  });

  it("does not count a link's URL as words a reader reads", () => {
    expect(countWords({ text: "see [the policy](https://example.test/a/very/long/path/indeed)" })).toBe(3);
  });
});

describe("markdown cannot escape the field holding it", () => {
  it("refuses a heading in prose, because the sections are fields", () => {
    expect(firstIssue({ value: form({ purpose: "## Purpose\nreally" }) })).toContain("heading");
  });

  it("refuses a pipe in a table cell", () => {
    const value = form({ scope: { covers: ["a | b"], doesNotCover: ["c"] } });
    expect(firstIssue({ value })).toContain('cannot contain "|"');
  });
});

describe("an unknown field is refused rather than dropped", () => {
  it("names the nearest real field", () => {
    expect(firstIssue({ value: { ...SOP_FORM_EXAMPLE, ownerRole: "IT" } })).toContain('Did you mean "owner"');
  });
});

describe("lastUpdated is a calendar date", () => {
  it("refuses a prose date", () => {
    expect(firstIssue({ value: form({ lastUpdated: "last Tuesday" }) })).toContain("YYYY-MM-DD");
  });
});
