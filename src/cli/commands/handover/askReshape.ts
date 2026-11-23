/**
 * `handover ask` on a run already waiting on a question recorded WITHOUT a shape — give that question one.
 *
 * ## The gap this closes
 *
 * Problem, options and lean are mandatory on every ask, so a question recorded as free-text still waits unshaped.
 * No other verb can shape one afterwards: `ask` refuses any waiting run, `correct` takes only the text, and `offer`
 * needs a Slack draft. A question left unshaped gives a card that can only say so.
 *
 * ## Why it replaces rather than re-asks
 *
 * The question has waited on the owner since it was first asked, and a card ages it from that instant. Answering it
 * to ask again would fabricate a ruling the owner never gave; a fresh `question` would reset the clock. So this records
 * `question-shaped`, which replaces the text and the shape together and keeps the asked instant — and applies only
 * to a question carrying NO shape and NO draft (`../../../handover/openQuestion.ts`, `reshapeBinds`). A shaped ask
 * is never replaced: `handover correct` restates its wording, `handover offer` replaces its shape with a draft.
 */

import { realCmuxCli } from "../../../cmux/sidebar.js";
import type { AskExampleSet } from "../../../handover/askExamples.js";
import type { RecordableShape } from "../../../handover/askShapeGate.js";
import { cardAlignmentVerdict } from "../../../handover/cardAlignment.js";
import { heldQuestion } from "../../../handover/heldQuestion.js";
import { reshapeBinds } from "../../../handover/openQuestion.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { publishRunWorkspaceRef } from "../../../handover/workspaceRefPublish.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { journalUnlessRefused } from "./appendUnlessRefused.js";
import { readStdinText } from "./askActionFlag.js";
import { exampleFields } from "./askExampleFlags.js";
import { askFreshCheck } from "./askFreshCheck.js";
import { askOfferVerdict } from "./askOffer.js";
import { mutationRefusal, nowIso, type Resolved } from "./lifecycleRunCore.js";
import {
  cardSignInExit,
  docTexts,
  exampleTexts,
  namedDraftExit,
  shapeTexts,
  undrawnAskDraftExit,
  waitingCard,
} from "./namedDraftAdmission.js";
import type { RunContext } from "./runContextTypes.js";

/** The verb as every refusal here spells it. */
const COMMAND = "slopweaver handover ask";

/**
 * The unshaped question a waiting run holds, which a shaped ask may replace — `undefined` when there is none.
 *
 * Fails CLOSED on an undecodable journal line: a line nothing here can read might be the very shape or draft that
 * makes the held question not this path's to replace, so such a run takes the ordinary refusal instead.
 *
 * @param context the run's derived phase, decoded journal and undecodable line numbers
 * @returns the held question's text, or `undefined` when the run is not waiting on an unshaped one
 */
export function unshapedHeldQuestion({
  context,
}: {
  context: Pick<RunContext, "events" | "run" | "unreadable">;
}): string | undefined {
  const { run, events, unreadable } = context;
  if (run.phase !== "waiting-on-owner" || unreadable.length > 0) {
    return undefined;
  }
  const held = heldQuestion({ events });
  if (held === undefined || !reshapeBinds({ event: { replaces: held.question }, held })) {
    return undefined;
  }
  return held.question;
}

/**
 * Record a shape, and the question's new text, over the unshaped question a waiting run holds.
 *
 * Every refusal runs before the journal moves, in `handover ask`'s own order, so each one's "nothing was recorded"
 * is true.
 *
 * @param resolved the resolved run context
 * @param question the `--question` value, already known to be non-empty
 * @param replaces the held question's text, as {@link unshapedHeldQuestion} returned it
 * @param examples the admitted scenes or gap, written on the reshape's own line
 * @param readOwnerWords the slugs the seat named in `--read-owner-words`, re-judged at the append
 * @returns the process exit code
 */
export async function runAskReshape({
  resolved,
  question,
  readOwnerWords,
  replaces,
  examples,
}: {
  resolved: Resolved;
  question: string;
  readOwnerWords: readonly string[];
  replaces: string;
  examples: AskExampleSet;
}): Promise<number> {
  const ownership = mutationRefusal({ resolved, verb: "ask" });
  if (ownership !== undefined) {
    return ownership;
  }
  const shape = admittedShape({ question, resolved });
  if (typeof shape === "number") {
    return shape;
  }
  const card = [question, ...shapeTexts({ shape })];
  const signIn = await cardSignInExit({
    command: COMMAND,
    fleetTexts: [...card, ...exampleTexts({ examples })],
    home: resolved.home,
    planTexts: card,
  });
  if (signIn !== undefined) {
    return signIn;
  }
  const slug = resolved.context.doc.slug;
  // Re-judged under the row lock settle writes under, as the ordinary ask is: a reshape keeps the pre-settlement asked
  // instant, so one landing after a settle would be ordered before it and named on no surface.
  const event = reshapeEvent({ question, replaces, shape });
  const appended = journalUnlessRefused({
    append: () =>
      applyRowEvent({ event: { ...event, ...exampleFields({ set: examples }) }, runsDir: resolved.runsDir, slug }),
    doc: resolved.context.doc,
    // The owner's rulings re-read at the append too: one given during the sign-in await still refuses (Codex
    // r3-restore-02).
    fresh: askFreshCheck({
      env: process.env,
      handoverDir: resolved.handoverDir,
      question,
      readOwnerWords,
      runsDir: resolved.runsDir,
      slug,
    }),
    verb: "ask",
  });
  if (typeof appended === "number") {
    return appended;
  }
  reportReshaped({ journal: appended.path, slug });
  return EXIT_OK;
}

/** What a recorded reshape prints, and the workspace reference it republishes once the journal has moved. */
function reportReshaped({ journal, slug }: { journal: string; slug: string }): void {
  logger.out({
    line: `handover ask: shaped the question ${slug} was already waiting on — asked when it first was, not now`,
  });
  logger.out({ line: `  journal: ${journal}` });
  publishRunWorkspaceRef({ cli: realCmuxCli(), verb: "handover ask" });
}

/** The `question-shaped` line a reshape appends, stamped now: the held question's text it replaces, and the shape. */
function reshapeEvent({ question, replaces, shape }: { question: string; replaces: string; shape: RecordableShape }): {
  readonly atIso: string;
  readonly kind: "question-shaped";
  readonly lean: RecordableShape["lean"];
  readonly options: RecordableShape["options"];
  readonly problem: RecordableShape["problem"];
  readonly question: string;
  readonly replaces: string;
  readonly stakes: RecordableShape["stakes"];
} {
  const { lean, options, problem, stakes } = shape;
  return { atIso: nowIso(), kind: "question-shaped", lean, options, problem, question, replaces, stakes };
}

/** The shape a reshape records, or the exit code of the refusal printed instead — all before the journal moves. */
function admittedShape({ question, resolved }: { question: string; resolved: Resolved }): number | RecordableShape {
  const verdict = askOfferVerdict({ command: COMMAND, parsed: resolved.parsed, required: true, stdin: readStdinText });
  if (verdict.kind === "refused") {
    for (const line of verdict.lines) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  if (verdict.action !== undefined) {
    logger.error({
      msg:
        `${COMMAND} blocked because this run is already waiting on a question, and a draft attached to a waiting ` +
        "question is `handover offer`'s to record — shape it here without --action, then offer the draft. Nothing was recorded.",
    });
    return EXIT_USAGE;
  }
  const shape = verdict.shape;
  if (shape === undefined) {
    logger.error({
      msg:
        `${COMMAND} blocked because this run is already waiting on an unshaped question, and giving it a shape is the ` +
        "only thing asking again may do — pass --problem, --options, --lean, --risk, --blast-radius and --still-real. Nothing was recorded.",
    });
    return EXIT_USAGE;
  }
  const aligned = cardAlignmentVerdict({ command: COMMAND, env: process.env, question });
  if (aligned.kind === "refused") {
    for (const line of aligned.lines) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  const drafts = namedDraftExit({
    command: COMMAND,
    env: process.env,
    home: resolved.home,
    texts: [...docTexts({ doc: resolved.context.doc }), question, ...shapeTexts({ shape })],
    write: (line) => {
      logger.error({ msg: line });
    },
  });
  if (drafts !== undefined) {
    return drafts;
  }
  const undrawn = undrawnAskDraftExit({
    command: COMMAND,
    env: process.env,
    named: docTexts({ doc: resolved.context.doc }),
    offersMessage: waitingCard({ context: resolved.context }).offersMessage,
    texts: [question, ...shapeTexts({ shape })],
    write: (line) => {
      logger.error({ msg: line });
    },
  });
  if (undrawn !== undefined) {
    return undrawn;
  }
  return shape;
}
