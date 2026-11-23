/**
 * `slopweaver knowledge quiz` — cut this sweep's one question, or print the one it already cut.
 *
 * The verb is IDEMPOTENT per
 * sweep by construction: a sweep that has already asked gets its own question back rather than a fresh
 * selection, because the briefing page they are reading carries that question's id and their answer names it.
 *
 * ## What it refuses, and what it will not do
 *
 * It refuses a call with no `--sweep`, because "this sweep" is the whole unit of the ruling and a verb that
 * invented one would cut a question no page ever showed them. It does not judge which lesson is worth
 * asking about — rule 2 forbids a model inside a verb, so the selection is a mechanical rotation
 * (`../../../knowledge/quiz/select.ts`) rather than a reading.
 *
 * A register with no eligible lesson records an EMPTY row and says so. That is a real answer to "what did
 * this sweep ask", and it is what stops the next render re-cutting forever.
 */
import { readLessonRows, readTraceRows } from "../../../knowledge/memoryStore.js";
import { cutQuestion, type QuizCut } from "../../../knowledge/quiz/cut.js";
import { excludedByVerdict, latestFleetLessons } from "../../../knowledge/quiz/select.js";
import { appendQuizEvent, readQuiz } from "../../../knowledge/quiz/store.js";
import type { QuizEvent, SelectedQuiz } from "../../../knowledge/quiz/types.js";
import type { TraceRow } from "../../../knowledge/traceRow.js";
import type { LessonRow } from "../../../knowledge/types.js";
import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { QUIZ_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { parseKnowledgeQuizArgs } from "./flagSpecs.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** What the verb prints when the sweep has a question. */
function report({ question, excluded }: { question: SelectedQuiz; excluded: ReadonlyMap<string, number> }): void {
  const subject = question.fleet;
  if (subject.kind === "trace") {
    const { trace } = subject;
    logger.out({ line: `knowledge quiz: ${question.quizId} — ${trace.domain}` });
    logger.out({ line: `  ${trace.question}` });
    logger.out({ line: `  we looked here: ${trace.probe} — it came back ${trace.outcome}` });
    logger.out({ line: `  my answer: ${trace.verdict} — ${trace.evidence}` });
    logger.out({ line: `  trace ${question.lessonId}` });
    return;
  }
  const { lesson } = subject;
  logger.out({ line: `knowledge quiz: ${question.quizId} — ${lesson.domain}` });
  logger.out({ line: `  ${lesson.claim}` });
  logger.out({ line: `  my answer: ${lesson.verdict} — ${lesson.evidence}` });
  logger.out({ line: `  lesson ${question.lessonId} · tier ${String(lesson.tier)}` });
  if (excluded.size > 0) {
    const parts = [...excluded.entries()].map(([verdict, count]) => `${String(count)} ${verdict}`);
    logger.out({
      line: `  not eligible to be asked: ${parts.join(", ")} — a quiz needs an unambiguous reference answer`,
    });
  }
}

/**
 * Run `knowledge quiz`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeQuiz(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: QUIZ_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeQuizArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: QUIZ_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const sweepId = flag({ name: "sweep", values });
  if (sweepId === undefined) {
    logger.error({ msg: "knowledge quiz: --sweep must name this sweep's tick id" });
    logger.error({ msg: QUIZ_USAGE });
    return EXIT_USAGE;
  }
  const home = flag({ name: "home", values });
  const read = await readSources({ home });
  if (typeof read === "number") {
    return read;
  }
  const cut = cutQuestion({
    events: read.events,
    nowIso: new Date().toISOString(),
    rows: read.rows,
    sweepId,
    traces: read.traces,
  });
  const recorded = recordCut({ cut, home });
  if (recorded !== undefined) {
    return recorded;
  }
  if (values["json"] === true) {
    logger.out({ line: JSON.stringify(quizDocument({ cut, sweepId })) });
    return EXIT_OK;
  }
  if (cut.question === undefined) {
    logger.out({
      line:
        `knowledge quiz: ${sweepId} asks nothing — the register holds no fleet lesson with a confirmed or ` +
        "refuted verdict. That is recorded, so the next render will not re-cut it",
    });
    return EXIT_OK;
  }
  report({ excluded: excludedByVerdict({ rows: latestFleetLessons({ rows: read.rows }) }), question: cut.question });
  return EXIT_OK;
}

/**
 * Record the selection this cut made, when it made one.
 *
 * Split out of the verb so its body stays a sequence of refusals: a cut that selected nothing has nothing
 * to write, and that is not a branch the reader of the verb needs to hold.
 *
 * @param cut what `cutQuestion` decided
 * @param home the state home to write into, absent for the resolved one
 * @returns the exit code a write failure has already reported, or undefined when there is nothing to say
 */
function recordCut({ cut, home }: { cut: QuizCut; home: string | undefined }): number | undefined {
  if (cut.write === undefined) {
    return undefined;
  }
  const written = appendQuizEvent({ event: cut.write, ...(home === undefined ? {} : { home }) });
  if (written.isErr()) {
    logger.error({ msg: `knowledge quiz: ${written.error.message}` });
    return EXIT_ERROR;
  }
  return undefined;
}

/**
 * What `--json` prints for one sweep.
 *
 * "This sweep asked nothing" is a shape of its own rather than an absent question, so it is an `if` naming
 * that case: `??` is refused by `no-silent-fallback` and a ternary by oxlint's `prefer-nullish-coalescing`.
 *
 * @param cut what `cutQuestion` decided
 * @param sweepId the tick the caller named
 * @returns the question, or the record that this sweep asked none
 */
function quizDocument({ cut, sweepId }: { cut: QuizCut; sweepId: string }): unknown {
  if (cut.question === undefined) {
    return { asked: false, sweepId };
  }
  return cut.question;
}

/** What the verb reads before it can cut anything: both halves of the register, and the ledger. */
interface QuizSources {
  readonly rows: readonly LessonRow[];
  readonly traces: readonly TraceRow[];
  readonly events: readonly QuizEvent[];
}

/** The register and the ledger this verb reads, or the exit code a failure has already reported. */
async function readSources({ home }: { home: string | undefined }): Promise<QuizSources | number> {
  const stored = await storedSubjects({ home });
  if (typeof stored === "string") {
    logger.error({ msg: `knowledge quiz: ${stored}` });
    return EXIT_ERROR;
  }
  const events = readQuiz(home === undefined ? {} : { home });
  if (events.isErr()) {
    logger.error({ msg: `knowledge quiz: ${events.error.message}` });
    return EXIT_ERROR;
  }
  return { events: events.value, rows: stored.rows, traces: stored.traces };
}

/**
 * Every lesson AND every trace the memories table holds, or the reason they could not be read.
 *
 * A failure is a MESSAGE rather than an empty register, so a sweep cannot record "nothing was eligible"
 * because the store was down — that row is what stops the next render re-cutting, and writing it on an
 * outage would retire a question nobody was ever asked. Both reads share one connection: they answer one
 * question ("what may this sweep ask about"), and two connections would let half of it succeed.
 *
 * @param home the state home whose remembered store selection is used
 * @returns both halves in recorded order, or the failure to print
 */
async function storedSubjects({
  home,
}: {
  home: string | undefined;
}): Promise<{ rows: readonly LessonRow[]; traces: readonly TraceRow[] } | string> {
  const opened = await connectStore(home === undefined ? {} : { home });
  if (opened.isErr()) {
    return opened.error.message;
  }
  const client = opened.value;
  try {
    const rows = await readLessonRows({ client });
    if (rows.isErr()) {
      return rows.error.message;
    }
    const traces = await readTraceRows({ client });
    if (traces.isErr()) {
      return traces.error.message;
    }
    return { rows: rows.value, traces: traces.value };
  } finally {
    await client.close();
  }
}

export const knowledgeQuizCommand = defineCommand({ run: runKnowledgeQuiz });
