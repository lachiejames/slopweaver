/**
 * `slopweaver talk slack-after` — what came after one Slack message, read live, for the console voice.
 *
 * The voice's `slack_thread_after` tool runs this with the link it read off their screen. One thread per call,
 * read with the same token `slack read-thread` would pick, and NOTHING written: the attachment stage that
 * keeps `slack read-thread` off the voice's `verb` list is never reached (`src/talk/slackAfter.ts`). Authors are
 * named from the local Slack member rows, read here and never refreshed.
 */
import { slackBotToken, slackUserToken } from "../../../config.js";
import { slackMemberNames } from "../../../corpus/members/slackNames.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { logger } from "../../../lib/logger.js";
import { withTimeout } from "../../../lib/resilience.js";
import { readSlackAfter, type SlackAfterAnswer } from "../../../talk/slackAfter.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { TALK_SLACK_AFTER_USAGE } from "./knowUsage.js";
import { parseSlackAfterArgs } from "./slackAfterArgs.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "slack-after", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * How long the whole read may take. The console kills a tool at 20 s with no reason given
 * (`site/lib/talkToolsList.ts`), and a thread of many pages or a Slack 429 honoured by the provider door can run
 * past that, so this verb gives up first and SAYS why.
 */
const SLACK_AFTER_DEADLINE_MS = 14_000;

/**
 * Run the `talk slack-after` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkSlackAfter(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_SLACK_AFTER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSlackAfterArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_SLACK_AFTER_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const homeArgs = args.home !== undefined ? { home: args.home } : {};
  const chosen = resolveSlackReadToken({ botToken: slackBotToken(homeArgs), userToken: slackUserToken(homeArgs) });
  if (chosen.token === undefined) {
    logger.error({ msg: "talk slack-after: no Slack token configured; run `slopweaver connect slack`" });
    return EXIT_ERROR;
  }
  const warnings: string[] = [];
  if (chosen.warning !== undefined) {
    warnings.push("read with the BOT token: a private conversation the bot is not in cannot be read");
  }
  const api = makeSlackApi({ token: chosen.token });
  let answer: Awaited<ReturnType<typeof readSlackAfter>>;
  try {
    answer = await withTimeout({
      task: () =>
        readSlackAfter({
          deps: { api, names: slackMemberNames({ home: args.home }).names, nowIso: () => new Date().toISOString() },
          maxBytes: args.maxBytes,
          permalink: args.url,
          warnings,
        }),
      timeoutMs: SLACK_AFTER_DEADLINE_MS,
    });
  } catch {
    logger.error({
      msg: `talk slack-after: Slack did not return the whole thread within ${String(SLACK_AFTER_DEADLINE_MS / 1000)} s — a very long thread or a rate limit; say so and try it again, never hand the read to a fleet session`,
    });
    return EXIT_ERROR;
  }
  if (answer.isErr()) {
    answer.error.forEach((message) => {
      logger.error({ msg: `talk slack-after: ${message}` });
    });
    return EXIT_ERROR;
  }
  printAnswer({ answer: answer.value, json: args.json });
  return EXIT_OK;
}

/** Print the answer as one JSON document, or as lines a person reads. */
function printAnswer({ answer, json }: { answer: SlackAfterAnswer; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(answer) });
    return;
  }
  logger.out({ line: `talk slack-after: ${answer.answer}` });
  answer.messages.forEach((message) => {
    logger.out({ line: `  ${message.atIso} ${message.author}: ${message.text}` });
  });
  answer.warnings.forEach((warning) => {
    logger.out({ line: `  warning: ${warning}` });
  });
}

export const talkSlackAfterCommand = defineCommand({ run: runTalkSlackAfter });
