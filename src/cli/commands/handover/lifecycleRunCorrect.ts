/**
 * `handover correct` — restate an open question truly, without re-asking it.
 *
 * ## The gap this closes
 *
 * A recorded question can go stale while it waits: measured on `the-vanta-walk-is-the-only-atlas-browser`,
 * whose card quoted one run's 10-of-12 as the outcome when four runs gave 9/8/9/10 of 12 — a figure the owner might
 * have ruled on. `handover ask` refuses a second question while one is open (an answer must bind to ONE
 * question), so without this verb a pinned number could never be taken back.
 *
 * It journals a `question-corrected` event, which `../../../handover/openQuestion.ts` and the ledger fold into
 * the open question — so the Queue card, the board and `resume` all read the corrected text from then on. It
 * posts nothing: a blocked row belongs on the Queue page, never in the owner's DM.
 *
 * ## The still-real line moves with the text
 *
 * A correction keeps the shape, so the still-real check the card prints under the question survives it word for
 * word. MEASURED on a monitors-in-IaC row: the question was
 * corrected to name draft sd-695c4598 and the card went on saying draft sd-7bb49482 was held. So when the card
 * prints a check, `--still-real` is REQUIRED, and it is journalled as a `question-reconfirmed` bound to the
 * corrected text — a kind every reader on the shared home already folds, so no checkout prints the old line.
 *
 * ## A registered ask with no run is corrected in its own file
 *
 * A row `handover register` wrote has no journal to fold a correction from, so its `summary:`, the body's copies
 * of the question and its still-real check are rewritten in place, under every content gate above
 * (`../../../handover/registeredAskChange.ts`).
 */

import { runDisposition } from "../../../handover/boardTypes.js";
import { cardAlignmentVerdict } from "../../../handover/cardAlignment.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { logger } from "../../../lib/logger.js";
import { shellCommandLine } from "../../../lib/shellCommandLine.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  lifecycleUsage,
  mutationRefusal,
  nowIso,
  phaseRefusalFor,
  type Resolved,
  resolve,
  routingFlagSuffix,
  stringFlag,
} from "./lifecycleRunCore.js";
import { publishedStillRealOf, shapeFrom } from "./listJsonAsk.js";
import {
  docTexts,
  fleetSignInExit,
  namedDraftExit,
  planSignInExit,
  shapeTexts,
  undrawnAskDraftExit,
  waitingCard,
} from "./namedDraftAdmission.js";
import { stillRealLine, stillRealProseExit } from "./reconfirmRun.js";
import { applyRegisteredAskChange, registeredAskOfResolved } from "./registeredAskWrite.js";

/**
 * `handover correct` — replace the open question's text on the journal, and its still-real check with it.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverCorrect(argv: readonly string[]): Promise<number> {
  const resolved = resolve({ argv, verb: "correct" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const question = stringFlag({ name: "question", parsed: resolved.parsed })?.trim();
  const why = stringFlag({ name: "why", parsed: resolved.parsed })?.trim();
  if (question === undefined || question.length === 0 || why === undefined || why.length === 0) {
    logger.error({ msg: "handover correct: --question (the corrected text) and --why (what was wrong) are required" });
    logger.error({ msg: lifecycleUsage({ verb: "correct" }) });
    return EXIT_USAGE;
  }
  const rawStillReal = stringFlag({ name: "still-real", parsed: resolved.parsed });
  const stillReal = stillRealLine({ value: rawStillReal });
  if (rawStillReal !== undefined && stillReal === undefined) {
    logger.error({ msg: "handover correct: --still-real must be one non-empty line — NOTHING was recorded" });
    return EXIT_USAGE;
  }
  if (registeredAskOfResolved({ resolved, rewritesStillReal: stillReal !== undefined }) !== undefined) {
    return correctRegistered({ question, resolved, stillReal, why });
  }
  const runRefused = runRefusal({ resolved });
  if (runRefused !== undefined) {
    return runRefused;
  }
  const contentRefused = await contentRefusal({ question, resolved, stillReal });
  if (contentRefused !== undefined) {
    return contentRefused;
  }
  const slug = resolved.context.doc.slug;
  // One instant for both lines: they are one act, and the reconfirm's is the card's new checked instant.
  const atIso = nowIso();
  const appended = applyRowEvent({
    event: { atIso, kind: "question-corrected", question, why },
    runsDir: resolved.runsDir,
    slug,
  });
  if (appended.isErr()) {
    logger.error({ msg: `handover correct: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `handover correct: recorded the corrected question for ${slug}` });
  logger.out({ line: `  journal: ${appended.value.path}` });
  if (stillReal === undefined) {
    return EXIT_OK;
  }
  return recordStillReal({ atIso, question, resolved, stillReal });
}

/**
 * Journal the restated check as a reconfirm of the corrected text, AFTER the correction so it binds to that text.
 *
 * Two appends, so the second can fail alone. The message says the correction IS recorded and the check is NOT
 * CONFIRMED — never "absent", since `applyRowEvent` can fail its read-back after the line landed — and prints the
 * one command that finishes the job, routed to the same board; re-running it is safe, the latest reconfirm wins.
 */
function recordStillReal({
  resolved,
  atIso,
  question,
  stillReal,
}: {
  resolved: Resolved;
  atIso: string;
  question: string;
  stillReal: string;
}): number {
  const slug = resolved.context.doc.slug;
  const reconfirmed = applyRowEvent({
    event: { atIso, kind: "question-reconfirmed", question, stillReal },
    runsDir: resolved.runsDir,
    slug,
  });
  if (reconfirmed.isErr()) {
    const repair = shellCommandLine({ command: ["slopweaver", "handover", "reconfirm", slug] });
    const routed = routingFlagSuffix({ parsed: resolved.parsed });
    const value = shellCommandLine({ command: ["--still-real", stillReal] });
    logger.error({
      msg:
        `handover correct: the corrected question IS recorded, but its still-real check is NOT confirmed ` +
        `(${reconfirmed.error.message}) — finish with: ${repair}${routed} ${value}`,
    });
    return EXIT_ERROR;
  }
  logger.out({ line: `  still real as of ${atIso}: ${stillReal}` });
  return EXIT_OK;
}

/**
 * Correct a registered ask that never opened a run: the same content gates over the restated question, collapsed
 * to the one line `handover register` writes a summary as, then its `summary:`, the body's copies of the question,
 * and the restated check, in the row's own file — where its card reads them — with `--why` as its `statusSummary:`.
 * No ownership or phase gate: no run exists, so nobody holds one and there is no phase to be in.
 */
async function correctRegistered({
  resolved,
  question,
  why,
  stillReal,
}: {
  resolved: Resolved;
  question: string;
  why: string;
  stillReal: string | undefined;
}): Promise<number> {
  const oneLine = question.replace(/\s+/gu, " ");
  const refused = await contentRefusal({ question: oneLine, resolved, stillReal });
  if (refused !== undefined) {
    return refused;
  }
  return applyRegisteredAskChange({
    change: { atIso: nowIso(), kind: "correct", question: oneLine, stillReal, why: why.replace(/\s+/gu, " ") },
    resolved,
    said: "recorded the corrected question",
    verb: "correct",
  });
}

/** The run-path refusals — a run another session holds, or no question open on it — before any content gate. */
function runRefusal({ resolved }: { resolved: Resolved }): number | undefined {
  const ownership = mutationRefusal({ resolved, verb: "correct" });
  if (ownership !== undefined) {
    return ownership;
  }
  const phase = phaseRefusalFor({ resolved, verb: "correct" });
  if (phase !== undefined) {
    logger.error({ msg: `handover correct: ${phase}` });
    return EXIT_ERROR;
  }
  return undefined;
}

/** Every content refusal that must fire while nothing is recorded yet, so its advice can still be followed. */
async function contentRefusal({
  resolved,
  question,
  stillReal,
}: {
  resolved: Resolved;
  question: string;
  stillReal: string | undefined;
}): Promise<number | undefined> {
  // A correction replaces the text the card is drawn from, so it answers to the same gate as the ask it
  // corrects — a CORRECTED question that led with a merged-PR claim is the failure.
  const aligned = cardAlignmentVerdict({ command: "slopweaver handover correct", env: process.env, question });
  if (aligned.kind === "refused") {
    for (const line of aligned.lines) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  const stillRealExit = stillRealRefusal({ question, resolved, stillReal });
  if (stillRealExit !== undefined) {
    return stillRealExit;
  }
  return draftAndSignInRefusal({ question, resolved });
}

/** The draft and sign-in gates over the corrected text, past ownership, phase and alignment. */
async function draftAndSignInRefusal({
  resolved,
  question,
}: {
  resolved: Resolved;
  question: string;
}): Promise<number | undefined> {
  // Only the NEW text is checked: an inherited option naming a draft that has since been sent is the console's to
  // draw as sent, and refusing an unrelated correction over it would strand the fix to the question.
  const drafts = namedDraftExit({
    command: "slopweaver handover correct",
    env: process.env,
    home: resolved.home,
    texts: [question],
    write: (line) => {
      logger.error({ msg: line });
    },
  });
  if (drafts !== undefined) {
    return drafts;
  }
  // A correction replaces the question and keeps the shape, which the card goes on drawing: a "drafted as you" there
  // still needs its draft, and an id it names still draws one. Unlike a held draft, the fix is always to hand. No
  // still-real line is kept: `stillRealRefusal` required a `--still-real` over one and has already checked it.
  const undrawn = undrawnAskDraftExit({
    command: "slopweaver handover correct",
    env: process.env,
    named: docTexts({ doc: resolved.context.doc }),
    offersMessage: waitingCard({ context: resolved.context }).offersMessage,
    texts: [question, ...keptShape({ resolved })],
    write: (line) => {
      logger.error({ msg: line });
    },
  });
  if (undrawn !== undefined) {
    return undrawn;
  }
  const planSignIn = await planSignInExit({
    command: "slopweaver handover correct",
    env: process.env,
    home: resolved.home,
    texts: [question],
    write: (line) => {
      logger.error({ msg: line });
    },
  });
  if (planSignIn !== undefined) {
    return planSignIn;
  }
  return fleetSignInExit({
    command: "slopweaver handover correct",
    env: process.env,
    home: resolved.home,
    nowIso: nowIso(),
    texts: [question],
    write: (line) => {
      logger.error({ msg: line });
    },
  });
}

/**
 * The shape texts the card goes on drawing after this correction: every field but the stakes' still-real line.
 * Wherever a gate reads this, that line is replaced by `--still-real` or the card prints none, because
 * `stillRealRefusal` refused every other case. `waitingCard`'s shape keeps it, which refused the very correction
 * retiring a bad one.
 */
function keptShape({ resolved }: { resolved: Resolved }): readonly string[] {
  const run = runDisposition({ events: resolved.context.events, unreadableLines: resolved.context.unreadable });
  const shape = shapeFrom({ doc: resolved.context.doc, run })?.shape;
  if (shape?.stakes === undefined) {
    return shapeTexts({ shape });
  }
  const { risk, blastRadius } = shape.stakes;
  return [...shapeTexts({ shape: { ...shape, stakes: undefined } }), risk, blastRadius];
}

/**
 * The still-real half of the pre-record refusals: required when the card prints a check, and held to the prose
 * gates `handover reconfirm` holds it to whenever it is given.
 *
 * "The card prints a check" is the row's own projection (`publishedStillRealOf`), not a narrower test of the
 * journal: a run with no journalled shape falls back to the doc's registered stakes, and that line goes stale too.
 * The refusal quotes it, because it is the fact the session must re-check — a correction is made because something
 * moved, and the check is the likeliest place it moved from.
 */
function stillRealRefusal({
  resolved,
  question,
  stillReal,
}: {
  resolved: Resolved;
  question: string;
  stillReal: string | undefined;
}): number | undefined {
  if (stillReal !== undefined) {
    // The card will draw the line beside the CORRECTED question and the shape the correction keeps.
    return stillRealProseExit({
      command: "slopweaver handover correct",
      home: resolved.home,
      kept: [question, ...keptShape({ resolved })],
      named: docTexts({ doc: resolved.context.doc }),
      offersMessage: waitingCard({ context: resolved.context }).offersMessage,
      stillReal,
    });
  }
  const run = runDisposition({ events: resolved.context.events, unreadableLines: resolved.context.unreadable });
  const printed = publishedStillRealOf({ doc: resolved.context.doc, run }).stillReal;
  if (printed === undefined) {
    return undefined;
  }
  logger.error({
    msg:
      `handover correct: --still-real is required — the card prints "${printed}" under this question and a ` +
      "correction keeps it, so restate the check you just re-ran (the same line if it still holds). NOTHING was recorded",
  });
  logger.error({ msg: lifecycleUsage({ verb: "correct" }) });
  return EXIT_USAGE;
}
