/**
 * `slopweaver talk slack-open` — one Slack thread, or the conversation around a DM message, opened whole from its
 * link and read live for the console voice: its READ of a thread, and the second step after `slack unread`'s list.
 *
 * The voice's `slack_open` tool runs this with any message link in the thread — off their screen, a card, or the row
 * they name. Read with the same token
 * `slack read-thread` would pick, and NOTHING written (`src/talk/slackOpen.ts`). Authors are named from the local
 * Slack member rows, read here and never refreshed.
 */
import { slackBotToken, slackUserToken } from "../../../config.js";
import { slackMemberNames } from "../../../corpus/members/slackNames.js";
import { makeSlackApi, makeSlackConversationInfoCall } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { logger } from "../../../lib/logger.js";
import { withTimeout } from "../../../lib/resilience.js";
import { readSlackOpen, type SlackOpenAnswer } from "../../../talk/slackOpen.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { TALK_SLACK_OPEN_USAGE } from "./knowUsage.js";
import { parseSlackOpenArgs } from "./slackOpenArgs.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "slack-open", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * How long the whole read may take. The console kills a tool at 20 s with no reason given
 * (`site/lib/talkToolsList.ts`), so this verb gives up first and SAYS why — `talk slack-after`'s deadline, for the
 * same fetch.
 */
const SLACK_OPEN_DEADLINE_MS = 14_000;

/**
 * Run the `talk slack-open` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkSlackOpen(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_SLACK_OPEN_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSlackOpenArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_SLACK_OPEN_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const homeArgs = args.home !== undefined ? { home: args.home } : {};
  const chosen = resolveSlackReadToken({ botToken: slackBotToken(homeArgs), userToken: slackUserToken(homeArgs) });
  const token = chosen.token;
  if (token === undefined) {
    logger.error({ msg: "talk slack-open: no Slack token configured; run `slopweaver connect slack`" });
    return EXIT_ERROR;
  }
  const warnings: string[] = [];
  if (chosen.warning !== undefined) {
    warnings.push("read with the BOT token: a private conversation the bot is not in cannot be read");
  }
  const api = makeSlackApi({ token });
  const maps = { channelNames: {}, userNames: slackMemberNames({ home: args.home }).names };
  let answer: Awaited<ReturnType<typeof readSlackOpen>>;
  try {
    answer = await withTimeout({
      task: () =>
        readSlackOpen({
          deps: { api, info: makeSlackConversationInfoCall({ token }), maps, nowMs: () => Date.now() },
          maxBytes: args.maxBytes,
          permalink: args.url,
          warnings,
        }),
      timeoutMs: SLACK_OPEN_DEADLINE_MS,
    });
  } catch {
    logger.error({
      msg: `talk slack-open: Slack did not return the whole thread within ${String(SLACK_OPEN_DEADLINE_MS / 1000)} s — a very long thread or a rate limit; say so and try it again, never hand the read to a fleet session`,
    });
    return EXIT_ERROR;
  }
  if (answer.isErr()) {
    answer.error.forEach((message) => {
      logger.error({ msg: `talk slack-open: ${message}` });
    });
    return EXIT_ERROR;
  }
  printAnswer({ answer: answer.value, json: args.json });
  return EXIT_OK;
}

/** Print the answer as one JSON document, or as lines a person reads. */
function printAnswer({ answer, json }: { answer: SlackOpenAnswer; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(answer) });
    return;
  }
  logger.out({ line: `talk slack-open: ${answer.answer}` });
  if (answer.opening !== null) {
    logger.out({ line: `  ${answer.opening.atIso} ${answer.opening.author}: ${answer.opening.text}` });
  }
  if (answer.omitted > 0) {
    logger.out({ line: `  … ${String(answer.omitted)} older message(s) left out for size` });
  }
  answer.messages.forEach((message) => {
    logger.out({ line: `  ${message.atIso} ${message.author}: ${message.text}` });
  });
  answer.warnings.forEach((warning) => {
    logger.out({ line: `  warning: ${warning}` });
  });
}

export const talkSlackOpenCommand = defineCommand({ run: runTalkSlackOpen });
