/**
 * The sentences a run-journal finding opens on — its measured cost in words, every count agreeing with its noun, and
 * no sentence at all when nothing was measured.
 */
import { describe, expect, it } from "vitest";

import {
  abandonmentConsequence,
  amendmentConsequence,
  median,
  questionConsequence,
} from "../../../reflect/journalConsequenceText.js";
import type { QuestionWaitMeasure } from "../../../reflect/questionWait.js";
import type { AbandonedEndMeasure, AmendmentMeasure, CompletedCycle } from "../../../reflect/runJournalConsequences.js";
import type { SightingGroup } from "../../../reflect/substrate.js";

const window = { fromIso: "2026-11-05T00:00:00.000Z", toIso: "2026-11-06T00:00:00.000Z" };

const group = <T>({ measures }: { measures: readonly T[] }): SightingGroup<T> => ({
  classKey: "c",
  count: measures.length,
  locus: "l",
  sample: "s",
  sightings: measures.map((measure) => ({ classKey: "c", evidence: "e", locus: "l", measure, tsIso: window.fromIso })),
});

describe("median", () => {
  it("takes the middle of an odd list and the mean of the middle two of an even one", () => {
    expect(median({ values: [5, 1, 3] })).toBe(3);
    expect(median({ values: [4, 1, 3, 2] })).toBe(2.5);
  });
});

describe("amendmentConsequence", () => {
  const untouched: readonly CompletedCycle[] = [
    { amended: false, cycleId: "a#0", elapsedHours: 2 },
    { amended: false, cycleId: "b#0", elapsedHours: 4 },
  ];

  it("leads with how much longer rewritten runs took, both cohorts sized, and says it is a link not a cause", () => {
    const measures: readonly AmendmentMeasure[] = [{ abandoned: false, completedHours: 9, cycleId: "x#0" }];
    expect(amendmentConsequence({ completed: untouched, group: group({ measures }) })).toBe(
      "1 run whose brief was rewritten mid-run took 3.0× as long to finish as 2 runs left alone (9.0h against " +
        "a median 3.0h) — nothing here measures how big each run was, and bigger work may simply get " +
        "rewritten more, so this is a link, not a measured slowdown",
    );
  });

  it("names both cohorts in the plural with their medians when each holds several runs", () => {
    const measures: readonly AmendmentMeasure[] = [
      { abandoned: false, completedHours: 8, cycleId: "x#0" },
      { abandoned: false, completedHours: 10, cycleId: "y#0" },
    ];
    expect(amendmentConsequence({ completed: untouched, group: group({ measures }) })).toMatch(
      /^2 runs whose brief was rewritten mid-run took 3\.0× as long to finish as 2 runs left alone \(a median 9\.0h against a median 3\.0h\)/,
    );
  });

  it("names a lone untouched run's own time, never a median of one", () => {
    const measures: readonly AmendmentMeasure[] = [
      { abandoned: false, completedHours: 8, cycleId: "x#0" },
      { abandoned: false, completedHours: 10, cycleId: "y#0" },
    ];
    const lone: readonly CompletedCycle[] = [{ amended: false, cycleId: "a#0", elapsedHours: 3 }];
    expect(amendmentConsequence({ completed: lone, group: group({ measures }) })).toMatch(
      /^2 runs whose brief was rewritten mid-run took 3\.0× as long to finish as 1 run left alone \(a median 9\.0h against 3\.0h\)/,
    );
  });

  it("counts a cycle rewritten eleven times ONCE in the median", () => {
    const measures = Array.from({ length: 11 }, (): AmendmentMeasure => ({
      abandoned: false,
      completedHours: 9,
      cycleId: "x#0",
    }));
    expect(amendmentConsequence({ completed: untouched, group: group({ measures }) })).toMatch(/^1 run whose brief/);
  });

  it("adds the rewritten runs that were dropped", () => {
    const measures: readonly AmendmentMeasure[] = [
      { abandoned: false, completedHours: 9, cycleId: "x#0" },
      { abandoned: true, completedHours: undefined, cycleId: "y#0" },
    ];
    expect(amendmentConsequence({ completed: untouched, group: group({ measures }) })).toMatch(
      /^1 run whose brief .*; 1 other rewritten run was abandoned unfinished$/,
    );
  });

  it("says only what was dropped when no duration compares, in the singular for one run", () => {
    const measures: readonly AmendmentMeasure[] = [{ abandoned: true, completedHours: undefined, cycleId: "y#0" }];
    expect(amendmentConsequence({ completed: [], group: group({ measures }) })).toBe(
      "1 run whose brief was rewritten mid-run was abandoned unfinished — that work was dropped",
    );
  });

  it("says only what was dropped when no duration compares, in the plural for two runs", () => {
    const measures: readonly AmendmentMeasure[] = [
      { abandoned: true, completedHours: undefined, cycleId: "y#0" },
      { abandoned: true, completedHours: undefined, cycleId: "z#0" },
    ];
    expect(amendmentConsequence({ completed: [], group: group({ measures }) })).toBe(
      "2 runs whose brief was rewritten mid-run were abandoned unfinished — that work was dropped",
    );
  });

  it("states NO cost when the rewritten runs were no slower and none was dropped — that is not a card", () => {
    const measures: readonly AmendmentMeasure[] = [{ abandoned: false, completedHours: 1, cycleId: "x#0" }];
    expect(amendmentConsequence({ completed: untouched, group: group({ measures }) })).toBeUndefined();
  });
});

describe("abandonmentConsequence", () => {
  it("counts distinct cycles, not abandoned lines", () => {
    const measures: readonly AbandonedEndMeasure[] = [{ cycleId: "a#0" }, { cycleId: "a#0" }, { cycleId: "b#1" }];
    expect(abandonmentConsequence({ group: group({ measures }) })).toBe(
      "2 runs were abandoned unfinished for reasons the miner filed under one class — that work was dropped",
    );
  });

  it("says one run in the singular", () => {
    const measures: readonly AbandonedEndMeasure[] = [{ cycleId: "a#0" }];
    expect(abandonmentConsequence({ group: group({ measures }) })).toBe(
      "1 run was abandoned unfinished for a reason the miner filed under this class — that work was dropped",
    );
  });

  it("states no cost when no sighting ended a cycle", () => {
    expect(abandonmentConsequence({ group: group<AbandonedEndMeasure>({ measures: [] }) })).toBeUndefined();
  });
});

describe("questionConsequence", () => {
  it("leads with how long work sat waiting on the owner's answer, the longest wait, and how many are still open", () => {
    const measures: readonly QuestionWaitMeasure[] = [
      { openAtWindowEnd: false, waitHours: 3 },
      { openAtWindowEnd: true, waitHours: 6.5 },
    ];
    expect(questionConsequence({ group: group({ measures }) })).toBe(
      "Work sat waiting on your answer for 9.5h across 2 questions; the longest wait was 6.5h, and 1 still had no answer when the window closed",
    );
  });

  it("says one open question in the singular, with no longest-wait clause repeating the total", () => {
    const measures: readonly QuestionWaitMeasure[] = [{ openAtWindowEnd: true, waitHours: 16.1 }];
    expect(questionConsequence({ group: group({ measures }) })).toBe(
      "Work sat waiting on your answer for 16.1h on 1 question, and it still had no answer when the window closed",
    );
  });

  it("says one answered question in the singular, with no open clause", () => {
    const measures: readonly QuestionWaitMeasure[] = [{ openAtWindowEnd: false, waitHours: 2 }];
    expect(questionConsequence({ group: group({ measures }) })).toBe(
      "Work sat waiting on your answer for 2.0h on 1 question",
    );
  });

  it("states no cost when no wait in the group was measured", () => {
    expect(questionConsequence({ group: group<QuestionWaitMeasure>({ measures: [] }) })).toBeUndefined();
  });
});
