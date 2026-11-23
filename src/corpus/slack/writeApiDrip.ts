/**
 * The Slack AS-ME DRIP write calls — `chat.postMessage`/`chat.update` for one drip message — split out of
 * `./writeApi.ts` purely to keep that file under `file-size-ratchet`'s 800-code-line cap. Same seam, same
 * `safeProviderCall`/`orThrow`/`scopeId` pattern, no policy of its own — see `writeApi.ts`'s own header.
 */
import type { WebClient } from "@slack/web-api";

import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { SlackDripMessagePayload, SlackNoFoldPayload } from "../../outbound/slack/types.js";
import { optStr } from "./shape.js";
import type { PostedMessage } from "./writeTransport.js";

/** The one client method a drip or no-fold POST reaches — narrowed so the type names exactly what is called. */
interface ChatPostClient {
  readonly chat: Pick<WebClient["chat"], "postMessage">;
}

/** The one client method a drip EDIT reaches. */
interface ChatUpdateClient {
  readonly chat: Pick<WebClient["chat"], "update">;
}

/**
 * `chat.postMessage` with ONE as-me drip message. Returns the created message's identity.
 *
 * The two arms send genuinely different arguments: the `rich` arm posts a one-element top-level `blocks`
 * array (no wrapper, so nothing can fold) with `text` carrying only the notification fallback, and the
 * `plain` arm posts a bare `text` with no blocks so Slack parses it exactly as it parses what a human
 * types. `form` is ours and is dropped here. A plain BOT notice carries `metadata` so `slack delete` can
 * retract it (`../../outbound/slack/noticeMetadata.ts`); the operator's own words never do.
 *
 * @param client the NON-RETRYING posting client — see `writeApi.ts`'s `postingClient`
 * @param channel the destination channel id
 * @param payload the rendered message, rich or plain
 * @param threadTs the parent to reply into, or undefined for a top-level message
 * @param scopeId the shared-429-block key for this token
 * @returns the created message's identity
 */
export async function postDripMessageCall({
  client,
  channel,
  payload,
  threadTs,
  scopeId,
}: {
  client: ChatPostClient;
  channel: string;
  payload: SlackDripMessagePayload;
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
          channel,
          text: payload.text,
          unfurl_links: payload.unfurl_links,
          unfurl_media: payload.unfurl_media,
          ...(payload.form === "rich" ? { blocks: [...payload.blocks] } : {}),
          ...(payload.form === "plain" && payload.metadata !== undefined ? { metadata: payload.metadata } : {}),
          ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
        }),
      operation: "slack.chat.postMessage.drip",
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
 * `chat.update` with a re-rendered AS-ME message — no `attachments`, no `metadata`.
 *
 * `blocks` is ALWAYS sent explicitly: the rendered one-element array for a rich message, an empty array for
 * the plain escape hatch. Slack's `chat.update` leaves a field untouched when it is omitted, so omitting
 * `blocks` on a plain-text edit of a message that used to be rich would leave the old blocks rendered
 * alongside the new `text` — sending `[]` is what actually clears them.
 *
 * @param client the repeatable write client
 * @param posted the message being edited
 * @param payload the rendered replacement, rich or plain
 * @param fileIds the message's existing file ids, re-sent so the edit does not detach them
 * @param scopeId the shared-429-block key for this token
 * @returns nothing
 */
export async function updateDripMessageCall({
  client,
  posted,
  payload,
  fileIds,
  scopeId,
}: {
  client: ChatUpdateClient;
  posted: PostedMessage;
  payload: SlackDripMessagePayload;
  fileIds: readonly string[];
  scopeId: string;
}): Promise<void> {
  orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.chat.update({
          blocks: payload.form === "rich" ? [...payload.blocks] : [],
          channel: posted.channel,
          text: payload.text,
          ts: posted.ts,
          ...(fileIds.length > 0 ? { file_ids: [...fileIds] } : {}),
        }),
      operation: "slack.chat.update.drip",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
}

/**
 * `chat.postMessage` with a NO-FOLD bot message. Returns the created message's identity.
 *
 * Its own call rather than a widened {@link postDripMessageCall} or a widened `postCardCall`, for the reason
 * `writeTransport.ts` gives about every other one of these: the arguments genuinely differ. The card sends
 * `attachments` with an empty `text`; a drip sends no `metadata` at all; this sends top-level `blocks`
 * WITH `metadata`, and `text` carrying a real notification fallback.
 *
 * **`attachments` is not merely omitted here, it is absent from the payload type.** That is what makes the
 * no-fold guarantee structural: an attachment wrapper is the one thing measured to make a Slack message
 * fold, so there is no field on {@link SlackNoFoldPayload} for one and no line in this call that could
 * send one.
 *
 * @param client the NON-RETRYING posting client — see `writeApi.ts`'s `postingClient`
 * @param channel the destination channel id
 * @param payload the rendered no-fold message
 * @param threadTs the parent to reply into, or undefined for a top-level message
 * @param scopeId the shared-429-block key for this token
 * @returns the created message's identity
 */
export async function postNoFoldCall({
  client,
  channel,
  payload,
  threadTs,
  scopeId,
}: {
  client: ChatPostClient;
  channel: string;
  payload: SlackNoFoldPayload;
  threadTs: string | undefined;
  scopeId: string;
}): Promise<PostedMessage> {
  const res = orThrow({
    result: await safeProviderCall({
      // AT-MOST-ONCE: `retryMode: "never"` AND the NON-RETRYING `client`, exactly as every other post here.
      execute: () =>
        client.chat.postMessage({
          blocks: [...payload.blocks],
          channel,
          metadata: payload.metadata,
          text: payload.text,
          unfurl_links: payload.unfurl_links,
          unfurl_media: payload.unfurl_media,
          ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
        }),
      operation: "slack.chat.postMessage.noFold",
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
