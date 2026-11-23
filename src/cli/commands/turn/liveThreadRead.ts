/**
 * ONE live read of an ask's thread, shared by the two moments that judge whether the thread moved: `turn answer`
 * right before the send, and `turn review` right before round 1 opens.
 *
 * The two callers treat a failed read differently, and that is why this returns a typed `Result` rather than
 * logging for them. The send FAILS OPEN — a missing read token must not silently break every answer
 * (`./sendPreflight.ts`). Round-1 open FAILS CLOSED with a fact refusal, because a check that could not run
 * must not be reported as one that passed, and refusing there costs a re-run rather than a post
 * (`./reviewThreadPreflight.ts`).
 */
import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { fetchCompleteSlackThread } from "../../../live/slack/pagination.js";

/** The thread's raw messages, and the token warning to surface when only a bot token could read it. */
export interface LiveThreadRead {
  readonly rawMessages: readonly unknown[];
  readonly warning: string | undefined;
}

/** No Slack read token is configured, so the thread could not be read at all. */
interface ReadTokenMissingError {
  readonly code: "SLACK_READ_TOKEN_MISSING";
  readonly message: string;
}

/** A token was there and the read itself failed. */
interface ThreadReadFailedError {
  readonly code: "THREAD_READ_FAILED";
  readonly message: string;
}

/** Why a live thread read did not happen. */
export type LiveThreadReadError = ReadTokenMissingError | ThreadReadFailedError;

/** The factory every {@link LiveThreadReadError} is built through. */
export const LiveThreadReadErrors = {
  readFailed: ({ cause }: { cause: string }): ThreadReadFailedError => ({
    code: "THREAD_READ_FAILED",
    message: `could not read the thread live: ${cause}`,
  }),
  tokenMissing: (): ReadTokenMissingError => ({
    code: "SLACK_READ_TOKEN_MISSING",
    message: "could not read the thread live — no Slack read token is configured (`slopweaver secrets status`)",
  }),
} as const;

/**
 * Read the thread an ask sits in, whole, with whichever Slack read token this home holds.
 *
 * @param home the state home the read token is resolved from
 * @param target the channel and thread to read
 * @returns the thread's raw messages and any token warning, or why the read did not happen
 */
export async function readLiveThread({
  home,
  target,
}: {
  home: string;
  target: { readonly channel: string; readonly threadTs: string };
}): Promise<Result<LiveThreadRead, LiveThreadReadError>> {
  const resolved = resolveSlackReadToken({ botToken: slackBotToken({ home }), userToken: slackUserToken({ home }) });
  if (resolved.token === undefined) {
    return err(LiveThreadReadErrors.tokenMissing());
  }
  const thread = await fetchCompleteSlackThread({
    api: makeSlackApi({ token: resolved.token }),
    channel: target.channel,
    threadTs: target.threadTs,
  });
  if (thread.isErr()) {
    return err(LiveThreadReadErrors.readFailed({ cause: thread.error.message }));
  }
  return ok({ rawMessages: thread.value.rawMessages, warning: resolved.warning });
}
