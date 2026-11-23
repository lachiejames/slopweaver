/**
 * Choosing ONE question per sweep, and decoding what the ledger holds. Pure — rows in, a question out, no
 * filesystem and no clock.
 *
 * ## The selection is MECHANICAL, and that is the whole design
 *
 * Rule 2 forbids a headless model, so nothing here judges which lesson is worth asking about — a verb that
 * did would be a regex pretending to comprehend. What it does instead is rotate: the lesson asked least
 * often, oldest-asked first, worst tier first, id last. Three consequences follow, and each is why that
 * order rather than another:
 *
 * - **Ranking by times ASKED rather than times answered** means an unanswered question cannot pin the quiz
 *   to one lesson forever. They may ignore a sweep; the next one moves on.
 * - **Tier ascending** puts an irreversible-harm lesson in front of a convention, because those are the
 *   beliefs where their being wrong costs the most.
 * - **The id last** makes the whole thing deterministic, so two runs of the same sweep cut the same
 *   question and a test can assert on which one.
 *
 * ## One sweep asks one question, forever
 *
 * {@link questionFor} returns the sweep's EXISTING question when it has one, rather than selecting again.
 * A sweep that re-rendered after a new lesson landed would otherwise ask them something different from what
 * the page they are looking at says — and the id on that page is what their answer names.
 */
import { createHash } from "node:crypto";

import { isRecord } from "../../lib/parsers.js";
import { withoutRetired } from "../supersession.js";
import type { TraceRow } from "../traceRow.js";
import type { LessonRow } from "../types.js";

import { QUIZ_VERDICTS, type QuizEvent, type QuizSubject, type QuizVerdict, type SelectedQuiz } from "./types.js";

/** How many hex characters of a digest an id keeps. Matches `../row.ts`'s `lessonId`. */
const ID_LENGTH = 16;

/**
 * The stable id for one question: the sweep it belongs to, and the lesson it draws on.
 *
 * The sweep is part of the key because the same lesson asked in two sweeps is two questions — they may answer
 * one and not the other, and collapsing them would lose which sweep they were reading. The separator is a NUL,
 * written as the escape: it is the one byte neither id can contain, and a literal one would make this file
 * binary to git and prettier.
 *
 * @param sweepId the supervisor tick this question belongs to
 * @param lessonId the lesson the question is drawn from
 * @returns a `q-` prefixed short hex id
 */
export function quizId({ sweepId, lessonId }: { sweepId: string; lessonId: string }): string {
  const digest = createHash("sha256").update(`${sweepId}\u0000${lessonId}`).digest("hex").slice(0, ID_LENGTH);
  return `q-${digest}`;
}

/**
 * Whether a verdict is one a question may be drawn from. See `./types.ts`'s {@link QUIZ_VERDICTS}.
 *
 * Positional by the compiler's own decision: TS1230 forbids a destructured parameter in a type predicate.
 */
function isQuizVerdict(verdict: LessonRow["verdict"]): verdict is QuizVerdict {
  return QUIZ_VERDICTS.some((entry) => entry === verdict);
}

/**
 * The LATEST recording of every fleet lesson, by claim id.
 *
 * Latest rather than first, because the register is append-only and a claim's newest row is what the fleet
 * currently believes — asking them about a verdict that has since been refuted would be asking about a
 * belief nobody holds. Filtered to `fleet` BEFORE the fold, because their row and the fleet's for one claim
 * share an id (`../row.ts`), so folding both together would let one of their answers become the reference
 * answer to its own question.
 *
 * A claim a later recording RETIRED (`../supersession.ts`) is dropped before either step, and over every
 * learner's rows: a retired claim is a belief nobody holds, whoever wrote its replacement.
 *
 * @param rows every row the register holds, in the order it was written
 * @returns one row per current fleet claim, newest recording kept
 */
export function latestFleetLessons({ rows }: { rows: readonly LessonRow[] }): readonly LessonRow[] {
  const latest = new Map<string, LessonRow>();
  for (const row of withoutRetired({ rows })) {
    if (row.learner === "fleet") {
      latest.set(row.id, row);
    }
  }
  return [...latest.values()];
}

/**
 * How many candidates each excluded verdict cost, so the narrowing is reportable rather than silent.
 *
 * @param rows the latest fleet recording per claim
 * @returns one entry per excluded verdict that actually excluded something
 */
export function excludedByVerdict({ rows }: { rows: readonly LessonRow[] }): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isQuizVerdict(row.verdict)) {
      counts.set(row.verdict, countOf({ counts, key: row.verdict }) + 1);
    }
  }
  return counts;
}

/**
 * How many times a key has been counted so far. ZERO is the real answer for a key never seen, written as a
 * line of code rather than substituted by an operator.
 *
 * @param counts what has been counted so far
 * @param key the entry to read
 * @returns the count, or zero when nothing has counted this key yet
 */
function countOf({ counts, key }: { counts: ReadonlyMap<string, number>; key: string }): number {
  const seen = counts.get(key);
  if (seen === undefined) {
    return 0;
  }
  return seen;
}

/** How many times each lesson has already been asked about, across every sweep. */
function askedCounts({ events }: { events: readonly QuizEvent[] }): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.kind === "selected") {
      counts.set(event.lessonId, countOf({ counts, key: event.lessonId }) + 1);
    }
  }
  return counts;
}

/** The most recent instant each lesson was asked about, for the second sort key. */
function lastAsked({ events }: { events: readonly QuizEvent[] }): ReadonlyMap<string, string> {
  const seen = new Map<string, string>();
  for (const event of events) {
    if (event.kind === "selected") {
      seen.set(event.lessonId, event.selectedAtIso);
    }
  }
  return seen;
}

/**
 * The claim id a subject is asked under, whichever kind it is.
 *
 * @param subject the lesson or trace a question is drawn from
 * @returns the register's own claim id
 */
export function subjectId({ subject }: { subject: QuizSubject }): string {
  return subject.kind === "trace" ? subject.trace.id : subject.lesson.id;
}

/**
 * The LATEST recording of every fleet trace, by claim id, keeping only the ones a question may be drawn from.
 *
 * `confirmed` only, for {@link QUIZ_VERDICTS}'s reason read through a trace: a refuted trace is one the fleet
 * has already found wrong, so asking them to keep or re-open it would be asking about a place nobody is
 * avoiding any more.
 *
 * @param rows every trace the register holds, in recorded order
 * @returns one row per fleet trace, newest recording kept
 */
export function latestFleetTraces({ rows }: { rows: readonly TraceRow[] }): readonly TraceRow[] {
  const latest = new Map<string, TraceRow>();
  for (const row of rows) {
    if (row.learner === "fleet") {
      latest.set(row.id, row);
    }
  }
  return [...latest.values()].filter((row) => row.verdict === "confirmed");
}

/**
 * The subject this sweep should ask about — a TRACE before a lesson, and undefined when there is neither.
 *
 * Traces go first because they are the half they have never been asked about and the half that decays fastest:
 * a place the fleet stopped looking is worth re-opening long before a conclusion is worth re-testing. The
 * order is otherwise the same mechanical rotation {@link nextLesson} documents, so two runs of one sweep
 * still cut the same question.
 *
 * @param lessons every lesson the register holds
 * @param traces every trace the register holds
 * @param events every row the quiz ledger holds
 * @returns the subject to ask about, or undefined when the register holds no eligible one
 */
export function nextSubject({
  lessons,
  traces,
  events,
}: {
  lessons: readonly LessonRow[];
  traces: readonly TraceRow[];
  events: readonly QuizEvent[];
}): QuizSubject | undefined {
  const eligible: QuizSubject[] = [
    ...latestFleetTraces({ rows: traces }).map((trace): QuizSubject => ({ kind: "trace", trace })),
    ...latestFleetLessons({ rows: lessons })
      .filter((row) => isQuizVerdict(row.verdict))
      .map((lesson): QuizSubject => ({ kind: "lesson", lesson })),
  ];
  const asked = askedCounts({ events });
  const when = lastAsked({ events });
  return eligible.toSorted((a, b) => subjectRotation({ a, asked, b, when }))[0];
}

/** How two subjects order: least-asked, oldest-asked, trace before lesson, then each kind's own tie-break. */
function subjectRotation({
  a,
  b,
  asked,
  when,
}: {
  a: QuizSubject;
  b: QuizSubject;
  asked: ReadonlyMap<string, number>;
  when: ReadonlyMap<string, string>;
}): number {
  const idA = subjectId({ subject: a });
  const idB = subjectId({ subject: b });
  const byCount = countOf({ counts: asked, key: idA }) - countOf({ counts: asked, key: idB });
  if (byCount !== 0) {
    return byCount;
  }
  const byAsked = askedOrder({ first: when.get(idA), second: when.get(idB) });
  if (byAsked !== 0) {
    return byAsked;
  }
  if (a.kind !== b.kind) {
    return a.kind === "trace" ? -1 : 1;
  }
  if (a.kind === "lesson" && b.kind === "lesson") {
    return a.lesson.tier - b.lesson.tier || idA.localeCompare(idB);
  }
  return idA.localeCompare(idB);
}

/** Never-asked first, then oldest-asked. Spelled out for the reason {@link rotation} gives. */
function askedOrder({ first, second }: { first: string | undefined; second: string | undefined }): number {
  if (first === undefined || second === undefined) {
    if (first === second) {
      return 0;
    }
    return first === undefined ? -1 : 1;
  }
  return first.localeCompare(second);
}

/**
 * The lesson this sweep should ask about, or undefined when the register holds no eligible one.
 *
 * @param rows every row the register holds
 * @param events every row the quiz ledger holds
 * @returns the lesson to ask about, or undefined
 */
export function nextLesson({
  rows,
  events,
}: {
  rows: readonly LessonRow[];
  events: readonly QuizEvent[];
}): LessonRow | undefined {
  const eligible = latestFleetLessons({ rows }).filter((row) => isQuizVerdict(row.verdict));
  const asked = askedCounts({ events });
  const when = lastAsked({ events });
  return eligible.toSorted((a, b) => rotation({ a, asked, b, when }))[0];
}

/**
 * How two eligible lessons order against each other: least-asked, oldest-asked, worst tier, then id.
 *
 * A lesson NEVER asked sorts before every asked one, and that is spelled as its own branch rather than
 * coalesced out of a missing instant — `house-rules` refuses `?? ""` for the reason it reads here: an
 * absent instant and an empty one would compare identically, and only one of them is a real state.
 */
function rotation({
  a,
  b,
  asked,
  when,
}: {
  a: LessonRow;
  b: LessonRow;
  asked: ReadonlyMap<string, number>;
  when: ReadonlyMap<string, string>;
}): number {
  const byCount = countOf({ counts: asked, key: a.id }) - countOf({ counts: asked, key: b.id });
  if (byCount !== 0) {
    return byCount;
  }
  const first = when.get(a.id);
  const second = when.get(b.id);
  if (first === undefined || second === undefined) {
    // Exactly one of them has never been asked, or neither has. Never-asked comes first; two never-asked
    // lessons fall through to the tier and id below, which is what keeps the whole order deterministic.
    if (first !== second) {
      return first === undefined ? -1 : 1;
    }
  } else if (first !== second) {
    return first.localeCompare(second);
  }
  return a.tier - b.tier || a.id.localeCompare(b.id);
}

/**
 * The question a sweep already cut, when it has one.
 *
 * @param events every row the quiz ledger holds
 * @param sweepId the sweep to look up
 * @returns the sweep's question, or undefined when it has not been cut or the sweep recorded an empty
 */
export function questionFor({
  events,
  sweepId,
}: {
  events: readonly QuizEvent[];
  sweepId: string;
}): SelectedQuiz | undefined {
  return events.find((event): event is SelectedQuiz => event.kind === "selected" && event.sweepId === sweepId);
}

/**
 * Their answer to one question, or undefined when they have not given one.
 *
 * FIRST rather than latest, unlike the proposal queue's {@link answerFor}: a quiz question is asked once and
 * `knowledge quiz-answer` refuses a second answer to it, so a later row would be a hand edit rather than
 * them changing their mind. The next sweep is where a changed mind belongs.
 *
 * @param events every row the quiz ledger holds
 * @param quizId the question to look up
 * @returns what they said, or undefined
 */
export function answerTo({
  events,
  quizId: id,
}: {
  events: readonly QuizEvent[];
  quizId: string;
}): Extract<QuizEvent, { kind: "answered" }> | undefined {
  return events.find(
    (event): event is Extract<QuizEvent, { kind: "answered" }> => event.kind === "answered" && event.quizId === id,
  );
}

/**
 * Whether a decoded value carries every field a {@link LessonRow} owes, shallowly.
 *
 * Positional by the compiler's own decision: TS1230 forbids a destructured parameter in a type predicate.
 */
function isStoredLesson(value: unknown): value is LessonRow {
  if (!isRecord(value)) {
    return false;
  }
  const required = ["id", "domain", "claim", "verdict", "tier", "surface", "learner", "evidence", "run"];
  return required.every((field) => typeof value[field] === "string" || typeof value[field] === "number");
}

/**
 * Decode one stored ledger line back into an event, checking every shape.
 *
 * Re-validated on the way IN rather than trusted, exactly as `../row.ts` and `../voice/unit.ts` do it, and
 * for their reason: the ledger is a plain append-only file a human can read and will eventually edit.
 *
 * @param line one line of the ledger
 * @returns the event, or undefined when the line does not decode
 */
export function parseQuizLine({ line }: { line: string }): QuizEvent | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded)) {
    return undefined;
  }
  const { kind } = decoded;
  if (kind === "empty") {
    return decodeEmpty({ decoded });
  }
  if (kind === "answered") {
    return decodeAnswered({ decoded });
  }
  return kind === "selected" ? decodeSelected({ decoded }) : undefined;
}

/** One `empty` line, or undefined when a required field is missing. */
function decodeEmpty({ decoded }: { decoded: Record<string, unknown> }): QuizEvent | undefined {
  const { sweepId, why, selectedAtIso } = decoded;
  if (typeof sweepId !== "string" || typeof why !== "string" || typeof selectedAtIso !== "string") {
    return undefined;
  }
  return { kind: "empty", selectedAtIso, sweepId, why };
}

/** One `answered` line, or undefined when a required field is missing. */
function decodeAnswered({ decoded }: { decoded: Record<string, unknown> }): QuizEvent | undefined {
  const { quizId: id, words, answeredAtIso, run } = decoded;
  const ok =
    typeof id === "string" && typeof words === "string" && typeof answeredAtIso === "string" && typeof run === "string";
  return ok ? { answeredAtIso, kind: "answered", quizId: id, run, words } : undefined;
}

/**
 * Whether a decoded value carries every field a {@link TraceRow} owes, shallowly.
 *
 * Positional by the compiler's own decision: TS1230 forbids destructuring in a type predicate.
 */
function isStoredTrace(value: unknown): value is TraceRow {
  if (!isRecord(value)) {
    return false;
  }
  return ["id", "domain", "question", "probe", "outcome", "evidence", "verdict", "learner", "run"].every(
    (field) => typeof value[field] === "string",
  );
}

/**
 * The subject a `selected` line pinned, in either the shape written before traces were askable or the one
 * written since.
 *
 * A line from the older ledger holds a BARE lesson row, so it reads as a lesson rather than failing to
 * decode: what a sweep asked them is a fact that does not stop being true because the vocabulary widened.
 *
 * @param value whatever the line's `fleet` field held
 * @returns the subject, or undefined when the line decodes to neither shape
 */
function decodeSubject({ value }: { value: unknown }): QuizSubject | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["kind"] === "trace" && isStoredTrace(value["trace"])) {
    return { kind: "trace", trace: value["trace"] };
  }
  if (value["kind"] === "lesson" && isStoredLesson(value["lesson"])) {
    return { kind: "lesson", lesson: value["lesson"] };
  }
  return isStoredLesson(value) ? { kind: "lesson", lesson: value } : undefined;
}

/** One `selected` line, receipt and all, or undefined when a required field is missing or malformed. */
function decodeSelected({ decoded }: { decoded: Record<string, unknown> }): QuizEvent | undefined {
  const { quizId: id, sweepId, lessonId, fleet, selectedAtIso } = decoded;
  const subject = decodeSubject({ value: fleet });
  const ok =
    typeof id === "string" &&
    typeof sweepId === "string" &&
    typeof lessonId === "string" &&
    typeof selectedAtIso === "string" &&
    subject !== undefined;
  return ok ? { fleet: subject, kind: "selected", lessonId, quizId: id, selectedAtIso, sweepId } : undefined;
}
