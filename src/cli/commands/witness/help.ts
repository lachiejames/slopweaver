/**
 * `slopweaver witness help` — take one `{"kind":"witness","ownThread":true}` line up unprompted, as if the bot
 * had been tagged on it: 👀, the progress card, and then the ordinary turn lane answers it.
 *
 * The loop runs this only after judging the help welcome (`skills/witness`); everything that must not rest on
 * judgement is checked here, in this order, with no Slack WRITE on any refusal: the high-stakes thread gate
 * `turn brief` would apply (a read), then under the witness lock the journal, the own-thread watch, the
 * responder whitelist, the ignore registries, an existing ask, a live ask in the thread, and the thread's
 * daily budget. Only then is `helped` journalled, and only then does the capture chain post.
 *
 * Stdout is the emitted mention a tag would have produced, plus `"unprompted":true` and the `witnessId`, so
 * the loop hands it to `turn brief` exactly as it hands a captured tag — and `turn brief` reads the journal
 * itself to carry `unprompted` into the brief, so nothing depends on the loop passing it on.
 *
 * Exit codes: 0 helped; 2 usage; 3 a policy refusal (not the bot's thread, not a responder, ignored, already
 * an ask, a live ask in the thread, budget spent, the thread stood the bot down, already settled or dispatched, high-stakes, or Slack's read
 * of the thread disagreeing with the flags); 4 the witness lock is held, so running it again unchanged is
 * right; 1 a fault (unreadable journal, snapshot or thread, no token, or a capture that dropped the message
 * after `helped` was journalled — never retried).
 */
import { logger } from "#lib/logger.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { responderHatchOpenNow } from "../../../live/listen/responderHatch.js";
import { helpWitness } from "../../../live/witness/help.js";
import { type WitnessHelpError, WitnessHelpErrors } from "../../../live/witness/helpErrors.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { liveHighStakesDeps } from "../slack/highStakesRead.js";
import { turnBriefHighStakesRefusals } from "../turn/briefHighStakes.js";
import { parseWitnessHelpArgs, VERB_ARG_OFFSET } from "./args.js";
import { productionWitnessHelpDeps } from "./deps.js";
import { WITNESS_HELP_USAGE } from "./usage.js";

/**
 * The exit code a help refusal or failure ends in.
 *
 * @param error the refusal
 * @returns 4 for a held lock, 1 for a fault, else 3 — a legitimate policy no
 */
export function witnessHelpExitCode({ error }: { error: WitnessHelpError }): number {
  switch (error.code) {
    case "HELP_LOCKED":
      return EXIT_DEFERRED;
    case "JOURNAL":
    case "STATE":
    case "THREAD_UNREADABLE":
    case "CAPTURE_DROPPED":
      return EXIT_ERROR;
    case "NOT_OWN_THREAD":
    case "NO_RESPONDER_TAG":
    case "NOT_IN_THREAD":
    case "AUTHOR_MISMATCH":
    case "ADDRESSED_TO_BOT":
    case "RESPONDER_REFUSED":
    case "IGNORED":
    case "HIGH_STAKES_REFUSED":
    case "ALREADY_AN_ASK":
    case "THREAD_ASK_ACTIVE":
    case "HELP_BUDGET_SPENT":
    case "THREAD_STOOD_DOWN":
    case "ALREADY_SETTLED":
    case "ALREADY_DISPATCHED":
      return EXIT_EXPECTED_EMPTY;
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/** Print a refusal and answer its exit code. */
function refuse({ error }: { error: WitnessHelpError }): number {
  logger.error({ msg: `witness help: ${error.code} — ${error.message}` });
  return witnessHelpExitCode({ error });
}

/**
 * Run `witness help`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runWitnessHelp(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: WITNESS_HELP_USAGE });
    return EXIT_OK;
  }
  const parsed = parseWitnessHelpArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: WITNESS_HELP_USAGE });
    return EXIT_USAGE;
  }
  const { request } = parsed.value;
  const home = resolveHome({ named: parsed.value.home });
  const token = slackBotToken({ home });
  if (token === undefined) {
    logger.error({ msg: "witness help: no Slack bot token is stored — run `slopweaver connect slack` first" });
    return EXIT_ERROR;
  }
  const highStakes = await turnBriefHighStakesRefusals({
    channel: request.key.channel,
    deps: liveHighStakesDeps(),
    env: process.env,
    home,
    threadTs: request.key.threadTs,
    token,
  });
  if (highStakes.length > 0) {
    return refuse({ error: WitnessHelpErrors.highStakesRefused({ lines: highStakes }) });
  }
  const detection = detectSupervisorSession({ env: process.env });
  const deps = productionWitnessHelpDeps({
    home,
    openOverride: responderHatchOpenNow({ home }),
    supervisor: detection.kind === "active" ? detection.session : undefined,
    token,
    transport: makeSlackWriteTransport({ home, token }),
  });
  const helped = await helpWitness({ deps, request });
  if (helped.isErr()) {
    return refuse({ error: helped.error });
  }
  const { emitted, witnessId } = helped.value;
  logger.out({ line: JSON.stringify({ ...emitted, unprompted: true, witnessId }) });
  return EXIT_OK;
}

export const witnessHelpCommand = defineCommand({ run: runWitnessHelp });
