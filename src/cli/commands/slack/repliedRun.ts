/**
 * `slopweaver slack replied` — has the owner posted in a thread since one message: the mechanical done-check an
 * ask anchored to a Slack message carries.
 *
 * Exit codes follow the house contract (`../../exitCodes.ts`): 0 they replied, 3 not yet — the legitimate
 * non-success status — and 1 when the check could not run, so a done-check that could not look never reads as
 * "still not done".
 */
import { logger } from "../../../lib/logger.js";
import { ownerReplyLine } from "../../../live/slack/ownerReply.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseSlackRepliedArgs } from "./repliedArgs.js";
import { checkOwnerReply } from "./repliedRead.js";
import { SLACK_REPLIED_USAGE } from "./repliedUsage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "slack", "replied", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `slack replied` verb.
 *
 * @param argv the full process argv
 * @returns 0 replied, 3 not yet, 1 could not check, 2 a usage mistake
 */
export async function runSlackReplied(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SLACK_REPLIED_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSlackRepliedArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: SLACK_REPLIED_USAGE });
    return EXIT_USAGE;
  }
  const { url, home, json } = parsed.value;
  const reply = await checkOwnerReply({ home, permalink: url });
  if (json) {
    logger.out({ line: JSON.stringify({ permalink: url, reply }) });
  } else if (reply.kind === "could-not-check") {
    logger.error({ msg: `slack replied: ${ownerReplyLine({ permalink: url, reply })}` });
  } else {
    logger.out({ line: ownerReplyLine({ permalink: url, reply }) });
  }
  if (reply.kind === "replied") {
    return EXIT_OK;
  }
  if (reply.kind === "not-yet") {
    return EXIT_EXPECTED_EMPTY;
  }
  return EXIT_ERROR;
}

export const slackRepliedCommand = defineCommand({ run: runSlackReplied });
