/*
 * The per-headline word budget: a headline at exactly the cap renders, one word over is refused rather than cut, and
 * every unfit finding is named in one refusal.
 */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";

import { textOfContent } from "../../../../outbound/briefing/vocabulary.js";
import {
  findingHeadline,
  renderSelfImprovementSection,
  SELF_IMPROVEMENT_HEADLINE_MAX_WORDS,
  SELF_IMPROVEMENT_STATUS_MAX_WORDS,
} from "../../../../reflect/briefingSection.js";
import { SelfImprovementSectionErrors } from "../../../../reflect/briefingSectionErrors.js";
import { finding, headlineText, ranked, render, summaryOf } from "./harness.js";

describe("renderSelfImprovementSection — the headline budget", () => {
  it("the longest status composition adds exactly SELF_IMPROVEMENT_STATUS_MAX_WORDS words to a summary", () => {
    const candidate = ranked({
      closedAtIso: "2026-09-19T01:30:00.000Z",
      closedBy: "slopweaver#1180",
      finding: finding({
        coveredBy: Array.from({ length: 51 }, (_, index) => `doc-${String(index)}`),
        summary: summaryOf({ words: 10 }),
      }),
    });
    const words = textOfContent({ content: findingHeadline({ candidate }) }).split(" ").length;
    expect(words - 10).toBe(SELF_IMPROVEMENT_STATUS_MAX_WORDS);
  });

  it("a headline at exactly the cap renders", () => {
    // A live, uncovered headline adds 13 words: `— still happening, last seen <day>; not on the board yet; anchor <id>`.
    const candidate = ranked({
      finding: finding({ summary: summaryOf({ words: SELF_IMPROVEMENT_HEADLINE_MAX_WORDS - 13 }) }),
    });
    const section = render({ findings: [candidate] });
    expect(headlineText({ note: section.notes[0]! }).split(" ").length).toBe(SELF_IMPROVEMENT_HEADLINE_MAX_WORDS);
  });

  it("a headline one word over is refused, naming the finding and its count, rather than cut", () => {
    const candidate = ranked({
      finding: finding({ summary: summaryOf({ words: SELF_IMPROVEMENT_HEADLINE_MAX_WORDS - 12 }) }),
      id: "long-one",
    });
    expect(unwrapErr(renderSelfImprovementSection({ findings: [candidate], notShown: 0 }))).toEqual(
      SelfImprovementSectionErrors.notesRefused({
        refusals: [
          SelfImprovementSectionErrors.headlineOverBudget({
            cap: SELF_IMPROVEMENT_HEADLINE_MAX_WORDS,
            id: "long-one",
            words: SELF_IMPROVEMENT_HEADLINE_MAX_WORDS + 1,
          }),
        ],
      }),
    );
  });

  it("every unfit finding is named in one refusal, not only the first, and a finding failing twice twice", () => {
    const long = summaryOf({ words: SELF_IMPROVEMENT_HEADLINE_MAX_WORDS - 12 });
    const findings = [
      ranked({ finding: finding({ summary: long }), id: "long-one" }),
      ranked({ id: "fit-one" }),
      ranked({ finding: finding({ summary: "steps 1) read 2) write 3) check were skipped" }), id: "packed-one" }),
      ranked({ finding: finding({ summary: `${long} 1) a 2) b 3) c` }), id: "both-one" }),
    ];
    const refused = unwrapErr(renderSelfImprovementSection({ findings, notShown: 0 }));
    expect(refused.code).toBe("NOTES_REFUSED");
    if (refused.code !== "NOTES_REFUSED") throw new Error(`expected NOTES_REFUSED, got ${refused.code}`);
    const named = refused.refusals.map((refusal) =>
      refusal.code === "HEADLINE_OVER_BUDGET"
        ? [refusal.code, refusal.id]
        : [refusal.code, ...refusal.issues.map((issue) => issue.split(":")[0])],
    );
    expect(named).toEqual([
      ["HEADLINE_OVER_BUDGET", "long-one"],
      ["SECTION_SCHEMA_REFUSED", "packed-one"],
      ["HEADLINE_OVER_BUDGET", "both-one"],
      ["SECTION_SCHEMA_REFUSED", "both-one"],
    ]);
    expect(refused.message).toContain("packed-one: headline.0.text: packs more than 2 numbers into running prose");
    expect(refused.message).toContain("both-one: headline.0.text: packs more than 2 numbers into running prose");
    expect(refused.message).not.toContain("fit-one");
  });
});
