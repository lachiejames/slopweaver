/**
 * THE RUN-JOURNAL COLLECTOR — the handover run journals, the Tier 1 substrate a hand-run's top finding came
 * entirely from. Its siblings, the dev-gate outcomes and the pain points, are in `./collect.ts`; what each journal
 * finding measurably cost is `./runJournalConsequences.ts`, and the sentence it opens on `./journalConsequenceText.ts`.
 *
 * No network call, no corpus read, and no model (AGENTS.md rule 2). This is a local pass over local files.
 */
import { join } from "node:path";

import { parseLedger, type RunEvent } from "../handover/ledger.js";
import { agreeing, countOf } from "./countPhrase.js";
import type { FrictionFinding } from "./finding.js";
import { abandonmentConsequence, amendmentConsequence, questionConsequence } from "./journalConsequenceText.js";
import type { QuestionWaitMeasure } from "./questionWait.js";
import {
  type AbandonedEndMeasure,
  type AmendmentMeasure,
  type CompletedCycle,
  type JournalMeasures,
  measureJournal,
} from "./runJournalConsequences.js";
import {
  type CollectorReading,
  classOr,
  classOrOther,
  foldSightings,
  inWindow,
  jsonlNames,
  oneLine,
  type ReflectWindow,
  type Sighting,
  type SubstrateReader,
} from "./substrate.js";

/**
 * The four sighting buckets one journal contributes, kept apart because each is a different locus, plus the
 * cycles it finished in the window — the cohort an amended cycle's duration is compared against.
 */
interface JournalSightings {
  readonly amendments: readonly Sighting<AmendmentMeasure>[];
  readonly endings: readonly Sighting<AbandonedEndMeasure>[];
  readonly questions: readonly Sighting<QuestionWaitMeasure>[];
  readonly stuck: readonly Sighting[];
  readonly completed: readonly CompletedCycle[];
  readonly unmeasurable: number;
}

/** Whether a run's probe snapshots in this window never once passed — friction, not an open run. */
function probesNeverPassed({
  events,
  window,
}: {
  events: readonly RunEvent[];
  window: ReflectWindow;
}): readonly RunEvent[] {
  const probes = events.flatMap((event) =>
    event.kind === "probed" && inWindow({ tsIso: event.atIso, window }) ? [event] : [],
  );
  return probes.length >= 2 && probes.every((event) => event.passed === 0 && event.failed > 0) ? probes : [];
}

/** The one stuck-probe sighting a journal contributes, or none when its probes moved. */
function stuckSightings({
  events,
  slug,
  window,
}: {
  events: readonly RunEvent[];
  slug: string;
  window: ReflectWindow;
}): readonly Sighting[] {
  const probes = probesNeverPassed({ events, window });
  if (probes.length === 0) {
    return [];
  }
  return [
    {
      classKey: "probes-never-passed",
      evidence: `${slug}: ${countOf({ count: probes.length, many: "probe snapshots", one: "probe snapshot" })}, none of them passing`,
      locus: "handover probe",
      tsIso: probes.at(-1)!.atIso,
    },
  ];
}

/** A sighting's measure, spread only when one was taken, so an unmeasured sighting carries no `measure` key. */
function withMeasure<T>({ measure }: { measure: T | undefined }): { measure?: T } {
  if (measure === undefined) {
    return {};
  }
  return { measure };
}

/**
 * Mine one journal's events into sightings. Pure — the reading and the slug are supplied.
 *
 * @param slug the doc the journal belongs to, which every evidence line names
 * @param events the decoded journal
 * @param window the run's bounds
 * @returns the four buckets, any of which may be empty
 */
function journalSightings({
  slug,
  events,
  window,
}: {
  slug: string;
  events: readonly RunEvent[];
  window: ReflectWindow;
}): JournalSightings {
  const measures = measureJournal({ events, slug, window });
  const placed = [...events.entries()].filter(([, event]) => inWindow({ tsIso: event.atIso, window }));
  return {
    amendments: placed.flatMap(([position, event]) => amendmentSighting({ event, measures, position, slug })),
    completed: measures.completed,
    endings: placed.flatMap(([position, event]) => endingSighting({ event, measures, position, slug })),
    questions: placed.flatMap(([position, event]) => questionSighting({ event, measures, position, slug })),
    stuck: stuckSightings({ events, slug, window }),
    unmeasurable: measures.unmeasurable,
  };
}

/** The fields every per-line sighting builder reads. */
interface LineInput {
  readonly event: RunEvent;
  readonly measures: JournalMeasures;
  readonly position: number;
  readonly slug: string;
}

/** An `amended` line as a sighting, carrying its cycle's measure; any other line as none. */
function amendmentSighting({ event, measures, position, slug }: LineInput): readonly Sighting<AmendmentMeasure>[] {
  if (event.kind !== "amended") {
    return [];
  }
  return [
    {
      classKey: classOrOther({ empty: "amended-without-a-reason", other: "other-amendment-reason", text: event.why }),
      evidence: `${slug}: ${oneLine({ text: event.why })}`,
      locus: "handover amend",
      tsIso: event.atIso,
      ...withMeasure({ measure: measures.amendments.get(position) }),
    },
  ];
}

/** An `abandoned` or `released` line as a sighting, measured only where it ENDED a cycle; any other line as none. */
function endingSighting({ event, measures, position, slug }: LineInput): readonly Sighting<AbandonedEndMeasure>[] {
  if (event.kind !== "abandoned" && event.kind !== "released") {
    return [];
  }
  return [
    {
      classKey: classOr({ fallback: `${event.kind}-without-a-reason`, text: event.why }),
      evidence: `${slug} (${event.kind}): ${oneLine({ text: event.why })}`,
      locus: `handover ${event.kind}`,
      tsIso: event.atIso,
      ...withMeasure({ measure: measures.abandonedEnds.get(position) }),
    },
  ];
}

/** A `question` line as a sighting, carrying its measured wait; any other line as none. */
function questionSighting({ event, measures, position, slug }: LineInput): readonly Sighting<QuestionWaitMeasure>[] {
  if (event.kind !== "question") {
    return [];
  }
  return [
    {
      classKey: classOr({ fallback: "question-without-text", text: event.question }),
      evidence: `${slug}: ${oneLine({ text: event.question })}`,
      locus: "handover question",
      tsIso: event.atIso,
      ...withMeasure({ measure: measures.questions.get(position) }),
    },
  ];
}

/**
 * Fold every journal's sightings into findings, one bucket at a time.
 *
 * @param buckets one entry per journal read
 * @returns the findings, in the order a brief prints them
 */
function journalFindings({ buckets }: { buckets: readonly JournalSightings[] }): readonly FrictionFinding[] {
  const completed = buckets.flatMap((one) => one.completed);
  return [
    ...foldSightings({
      consequence: (group) => amendmentConsequence({ completed, group }),
      cost: 2,
      // A sighting is one `amended` journal LINE, so the count is lines, never runs or mid-run rewrites: one run
      // amended eleven times is eleven here and once in the consequence's median, and a line appended after its run
      // ended is still a line.
      describe: ({ classKey, count }) =>
        `${countOf({ count, many: "brief amendments", one: "brief amendment" })} the miner filed under class ${classKey}`,
      impact: 3,
      safety: 4,
      sightings: buckets.flatMap((one) => one.amendments),
      source: "run-journal",
    }),
    ...foldSightings({
      // An abandonment is dropped work, counted by the distinct cycle it ended; a release hands a seat on and
      // carries no measure, so it states no cost.
      consequence: (group) => abandonmentConsequence({ group }),
      cost: 3,
      // Counted as journal LINES: a duplicate abandonment is a second line, never a second ending.
      describe: ({ classKey, count, locus }) =>
        `${countOf({ count, many: "journal lines", one: "journal line" })} recording ${locus} the miner filed under class ${classKey}`,
      impact: 3,
      safety: 3,
      sightings: buckets.flatMap((one) => one.endings),
      source: "run-journal",
    }),
    ...foldSightings({
      consequence: (group) => questionConsequence({ group }),
      cost: 2,
      describe: ({ classKey, count }) =>
        `${countOf({ count, many: "questions to you", one: "question to you" })} the miner filed under class ${classKey}`,
      impact: 2,
      safety: 5,
      sightings: buckets.flatMap((one) => one.questions),
      source: "run-journal",
    }),
    ...foldSightings({
      cost: 3,
      describe: ({ count }) =>
        // One sighting per JOURNAL, its probes pooled across every cycle, so the count is journals.
        `${countOf({ count, many: "run journals", one: "run journal" })} recorded probe snapshots in this window in which nothing ever passed — ${agreeing({ count, many: "those docs' probes", one: "the doc's probes" })} may not describe the work`,
      impact: 2,
      safety: 4,
      sightings: buckets.flatMap((one) => one.stuck),
      source: "run-journal",
    }),
  ];
}

/**
 * Read the handover run journals.
 *
 * Five kinds are mined and each says something different about the day. `amended` is a brief that had to
 * change underneath a live run, which is where a recurring defect in how work is specified shows up.
 * `abandoned` and `released` are runs that stopped, with the reason in the writer's own words. `question`
 * is a legitimate ending, so it is the recurring QUESTION CLASS that is a finding and never one question.
 * `probed` is mined only for a run whose probes never moved across the window, because a single failing
 * snapshot is what an open run looks like rather than friction.
 *
 * A line that does not decode is counted into residue rather than dropped: a journal is the durable half of
 * the orchestration design, so a line silently skipped is a decision silently forgotten.
 *
 * @param runsDir the directory of `<slug>.jsonl` run journals
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @returns the findings, what was read, and what could not be
 */
export function collectRunJournalFriction({
  runsDir,
  reader,
  window,
}: {
  runsDir: string;
  reader: SubstrateReader;
  window: ReflectWindow;
}): CollectorReading {
  const residue: string[] = [];
  const buckets: JournalSightings[] = [];
  let rowsRead = 0;
  for (const name of jsonlNames({ dir: runsDir, reader })) {
    const text = reader.readText(join(runsDir, name));
    if (text === undefined) {
      residue.push(`run journal ${name} could not be read, so its day is unknown rather than quiet`);
      continue;
    }
    const parsed = parseLedger({ text });
    rowsRead += parsed.events.length;
    if (parsed.unreadable.length > 0) {
      residue.push(
        `run journal ${name} has ${countOf({ count: parsed.unreadable.length, many: "lines", one: "line" })} that did not decode — that many decisions are invisible to this pass`,
      );
    }
    buckets.push(journalSightings({ events: parsed.events, slug: name.slice(0, -".jsonl".length), window }));
  }
  const unmeasurable = buckets.reduce((sum, one) => sum + one.unmeasurable, 0);
  if (unmeasurable > 0) {
    residue.push(
      `${countOf({ count: unmeasurable, many: "run cycles or question waits", one: "run cycle or question wait" })} ${agreeing({ count: unmeasurable, many: "carry", one: "carries" })} a timestamp that does not parse or runs backwards, so ${agreeing({ count: unmeasurable, many: "they are", one: "it is" })} in no duration`,
    );
  }
  return {
    findings: journalFindings({ buckets }),
    residue,
    rowsRead,
    source: "run-journal",
  };
}
