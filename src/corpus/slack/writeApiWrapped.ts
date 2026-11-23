/**
 * The two Slack writes that post one accent WRAPPER as a new message — a card and a turn's live frame — plus
 * the frame's in-place update, split out of `./writeApi.ts` to keep that file under `file-size-ratchet`. The
 * card and the frame post the same shape, so they sit side by side here rather than as a copy across two
 * files. Same seam, same `safeProviderCall`/`orThrow`/`scopeId` pattern, no policy of its own — see
 * `writeApi.ts`'s own header.
 */
import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { SlackCardPayload, SlackTurnPayload } from "../../outbound/slack/types.js";
import type { GuardedWebClient } from "./guardedWebClient.js";
import { toSdkAttachments } from "./sdkAttachments.js";
import { optStr } from "./shape.js";
import type { PostedMessage } from "./writeTransport.js";

/**
 * `chat.postMessage` with the rendered card. At-most-once.
 *
 * @param client the non-retrying posting client
 * @param scopeId the shared-429-block key for this token
 * @returns the created message's identity
 */
export async function postCardCall({
  client,
  channel,
  payload,
  threadTs,
  scopeId,
}: {
  client: GuardedWebClient;
  channel: string;
  payload: SlackCardPayload;
  threadTs: string | undefined;
  scopeId: string;
}): Promise<PostedMessage> {
  const res = orThrow({
    result: await safeProviderCall({
      // AT-MOST-ONCE: `retryMode: "never"` AND the NON-RETRYING `client` — see `postingClient`. The shared
      // block may DELAY this first attempt, which is safe because nothing has been sent yet; it can never
      // cause a second one.
      execute: () =>
        client.chat.postMessage({
          attachments: toSdkAttachments({ wrapper: payload.attachments[0] }),
          channel,
          metadata: payload.metadata,
          text: payload.text,
          unfurl_links: payload.unfurl_links,
          unfurl_media: payload.unfurl_media,
          ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
        }),
      operation: "slack.chat.postMessage",
      provider: "slack",
      retryMode: "never",
      scopeId,
    }),
  });
  const postedChannel = optStr({ value: res.channel });
  const ts = optStr({ value: res.ts });
  if (postedChannel === undefined || ts === undefined) {
    throw new Error("slack.chat.postMessage returned no channel/ts");
  }
  return { channel: postedChannel, ts };
}

/**
 * `chat.postMessage` with the initial metadata-bearing TURN frame. At-most-once.
 *
 * @param client the non-retrying posting client
 * @param scopeId the shared-429-block key for this token
 * @returns the posted frame's identity
 */
export async function postTurnCall({
  client,
  channel,
  payload,
  threadTs,
  scopeId,
}: {
  client: GuardedWebClient;
  channel: string;
  payload: SlackTurnPayload;
  threadTs: string | undefined;
  scopeId: string;
}): Promise<PostedMessage> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.chat.postMessage({
          attachments: toSdkAttachments({ wrapper: payload.attachments[0] }),
          channel,
          metadata: payload.metadata,
          text: payload.text,
          unfurl_links: payload.unfurl_links,
          unfurl_media: payload.unfurl_media,
          ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
        }),
      operation: "slack.chat.postMessage.turn",
      provider: "slack",
      retryMode: "never",
      scopeId,
    }),
  });
  const postedChannel = optStr({ value: res.channel });
  const ts = optStr({ value: res.ts });
  if (postedChannel === undefined || ts === undefined) {
    throw new Error("slack.chat.postMessage returned no channel/ts");
  }
  return { channel: postedChannel, ts };
}

/**
 * `chat.update` with a new turn frame. Repeatable and paced.
 *
 * @param client the retrying write client
 * @param scopeId the shared-429-block key for this token
 */
export async function updateTurnCall({
  client,
  posted,
  payload,
  scopeId,
}: {
  client: GuardedWebClient;
  posted: PostedMessage;
  payload: SlackTurnPayload;
  scopeId: string;
}): Promise<void> {
  orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.chat.update({
          attachments: toSdkAttachments({ wrapper: payload.attachments[0] }),
          channel: posted.channel,
          metadata: payload.metadata,
          text: payload.text,
          ts: posted.ts,
        }),
      operation: "slack.chat.update.turn",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
}
