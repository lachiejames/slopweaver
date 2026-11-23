/**
 * `slopweaver talk slack-channel` — one Slack channel read live from the name on their screen, a link, or an id: the
 * newest top-level messages, each with its reply count, for the console voice's `slack_channel` tool.
 *
 * Read with the same token `slack read-thread` would pick, and NOTHING written (`src/talk/slackChannel.ts`). Authors
 * are named from the local Slack member rows, read here and never refreshed.
 */
import { type Logger, logger } from "#lib/logger.js";
import { withTimeout } from "#lib/resilience.js";
import { slackBotToken, slackUserToken } from "../../../config.js";
import { slackMemberNames } from "../../../corpus/members/slackNames.js";
import { makeSlackApi, makeSlackConversationInfoCall } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { readSlackChannel } from "../../../talk/slackChannel.js";
import { parseSlackChannelAddress } from "../../../talk/slackChannelAddress.js";
import type { SlackChannelAnswer } from "../../../talk/slackChannelAnswer.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { TALK_SLACK_CHANNEL_USAGE } from "./knowUsage.js";
import { parseSlackChannelArgs, type SlackChannelArgs } from "./slackChannelArgs.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "slack-channel", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * How long the whole read may take. The console kills a tool at 20 s with no reason given
 * (`site/lib/talkToolsList.ts`), so this verb gives up first and SAYS why — `talk slack-open`'s deadline. A name costs
 * one channel-list walk (2.4 s measured, `live/slack/channelPagination.ts`) before the one history page.
 */
const SLACK_CHANNEL_DEADLINE_MS = 14_000;

/**
 * Run the `talk slack-channel` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkSlackChannel(argv: readonly string[]): Promise<number> {
  return runTalkSlackChannelWithDeps({ argv, log: logger });
}

/**
 * The verb over an injected logger, so a test reads which line it printed rather than only its exit code.
 *
 * @param argv the full process argv
 * @param log where the usage, refusals and answer are printed
 * @returns the process exit code
 */
export async function runTalkSlackChannelWithDeps({
  argv,
  log,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: TALK_SLACK_CHANNEL_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSlackChannelArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      log.error({ msg: message });
    });
    log.error({ msg: TALK_SLACK_CHANNEL_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const address = parseSlackChannelAddress({ input: args.channel });
  if (address.isErr()) {
    log.error({ msg: `talk slack-channel: ${address.error.message}` });
    log.error({ msg: TALK_SLACK_CHANNEL_USAGE });
    return EXIT_USAGE;
  }
  return readAndPrint({ args, log });
}

/** Read the token only now the argument has parsed, then the channel live within the deadline, and print it. */
async function readAndPrint({
  args,
  log,
}: {
  args: SlackChannelArgs;
  log: Pick<Logger, "error" | "out">;
}): Promise<number> {
  const homeArgs = args.home !== undefined ? { home: args.home } : {};
  const chosen = resolveSlackReadToken({ botToken: slackBotToken(homeArgs), userToken: slackUserToken(homeArgs) });
  const token = chosen.token;
  if (token === undefined) {
    log.error({ msg: "talk slack-channel: no Slack token configured; run `slopweaver connect slack`" });
    return EXIT_ERROR;
  }
  const botToken = chosen.warning !== undefined;
  const warnings: string[] = [];
  if (botToken) {
    warnings.push("read with the BOT token: a private channel the bot is not in cannot be found or read");
  }
  const maps = { channelNames: {}, userNames: slackMemberNames({ home: args.home }).names };
  let answer: Awaited<ReturnType<typeof readSlackChannel>>;
  try {
    answer = await withTimeout({
      task: () =>
        readSlackChannel({
          botToken,
          channel: args.channel,
          deps: {
            api: makeSlackApi({ token }),
            info: makeSlackConversationInfoCall({ token }),
            maps,
            nowMs: () => Date.now(),
          },
          maxBytes: args.maxBytes,
          warnings,
        }),
      timeoutMs: SLACK_CHANNEL_DEADLINE_MS,
    });
  } catch {
    log.error({
      msg: `talk slack-channel: Slack did not list the channels and return the newest messages within ${String(SLACK_CHANNEL_DEADLINE_MS / 1000)} s — a rate limit or a slow Slack; nothing partial was kept, so try once more`,
    });
    return EXIT_ERROR;
  }
  if (answer.isErr()) {
    log.error({ msg: `talk slack-channel: ${answer.error.message}` });
    return EXIT_ERROR;
  }
  printAnswer({ answer: answer.value, json: args.json, log });
  return EXIT_OK;
}

/** Print the answer as one JSON document, or as lines a person reads. */
function printAnswer({
  answer,
  json,
  log,
}: {
  answer: SlackChannelAnswer;
  json: boolean;
  log: Pick<Logger, "out">;
}): void {
  if (json) {
    log.out({ line: JSON.stringify(answer) });
    return;
  }
  log.out({ line: `talk slack-channel: ${answer.answer}` });
  if (answer.omitted > 0) {
    log.out({ line: `  … ${String(answer.omitted)} older message(s) left out for size` });
  }
  answer.messages.forEach((message) => {
    const replies =
      message.replies > 0 ? ` [${String(message.replies)} repl${message.replies === 1 ? "y" : "ies"}]` : "";
    log.out({ line: `  ${message.atIso} ${message.author}${replies}: ${message.text}` });
  });
  answer.warnings.forEach((warning) => {
    log.out({ line: `  warning: ${warning}` });
  });
}

export const talkSlackChannelCommand = defineCommand({ run: runTalkSlackChannel });
