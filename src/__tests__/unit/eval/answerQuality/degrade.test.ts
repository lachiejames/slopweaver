import { describe, expect, it } from "vitest";
import type { AnswerQualityCase } from "../../../../eval/answerQuality/caseSchema.js";
import {
  degradeGolden,
  dropSentencesCarrying,
  ineffectiveDrops,
  splitSentences,
} from "../../../../eval/answerQuality/degrade.js";
import { scoreAnswer } from "../../../../eval/answerQuality/score.js";

const CASE: AnswerQualityCase = {
  attributions: [{ id: "a1", label: "credited to the runbook", requires: [["runbook"]], source: "notion" }],
  caveats: [{ id: "v1", label: "does not claim it was reproduced", requires: [["not sure whether"]] }],
  claims: [{ id: "c1", label: "the pool exhausted", requires: [["pool exhausted"]] }],
  goldenText: "The pool exhausted.\n\nI am not sure whether that caused it.\n\nThe runbook puts the limit at 20.",
  id: "case-01",
  inventedCertainty: ["this confirms the root cause"],
};

describe("splitSentences", () => {
  it("splits on terminal punctuation and on hard line breaks, dropping the empties", () => {
    expect(splitSentences({ text: "One. Two?\n\nThree!\n" })).toEqual(["One.", "Two?", "Three!"]);
  });

  it("returns nothing for whitespace-only prose", () => {
    expect(splitSentences({ text: "   \n\n  " })).toEqual([]);
  });
});

describe("dropSentencesCarrying", () => {
  it("removes exactly the sentences carrying an anchor and rejoins the rest", () => {
    const text = dropSentencesCarrying({ requires: [["not sure whether"]], text: CASE.goldenText });
    expect(text).toBe("The pool exhausted. The runbook puts the limit at 20.");
  });

  it("matches an anchor case-insensitively", () => {
    const text = dropSentencesCarrying({
      requires: [["OUT OF SYNC"]],
      text: "Fine here.\n\nThe two went out of sync.",
    });
    expect(text).toBe("Fine here.");
  });

  it("cannot drop an anchor a hard line break splits, which is why the self-test checks droppability", () => {
    const text = "Fine here.\n\nThe two went out\nof sync.";
    expect(dropSentencesCarrying({ requires: [["out of sync"]], text })).toBe("Fine here. The two went out of sync.");
  });
});

describe("degradeGolden", () => {
  it("emits one variant per caveat, one per attribution, and one inventing certainty", () => {
    expect(degradeGolden({ answerCase: CASE }).map((variant) => variant.kind)).toEqual([
      "caveat-dropped",
      "attribution-dropped",
      "certainty-invented",
    ]);
  });

  it("makes every variant score strictly below the golden", () => {
    const golden = scoreAnswer({
      answerCase: CASE,
      candidate: { caseId: CASE.id, label: "golden", text: CASE.goldenText },
    }).score;
    const scores = degradeGolden({ answerCase: CASE }).map(
      (variant) =>
        scoreAnswer({ answerCase: CASE, candidate: { caseId: CASE.id, label: variant.label, text: variant.text } })
          .score,
    );
    expect(golden).toBe(1);
    expect(scores).toEqual([0.75, 0.75, 0.75]);
  });

  it("appends the certainty phrase, so the variant's overlap with the golden goes UP while its grade goes down", () => {
    const variant = degradeGolden({ answerCase: CASE }).find((entry) => entry.kind === "certainty-invented")!;
    expect(variant.text.startsWith(CASE.goldenText)).toBe(true);
    expect(variant.text.length).toBeGreaterThan(CASE.goldenText.length);
  });

  it("emits no certainty variant when the case names no invented-certainty phrasing", () => {
    const answerCase: AnswerQualityCase = { ...CASE, inventedCertainty: [] };
    expect(degradeGolden({ answerCase }).map((variant) => variant.kind)).toEqual([
      "caveat-dropped",
      "attribution-dropped",
    ]);
  });

  it("omits a variant whose drop left the expectation still satisfied", () => {
    const answerCase: AnswerQualityCase = {
      ...CASE,
      attributions: [],
      caveats: [{ id: "v1", label: "anchor straddles a sentence boundary", requires: [["fine. sync"]] }],
      goldenText: "It looks fine. Sync broke overnight.",
    };
    expect(degradeGolden({ answerCase }).map((variant) => variant.kind)).toEqual(["certainty-invented"]);
  });
});

describe("ineffectiveDrops", () => {
  it("is empty when every anchor names something a sentence deletion removes", () => {
    expect(ineffectiveDrops({ answerCase: CASE })).toEqual([]);
  });

  it("names an anchor that no sentence deletion can remove, because it straddles two of them", () => {
    const answerCase: AnswerQualityCase = {
      ...CASE,
      attributions: [],
      caveats: [{ id: "v1", label: "anchor straddles a sentence boundary", requires: [["fine. sync"]] }],
      goldenText: "It looks fine. Sync broke overnight.",
    };
    expect(ineffectiveDrops({ answerCase })).toEqual(["anchor straddles a sentence boundary"]);
  });
});
