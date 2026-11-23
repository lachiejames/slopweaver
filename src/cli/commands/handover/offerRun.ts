/**
 * `handover offer` — attach a concrete Slack ACTION to the question a run is already holding.
 *
 * ## Why a second verb rather than a flag on `handover ask`
 *
 * `handover ask --action` covers the ask that is offered from the start. This covers the other direction,
 * which is the common one: 40-odd rows were already waiting on the owner when the action existed, and each is a decision the owner
 * still has to take. The alternatives are both wrong. Answering the question to
 * re-ask it fabricates a ruling the owner never gave. Correcting it (`handover correct`) restates the TEXT and
 * deliberately keeps everything else, so it cannot carry a draft — and it must not learn to, because a
 * correction that reset a card would reset the asked-at instant every surface reads to say how long the owner has
 * had it (`../../../handover/openQuestion.ts`).
 *
 * So an offer is its own event, bound to the question it names, replacing the action and the shape TOGETHER
 * and touching neither the question's text nor its clock.
 *
 * ## It posts nothing
 *
 * Nothing about a recorded question is ever sent to the owner — they read a run blocked on them on the console's
 * Queue page. The console reads the journal, so the card changes where the owner is already
 * looking.
 */

import { type AskAction, actionMessages, MAIL_ACTION_VERSION } from "../../../handover/askAction.js";
import { actionOptions } from "../../../handover/askActionOptions.js";
import type { RecordableShape } from "../../../handover/askShapeGate.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { readStdinText } from "./askActionFlag.js";
import { askOfferVerdict } from "./askOffer.js";
import {
  lifecycleUsage,
  mutationRefusal,
  nowIso,
  phaseRefusalFor,
  type Resolved,
  resolve,
} from "./lifecycleRunCore.js";
import { actionTexts, docTexts, fleetSignInExit, namedDraftExit, shapeTexts } from "./namedDraftAdmission.js";

/** The verb as every refusal here spells it. */
const COMMAND = "slopweaver handover offer";

/**
 * `handover offer` — record the draft, the people and the destinations an open ask is really offering.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runHandoverOffer(argv: readonly string[]): number {
  const admitted = offerAdmits({ argv });
  if (typeof admitted === "number") {
    return admitted;
  }
  const { action, question, resolved, shape } = admitted;
  const appended = applyRowEvent({
    event: {
      action,
      atIso: nowIso(),
      kind: "question-offered",
      lean: shape.lean,
      options: actionOptions({ action }),
      problem: shape.problem,
      question,
      stakes: shape.stakes,
    },
    runsDir: resolved.runsDir,
    slug: resolved.context.doc.slug,
  });
  if (appended.isErr()) {
    logger.error({ msg: `handover offer: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `handover offer: recorded ${offeredWhat({ action })} for ${resolved.context.doc.slug}` });
  logger.out({ line: `  journal: ${appended.value.path}` });
  return EXIT_OK;
}

/**
 * Every check that runs BEFORE the journal moves, and the four values an append then needs.
 *
 * All of them sit here rather than beside the append for `../../../handover/askShapeGate.ts`'s reason: a
 * refusal printed after the journal moved is advice the caller cannot take.
 *
 * @returns what to append, or the exit code to return instead
 */
function offerAdmits({ argv }: { argv: readonly string[] }):
  | number
  | {
      readonly resolved: Resolved;
      readonly question: string;
      readonly action: AskAction;
      readonly shape: RecordableShape;
    } {
  const resolved = resolve({ argv, verb: "offer" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const ownership = mutationRefusal({ resolved, verb: "offer" });
  if (ownership !== undefined) {
    return ownership;
  }
  const refusal = phaseRefusalFor({ resolved, verb: "offer" });
  if (refusal !== undefined) {
    logger.error({ msg: `handover offer: ${refusal}` });
    return EXIT_ERROR;
  }
  const question = resolved.context.run.openQuestion;
  if (question === undefined) {
    logger.error({
      msg:
        "handover offer: the run reads as waiting on the owner but carries no question text, which is a " +
        "defect rather than a state — NOTHING was recorded",
    });
    return EXIT_ERROR;
  }
  const card = offeredCard({ question, resolved });
  if (typeof card === "number") {
    return card;
  }
  return { ...card, question, resolved };
}

/**
 * The flags' half of {@link offerAdmits}: the action and shape an offer records, each refused with its reason, and
 * the parked drafts the shape and the re-recorded question name checked against the register — all before the
 * journal moves.
 *
 * @param question the open question, which the offer's own event records again
 * @returns the action and shape to record, or the exit code to return instead
 */
function offeredCard({
  question,
  resolved,
}: {
  question: string;
  resolved: Resolved;
}): number | { readonly action: AskAction; readonly shape: RecordableShape } {
  const verdict = askOfferVerdict({ command: COMMAND, parsed: resolved.parsed, required: true, stdin: readStdinText });
  if (verdict.kind === "refused") {
    for (const line of verdict.lines) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  const action = verdict.action;
  if (action === undefined) {
    logger.error({ msg: `${COMMAND} blocked because --action is what this verb records, and none was given.` });
    logger.error({ msg: lifecycleUsage({ verb: "offer" }) });
    return EXIT_USAGE;
  }
  const shape = verdict.shape;
  if (shape === undefined) {
    logger.error({
      msg:
        `${COMMAND} blocked because an offer replaces the whole card — it wants --problem, --lean, --risk, ` +
        "--blast-radius and --still-real beside --action, since the options it derives describe the " +
        "destinations in that same draft.",
    });
    return EXIT_USAGE;
  }
  // Every text the card draws is checked: the slug and summary, the question the offer re-records on its own event (a stale id
  // there is `correct`'s to fix first), the shape, and the action body `SlackActionPreview` renders.
  const drafts = namedDraftExit({
    command: COMMAND,
    env: process.env,
    home: resolved.home,
    texts: [...docTexts({ doc: resolved.context.doc }), question, ...shapeTexts({ shape }), ...actionTexts({ action })],
    write: (line) => {
      logger.error({ msg: line });
    },
  });
  if (drafts !== undefined) {
    return drafts;
  }
  // An offer rewrites the card's problem, lean and stakes, so a sign-in ask there meets the ask's gate.
  const fleetSignIn = fleetSignInExit({
    command: COMMAND,
    env: process.env,
    home: resolved.home,
    nowIso: nowIso(),
    texts: [question, ...shapeTexts({ shape })],
    write: (line) => {
      logger.error({ msg: line });
    },
  });
  if (fleetSignIn !== undefined) {
    return fleetSignIn;
  }
  return { action, shape };
}

/** What an offer recorded, in the words its one report line uses. */
function offeredWhat({ action }: { action: AskAction }): string {
  if (action.version === MAIL_ACTION_VERSION) {
    return `a mail draft to ${action.form.to.join(", ")}`;
  }
  const messages = actionMessages({ action }).length;
  if (messages > 1) {
    return `a ${String(action.destinations.length)}-destination draft of ${String(messages)} messages`;
  }
  return `a ${String(action.destinations.length)}-destination draft`;
}
