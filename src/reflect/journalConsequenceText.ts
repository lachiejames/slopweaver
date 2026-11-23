/**
 * The SENTENCE a run-journal finding opens on — its measured cost to the owner or the fleet, in words.
 *
 * `./runJournalConsequences.ts` and `./questionWait.ts` measure; this file only says what those measures support.
 * An amendment finding says how long the rewritten runs took against the untouched ones and how many were dropped,
 * a question finding how long work sat waiting on the owner's answer, an abandonment finding how many runs it dropped. Every
 * count agrees with its noun (`./countPhrase.ts`), and a finding whose measures state no cost returns `undefined`,
 * because a finding with no cost is not a card.
 *
 * Pure: sighting groups in, one sentence out.
 */
import { agreeing, countOf } from "./countPhrase.js";
import type { QuestionWaitMeasure } from "./questionWait.js";
import type { AbandonedEndMeasure, AmendmentMeasure, CompletedCycle } from "./runJournalConsequences.js";
import type { SightingGroup } from "./substrate.js";

/**
 * The median of a non-empty list.
 *
 * @param values the numbers, in any order; never empty
 * @returns the middle value, or the mean of the two middle values for an even count
 */
export function median({ values }: { values: readonly number[] }): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** One decimal, the precision every hour and ratio on a card carries. */
function oneDecimal({ value }: { value: number }): string {
  return value.toFixed(1);
}

/** The distinct cycles an amendment group touched, each counted once however often it was rewritten. */
function distinctCycles({ group }: { group: SightingGroup<AmendmentMeasure> }): readonly AmendmentMeasure[] {
  const byCycle = new Map<string, AmendmentMeasure>();
  for (const sighting of group.sightings) {
    if (sighting.measure !== undefined) {
      byCycle.set(sighting.measure.cycleId, sighting.measure);
    }
  }
  return [...byCycle.values()];
}

/**
 * The slowdown clause: how much longer the rewritten cycles took than the untouched ones, or `undefined` when
 * either cohort is empty, the baseline is zero, or the rewritten cycles were no slower.
 */
function slowdownClause({
  cycles,
  completed,
}: {
  cycles: readonly AmendmentMeasure[];
  completed: readonly CompletedCycle[];
}): string | undefined {
  const rewritten = cycles.flatMap((cycle) => (cycle.completedHours === undefined ? [] : [cycle.completedHours]));
  const untouched = completed.filter((cycle) => !cycle.amended).map((cycle) => cycle.elapsedHours);
  if (rewritten.length === 0 || untouched.length === 0) {
    return undefined;
  }
  const rewrittenMedian = median({ values: rewritten });
  const untouchedMedian = median({ values: untouched });
  if (untouchedMedian <= 0 || rewrittenMedian <= untouchedMedian) {
    return undefined;
  }
  // Each cohort agrees with its own count: one run has a time, never "a median across 1".
  const rewrittenRuns = countOf({
    count: rewritten.length,
    many: "runs whose brief was rewritten mid-run",
    one: "run whose brief was rewritten mid-run",
  });
  const untouchedRuns = countOf({ count: untouched.length, many: "runs left alone", one: "run left alone" });
  return (
    `${rewrittenRuns} took ${oneDecimal({ value: rewrittenMedian / untouchedMedian })}× as long to finish as ` +
    `${untouchedRuns} (${cohortHours({ count: rewritten.length, hours: rewrittenMedian })} against ` +
    `${cohortHours({ count: untouched.length, hours: untouchedMedian })}) — nothing here measures how big each run ` +
    `was, and bigger work may simply get rewritten more, so this is a link, not a measured slowdown`
  );
}

/** One cohort's time: a lone run's own hours, or the median of several, named as one. */
function cohortHours({ count, hours }: { count: number; hours: number }): string {
  const value = `${oneDecimal({ value: hours })}h`;
  if (count === 1) {
    return value;
  }
  return `a median ${value}`;
}

/**
 * What an amendment group measurably cost: the slowdown against untouched runs, and the rewritten runs that
 * were dropped unfinished — or `undefined` when neither was measured.
 *
 * @param group the amendment sightings of one class
 * @param completed every cycle that finished in the window, across every journal — the comparison cohort
 * @returns the consequence, sentence-cased, or `undefined`
 */
export function amendmentConsequence({
  group,
  completed,
}: {
  group: SightingGroup<AmendmentMeasure>;
  completed: readonly CompletedCycle[];
}): string | undefined {
  const cycles = distinctCycles({ group });
  const slowdown = slowdownClause({ completed, cycles });
  const dropped = cycles.filter((cycle) => cycle.abandoned).length;
  if (slowdown === undefined && dropped === 0) {
    return undefined;
  }
  if (slowdown === undefined) {
    return `${countOf({ count: dropped, many: "runs", one: "run" })} whose brief was rewritten mid-run ${agreeing({ count: dropped, many: "were", one: "was" })} abandoned unfinished — that work was dropped`;
  }
  const droppedClause =
    dropped === 0
      ? ""
      : `; ${countOf({ count: dropped, many: "other rewritten runs", one: "other rewritten run" })} ${agreeing({ count: dropped, many: "were", one: "was" })} abandoned unfinished`;
  return `${slowdown.charAt(0).toUpperCase()}${slowdown.slice(1)}${droppedClause}`;
}

/**
 * What a question group measurably cost: how long work sat waiting on the owner's answer.
 *
 * @param group the question sightings of one class
 * @returns the consequence, or `undefined` when no wait in the group could be measured
 */
export function questionConsequence({ group }: { group: SightingGroup<QuestionWaitMeasure> }): string | undefined {
  const waits = group.sightings.flatMap((sighting) => (sighting.measure === undefined ? [] : [sighting.measure]));
  if (waits.length === 0) {
    return undefined;
  }
  const total = waits.reduce((sum, wait) => sum + wait.waitHours, 0);
  const longest = Math.max(...waits.map((wait) => wait.waitHours));
  const open = waits.filter((wait) => wait.openAtWindowEnd).length;
  if (waits.length === 1) {
    const stillOpen = open === 0 ? "" : ", and it still had no answer when the window closed";
    return `Work sat waiting on your answer for ${oneDecimal({ value: total })}h on ${countOf({ count: waits.length, many: "questions", one: "question" })}${stillOpen}`;
  }
  const openClause = open === 0 ? "" : `, and ${String(open)} still had no answer when the window closed`;
  return (
    `Work sat waiting on your answer for ${oneDecimal({ value: total })}h across ${String(waits.length)} questions; ` +
    `the longest wait was ${oneDecimal({ value: longest })}h${openClause}`
  );
}

/**
 * What an abandonment group measurably cost: the distinct runs it dropped, counted by the cycle each ended.
 *
 * A sighting with no measure is an `abandoned` line that did not END its cycle (a duplicate after the first
 * ending), so it adds no run; a release never carries one, because handing a seat on drops nothing.
 *
 * The group is one CLASS (`finding.ts`'s classifier over each `why`), never one recorded reason: two different
 * `why` lines can land in the same class, so the sentence says the miner filed them together and no more.
 *
 * @param group the ending sightings of one class
 * @returns the consequence, or `undefined` when no sighting ended a cycle abandoned
 */
export function abandonmentConsequence({ group }: { group: SightingGroup<AbandonedEndMeasure> }): string | undefined {
  const cycles = new Set(
    group.sightings.flatMap((sighting) => (sighting.measure === undefined ? [] : [sighting.measure.cycleId])),
  );
  if (cycles.size === 0) {
    return undefined;
  }
  const filed = agreeing({
    count: cycles.size,
    many: "were abandoned unfinished for reasons the miner filed under one class",
    one: "was abandoned unfinished for a reason the miner filed under this class",
  });
  return `${countOf({ count: cycles.size, many: "runs", one: "run" })} ${filed} — that work was dropped`;
}
