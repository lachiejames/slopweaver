/**
 * `slopweaver witness stand-down` — somebody in a thread the bot is in told it it was in the way, or to stop:
 * put the stand-down reaction on their message, journal `stood-down`, and say NOTHING in Slack. From then on
 * the thread is witnessed no further (`../../../live/witness/standDown.ts`). With no `--message-ts` it stands
 * the whole thread down and reacts on nothing — the path when that message already ended or is gone.
 *
 * Run by the loop on a witness line, or by a turn worker whose tag turned out to be "please stop". Never a
 * reply of any kind: the owner's ruling is a reaction, never a sorry-I'll-stop message.
 *
 * Exit codes: 0 stood down, or already was; 2 usage; 3 the message already ended another way or a witness worker
 * is live on it; 4 the witness lock is held, so running it again unchanged is right; 1 a fault (no token, an
 * unreadable journal, or a reaction Slack did not take — nothing recorded, so run it again).
 */
import { logger } from "#lib/logger.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import {
  standDownThread,
  standDownWitness,
  type WitnessThreadStandDownRequest,
} from "../../../live/witness/standDown.js";
import type { WitnessStandDownError } from "../../../live/witness/standDownErrors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseWitnessStandDownArgs, VERB_ARG_OFFSET } from "./args.js";
import { productionWitnessJournalDeps, productionWitnessStandDownDeps } from "./deps.js";
import { WITNESS_STAND_DOWN_USAGE } from "./usage.js";

/**
 * The exit code a stand-down refusal or failure ends in.
 *
 * @param error the refusal
 * @returns 4 for a held lock, 2 for a blank why, 1 for a fault, else 3 — a legitimate policy no
 */
export function witnessStandDownExitCode({ error }: { error: WitnessStandDownError }): number {
  switch (error.code) {
    case "STAND_DOWN_LOCKED":
      return EXIT_DEFERRED;
    case "WHY_BLANK":
      return EXIT_USAGE;
    case "JOURNAL":
    case "REACTION_FAILED":
      return EXIT_ERROR;
    case "ALREADY_SETTLED":
    case "ALREADY_DISPATCHED":
      return EXIT_EXPECTED_EMPTY;
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/**
 * Run `witness stand-down`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runWitnessStandDown(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: WITNESS_STAND_DOWN_USAGE });
    return EXIT_OK;
  }
  const parsed = parseWitnessStandDownArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: WITNESS_STAND_DOWN_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: parsed.value.home });
  if (parsed.value.scope === "thread") {
    return standDownWholeThread({ home, request: parsed.value.request });
  }
  const { request } = parsed.value;
  const token = slackBotToken({ home });
  if (token === undefined) {
    logger.error({ msg: "witness stand-down: no Slack bot token is stored — run `slopweaver connect slack` first" });
    return EXIT_ERROR;
  }
  const deps = productionWitnessStandDownDeps({ home, transport: makeSlackWriteTransport({ home, token }) });
  const stood = await standDownWitness({ deps, request });
  if (stood.isErr()) {
    logger.error({ msg: `witness stand-down: ${stood.error.code} — ${stood.error.message}` });
    return witnessStandDownExitCode({ error: stood.error });
  }
  const { already, emoji, witnessId } = stood.value;
  const where = `${request.key.channel} (thread ${request.key.threadTs})`;
  if (already) {
    logger.out({ line: `witness stand-down: ${witnessId} was already recorded — ${where} is not witnessed` });
    return EXIT_OK;
  }
  logger.out({
    line: `witness stand-down: :${emoji}: on ${request.key.messageTs}, nothing posted — ${where} is witnessed no further (${witnessId})`,
  });
  return EXIT_OK;
}

/** The whole-thread form: the journal alone, so no Slack token is needed — it makes no Slack call. */
async function standDownWholeThread({
  home,
  request,
}: {
  home: string;
  request: WitnessThreadStandDownRequest;
}): Promise<number> {
  const stood = await standDownThread({ deps: productionWitnessJournalDeps({ home }), request });
  if (stood.isErr()) {
    logger.error({ msg: `witness stand-down: ${stood.error.code} — ${stood.error.message}` });
    return witnessStandDownExitCode({ error: stood.error });
  }
  const { already, id } = stood.value;
  const where = `${request.channel} (thread ${request.threadTs})`;
  if (already) {
    logger.out({ line: `witness stand-down: ${id} was already recorded — ${where} is not witnessed` });
    return EXIT_OK;
  }
  logger.out({
    line: `witness stand-down: nothing reacted, nothing posted — ${where} is witnessed no further (${id})`,
  });
  return EXIT_OK;
}

export const witnessStandDownCommand = defineCommand({ run: runWitnessStandDown });
