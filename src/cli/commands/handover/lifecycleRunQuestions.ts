/**
 * `handover ask` and `handover answer` — recording the question that only the owner can settle, and the owner's answer. Split out of `lifecycleRun.ts`, which re-exports everything here unchanged; see
 * {@link ./lifecycleRunCore} for the shared resolve/flag machinery this depends on.
 */

import { realCmuxCli } from "../../../cmux/sidebar.js";
import type { AskAction } from "../../../handover/askAction.js";
import type { AskExampleSet } from "../../../handover/askExamples.js";
import type { RecordableShape } from "../../../handover/askShapeGate.js";
import { cardAlignmentVerdict } from "../../../handover/cardAlignment.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { ruledReaskVerdict } from "../../../handover/ruledReaskGate.js";
import { askOnSettledRowRefusal } from "../../../handover/settledAsk.js";
import { publishRunWorkspaceRef } from "../../../handover/workspaceRefPublish.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { productionMonitorDeps } from "../monitor/deps.js";
import { printedRefusal } from "./appendUnlessRefused.js";
import { readStdinText } from "./askActionFlag.js";
import { admittedExamples, exampleFields } from "./askExampleFlags.js";
import { askFreshCheck } from "./askFreshCheck.js";
import { laterOwnerWordsExit, readOwnerWordsOf } from "./askLaterOwnerWords.js";
import { askOfferVerdict } from "./askOffer.js";
import { runAskReshape, unshapedHeldQuestion } from "./askReshape.js";
import { recordText } from "./lifecycleRecordText.js";
import {
  lifecycleUsage,
  nowIso,
  phaseRefusalFor,
  type Resolved,
  resolve,
  stringFlag,
  VERB_ARG_OFFSET,
} from "./lifecycleRunCore.js";
import {
  actionTexts,
  cardSignInExit,
  docTexts,
  exampleTexts,
  namedDraftExit,
  shapeTexts,
  undrawnAskDraftExit,
} from "./namedDraftAdmission.js";
import { fireSteerAtRiskIfSteered } from "./steerRiskCard.js";

/** Where an admission gate's refusal lines go: stderr, one line each. */
const refusalLine: (line: string) => void = (line) => {
  logger.error({ msg: line });
};

/**
 * `handover ask` — record the question that only the owner can settle, and mark the run as waiting on the owner.
 *
 * The journal is the whole act. The console's Queue page draws a waiting run from it as a card, and the board
 * reads the same journals; no sidebar lane moves. **Nothing is posted to Slack**: a row blocked on the owner
 * is read on the localhost Queue page, and the owner's private DM is kept for what earns it
 * (`../../../outbound/slack/dmPurpose.ts`).
 *
 * **The residue, stated**: the Queue draws a card only for a row `src/handover/ownerWait.ts` calls the owner's, so a
 * paused, terminal or since-ruled run is at most counted there, and one whose document was archived, renamed or
 * removed shows nowhere, because the board lists documents. The sweep that read journals and DMed those is
 * deleted with the DM, and nothing replaces it yet.
 *
 * Every refusal in {@link askAdmits} runs BEFORE `recordText` touches the journal, so its advice ("ask again,
 * with …") is still followable: a run already paused on the owner refuses a second `ask`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverAsk(argv: readonly string[]): Promise<number> {
  const resolved = resolve({ argv, verb: "ask" });
  if (typeof resolved === "number") {
    return resolved;
  }
  // Ahead of BOTH write paths below: a settled ask row is on no surface, so a question journalled on its run would be
  // paused against a row nothing shows (`../../../handover/settledAsk.ts`).
  const settled = askOnSettledRowRefusal({ doc: resolved.context.doc });
  if (settled !== undefined) {
    return printedRefusal({ lines: settled, verb: "ask" });
  }
  const question = stringFlag({ name: "question", parsed: resolved.parsed });
  if (question === undefined || question.trim().length === 0) {
    logger.error({ msg: "handover ask: --question is required" });
    logger.error({ msg: lifecycleUsage({ verb: "ask" }) });
    return EXIT_USAGE;
  }
  // Words the owner said on another row after this row's own may already answer the question
  // (`../../../handover/laterOwnerWords.ts`) — listed, and refused until the seat names each as read, ahead of both
  // write paths and re-judged at the append.
  const readOwnerWords = readOwnerWordsOf({ parsed: resolved.parsed });
  const later = laterOwnerWordsExit({ read: readOwnerWords, resolved });
  if (later !== undefined) {
    return later;
  }
  // The same words as a question the owner already ruled on are a check-in, never a fresh ask (`ruledReaskGate.ts`) —
  // judged ahead of BOTH write paths, since a reshape of a held question they ruled on re-presents it too (Codex
  // r3-restore-02).
  const reask = ruledReaskVerdict({
    askedIso: nowIso(),
    command: "slopweaver handover ask",
    env: process.env,
    events: resolved.context.events,
    question: question.trim(),
  });
  if (reask.kind === "refused") {
    for (const line of reask.lines) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  // Judged before EITHER path writes, so a refused scene leaves the journal exactly as it was.
  const examples = askExamples({ argv, parsed: resolved.parsed });
  if (typeof examples === "number") {
    return examples;
  }
  // A run waiting on a question recorded before the shape was required may be asked again WITH one — the one
  // second ask that replaces rather than competes, keeping the instant it was first asked (`./askReshape.ts`).
  const replaces = unshapedHeldQuestion({ context: resolved.context });
  if (replaces !== undefined) {
    return runAskReshape({ examples, question: question.trim(), readOwnerWords, replaces, resolved });
  }
  const admitted = await askAdmits({ examples, question, resolved });
  if (typeof admitted === "number") {
    return admitted;
  }
  return recordQuestion({ admitted, argv, examples, question, readOwnerWords, resolved });
}

/**
 * The write half of `handover ask`, reached only once every check above has passed: append the admitted question,
 * pausing the run, then republish the workspace reference.
 */
async function recordQuestion({
  admitted,
  argv,
  examples,
  question,
  readOwnerWords,
  resolved,
}: {
  admitted: { readonly shape: RecordableShape | undefined; readonly action: AskAction | undefined };
  argv: readonly string[];
  examples: AskExampleSet;
  question: string;
  readOwnerWords: readonly string[];
  resolved: Resolved;
}): Promise<number> {
  const { shape, action } = admitted;
  const recorded = await recordText({
    // A question to the owner on a row they explicitly steered is their deliverable waiting on them: the note lands with it.
    afterRecord: ({ home, slug }) =>
      fireSteerAtRiskIfSteered({ deps: productionMonitorDeps(), home, slug, verb: "handover ask" }),
    argv,
    build: ({ value }) => questionEvent({ action, examples, question: value, shape }),
    flag: "question",
    // Asked AGAIN of `recordText`'s own fresh read, just before the append: a settle landing between the check at the
    // top of this verb and the write would otherwise journal the question it refuses. Whether that read
    // holds the lock is decided off the fresh row too, never the resolved one. The owner's rulings are
    // re-read there too, so one given while a sign-in was awaited still refuses the same words (`./askFreshCheck.ts`).
    fresh: askFreshCheck({
      env: process.env,
      handoverDir: resolved.handoverDir,
      question: question.trim(),
      readOwnerWords,
      runsDir: resolved.runsDir,
      slug: resolved.context.doc.slug,
    }),
    said: "recorded the question and paused the run",
    verb: "ask",
  });
  if (recorded !== EXIT_OK) {
    return recorded;
  }
  publishRunWorkspaceRef({ cli: realCmuxCli(), verb: "handover ask" });
  return EXIT_OK;
}

/** The `question` line `handover ask` appends, carrying its draft, shape and scenes on the one line. */
function questionEvent({
  action,
  examples,
  question,
  shape,
}: {
  action: AskAction | undefined;
  examples: AskExampleSet;
  question: string;
  shape: RecordableShape | undefined;
}): RunEvent {
  return {
    atIso: nowIso(),
    kind: "question",
    question,
    // The ACTION spreads the same way and for the same reason: a card reads its absence to say the ask
    // offers no draft, rather than drawing an empty preview.
    ...(action === undefined ? {} : { action }),
    // Spread rather than assigned `undefined`: `exactOptionalPropertyTypes` distinguishes an absent field
    // from one holding `undefined`, and it is the ABSENCE a card reads to draw its "needs rewriting" mark.
    // The stakes ride with it: the verb requires them, and a card reads them off this line and nowhere else.
    ...(shape === undefined
      ? {}
      : { lean: shape.lean, options: shape.options, problem: shape.problem, stakes: shape.stakes }),
    // The scene rides the SAME line, so an ask can never land without it.
    ...exampleFields({ set: examples }),
  };
}

/**
 * The scenes `handover ask` records on its asking line, or the usage exit after printing every reason they were
 * refused.
 */
function askExamples({ argv, parsed }: { argv: readonly string[]; parsed: ParsedFlags }): AskExampleSet | number {
  const examples = admittedExamples({
    command: "handover ask",
    env: process.env,
    gap: stringFlag({ name: "example-gap", parsed }),
    rest: argv.slice(VERB_ARG_OFFSET),
  });
  if (examples.kind === "refused") {
    examples.lines.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_USAGE;
  }
  return examples.set;
}

/**
 * Every check `handover ask` makes BEFORE the journal is touched, in the one order that keeps its advice
 * followable.
 *
 * Every refusal here ends on "nothing was recorded", and that sentence is only true while this runs ahead of
 * `recordText`. Held together here so the order is one readable block rather than guards interleaved with the
 * recording.
 *
 * @param question the `--question` value, already known to be non-empty
 * @param examples the admitted scenes the card leads with, or its gap
 * @returns the shape and action to record, or the exit code to return instead
 */
async function askAdmits({
  examples,
  question,
  resolved,
}: {
  examples: AskExampleSet;
  question: string;
  resolved: Resolved;
}): Promise<
  | number
  | {
      readonly shape: RecordableShape | undefined;
      readonly action: AskAction | undefined;
    }
> {
  const refusal = phaseRefusalFor({ resolved, verb: "ask" });
  if (refusal !== undefined) {
    logger.error({ msg: `handover ask: ${refusal}` });
    return EXIT_ERROR;
  }
  const verdict = askOfferVerdict({
    command: "slopweaver handover ask",
    parsed: resolved.parsed,
    required: true,
    stdin: readStdinText,
  });
  if (verdict.kind === "refused") {
    for (const line of verdict.lines) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  const aligned = cardAlignmentVerdict({ command: "slopweaver handover ask", env: process.env, question });
  if (aligned.kind === "refused") {
    for (const line of aligned.lines) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  const card = await cardTextsExit({ action: verdict.action, examples, question, resolved, shape: verdict.shape });
  if (card !== undefined) {
    return card;
  }
  return { action: verdict.action, shape: verdict.shape };
}

/**
 * The gates on what the card will SAY — a draft it names, then a sign-in it asks the owner for — in `askAdmits`' order.
 *
 * @param action the admitted draft, whose every message and destination the card draws
 * @returns `undefined` to proceed, or the exit code of the refusal printed instead
 */
async function cardTextsExit({
  action,
  examples,
  question,
  resolved,
  shape,
}: {
  action: AskAction | undefined;
  examples: AskExampleSet;
  question: string;
  resolved: Resolved;
  shape: RecordableShape | undefined;
}): Promise<number | undefined> {
  const drafts = namedDraftExit({
    command: "slopweaver handover ask",
    env: process.env,
    home: resolved.home,
    texts: [...docTexts({ doc: resolved.context.doc }), question, ...shapeTexts({ shape }), ...actionTexts({ action })],
    write: refusalLine,
  });
  if (drafts !== undefined) {
    return drafts;
  }
  const card = [question, ...shapeTexts({ shape })];
  const undrawn = undrawnAskDraftExit({
    command: "slopweaver handover ask",
    env: process.env,
    named: docTexts({ doc: resolved.context.doc }),
    offersMessage: action !== undefined,
    texts: card,
    write: refusalLine,
  });
  if (undrawn !== undefined) {
    return undrawn;
  }
  return cardSignInExit({
    command: "slopweaver handover ask",
    fleetTexts: [...card, ...exampleTexts({ examples })],
    home: resolved.home,
    planTexts: card,
  });
}

/**
 * `handover answer` — record the owner's answer, so the run may proceed.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverAnswer(argv: readonly string[]): Promise<number> {
  return recordText({
    argv,
    build: ({ value }) => ({ answer: value, atIso: nowIso(), kind: "answered" }),
    flag: "answer",
    said: "recorded the answer — the run is open again",
    verb: "answer",
  });
}
