/**
 * `slopweaver turn answer` — post the answer the VISIBLE SESSION composed, into a real Slack thread.
 *
 * ## There is no model in this verb, and that is the whole change
 *
 * It used to build `liveTurnQuery({ client: claudeCliClient() })`, which spawned a DETACHED `claude -p`
 * child to write the answer. The listener did the same. So the agent surface the owner praised was produced
 * by exactly the mechanism the supervisor loop exists to abolish — an executor running outside any session
 * the owner could see, interrupt, or account for.
 *
 * The work now happens in the visible turn. `slopweaver turn brief` hands the session a question to judge;
 * `slopweaver turn dispatch` executes the tier its decision named; this verb grounds what the session wrote
 * and posts it.
 *
 * ## Two ways in, one validation before either posts
 *
 * `inline`/`read-only-subagent` turns stay in the SAME calling session, so `--brief`/`--answer`/`--decision`
 * name three files this process reads directly. A `fresh-visible-session` turn is a SEPARATE process in a
 * separate workspace — `--dispatch <id>` re-reads that workspace's LIVE screen for its ready marker rather
 * than trusting any file path a caller could type without the work having actually finished. Either way,
 * `validateAnswerForDispatch` (`../../../live/turn/briefAnswerable.js`) checks the answer's grounding against the
 * decision that dispatched it before anything reaches Slack — a session can claim a grounding it did not
 * earn as easily as it could once invent a citation.
 *
 * ## The ordering is untouched
 *
 * `runTurn` still posts a working message first, advances a checklist in place, and posts the reply before
 * ticking the final step. What changed is that the middle takes a second instead of half a minute, because
 * the thinking already happened upstairs.
 *
 * ## Where the rest of this verb lives
 *
 * Resolving the DIRECT/DISPATCH invocation modes into validated inputs, and `--print-digest`, is
 * {@link ./loadInputs.js}. Every gate before posting, and the post itself, is {@link ./postAnswer.js}. This
 * file is left with argv parsing and the verb's own entry point.
 */
import { logger } from "../../../lib/logger.js";
import { askIdentityOf } from "../../../live/ask/identity.js";
import { validateAnswerForDispatch } from "../../../live/turn/briefAnswerable.js";
import { readReachReceipts } from "../../../live/turn/progressLog.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { str } from "./core.js";
import { TurnCommandErrors, turnCommandErrorLines } from "./errors.js";
import { loadDirectInputs, loadDispatchInputs, parseTurnArgs, printAnswerDigest, refuse } from "./loadInputs.js";
import { postAnswer } from "./postAnswer.js";
import { uncheckedEvidenceOrigins } from "./reachCore.js";
import { TURN_USAGE } from "./usage.js";

export { closeAnsweredDispatchWorkspace } from "./answerCleanup.js";
export { TURN_FLAG_NAMES, TURN_FLAG_SPEC, TURN_MODEL_LABEL, turnModelLabel, turnSessionUrl } from "./core.js";
export { mentionFromBrief, parseTurnArgs, readyAnswerPathFromLiveScreen } from "./loadInputs.js";
export { threadDeltaAtSend } from "./sendPreflight.js";
export { TURN_USAGE } from "./usage.js";

/**
 * Where this verb's own arguments start in `process.argv`: `[node, cli, turn, answer, …]`, so FOUR.
 *
 * Not a detail, and not a guess — this exact index was wrong in the first cut of this file, at 3, and the
 * whole unit suite passed because a test constructs the tail it expects. It was caught by invoking the real
 * binary, which is what every other noun+verb module in this repo says in its own comment after making the
 * same mistake.
 */
const VERB_ARG_OFFSET = 4;

/**
 * Run the turn verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnAnswer(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, errors: parsed.error, usage: true });
  }
  const values = parsed.value.values;
  if (values["print-digest"] === true) {
    return printAnswerDigest({ values });
  }
  const home = resolveHome({ named: str({ key: "home", values }) });
  const dispatchId = str({ key: "dispatch", values });
  const loaded =
    dispatchId === undefined ? loadDirectInputs({ home, values }) : await loadDispatchInputs({ dispatchId, home });
  if (loaded.isErr()) {
    // A MISSING flag is a usage error and prints the usage; an unreadable/malformed input, or a live screen
    // that has not confirmed readiness, is not — the caller typed the command correctly and the state is
    // the problem, so repeating the usage would bury the one line that says what is actually wrong.
    const missingFlag = loaded.error.code === "INPUTS_MISSING";
    return refuse({
      code: missingFlag ? EXIT_USAGE : EXIT_ERROR,
      errors: turnCommandErrorLines({ error: loaded.error }),
      usage: missingFlag,
    });
  }
  // Before anything else judges the answer: browser evidence from a page no `turn reach` found signed in is a gap the owner's
  // sign-in closes, so it blocks the turn on the owner rather than reaching the thread.
  const unchecked = uncheckedEvidenceOrigins({
    answer: loaded.value.answer,
    reaches: readReachReceipts({ askIdentity: askIdentityOf({ source: loaded.value.brief }), home }),
  });
  if (unchecked.length > 0) {
    return refuse({
      code: EXIT_ERROR,
      errors: turnCommandErrorLines({ error: TurnCommandErrors.reachabilityUnchecked({ origins: unchecked }) }),
      usage: false,
    });
  }
  const validated = validateAnswerForDispatch({
    answer: loaded.value.answer,
    brief: loaded.value.brief,
    decision: loaded.value.decision,
  });
  if (validated.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: [validated.error.message], usage: false });
  }
  return postAnswer({ ...loaded.value, home, values });
}

export const turnAnswerCommand = defineCommand({ run: runTurnAnswer });
