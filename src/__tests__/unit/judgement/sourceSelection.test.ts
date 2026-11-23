/**
 * The judgement-mining selection contract: a pure function of the tree's content that spreads the bounded
 * sample across the whole tree instead of spending it on whatever sorts first by name.
 */
import { describe, expect, it } from "vitest";

import {
  JUDGEMENT_FILE_MAX_CHARS,
  JUDGEMENT_SELECTION_CONTRACT,
  type JudgementCandidateFile,
  selectJudgementSample,
  spreadExcerpt,
} from "../../../judgement/sourceSelection.js";
import { sha256Text } from "../../../lib/hash.js";

/** `count` files named `dated/<nnn>.md`, each `size` chars of its own letter-coded body. */
function datedFiles({ count, size }: { count: number; size: number }): readonly JudgementCandidateFile[] {
  return Array.from({ length: count }, (_, index) => ({
    relativePath: `dated/${String(index).padStart(3, "0")}.md`,
    text: `${String(index).padStart(3, "0")}:`.padEnd(size, "x"),
  }));
}

describe("selectJudgementSample", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "refuses a budget of %s rather than rendering past it",
    (budgetChars) => {
      expect(() =>
        selectJudgementSample({ budgetChars, candidates: [{ relativePath: "a.md", text: "A".repeat(1000) }] }),
      ).toThrow(`a sample budget is a non-negative safe integer, not ${String(budgetChars)}`);
    },
  );

  it("selects nothing from an empty tree and says so", () => {
    const selection = selectJudgementSample({ candidates: [] });
    expect(selection.text).toBe("");
    expect(selection.selected).toEqual([]);
    expect(selection.coverage).toEqual({
      budgetSkippedFiles: 0,
      candidateChars: 0,
      candidateFiles: 0,
      contract: JUDGEMENT_SELECTION_CONTRACT,
      selectedChars: 0,
      selectedFiles: 0,
      strata: [],
      truncatedFiles: 0,
    });
  });

  it("takes a whole small tree whole", () => {
    const candidates = [
      { relativePath: "a.md", text: "alpha" },
      { relativePath: "notes/b.md", text: "bravo" },
    ];
    const selection = selectJudgementSample({ candidates });
    expect(selection.selected.map((file) => file.relativePath).toSorted()).toEqual(["a.md", "notes/b.md"]);
    expect(selection.coverage.selectedFiles).toBe(2);
    expect(selection.coverage.selectedChars).toBe(10);
    expect(selection.text.length).toBe(12);
    // Strata are ordered by the hash of their name, never alphabetically: sha256("notes") < sha256(".").
    expect(selection.coverage.strata).toEqual([
      { candidateFiles: 1, selectedFiles: 1, stratum: "notes" },
      { candidateFiles: 1, selectedFiles: 1, stratum: "." },
    ]);
  });

  it("yields the same selection whatever order the candidates arrive in", () => {
    const candidates = datedFiles({ count: 40, size: 100 });
    const forward = selectJudgementSample({ budgetChars: 1000, candidates });
    const reversed = selectJudgementSample({ budgetChars: 1000, candidates: candidates.toReversed() });
    expect(reversed).toEqual(forward);
  });

  it("reads each candidate's text once, so a receipt's hash is the hash of the text it rendered", () => {
    let reads = 0;
    const candidate = {
      relativePath: "a.md",
      get text(): string {
        reads += 1;
        return `version ${String(reads)}`;
      },
    };
    const selection = selectJudgementSample({ candidates: [candidate] });
    expect(reads).toBe(1);
    expect(selection.text).toBe("version 1");
    expect(selection.selected[0]!.contentHash).toBe(sha256Text({ text: "version 1" }));
    expect(selection.coverage.candidateChars).toBe("version 1".length);
  });

  it.each([
    [
      "strata",
      [
        { relativePath: "a\ud800/x", text: "A" },
        { relativePath: "a\udc00/y", text: "B" },
      ],
    ],
    [
      "files",
      [
        { relativePath: "same.md", text: "\ud800" },
        { relativePath: "same.md", text: "\udc00" },
      ],
    ],
  ])("orders %s whose names hash alike through lone-surrogate replacement the same either way", (_kind, candidates) => {
    const forward = selectJudgementSample({ budgetChars: 100, candidates });
    const reversed = selectJudgementSample({ budgetChars: 100, candidates: candidates.toReversed() });
    expect(reversed.text).toBe(forward.text);
    expect(reversed).toEqual(forward);
  });

  it("does not spend the budget on the files that sort first by name", () => {
    // 40 dated files, room for 9 with separators: a prefix walk takes 000..008 and never sees the later 31.
    const selection = selectJudgementSample({ budgetChars: 1000, candidates: datedFiles({ count: 40, size: 100 }) });
    const picked = selection.selected.map((file) => Number(file.relativePath.slice(6, 9)));
    expect(picked.length).toBe(9);
    expect(picked.filter((index) => index >= 9).length).toBeGreaterThan(0);
    expect(selection.coverage.budgetSkippedFiles).toBe(31);
    expect(selection.coverage.selectedChars).toBe(9 * 100);
    expect(selection.text.length).toBe(9 * 100 + 8 * 2);
  });

  it("draws strata in turn, so one large subtree cannot starve a small one", () => {
    const big = Array.from({ length: 20 }, (_, index) => ({
      relativePath: `big/${String(index)}.md`,
      text: "b".repeat(100),
    }));
    const small = [{ relativePath: "small/only.md", text: "s".repeat(100) }];
    // Budget 1000 holds nine 100-char files with separators: the small stratum gets its turn in round one.
    const selection = selectJudgementSample({ budgetChars: 1000, candidates: [...big, ...small] });
    expect(selection.coverage.strata.toSorted((left, right) => left.candidateFiles - right.candidateFiles)).toEqual([
      { candidateFiles: 1, selectedFiles: 1, stratum: "small" },
      { candidateFiles: 20, selectedFiles: 8, stratum: "big" },
    ]);
  });

  it("shows an over-long file as a declared head, middle and tail excerpt, never the whole budget", () => {
    const huge = { relativePath: "huge.md", text: "h".repeat(JUDGEMENT_FILE_MAX_CHARS * 3) };
    const other = { relativePath: "other.md", text: "other" };
    const selection = selectJudgementSample({ candidates: [huge, other] });
    expect(selection.selected.map((file) => file.selectedChars).toSorted((left, right) => left - right)).toEqual([
      5,
      JUDGEMENT_FILE_MAX_CHARS,
    ]);
    expect(selection.coverage.truncatedFiles).toBe(1);
    expect(selection.coverage.candidateChars).toBe(JUDGEMENT_FILE_MAX_CHARS * 3 + 5);
  });

  it("skips a file that no longer fits rather than slicing it, and keeps filling with smaller ones", () => {
    // Budget 160 → ceiling 20. Eight 20-char files and one 5-char one: whatever the draw order, seven
    // twenties and the five fit exactly (7 × 20 + 5 + 7 separators of 2 = 159 rendered, 145 of it content) and one
    // twenty is skipped.
    const candidates = [
      ...Array.from({ length: 8 }, (_, index) => ({ relativePath: `f${String(index)}.md`, text: "y".repeat(20) })),
      { relativePath: "short.md", text: "z".repeat(5) },
    ];
    const selection = selectJudgementSample({ budgetChars: 160, candidates });
    expect(selection.coverage.selectedFiles).toBe(8);
    expect(selection.coverage.budgetSkippedFiles).toBe(1);
    expect(selection.coverage.selectedChars).toBe(145);
    expect(selection.text.length).toBe(159);
    expect(selection.selected.filter((file) => file.relativePath === "short.md").length).toBe(1);
    expect(selection.coverage.truncatedFiles).toBe(0);
  });

  it("never renders more than the budget, separators included", () => {
    const selection = selectJudgementSample({ budgetChars: 1000, candidates: datedFiles({ count: 40, size: 100 }) });
    expect(selection.text.length).toBe(selection.coverage.selectedChars + (selection.coverage.selectedFiles - 1) * 2);
    expect(selection.text.length).toBeLessThanOrEqual(1000);
  });

  it("excerpts head, middle and tail to exactly the ceiling, so an excerpt is never a prefix", () => {
    const text = `${"a".repeat(100)}${"b".repeat(100)}${"c".repeat(100)}`;
    const excerpt = spreadExcerpt({ ceiling: 40, text });
    expect(excerpt).toBe(`${"a".repeat(10)}\n[…]\n${"b".repeat(10)}\n[…]\n${"c".repeat(10)}`);
    expect(excerpt.length).toBe(40);
  });
});
