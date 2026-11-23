/*
 * The Problem and Solution sections stay under `SECTION_MAX_WORDS`: the cap is exact, summed across every
 * block, shared with `proofOfProblem`, blind to nested media alt text, and a markdown link counts as zero.
 */
import { describe, expect, it } from "vitest";

import { structuredIssueSchema } from "../../../../../outbound/linear/schema.js";
import { countSectionWords, SECTION_MAX_WORDS } from "../../../../../outbound/linear/sectionWords.js";
import { firstMessage, structured } from "./harness.js";

describe("structuredIssueSchema — Problem and Solution stay under SECTION_MAX_WORDS", () => {
  it(`accepts a Problem section at exactly ${String(SECTION_MAX_WORDS)} words`, () => {
    const text = Array.from({ length: SECTION_MAX_WORDS }, (_, i) => `w${String(i)}`).join(" ");
    expect(structuredIssueSchema.safeParse(structured({ problem: [{ kind: "para", text }] })).success).toBe(true);
  });

  it(`refuses a Problem section one word past ${String(SECTION_MAX_WORDS)}, naming the count and the cap`, () => {
    const text = Array.from({ length: SECTION_MAX_WORDS + 1 }, (_, i) => `w${String(i)}`).join(" ");
    const result = structuredIssueSchema.safeParse(structured({ problem: [{ kind: "para", text }] }));

    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain(`${String(SECTION_MAX_WORDS + 1)} words, over the 50-word cap`);
  });

  it(`refuses a Solution section over ${String(SECTION_MAX_WORDS)} words`, () => {
    const text = Array.from({ length: SECTION_MAX_WORDS + 1 }, (_, i) => `w${String(i)}`).join(" ");
    expect(structuredIssueSchema.safeParse(structured({ solution: [{ kind: "para", text }] })).success).toBe(false);
  });

  it("sums words ACROSS every block in the section, not just the first", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `w${String(i)}`).join(" ");
    const result = structuredIssueSchema.safeParse(
      structured({
        problem: [
          { kind: "para", text: thirty },
          { items: [{ text: thirty }], kind: "bullets" },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("counts proofOfProblem against the SAME budget as problem, not a separate one", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `w${String(i)}`).join(" ");
    const result = structuredIssueSchema.safeParse(
      structured({
        problem: [{ kind: "para", text: thirty }],
        proofOfProblem: [{ kind: "para", text: thirty }],
      }),
    );

    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("problem is 60 words");
  });

  it("does not count a bullet item's nested media alt text against the cap", () => {
    const fifty = Array.from({ length: SECTION_MAX_WORDS }, (_, i) => `w${String(i)}`).join(" ");
    const result = structuredIssueSchema.safeParse(
      structured({
        problem: [
          { kind: "para", text: fifty.split(" ").slice(0, 1).join(" ") },
          {
            items: [
              {
                nested: [{ alt: "a".repeat(500), kind: "media", mime: "image/png", url: "https://x.test/shot.png" }],
                text: fifty.split(" ").slice(1).join(" "),
              },
            ],
            kind: "bullets",
          },
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it("a markdown link contributes ZERO words — the guard's own measured rule, opposite of GitHub's", () => {
    // 49 bare words plus one link whose label+url would be 3 more words if counted naively — still under cap
    // only because the whole `[label](url)` construct counts as nothing.
    const words = Array.from({ length: 49 }, (_, i) => `w${String(i)}`).join(" ");
    const text = `${words} [see the doc](https://example.test/a/very/long/path/that/would/be/many/words)`;
    expect(structuredIssueSchema.safeParse(structured({ problem: [{ kind: "para", text }] })).success).toBe(true);
  });

  it("a markdown link whose url itself contains a balanced parenthesis still contributes ZERO words", () => {
    // Found BROKEN by an adversarial Codex review pass: a `[^)]*` url group stops at the url's OWN closing
    // paren, leaving the real trailing `)` behind to be counted as a stray word.
    const text = "[label](https://example.test/a(b))";
    expect(countSectionWords({ text })).toBe(0);
  });

  it("a markdown link whose label contains a backslash-escaped bracket still contributes ZERO words", () => {
    // Found BROKEN a second time by an adversarial Codex review pass: a plain `[^\]]*` label group stops at
    // an ESCAPED `]` as if it were the closing bracket, so the whole construct never matches and survives
    // unstripped.
    const text = "[la\\]bel](https://example.test/a(b))";
    expect(countSectionWords({ text })).toBe(0);
  });
});
