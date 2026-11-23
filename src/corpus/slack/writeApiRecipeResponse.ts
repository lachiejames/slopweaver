/**
 * The Slack RECIPE RESPONSE write calls — `chat.postMessage`/`chat.update` for a scheduled recipe's own
 * response message — split out of `./writeApi.ts` purely to keep that file under `file-size-ratchet`'s
 * 800-code-line cap. Same seam, same `safeProviderCall`/`orThrow`/`scopeId` pattern, no policy of its own —
 * see `writeApi.ts`'s own header.
 */
import type { MessageMetadata } from "@slack/types";
import type { WebClient } from "@slack/web-api";

import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { SlackRecipeResponsePayload } from "../../outbound/slack/recipeResponse.js";
import { toSdkAttachments } from "./sdkAttachments.js";
import { optStr } from "./shape.js";
import type { PostedMessage } from "./writeTransport.js";

/**
 * Rebuild a recipe-response metadata value as a FRESH object literal, structurally matching the SDK's own
 * `MessageMetadata` index signature — the SDK's index signature has no `undefined` in its value union, so
 * `targetThreadTs: string | undefined` (a real, legitimately-absent field for a top-level target) must be
 * OMITTED rather than passed as an explicit `undefined`, which only a freshly-built literal can express.
 *
 * @internal — exported for its unit test; {@link postRecipeResponseCall} is the one caller.
 *
 * @param metadata the rendered recipe response's own metadata, whose thread target may be undefined
 * @returns the SDK-shaped metadata, with every anchor field copied and an absent thread target omitted
 */
export function sdkRecipeResponseMetadata({
  metadata,
}: {
  metadata: SlackRecipeResponsePayload["metadata"];
}): MessageMetadata {
  const { targetThreadTs, ...rest } = metadata.event_payload;
  return {
    event_payload: { ...rest, ...(targetThreadTs === undefined ? {} : { targetThreadTs }) },
    event_type: metadata.event_type,
  };
}

/**
 * `chat.postMessage` with a scheduled recipe's own response message. Returns the created message's identity.
 *
 * Non-retrying like every other post here (`writeApi.ts`'s `postingClient`) — an at-most-once send is
 * correct for an irreversible `chat.postMessage`. Sends `attachments` exactly like the card's own post.
 *
 * @param client the non-retrying SDK client
 * @param channel the destination channel id
 * @param payload the rendered recipe response
 * @param threadTs the parent timestamp when replying in a thread, or undefined for a top-level post
 * @param scopeId the rate-limit scope this call is paced under
 * @returns the created message's channel and timestamp
 */
export async function postRecipeResponseCall({
  client,
  channel,
  payload,
  threadTs,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  payload: SlackRecipeResponsePayload;
  threadTs: string | undefined;
  scopeId: string;
}): Promise<PostedMessage> {
  const res = orThrow({
    result: await safeProviderCall({
      // AT-MOST-ONCE: `retryMode: "never"` AND the NON-RETRYING `client` — see `writeApi.ts`'s `postingClient`.
      execute: () =>
        client.chat.postMessage({
          attachments: toSdkAttachments({ wrapper: payload.attachments[0] }),
          channel,
          metadata: sdkRecipeResponseMetadata({ metadata: payload.metadata }),
          text: payload.text,
          unfurl_links: payload.unfurl_links,
          unfurl_media: payload.unfurl_media,
          ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
        }),
      operation: "slack.chat.postMessage.recipeResponse",
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
 * `chat.update` with the SAME attachments plus `file_ids` — the recipe response's own twin of `attachMediaCall`.
 *
 * @param client the SDK client
 * @param posted the message identity returned by {@link postRecipeResponseCall}
 * @param payload the rendered recipe response
 * @param fileIds the uploaded file ids to attach, in the caller's order
 * @param scopeId the rate-limit scope this call is paced under
 * @returns nothing — throws on any failure
 */
export async function attachRecipeResponseMediaCall({
  client,
  posted,
  payload,
  fileIds,
  scopeId,
}: {
  client: WebClient;
  posted: PostedMessage;
  payload: SlackRecipeResponsePayload;
  fileIds: readonly string[];
  scopeId: string;
}): Promise<void> {
  orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.chat.update({
          attachments: toSdkAttachments({ wrapper: payload.attachments[0] }),
          channel: posted.channel,
          file_ids: [...fileIds],
          text: payload.text,
          ts: posted.ts,
        }),
      operation: "slack.chat.update.recipeResponse",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
}
