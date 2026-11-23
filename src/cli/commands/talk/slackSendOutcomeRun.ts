/**
 * `slopweaver talk slack-send-outcome` — what became of a Slack send they asked for on a call, for the console voice.
 *
 * The voice's `slack_send_outcome` tool runs this, and so does the console page itself after a relay declared a Slack
 * send, so the outcome is said to them without their asking (`site/lib/slackSendWatch.ts`). One thread read live with the
 * token `slack replied` picks, then the as-me draft register and the send failure journal; nothing written. The rules
 * are `src/talk/slackSendOutcome.ts`'s.
 */
import { readSlackDraftLinesOrError } from "../../../admit/slackDraftStore.js";
import { readSlackSendFailures } from "../../../admit/slackSendFailureStore.js";
import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { withTimeout } from "../../../lib/resilience.js";
import { parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import { ownerUserIdFromProfile } from "../../../profileStore.js";
import {
  draftsOrUnsure,
  readSlackSendOutcome,
  SLACK_SEND_OUTCOME_NOTE,
  type SlackSendOutcomeAnswer,
  type SlackSendOutcomeDeps,
} from "../../../talk/slackSendOutcome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { TALK_SLACK_SEND_OUTCOME_USAGE } from "./knowUsage.js";
import { parseSlackSendOutcomeArgs } from "./slackSendOutcomeArgs.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "slack-send-outcome", ...]`. */
const VERB_ARG_OFFSET = 4;

/** How long the whole read may take: under the console's 20 s tool kill, as `talk slack-after`'s is. */
const SLACK_SEND_OUTCOME_DEADLINE_MS = 14_000;

/** Why there is no outcome when no token can read Slack. */
const NO_TOKEN_WHY = "no Slack token is configured — run `slopweaver connect slack`";

/** Why there is no outcome when Slack outlasts the deadline. */
const DEADLINE_WHY = `Slack did not answer within ${String(SLACK_SEND_OUTCOME_DEADLINE_MS / 1000)} s — a very long thread or a rate limit`;

/** The answer for a read that could not be made. */
function couldNotCheck({ why }: { why: string }): SlackSendOutcomeAnswer {
  return { note: SLACK_SEND_OUTCOME_NOTE, outcome: { state: "could-not-check", why } };
}

/** The live edges one outcome read uses: Slack under `token`, and the two registers under `home`. */
function outcomeDeps({ home, token }: { home: string; token: string }): SlackSendOutcomeDeps {
  return {
    api: makeSlackApi({ token }),
    drafts: () =>
      readSlackDraftLinesOrError({ home })
        .mapErr((error) => [error.message])
        .andThen((lines) => draftsOrUnsure({ log: parseSlackDraftLog({ lines }) }).mapErr((error) => [error.message])),
    failures: () => readSlackSendFailures({ home }).mapErr((error) => [error.message]),
    nowMs: () => Date.now(),
    ownerUserId: ownerUserIdFromProfile({ home }),
  };
}

/**
 * Run the `talk slack-send-outcome` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkSlackSendOutcome(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_SLACK_SEND_OUTCOME_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSlackSendOutcomeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_SLACK_SEND_OUTCOME_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = typeof args.home === "string" ? args.home : slopweaverHome();
  const chosen = resolveSlackReadToken({ botToken: slackBotToken({ home }), userToken: slackUserToken({ home }) });
  if (chosen.token === undefined) {
    printAnswer({ answer: couldNotCheck({ why: NO_TOKEN_WHY }), json: args.json });
    return EXIT_OK;
  }
  const deps = outcomeDeps({ home, token: chosen.token });
  let answer: Awaited<ReturnType<typeof readSlackSendOutcome>>;
  try {
    answer = await withTimeout({
      task: () => readSlackSendOutcome({ deps, sinceIso: args.since, url: args.url }),
      timeoutMs: SLACK_SEND_OUTCOME_DEADLINE_MS,
    });
  } catch {
    printAnswer({ answer: couldNotCheck({ why: DEADLINE_WHY }), json: args.json });
    return EXIT_OK;
  }
  if (answer.isErr()) {
    logger.error({ msg: `talk slack-send-outcome: ${answer.error.message}` });
    return EXIT_ERROR;
  }
  printAnswer({ answer: answer.value, json: args.json });
  return EXIT_OK;
}

/** Print the answer as one JSON document, or as the one line a person reads. */
function printAnswer({ answer, json }: { answer: SlackSendOutcomeAnswer; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(answer) });
    return;
  }
  const { outcome } = answer;
  if (outcome.state === "sent") {
    logger.out({ line: `sent at ${outcome.atIso}: ${outcome.permalink}` });
  } else if (outcome.state === "held") {
    logger.out({ line: `held since ${outcome.atIso}, not sent: ${outcome.why}` });
  } else if (outcome.state === "failed") {
    logger.out({ line: `failed at ${outcome.atIso}, not sent: ${outcome.error}` });
  } else if (outcome.state === "not-sent-yet") {
    logger.out({ line: `not sent yet, read ${outcome.readAtIso}` });
  } else {
    logger.out({ line: `could not check: ${outcome.why}` });
  }
}

export const talkSlackSendOutcomeCommand = defineCommand({ run: runTalkSlackSendOutcome });
