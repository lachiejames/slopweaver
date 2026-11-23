/**
 * The predicate the settle path asks: has this run answered whether there was a lesson?
 *
 * Pure — the caller passes the run's events and the register's rows, so the gate is testable without a
 * filesystem and without a clock.
 *
 * ## Why this is a gate and not a reminder
 *
 * A run cannot settle without answering whether it learned anything. Otherwise nothing makes an agent
 * remember to store knowledge, so skipping the record is made structurally impossible, or at least very
 * difficult, for an agent to do.
 *
 * The gate is deliberately NOT "write a lesson". It is "say whether there was one", and
 * {@link LESSONS_NONE} is a first-class, recorded answer. That distinction is what stops the mechanism
 * manufacturing filler: a run with nothing to record pays one flag, and a store of lazy rows would be worse
 * than an empty one.
 *
 * ## Why the question is asked HERE and not mined later
 *
 * Same rule. A crash report is written immediately, because otherwise lessons and knowledge are lost to
 * time, distorted, harder to re-derive or eventually unreachable — so the best time to ask an agent if there
 * is a lesson is right after it did something, rather than looping over old session transcripts every so
 * often.
 *
 * The transcript-mining loop (`../reflect/`) is therefore NOT the write path and must not become one. It
 * keeps its own job — recurrence across sessions — and the consolidation follow-on reads the
 * register's repeated ids rather than re-deriving lessons from transcripts.
 *
 * ## Only the FLEET's rows answer this question
 *
 * A row carries `learner` and the register holds both sides (`./types.ts`). A
 * belief of the OWNER's that a session happened to record while this run was open says nothing about whether the
 * run itself learned anything — so counting one would let a run close by writing down something the owner said,
 * which is the filler this gate exists to refuse. The narrowing is here rather than at the caller because
 * this is the module that defines what answering means.
 */
import type { RunEvent } from "../handover/ledger.js";

import type { LessonRow } from "./types.js";

/** The declaration that says, on the record, that this run had nothing to record. */
export const LESSONS_NONE = "none";

/** The break-glass, printed loudly whenever it is used. "Very difficult", per the ruling, not impossible. */
export const ALLOW_NO_LESSONS = "SLOPWEAVER_ALLOW_NO_LESSONS";

/** What the gate found, so a caller can print the right line rather than re-deriving it. */
export interface LessonsDeclaration {
  /** Whether the run has answered the question at all. */
  readonly declared: boolean;
  /** How many FLEET rows this run recorded in the register since it started. */
  readonly recorded: number;
  /** Whether the answer was an explicit `none` rather than a row. */
  readonly explicitNone: boolean;
}

/**
 * Whether a run has answered the lesson question since its last `started`.
 *
 * Two ways to answer, and they are equal — a row in the register naming this run, or an explicit `none`
 * journalled on the run itself. Both are checked against the run's CURRENT cycle: a doc that is run twice
 * answers twice, because the second cycle learned its own things and a stale answer from the first would be
 * the amnesia this mechanism exists to close.
 *
 * @param events the run's journal, oldest first
 * @param rows every row the register holds; only the fleet's count toward the answer
 * @param slug the doc's slug, matched against each row's `run`
 * @param startedAtIso the current cycle's `started` instant; rows and answers before it do not count
 * @returns what was found, so the caller can report it without asking again
 */
export function lessonsDeclaration({
  events,
  rows,
  slug,
  startedAtIso,
}: {
  events: readonly RunEvent[];
  rows: readonly LessonRow[];
  slug: string;
  startedAtIso: string;
}): LessonsDeclaration {
  const recorded = rows.filter(
    (row) => row.learner === "fleet" && row.run === slug && row.recordedAtIso >= startedAtIso,
  ).length;
  const explicitNone = events.some(
    (event) => event.kind === "lessons" && event.atIso >= startedAtIso && event.lessons === LESSONS_NONE,
  );
  return { declared: recorded > 0 || explicitNone, explicitNone, recorded };
}

/**
 * The refusal a settle path prints when the question has not been answered.
 *
 * Written as two commands rather than a scolding, because the session reading it is about to close a run and
 * the only useful output is the next keystroke.
 *
 * @param slug the doc's slug, interpolated into both suggested commands
 * @param verb the verb being refused, so the message names the thing the reader actually typed
 * @returns the lines to print, in order
 */
export function lessonsRefusalLines({ slug, verb }: { slug: string; verb: string }): readonly string[] {
  return [
    `handover ${verb}: ${slug} has not said whether this run learned anything, so it cannot ${verb} yet.`,
    "  ANSWER IT NOW, while the run's own context still exists — that is the whole point of asking here",
    "  rather than mining it out of a transcript later.",
    "",
    "  Something was learned:",
    `    slopweaver knowledge record --run ${slug} --domain <slug> --claim "<one sentence>" \\`,
    `      --verdict confirmed --tier 2 --surface api --evidence "<what you measured>" [--repro "<command>"]`,
    "",
    "  Nothing was learned — a legitimate, recorded answer:",
    `    slopweaver handover ${verb} ${slug} --lessons ${LESSONS_NONE}`,
    "",
    `  ${ALLOW_NO_LESSONS}=1 forces past this, loudly, and records that it was forced.`,
  ];
}
