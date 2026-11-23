/*
 * The above-the-fold budget counts the summary and every headline, nothing inside a fold: a section at exactly the
 * budget renders, and one word over is refused though every headline is inside its own cap.
 */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";

import {
  renderSelfImprovementSection,
  SELF_IMPROVEMENT_ABOVE_FOLD_MAX,
  selfImprovementAboveFoldWords,
} from "../../../../reflect/briefingSection.js";
import { SelfImprovementSectionErrors } from "../../../../reflect/briefingSectionErrors.js";
import type { RankedFinding } from "../../../../reflect/rank.js";
import { finding, ranked, render, summaryOf } from "./harness.js";

describe("renderSelfImprovementSection — the above-the-fold budget", () => {
  // Summary line with notShown 0 is 8 words; each live, uncovered headline is its summary plus 13.
  const withSummaries = ({ words }: { words: readonly number[] }): readonly RankedFinding[] =>
    words.map((count, index) =>
      ranked({ finding: finding({ summary: summaryOf({ words: count }) }), id: `id-${String(index + 1)}` }),
    );

  it("a section at exactly the budget renders", () => {
    const section = render({ findings: withSummaries({ words: [25, 25, 25, 25, 27] }) });
    expect(selfImprovementAboveFoldWords({ section })).toBe(SELF_IMPROVEMENT_ABOVE_FOLD_MAX);
  });

  it("a section one word over is refused, though every headline is inside its own cap", () => {
    const findings = withSummaries({ words: [25, 25, 25, 25, 28] });
    expect(unwrapErr(renderSelfImprovementSection({ findings, notShown: 0 }))).toEqual(
      SelfImprovementSectionErrors.aboveFoldOverBudget({
        cap: SELF_IMPROVEMENT_ABOVE_FOLD_MAX,
        headlines: [
          { id: "id-1", words: 38 },
          { id: "id-2", words: 38 },
          { id: "id-3", words: 38 },
          { id: "id-4", words: 38 },
          { id: "id-5", words: 41 },
        ],
        words: SELF_IMPROVEMENT_ABOVE_FOLD_MAX + 1,
      }),
    );
    expect(unwrapErr(renderSelfImprovementSection({ findings, notShown: 0 })).message).toContain(
      "its headlines were id-1 (38 words), id-2 (38 words), id-3 (38 words), id-4 (38 words), id-5 (41 words)",
    );
  });

  it("counts the summary and every headline, and nothing inside a fold", () => {
    const section = render({ findings: withSummaries({ words: [1] }) });
    expect(selfImprovementAboveFoldWords({ section })).toBe(8 + 14);
  });
});
