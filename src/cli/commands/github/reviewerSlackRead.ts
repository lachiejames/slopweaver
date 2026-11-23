/**
 * `github reviewer read`'s one Slack read, through the door `slack read-thread` uses: the message a permalink
 * names and every message of the thread it sits in. Split out of `./reviewerRun.ts`, which it would have taken
 * past its size ratchet.
 */
import { err, ok } from "#lib/result.js";

import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { downloadSlackFile } from "../../../live/slack/download.js";
import type { SlackThreadTarget } from "../../../live/slack/permalink.js";
import { readSlackThread } from "../../../live/slack/readThread.js";
import type { VisibleSlackMessage } from "../../../live/slack/types.js";
import { stateHomePaths } from "../../../stateHome.js";

import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import { type ReadMessage } from "./reviewerCore.js";

/**
 * The message a permalink names and the rest of its thread, read whole — a pull request is often linked by a
 * reply rather than the root, and the landing associates every message of a thread holding the link — with no
 * attachment fetched.
 *
 * @param permalink the Slack message permalink `--message` named
 * @returns the message, or why it could not be read
 */
export async function readReviewerMessage({
  home,
  permalink,
}: {
  home: string | undefined;
  permalink: string;
}): Promise<GithubVerbResult<ReadMessage>> {
  const homeArgs = home === undefined ? {} : { home };
  const chosen = resolveSlackReadToken({ botToken: slackBotToken(homeArgs), userToken: slackUserToken(homeArgs) });
  const { token } = chosen;
  if (token === undefined) {
    return err(GithubVerbErrors.slackTokenMissing());
  }
  const document = await readSlackThread({
    deps: {
      api: makeSlackApi({ token }),
      downloadFile: downloadSlackFile,
      nowIso: () => new Date().toISOString(),
      onProgress: () => undefined,
    },
    filesRoot: stateHomePaths(homeArgs).live.slack.threadFiles,
    maxFileBytes: 0,
    permalink,
    principal: chosen.warning === undefined ? "user" : "bot",
    token,
  });
  if (document.isErr()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "slack read-thread", reasons: [document.error.message] }));
  }
  return readMessageOf(document.value);
}

/**
 * The message a thread read addressed, with the words of every other message in its thread beside it.
 *
 * @param thread where the read landed: the conversation and the message the permalink addressed
 * @param messages every message the read returned, the addressed one among them
 * @returns the message, or why the read did not carry it
 */
export function readMessageOf({
  thread,
  messages,
}: {
  thread: Pick<SlackThreadTarget, "channel" | "addressedTs">;
  messages: readonly Pick<VisibleSlackMessage, "ts" | "tsIso" | "text">[];
}): GithubVerbResult<ReadMessage> {
  const addressed = messages.find((message) => message.ts === thread.addressedTs);
  if (addressed === undefined) {
    return err(GithubVerbErrors.slackMessageMissing({ ts: thread.addressedTs }));
  }
  return ok({
    atIso: addressed.tsIso,
    channelId: thread.channel,
    text: addressed.text,
    threadTexts: messages.filter((message) => message.ts !== addressed.ts).map((message) => message.text),
    ts: addressed.ts,
  });
}
