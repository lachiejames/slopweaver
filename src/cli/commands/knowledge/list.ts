/**
 * `slopweaver knowledge list` — read the register back, filtered by facet.
 *
 * Reads local state and nothing else: no network, no model, no clock in the output.
 * The register is the `memories` table rather than a file, so this verb needs the STORE reachable — local
 * still, a Postgres on this machine, never a provider. `--repeats` is the one derived view, and it is the
 * owner's consolidation trigger rather than a convenience — see `../../../knowledge/query.ts`.
 *
 * Only `kind = 'lesson'` rows reach the filters, applied in the query rather than here: a preference is not
 * a measured lesson and counting one as a repeat would manufacture the consolidation signal. A claim a later
 * recording retired (`../../../knowledge/supersession.ts`) never reaches them either.
 */
import { readLessonRows } from "../../../knowledge/memoryStore.js";
import { filterLessons, repeatedLessons } from "../../../knowledge/query.js";
import { withoutRetired } from "../../../knowledge/supersession.js";
import {
  LESSON_LEARNERS,
  LESSON_SURFACES,
  LESSON_TIER_MEANINGS,
  LESSON_TIERS,
  LESSON_VERDICTS,
  type LessonLearner,
  type LessonRow,
  type LessonSurface,
  type LessonTier,
  type LessonVerdict,
} from "../../../knowledge/types.js";
import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { LIST_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { parseKnowledgeListArgs } from "./flagSpecs.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * What a closed-vocabulary filter flag resolved to: absent, a member, or a value outside the vocabulary.
 *
 * Three states rather than two, because collapsing the third into "absent" is a filter that silently does
 * not filter — `--verdict confimed` (a typo) once printed the whole register with an exit code of zero, and
 * a reader has no way to tell that from a register where every row really is confirmed. That is the shape
 * this repository names as a check that cannot fail reporting clean.
 */
type FilterChoice<T> =
  | { readonly state: "absent" }
  | { readonly state: "chosen"; readonly value: T }
  | { readonly state: "unknown"; readonly typed: string };

/**
 * Resolve one closed-vocabulary filter flag against its own vocabulary.
 *
 * Generic over the vocabulary rather than written four times, because the three states and their meanings
 * are identical for every facet; only the member list differs.
 *
 * @param values the parsed flag values
 * @param name the flag, without its `--`
 * @param vocabulary every accepted member
 * @param spell how a member is written on the command line, for a vocabulary that is not strings
 * @returns which of the three states the flag is in
 */
function filterChoice<T>({
  values,
  name,
  vocabulary,
  spell,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
  vocabulary: readonly T[];
  spell: (entry: T) => string;
}): FilterChoice<T> {
  const typed = flag({ name, values });
  if (typed === undefined) {
    return { state: "absent" };
  }
  const found = vocabulary.find((entry) => spell(entry) === typed);
  if (found === undefined) {
    return { state: "unknown", typed };
  }
  return { state: "chosen", value: found };
}

/**
 * Run `knowledge list`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeList(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LIST_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeListArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: LIST_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = flag({ name: "home", values });
  const repeats = values["repeats"] === true;
  const facets = resolveFacets({ repeats, values });
  if (facets.refusals.length > 0) {
    facets.refusals.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: LIST_USAGE });
    return EXIT_USAGE;
  }
  const stored = await storedLessons({ home });
  if (typeof stored === "string") {
    logger.error({ msg: `knowledge list: ${stored}` });
    return EXIT_ERROR;
  }
  // A retired claim is dropped BEFORE the facets filter, so a --domain or --learner filter cannot bring back
  // a claim a later recording outside that filter retired.
  const rows = filterLessons({
    ...facets.chosen,
    domain: flag({ name: "domain", values }),
    rows: withoutRetired({ rows: stored }),
    run: flag({ name: "run", values }),
  });
  if (repeats) {
    return reportRepeats({ json: values["json"] === true, rows });
  }
  if (values["json"] === true) {
    rows.forEach((row) => {
      logger.out({ line: JSON.stringify(row) });
    });
    return EXIT_OK;
  }
  if (rows.length === 0) {
    logger.out({
      line: "knowledge list: no lesson matches — an empty register and a filtered-out one look the same here",
    });
    return EXIT_OK;
  }
  rows.forEach((row) => {
    printRow({ row });
  });
  logger.out({ line: `${String(rows.length)} lesson(s)` });
  return EXIT_OK;
}

/**
 * Every lesson the memories table holds, or the reason it could not be read.
 *
 * A failure is a MESSAGE rather than an empty list for the reason `../../../knowledge/memoryStore.ts`
 * gives: "nothing has been recorded" and "the store is down" lead to opposite next actions, and this verb
 * is how a session checks the first. The connection is closed in a `finally`.
 *
 * @param home the state home whose remembered store selection is used
 * @returns every lesson in recorded order, or the failure to print
 */
async function storedLessons({ home }: { home: string | undefined }): Promise<readonly LessonRow[] | string> {
  const opened = await connectStore(home === undefined ? {} : { home });
  if (opened.isErr()) {
    return opened.error.message;
  }
  const client = opened.value;
  try {
    const rows = await readLessonRows({ client });
    return rows.isErr() ? rows.error.message : rows.value;
  } finally {
    await client.close();
  }
}

/**
 * Every closed-vocabulary facet flag, resolved in one pass: what to filter by, and what to refuse.
 *
 * Both halves come back together rather than the caller asking twice, because a run that filtered by the
 * facets it understood while ignoring one it did not is the exact silent-filter failure this resolution
 * exists to prevent.
 *
 * @param values the parsed flag values
 * @param repeats whether the consolidation view was asked for, which decides the learner default
 * @returns the facets to filter by, and one refusal line per flag typed outside its vocabulary
 */
function resolveFacets({ values, repeats }: { values: Readonly<Record<string, unknown>>; repeats: boolean }): {
  readonly chosen: {
    readonly verdict: LessonVerdict | undefined;
    readonly tier: LessonTier | undefined;
    readonly surface: LessonSurface | undefined;
    readonly learner: LessonLearner | undefined;
  };
  readonly refusals: readonly string[];
} {
  const verdict = filterChoice<LessonVerdict>({
    name: "verdict",
    spell: (e) => e,
    values,
    vocabulary: LESSON_VERDICTS,
  });
  const tier = filterChoice<LessonTier>({ name: "tier", spell: (e) => String(e), values, vocabulary: LESSON_TIERS });
  const surface = filterChoice<LessonSurface>({
    name: "surface",
    spell: (e) => e,
    values,
    vocabulary: LESSON_SURFACES,
  });
  const learner = filterChoice<LessonLearner>({
    name: "learner",
    spell: (e) => e,
    values,
    vocabulary: LESSON_LEARNERS,
  });
  return {
    chosen: {
      learner: chosenLearner({ choice: learner, repeats }),
      surface: surface.state === "chosen" ? surface.value : undefined,
      tier: tier.state === "chosen" ? tier.value : undefined,
      verdict: verdict.state === "chosen" ? verdict.value : undefined,
    },
    refusals: [
      refusalFor({ allowed: LESSON_VERDICTS.join(", "), choice: verdict, flag: "--verdict" }),
      refusalFor({ allowed: LESSON_TIERS.map((e) => String(e)).join(", "), choice: tier, flag: "--tier" }),
      refusalFor({ allowed: LESSON_SURFACES.join(", "), choice: surface, flag: "--surface" }),
      refusalFor({ allowed: LESSON_LEARNERS.join(", "), choice: learner, flag: "--learner" }),
    ].filter((line): line is string => line !== undefined),
  };
}

/**
 * The refusal line for one filter flag typed outside its vocabulary, or undefined when there is nothing
 * wrong with it.
 *
 * The whole vocabulary is printed rather than only the rejected value, for the reason `./record.ts`'s own
 * refusal gives: the reader is choosing from a closed list they may never have seen.
 *
 * @param choice what the flag resolved to
 * @param flag the `--`-prefixed flag, for the message
 * @param allowed every accepted value, already joined for printing
 * @returns the line to print, or undefined
 */
function refusalFor<T>({
  choice,
  flag: name,
  allowed,
}: {
  choice: FilterChoice<T>;
  flag: string;
  allowed: string;
}): string | undefined {
  if (choice.state !== "unknown") {
    return undefined;
  }
  return `knowledge list: ${name} "${choice.typed}" is not one of ${allowed} — refusing rather than reading the register unfiltered`;
}

/**
 * Which side of the register to read, once `--repeats` has had its say.
 *
 * `--repeats` narrows to the FLEET by default, and that default is the correction for a real hazard rather
 * than a preference: a row of the owner's and a row of the fleet's for the same claim share an id (`lessonId` does
 * not hash the learner), so grouping both sides together reports a repeat across two "runs" that exactly one
 * fleet session ever learned. The consolidation trigger is about independent fleet learning, so that is what
 * it counts. An explicit `--learner` always wins, including `--learner owner --repeats`, which is the
 * question "which of the owner's beliefs have they stated more than once".
 *
 * @param choice what `--learner` resolved to
 * @param repeats whether the consolidation view was asked for
 * @returns the learner to filter by, or undefined for both sides
 */
function chosenLearner({
  choice,
  repeats,
}: {
  choice: FilterChoice<LessonLearner>;
  repeats: boolean;
}): LessonLearner | undefined {
  if (choice.state === "chosen") {
    return choice.value;
  }
  return repeats ? "fleet" : undefined;
}

/** One row, in the four groups it is built from. */
function printRow({ row }: { row: LessonRow }): void {
  logger.out({ line: "" });
  logger.out({
    line:
      `${row.id} · ${row.domain} · tier ${String(row.tier)} · ${row.verdict} · ${row.surface}` +
      ` · ${row.learner === "owner" ? "the owner's" : "fleet"}`,
  });
  logger.out({ line: `  ${row.claim}` });
  logger.out({ line: `  measured: ${row.evidence}` });
  if (row.caveat !== undefined) {
    logger.out({ line: `  caveat:   ${row.caveat}` });
  }
  if (row.repro !== undefined) {
    logger.out({ line: `  repro:    ${row.repro}` });
  }
  if (row.supersedes !== undefined) {
    logger.out({ line: `  retires:  ${row.supersedes}` });
  }
  logger.out({
    line: `  recorded ${row.recordedAtIso} on ${row.run} — tier ${String(row.tier)}: ${LESSON_TIER_MEANINGS[row.tier]}`,
  });
}

/** The consolidation view: what more than one run has now learned independently. */
function reportRepeats({ rows, json }: { rows: readonly LessonRow[]; json: boolean }): number {
  const repeats = repeatedLessons({ rows });
  if (json) {
    repeats.forEach((repeat) => {
      logger.out({ line: JSON.stringify(repeat) });
    });
    return EXIT_OK;
  }
  if (repeats.length === 0) {
    logger.out({ line: "knowledge list: no lesson has been recorded twice yet" });
    return EXIT_OK;
  }
  repeats.forEach((repeat) => {
    logger.out({ line: "" });
    logger.out({
      line: `${repeat.id} · recorded ${String(repeat.count)} time(s) across ${String(repeat.runs)} run(s) · ${repeat.first.domain}`,
    });
    logger.out({ line: `  ${repeat.first.claim}` });
  });
  logger.out({ line: "" });
  logger.out({
    line: "A lesson several RUNS learned independently is the signal to make it a standing rule or a gate, so no future session has to learn it again.",
  });
  return EXIT_OK;
}

export const knowledgeListCommand = defineCommand({ run: runKnowledgeList });
