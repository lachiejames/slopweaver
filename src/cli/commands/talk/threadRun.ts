/**
 * `slopweaver talk thread` — the conversation they and the console voice had, across calls and typed conversations,
 * oldest first: their speech and nothing else (`../../../talk/chatThread.ts`). The orb's messenger and the stage open
 * on it, so a reopened console shows where the two of them stopped. It reads this home's declared main checkouts
 * too, so a call another install recorded — a home carried from another machine — is left out of it.
 */
import { logger } from "../../../lib/logger.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { readCalls } from "../../../talk/callStore.js";
import { chatThreadOf, THREAD_CALLS_READ, threadCutOf, threadUnreadableOf } from "../../../talk/chatThread.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseThreadArgs } from "./callArgs.js";
import { TALK_THREAD_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "thread", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk thread` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkThread(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_THREAD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseThreadArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_THREAD_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  const mainCheckoutPaths = mainCheckoutsFromProfile({ home }).map((checkout) => checkout.path);
  const read = readCalls({ home, keep: { speaking: THREAD_CALLS_READ } });
  if (read.isErr()) {
    logger.error({ msg: `talk thread: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const { calls } = read.value;
  const unreadable = threadUnreadableOf({ calls, mainCheckoutPaths, unreadable: read.value.unreadable });
  const turns = chatThreadOf({ calls, mainCheckoutPaths, turns: args.turns });
  if (args.json) {
    const cut = threadCutOf({ calls, mainCheckoutPaths, passedOver: read.value.passedOver, turns: args.turns });
    logger.out({ line: JSON.stringify({ cut, observedAtIso: new Date().toISOString(), turns, unreadable }) });
    return EXIT_OK;
  }
  unreadable.forEach((why) => {
    logger.out({ line: `  not read — ${why}` });
  });
  if (turns.length === 0) {
    logger.out({ line: "talk thread: nothing has been said to the console voice on this install" });
    return EXIT_OK;
  }
  turns.forEach((turn) => {
    const typed = turn.medium === "typed" ? " (typed)" : "";
    logger.out({ line: `${turn.atIso}  ${turn.who}${typed} ${turn.text}` });
  });
  return EXIT_OK;
}

export const talkThreadCommand = defineCommand({ run: runTalkThread });
