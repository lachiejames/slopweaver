/**
 * `slopweaver knowledge answer` — record what THEY said about one proposed belief.
 *
 * The other end of the briefing's correction block. They read a row, say `right`, `wrong` or `partly` to
 * the pinned supervisor, and a visible session writes that down here. The row lands in the same append-only
 * queue the proposal is in, so their answer and the claim it answers are one file a reader can walk.
 *
 * ## What it refuses, and what it cannot
 *
 * It refuses an id the queue does not hold and one it has already answered, and it says which of the two —
 * "already answered" and "never proposed" lead to opposite next actions. It cannot check that the mark is a
 * fair reading of what they said; that is the session's judgement and rule 2 keeps it there.
 *
 * Recording the answer does NOT record a register row. That is deliberate and it is the boundary
 * `../../../knowledge/voice/types.ts` draws: a lesson owes a verdict and evidence that was observed, and
 * neither can be manufactured from a mark. `knowledge record --learner owner` is the separate, explicit
 * second step, and the verb says so on every success.
 */
import { buildAnswer } from "../../../knowledge/voice/answer.js";
import { appendProposal, readProposals } from "../../../knowledge/voice/store.js";
import { type AnsweredProposal, BELIEF_MARKS, type BeliefMark } from "../../../knowledge/voice/types.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { ANSWER_USAGE, parseKnowledgeAnswerArgs, VERB_ARG_OFFSET } from "./core.js";

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
function report({ row, path, json }: { row: AnsweredProposal; path: string; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(row) });
    return;
  }
  logger.out({ line: `knowledge answer: ${row.proposalId} — they say ${row.mark}` });
  logger.out({ line: `  their words: ${row.why}` });
  if (row.correction !== undefined) {
    logger.out({ line: `  they would say: ${row.correction}` });
  }
  logger.out({ line: `  ${path}` });
  logger.out({
    line:
      "  their reaction is recorded; no register row is. A lesson owes a verdict and evidence that was " +
      "observed — record one with `slopweaver knowledge record --learner owner` when the answer supports it",
  });
}

/**
 * The three things they actually said, or undefined once the refusal has been printed.
 *
 * Split out of {@link runKnowledgeAnswer} so that function stays a sequence of steps rather than a wall of
 * argv checks. Each refusal names the flag AND why it exists — "`right` on its own is a fine answer" is
 * what stops a session inventing prose to satisfy `--why`.
 *
 * @param positionals the argv positionals, whose first is the proposal id
 * @param values the parsed flag values
 * @returns their mark, their words and the proposal they answer, or undefined
 */
function whatOwnerSaid({
  positionals,
  values,
}: {
  positionals: readonly string[];
  values: Readonly<Record<string, unknown>>;
}): { proposalId: string; mark: BeliefMark; why: string } | undefined {
  const proposalId = positionals[0];
  if (proposalId === undefined) {
    logger.error({ msg: "knowledge answer: the proposal id they are answering is required" });
    logger.error({ msg: ANSWER_USAGE });
    return undefined;
  }
  const mark = BELIEF_MARKS.find((entry) => entry === flag({ name: "mark", values }));
  if (mark === undefined) {
    logger.error({ msg: `knowledge answer: --mark must be one of ${BELIEF_MARKS.join(", ")}` });
    logger.error({ msg: ANSWER_USAGE });
    return undefined;
  }
  const why = flag({ name: "why", values });
  if (why === undefined) {
    logger.error({
      msg: "knowledge answer: --why is required — it carries THEIR words, and `right` on its own is a fine answer",
    });
    logger.error({ msg: ANSWER_USAGE });
    return undefined;
  }
  return { mark, proposalId, why };
}

/**
 * Run `knowledge answer`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runKnowledgeAnswer(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ANSWER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeAnswerArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ANSWER_USAGE });
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed.value;
  const said = whatOwnerSaid({ positionals, values });
  if (said === undefined) {
    return EXIT_USAGE;
  }
  const { proposalId, mark, why } = said;
  const home = flag({ name: "home", values });
  const queue = readProposals(home === undefined ? {} : { home });
  if (queue.isErr()) {
    logger.error({ msg: `knowledge answer: ${queue.error.message}` });
    return EXIT_ERROR;
  }
  const correction = flag({ name: "correction", values });
  const run = runSlug({ values });
  const built = buildAnswer({
    mark,
    proposalId,
    proposals: queue.value,
    reviewedAtIso: new Date().toISOString(),
    run,
    why,
    ...(correction === undefined ? {} : { correction }),
  });
  if (built.isErr()) {
    logger.error({ msg: `knowledge answer: ${built.error.message}` });
    return EXIT_ERROR;
  }
  const written = appendProposal({ row: built.value, ...(home === undefined ? {} : { home }) });
  if (written.isErr()) {
    logger.error({ msg: `knowledge answer: ${written.error.message}` });
    return EXIT_ERROR;
  }
  report({ json: values["json"] === true, path: written.value, row: built.value });
  return EXIT_OK;
}

export const knowledgeAnswerCommand = defineCommand({ run: runKnowledgeAnswer });
