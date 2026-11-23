/**
 * Cutting one sweep's question, and recording what they said about it. Pure — rows in, an event out.
 *
 * The effectful half is `./store.ts`; this file is where the two rules that make a quiz honest live, and
 * both are about IDEMPOTENCE rather than about content:
 *
 * - **A sweep that already asked returns its own question**, never a fresh selection. The page they are
 *   reading carries an id, and that id has to keep meaning what it meant when the page was rendered.
 * - **A question they have answered refuses a second answer.** What they said is never overwritten; a changed
 *   mind belongs in the next sweep, which will ask a different question anyway.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { TraceRow } from "../traceRow.js";
import type { LessonRow } from "../types.js";

import { type QuizError, QuizErrors } from "./errors.js";
import { answerTo, nextSubject, questionFor, quizId, subjectId } from "./select.js";
import { type AnsweredQuiz, type EmptyQuiz, QUIZ_ANSWER_MAX, type QuizEvent, type SelectedQuiz } from "./types.js";

/** What cutting a sweep's question produced, and whether it was cut now or already stood. */
export interface QuizCut {
  /** The event to append, or undefined when the sweep already had one recorded. */
  readonly write: SelectedQuiz | EmptyQuiz | undefined;
  /** The sweep's question, absent when the register held no eligible lesson. */
  readonly question: SelectedQuiz | undefined;
}

/** A non-empty trimmed string within a cap, or the reason it is not one. */
function requireText({ field, value, max }: { field: string; value: string; max: number }): Result<string, QuizError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(QuizErrors.field({ field, why: "is empty" }));
  }
  if (trimmed.length > max) {
    return err(
      QuizErrors.field({ field, why: `is ${String(trimmed.length)} characters, over the ${String(max)} allowed` }),
    );
  }
  return ok(trimmed);
}

/**
 * The question this sweep asks, cutting a new one only when the sweep has not asked yet.
 *
 * An EMPTY outcome is recorded as a row rather than left as an absence, the same call the proposal queue's
 * `none` arm makes: a sweep that found no eligible lesson has answered the question "what did this sweep
 * ask", and a reader that could not tell that apart from a sweep that never ran would re-cut forever.
 *
 * @param events every row the quiz ledger holds
 * @param rows every row the register holds
 * @param sweepId the sweep asking
 * @param nowIso the instant to stamp; passed in so this stays pure
 * @returns what to write and what the sweep's question is
 */
export function cutQuestion({
  events,
  rows,
  traces,
  sweepId,
  nowIso,
}: {
  events: readonly QuizEvent[];
  rows: readonly LessonRow[];
  /** Every trace the register holds. The quiz asks about these as well as lessons, and they go first. */
  traces: readonly TraceRow[];
  sweepId: string;
  nowIso: string;
}): QuizCut {
  const standing = questionFor({ events, sweepId });
  if (standing !== undefined) {
    return { question: standing, write: undefined };
  }
  if (events.some((event) => event.kind === "empty" && event.sweepId === sweepId)) {
    return { question: undefined, write: undefined };
  }
  const subject = nextSubject({ events, lessons: rows, traces });
  if (subject === undefined) {
    return {
      question: undefined,
      write: {
        kind: "empty",
        selectedAtIso: nowIso,
        sweepId,
        why: "the register holds no fleet trace, and no lesson with a confirmed or refuted verdict, to ask about",
      },
    };
  }
  const id = subjectId({ subject });
  const question: SelectedQuiz = {
    fleet: subject,
    kind: "selected",
    lessonId: id,
    quizId: quizId({ lessonId: id, sweepId }),
    selectedAtIso: nowIso,
    sweepId,
  };
  return { question, write: question };
}

/**
 * Build the row recording what they said about one question.
 *
 * @param events every row the quiz ledger holds
 * @param quizId the question they answered
 * @param words their own words, as the supervisor relayed them
 * @param run the board row the recording session is on
 * @param answeredAtIso the instant to stamp; passed in so this stays pure
 * @returns the row, or the first check that failed
 */
export function buildQuizAnswer({
  events,
  quizId: id,
  words,
  run,
  answeredAtIso,
}: {
  events: readonly QuizEvent[];
  quizId: string;
  words: string;
  run: string;
  answeredAtIso: string;
}): Result<AnsweredQuiz, QuizError> {
  if (!events.some((event) => event.kind === "selected" && event.quizId === id)) {
    return err(QuizErrors.notFound({ quizId: id }));
  }
  if (answerTo({ events, quizId: id }) !== undefined) {
    return err(QuizErrors.alreadyAnswered({ quizId: id }));
  }
  const said = requireText({ field: "answer", max: QUIZ_ANSWER_MAX, value: words });
  if (said.isErr()) {
    return err(said.error);
  }
  const runText = requireText({ field: "run", max: 200, value: run });
  if (runText.isErr()) {
    return err(runText.error);
  }
  return ok({ answeredAtIso, kind: "answered", quizId: id, run: runText.value, words: said.value });
}
