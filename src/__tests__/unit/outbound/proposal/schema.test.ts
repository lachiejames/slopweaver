/**
 * The golden-proposal FORM.
 *
 * The cases worth writing are the refusals, because every one of them is a way a document could look fine
 * and be wrong: a pipe inside a table cell silently splits it and shifts every column after it, a `##` in a
 * prose field escapes its own section, and a `</details>` closes a toggle the renderer opened.
 */
import { describe, expect, it } from "vitest";
import { PROPOSAL_FORM_EXAMPLE } from "../../../../cli/commands/proposal/formExample.js";
import {
  countWords,
  proposalFormSchema,
  TEASER_MAX_WORDS,
  TLDR_MAX_WORDS,
} from "../../../../outbound/proposal/schema.js";
import type { ProposalForm } from "../../../../outbound/proposal/types.js";

/** The shipped example, with one field replaced — the only thing under test in each case. */
function form(over: Partial<ProposalForm> = {}): unknown {
  return { ...PROPOSAL_FORM_EXAMPLE, ...over };
}

/** Every rejection message, flattened, without a conditional in the assertion. */
function rejections({ value }: { value: unknown }): readonly string[] {
  const parsed = proposalFormSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("proposalFormSchema", () => {
  it("accepts the shipped example, so `--form-example` is not a lie", () => {
    expect(proposalFormSchema.safeParse(PROPOSAL_FORM_EXAMPLE).success).toBe(true);
  });

  it("refuses an unknown key rather than dropping it", () => {
    const errors = rejections({ value: { ...PROPOSAL_FORM_EXAMPLE, summary: "a field from another schema" } });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('unknown field "summary"');
  });

  it("refuses a heading inside a prose field, which could only escape its own section", () => {
    expect(rejections({ value: form({ tldr: "It is broken.\n## A second section" }) })[0]).toContain(
      "cannot contain a heading",
    );
  });

  it("refuses a <details> line in prose, because the renderer owns the toggles", () => {
    expect(rejections({ value: form({ tldr: "It is broken.\n</details>" }) })[0]).toContain("<details> toggle");
  });

  it("refuses a pipe in a table cell, which would shift every column after it", () => {
    const value = form({
      scope: { rows: [{ notYet: "b | c", solves: "a", whatItWouldTake: "d" }], weakestPart: "thin sample." },
    });
    expect(rejections({ value })[0]).toContain('cannot contain "|"');
  });

  it("refuses a local image path, which Notion cannot publish", () => {
    const value = form({
      data: { ...PROPOSAL_FORM_EXAMPLE.data, hero: { ...PROPOSAL_FORM_EXAMPLE.data.hero!, url: "./shot.png" } },
    });
    expect(rejections({ value })[0]).toContain("http(s) URL");
  });

  it("refuses an evidence table with no rows: a proposal without linked evidence is an opinion", () => {
    expect(rejections({ value: form({ data: { rows: [] } }) })[0]).toContain("at least one row");
  });

  it("refuses two recommended options, because that is not a recommendation", () => {
    const value = form({
      fix: {
        ...PROPOSAL_FORM_EXAMPLE.fix,
        optionsConsidered: PROPOSAL_FORM_EXAMPLE.fix.optionsConsidered.map((option) => ({
          ...option,
          recommended: true,
        })),
      },
    });
    expect(rejections({ value })[0]).toContain("exactly one option");
  });

  it("refuses zero recommended options, which leaves the ask unstated", () => {
    const value = form({
      fix: {
        ...PROPOSAL_FORM_EXAMPLE.fix,
        optionsConsidered: PROPOSAL_FORM_EXAMPLE.fix.optionsConsidered.map((option) => ({
          ...option,
          recommended: false,
        })),
      },
    });
    expect(rejections({ value })[0]).toContain("exactly one option");
  });

  it("accepts NO options at all, so a fix with no real alternative need not invent two", () => {
    const value = form({ fix: { ...PROPOSAL_FORM_EXAMPLE.fix, optionsConsidered: [] } });
    expect(proposalFormSchema.safeParse(value).success).toBe(true);
  });

  it("caps the TL;DR, which is the whole above-the-fold surface", () => {
    expect(rejections({ value: form({ tldr: "word ".repeat(TLDR_MAX_WORDS + 1) }) })[0]).toContain("above-the-fold");
  });

  it("caps the Slack teaser at the operator's own number", () => {
    expect(rejections({ value: form({ slackTeaser: "word ".repeat(TEASER_MAX_WORDS + 1) }) })[0]).toContain(
      "at most 100 words",
    );
  });

  it("refuses a multi-line title, which becomes a Notion page property", () => {
    expect(rejections({ value: form({ title: "a title\nand more" }) })[0]).toContain("one line");
  });

  it("accepts a `file:` hero, the spelling that says upload this at publish", () => {
    const hero = { ...PROPOSAL_FORM_EXAMPLE.data.hero!, url: "file:./shots/hero.png" };
    expect(rejections({ value: form({ data: { ...PROPOSAL_FORM_EXAMPLE.data, hero } }) })).toEqual([]);
  });

  it("refuses a bare local hero path, which Notion would publish as a broken image", () => {
    const hero = { ...PROPOSAL_FORM_EXAMPLE.data.hero!, url: "./shots/hero.png" };
    expect(rejections({ value: form({ data: { ...PROPOSAL_FORM_EXAMPLE.data, hero } }) })[0]).toContain("`file:` path");
  });

  it("refuses a `file:` hero path carrying a space, which the placeholder pattern would not match", () => {
    const hero = { ...PROPOSAL_FORM_EXAMPLE.data.hero!, url: "file:./shots/my hero.png" };
    expect(rejections({ value: form({ data: { ...PROPOSAL_FORM_EXAMPLE.data, hero } }) })[0]).toContain(
      "no whitespace",
    );
  });

  it("still refuses a `file:` CITATION, because a source has to be openable by the reader", () => {
    const hero = { ...PROPOSAL_FORM_EXAMPLE.data.hero!, sourceUrl: "file:./shots/hero.png" };
    expect(rejections({ value: form({ data: { ...PROPOSAL_FORM_EXAMPLE.data, hero } }) })[0]).toContain("openable");
  });

  it("refuses a phrase where an emoji icon belongs", () => {
    expect(rejections({ value: form({ emoji: "compass" }) })[0]).toContain("one emoji");
  });
});

describe("countWords", () => {
  it("counts a link's visible label but not its URL", () => {
    expect(countWords({ text: "see [the run](https://example.test/a/very/long/path/indeed)" })).toBe(3);
  });

  it("counts plain prose", () => {
    expect(countWords({ text: "one two three" })).toBe(3);
  });

  it("counts nothing in an empty string", () => {
    expect(countWords({ text: "   " })).toBe(0);
  });
});
