/**
 * `slopweaver knowledge quiz-answer` — record what THEY said about this sweep's question.
 *
 * The other end of the briefing's quiz block. They read the claim, tell the supervisor the id and what they
 * thinks, and a visible session writes that down here.
 *
 * ## It records their ANSWER, and grades nothing
 *
 * There is no `--correct` flag and there will not be one. Deciding whether their answer is right means
 * assessing the claim, which is what `knowledge record --learner owner` is for and what a verdict on a
 * register row means — and a session hearing "no, that only happens on the read replica" has to judge
 * whether that refutes the fleet's claim or narrows it. Rule 2 keeps that judgement in a visible session,
 * so this verb stores the words and says what is still owed.
 *
 * A second answer to one question is REFUSED: what they said is never overwritten, and a changed mind belongs
 * in the next sweep, which asks a different question anyway.
 */
import { buildQuizAnswer } from "../../../knowledge/quiz/cut.js";
import { appendQuizEvent, readQuiz } from "../../../knowledge/quiz/store.js";
import type { AnsweredQuiz } from "../../../knowledge/quiz/types.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseKnowledgeQuizAnswerArgs, QUIZ_ANSWER_USAGE, VERB_ARG_OFFSET } from "./core.js";

/** The run recorded when no `--run` was given. A real value on the row, never an absent field. */
const AD_HOC = "ad-hoc";

/**
 * The run slug this row is recorded against.
 *
 * `--run` is optional and AD_HOC is a real value on the row rather than an absent field, so the
 * substitution is an `if` naming the absent case: `??` is refused by `no-silent-fallback` and a ternary is
 * refused by oxlint's `prefer-nullish-coalescing`, and a statement is what satisfies both.
 *
 * @param values the parsed flag values
 * @returns the named run, or AD_HOC when none was given
 */
function runSlug({ values }: { values: Readonly<Record<string, unknown>> }): string {
  const named = flag({ name: "run", values });
  if (named === undefined) {
    return AD_HOC;
  }
  return named;
}

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** What the verb prints once their answer is on disk. */
function report({ row, path, json }: { row: AnsweredQuiz; path: string; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(row) });
    return;
  }
  logger.out({ line: `knowledge quiz-answer: ${row.quizId} answered` });
  logger.out({ line: `  their words: ${row.words}` });
  logger.out({ line: `  ${path}` });
  logger.out({
    line:
      "  their answer is recorded; no register row is. Read it against the fleet's claim and, when it " +
      "supports one, record their belief with `slopweaver knowledge record --learner owner`",
  });
}

/**
 * Run `knowledge quiz-answer`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runKnowledgeQuizAnswer(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: QUIZ_ANSWER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeQuizAnswerArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: QUIZ_ANSWER_USAGE });
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed.value;
  const quizId = positionals[0];
  const words = flag({ name: "answer", values });
  if (quizId === undefined || words === undefined) {
    logger.error({ msg: "knowledge quiz-answer: the question id and --answer are both required" });
    logger.error({ msg: QUIZ_ANSWER_USAGE });
    return EXIT_USAGE;
  }
  const home = flag({ name: "home", values });
  const events = readQuiz(home === undefined ? {} : { home });
  if (events.isErr()) {
    logger.error({ msg: `knowledge quiz-answer: ${events.error.message}` });
    return EXIT_ERROR;
  }
  const run = runSlug({ values });
  const built = buildQuizAnswer({
    answeredAtIso: new Date().toISOString(),
    events: events.value,
    quizId,
    run,
    words,
  });
  if (built.isErr()) {
    logger.error({ msg: `knowledge quiz-answer: ${built.error.message}` });
    return EXIT_ERROR;
  }
  const written = appendQuizEvent({ event: built.value, ...(home === undefined ? {} : { home }) });
  if (written.isErr()) {
    logger.error({ msg: `knowledge quiz-answer: ${written.error.message}` });
    return EXIT_ERROR;
  }
  report({ json: values["json"] === true, path: written.value, row: built.value });
  return EXIT_OK;
}

export const knowledgeQuizAnswerCommand = defineCommand({ run: runKnowledgeQuizAnswer });
