/**
 * `slopweaver handover example <slug>` — give an OPEN ask the concrete examples its Queue card leads with, or the
 * one line saying why its row cannot support a truthful one.
 *
 * ## The gap this closes
 *
 * Every open Queue card carries, above its options, a second-person scene the owner can
 * picture, ending on the question it is really asking (`../../../handover/askExamples.ts`). The recording verbs
 * require one on every NEW ask; this is the verb that gives one to an ask already open, which is how the backfill
 * is done and how related asks folded onto one card gain their numbered scenes.
 *
 * ## Two homes, one per row shape, and the board reads exactly one
 *
 * - A run parked on the owner: a `question-examples` journal event, bound to the open question's exact text, so a later
 *   re-ask or reshape leaves it behind rather than lending the old scene to a new question (`openQuestion.ts`).
 * - A registered ask with no run behind it: `examples:` / `exampleGap:` in its front matter.
 *
 * `handover list --json` publishes from whichever of the two its question came from (`./listJson.ts`), so a card's
 * scene and its question never come from two places.
 *
 * ## Why it does not require holding the run
 *
 * A backfill crosses rows other sessions hold, exactly as `handover reconfirm` does. It moves no phase, touches
 * neither the question, its shape nor the instant it was asked, and what it writes is printed on the card where the owner
 * reads it, so a wrong scene is visible rather than hidden. A row that is NOT open on the owner is refused: done cards are
 * left alone.
 */
import {
  type AskExampleSet,
  askExampleFrontMatter,
  askExampleProblems,
  askExampleSetOf,
  sameAskExampleSet,
} from "../../../handover/askExamples.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import { cardProseVerdict } from "../../../handover/cardAlignment.js";
import { exampleProseFields } from "../../../handover/cardImage.js";
import { OWNER_WAIT_KIND } from "../../../handover/ownerWait.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { isSafeSlug } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, parseFlags, repeatedFlagValues } from "../../parseFlags.js";
import { writeAskFrontMatter } from "./askFrontMatterWrite.js";
import { flagNamesOf, resolveHandoverDir, stringFlag, VERB_ARG_OFFSET } from "./commandSupport.js";
import { publishedWaitOf } from "./listJsonWait.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { composeRow } from "./rowRun.js";

/** The flags `handover example` accepts, names without the leading `--`. */
const EXAMPLE_FLAGS: FlagSpec = {
  repeatable: ["example"],
  string: ["example", "example-gap", "dir", "home"],
};

/** `--`-prefixed, so the help-truth ratchet can compare the usage string against the parser both ways. */
export const HANDOVER_EXAMPLE_FLAG_NAMES: readonly string[] = flagNamesOf({ spec: EXAMPLE_FLAGS });

export const EXAMPLE_USAGE =
  'usage: slopweaver handover example <slug> (--example "<scene>" [--example "<scene>" ...] | ' +
  '--example-gap "<line>") [--dir <path>] [--home <dir>]\n' +
  "\n" +
  "Gives an OPEN ask the concrete examples its Queue card leads with. A scene puts the owner in it, second person —\n" +
  "what they were doing, what appeared, what the fleet did or wants to do — and ends on the question the card is\n" +
  "really asking. Up to three, numbered on the card, for related asks folded onto one row.\n" +
  "\n" +
  "  --example      one scene; repeat it for each related ask, in the order the card numbers them\n" +
  "  --example-gap  one line saying why the row's own record cannot support a truthful scene — never invent one\n" +
  "\n" +
  "Replaces whatever the row carried. A run parked on the owner takes it in its journal, bound to the open question;\n" +
  "a registered ask takes it in its front matter. A row not open on the owner is refused. Needs no claim on the run.\n" +
  "\n" +
  'example: slopweaver handover example datadog-tool-error --example "You are in a meeting and the fleet, ' +
  "mid-way through a Datadog investigation, hits an error that blocks two of its tools, so it opens a fix PR and " +
  'self-merges it. Was that the right call?"';

/**
 * Parse `handover example`'s flags. Exported so the help-truth ratchet probes the real parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the parser's refusals
 */
export function parseHandoverExampleArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: EXAMPLE_FLAGS });
}

/** What recording a set on one row did. */
type ExampleWrite =
  | { readonly kind: "journalled"; readonly path: string }
  | { readonly kind: "written"; readonly path: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly problem: string };

/**
 * Re-read a registered ask's file, edit its front matter, read the edit back, and write it — all inside the row's one
 * lock (`./boardRowLock.ts`), so no other row edit is written over.
 *
 * @param path the row's file
 * @param slug the row the board composed, so a file another writer replaced is refused
 * @param set what to record
 * @returns what happened
 */
function writeFrontMatter({ path, slug, set }: { path: string; slug: string; set: AskExampleSet }): ExampleWrite {
  const fields = askExampleFrontMatter({ set });
  return writeAskFrontMatter({
    edit: {
      holds: (doc) =>
        sameAskExampleSet({ left: askExampleSetOf({ examples: doc.examples, gap: doc.exampleGap }), right: set }),
      remove: fields.remove,
      set: fields.set,
    },
    path,
    slug,
  });
}

/**
 * Record the set wherever this row's question lives: the journal for a run parked on the owner, else the front matter.
 *
 * @param model the composed row
 * @param set what to record
 * @param home the state home whose run journals are written
 * @returns what happened
 */
function recordExamples({ model, set, home }: { model: BoardModel; set: AskExampleSet; home: string }): ExampleWrite {
  const published = publishedWaitOf({ model });
  if (published.wait.kind !== OWNER_WAIT_KIND || published.question === undefined) {
    return {
      kind: "refused",
      problem: `${model.doc.slug} is not an ask open on the owner (${published.wait.kind}) — done cards are left alone`,
    };
  }
  if (model.run.kind !== "waiting-on-owner") {
    return writeFrontMatter({ path: model.doc.path, set, slug: model.doc.slug });
  }
  if (sameAskExampleSet({ left: model.run.illustration, right: set })) {
    return { kind: "unchanged" };
  }
  const appended = applyRowEvent({
    event: {
      atIso: new Date().toISOString(),
      kind: "question-examples",
      question: model.run.question,
      ...(set.kind === "gap" ? { examples: [], exampleGap: set.gap } : { examples: set.examples }),
    },
    runsDir: stateHomePaths({ home }).runs,
    slug: model.doc.slug,
  });
  if (appended.isErr()) {
    return { kind: "refused", problem: appended.error.message };
  }
  return { kind: "journalled", path: appended.value.path };
}

/** Print a usage-level refusal with the verb's own help, and hand back the exit code. */
function usageRefused({ problems }: { problems: readonly string[] }): number {
  problems.forEach((problem) => {
    logger.error({ msg: `handover example: ${problem}` });
  });
  logger.error({ msg: EXAMPLE_USAGE });
  return EXIT_USAGE;
}

/**
 * Give one open ask its examples.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverExample(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: EXAMPLE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverExampleArgs({ rest });
  if (parsed.isErr()) {
    return usageRefused({ problems: parsed.error });
  }
  const [slug, ...extra] = parsed.value.positionals;
  if (slug === undefined || extra.length > 0 || !isSafeSlug({ slug })) {
    return usageRefused({ problems: ["name exactly one row's slug — letters, digits, dots, dashes, underscores"] });
  }
  const examples = repeatedFlagValues({ name: "example", rest });
  const gap = stringFlag({ name: "example-gap", parsed: parsed.value });
  const problems = askExampleProblems({ examples, gap });
  if (problems.length > 0) {
    return usageRefused({ problems });
  }
  const set = askExampleSetOf({ examples, gap });
  if (set === undefined) {
    return usageRefused({ problems: ["pass --example or --example-gap"] });
  }
  const pictured = cardProseVerdict({
    command: "slopweaver handover example",
    env: process.env,
    fields: exampleProseFields({ examples, gap }),
  });
  if (pictured.kind === "refused") {
    pictured.lines.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const handoverDir = resolveHandoverDir({ dir: stringFlag({ name: "dir", parsed: parsed.value }), home });
  const row = composeRow({ base: undefined, handoverDir, home, slug });
  if (row.kind === "none") {
    logger.error({ msg: row.line.replace(/^handover row:/u, "handover example:") });
    return row.exit;
  }
  const write = recordExamples({ home, model: row.model, set });
  if (write.kind === "refused") {
    logger.error({ msg: `handover example: ${write.problem}` });
    return EXIT_ERROR;
  }
  if (write.kind === "unchanged") {
    logger.out({ line: `handover example: ${slug} already carries exactly this — nothing written` });
    return EXIT_OK;
  }
  const what = set.kind === "gap" ? "a gap line" : `${String(set.examples.length)} example(s)`;
  logger.out({ line: `handover example: ${slug} now carries ${what}` });
  if (write.kind === "journalled") {
    logger.out({ line: `  journal: ${write.path}` });
    return EXIT_OK;
  }
  logger.out({ line: `  doc: ${write.path}` });
  return (await mirrorAfterWrite({ home, path: write.path, verb: "example" })) ? EXIT_ERROR : EXIT_OK;
}

export const handoverExampleCommand = defineCommand({ run: runHandoverExample });
