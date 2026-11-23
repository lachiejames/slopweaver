/**
 * The Slack STREAM write calls — `chat.startStream`/`chat.appendStream`/`chat.stopStream`, split out of
 * `./writeApi.ts` purely to keep that file under `file-size-ratchet`'s 800-code-line cap. This is still the
 * one seam that mutates a workspace: these functions are wired into the SAME `SlackWriteTransport`
 * `writeApi.ts` builds, follow its exact `safeProviderCall`/`orThrow`/`scopeId` pattern, and carry no policy
 * of their own — the decisions about display mode, chunk content and when to stop live in the caller,
 * exactly as `writeApi.ts`'s own header describes for every other method here.
 */
import type { AnyChunk } from "@slack/types";
import type { WebClient } from "@slack/web-api";

import { type IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type {
  SlackStreamClosePayload,
  SlackStreamOpenPayload,
  SlackStreamRecipient,
} from "../../outbound/slack/types.js";
import { optStr } from "./shape.js";
import type { PostedMessage } from "./writeTransport.js";

/**
 * `chat.startStream` — open a streamed message. AT-MOST-ONCE like every other post here: opening a stream
 * creates a message the same way `chat.postMessage` does, and a retried open would double it.
 *
 * `recipient` is passed through only for a channel-surface stream; a DM needs neither `recipient_user_id`
 * nor `recipient_team_id` — measured live against the real workspace, and consistent with the SDK's own
 * types marking both optional.
 *
 * @param client the raw Slack client
 * @param channel the destination channel id
 * @param threadTs the thread to stream into — `chat.startStream` requires one unconditionally
 * @param payload the stream's opening chunks and display mode
 * @param recipient who a channel-surface stream is for; undefined in a DM
 * @param scopeId the shared-429-block key for this token
 * @returns the streamed message's identity, same shape as any other post
 */
export async function startStreamCall({
  client,
  channel,
  threadTs,
  payload,
  recipient,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  threadTs: string;
  payload: SlackStreamOpenPayload;
  recipient: SlackStreamRecipient | undefined;
  scopeId: string;
}): Promise<PostedMessage> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.chat.startStream({
          channel,
          chunks: [...payload.chunks],
          thread_ts: threadTs,
          ...(payload.taskDisplayMode === undefined ? {} : { task_display_mode: payload.taskDisplayMode }),
          ...(recipient === undefined
            ? {}
            : { recipient_team_id: recipient.teamId, recipient_user_id: recipient.userId }),
        }),
      operation: "slack.chat.startStream",
      provider: "slack",
      retryMode: "never",
      scopeId,
    }),
  });
  const postedChannel = optStr({ value: res.channel });
  const ts = optStr({ value: res.ts });
  if (postedChannel === undefined || ts === undefined) {
    throw new Error("slack.chat.startStream returned no channel/ts");
  }
  return { channel: postedChannel, ts };
}

/**
 * Slack platform error codes meaning "this stream is not open" — the stream-lifecycle twin of
 * `writeApi.ts`'s `ALREADY_GONE_CODES`. Measured live: a SECOND `chat.stopStream` on an already-finalized
 * message fails with this code rather than succeeding as a no-op, which contradicts the assumption a first
 * draft of this file made. `chat.appendStream` on a stopped stream fails with the identical code.
 */
const ALREADY_STOPPED_CODES: ReadonlySet<string> = new Set(["message_not_in_streaming_state"]);

/**
 * Whether a failed `chat.stopStream` failed because the stream was ALREADY STOPPED.
 *
 * Same shape and same reason as `writeApi.ts`'s `isAlreadyGone`: the caller's goal is a STATE ("this stream
 * is no longer open"), not an event ("I performed the stop"), so a stream stopped by an earlier call — or by
 * Slack itself — must read as success, not failure.
 *
 * @param error the typed boundary failure from a stop attempt
 * @returns true when the stream is already stopped, so the stop's goal is met
 */
export function isAlreadyStopped({ error }: { error: IngestError }): boolean {
  const cause: unknown = error.cause;
  const data = isRecord(cause) ? cause["data"] : undefined;
  const code = isRecord(data) ? data["error"] : undefined;
  if (typeof code === "string" && ALREADY_STOPPED_CODES.has(code)) {
    return true;
  }
  const direct = error.code;
  return direct !== undefined && ALREADY_STOPPED_CODES.has(direct);
}

/**
 * `chat.appendStream` — append chunks to an open stream. Repeatable in the sense that a `task_update` chunk
 * re-sent under an already-seen `id` updates that card in place rather than duplicating it, so a retry after
 * a lost response is harmless.
 *
 * Also tolerates the stream having been stopped ALREADY: measured live, an append after stop fails with
 * `message_not_in_streaming_state`, the same code a second `chat.stopStream` fails with, and this treats it
 * the same way — as the desired end state, not a failure. An adversarial review found that nothing upstream
 * of `TurnPoster.advanceWorking` prevents it from being called against an already-finalized checklist (the
 * caller has no reliable way to know the stream's exact state), so the safe behaviour here is a silent no-op
 * rather than crashing a turn whose checklist simply has nothing left to advance.
 *
 * @param client the raw Slack client
 * @param posted the stream's identity
 * @param chunks the chunks to append
 * @param scopeId the shared-429-block key for this token
 */
export async function appendStreamCall({
  client,
  posted,
  chunks,
  scopeId,
}: {
  client: WebClient;
  posted: PostedMessage;
  chunks: readonly AnyChunk[];
  scopeId: string;
}): Promise<void> {
  const result = await safeProviderCall({
    execute: () => client.chat.appendStream({ channel: posted.channel, chunks: [...chunks], ts: posted.ts }),
    operation: "slack.chat.appendStream",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (result.isOk() || isAlreadyStopped({ error: result.error })) {
    return;
  }
  orThrow({ result });
}

/**
 * `chat.stopStream` — finalize a stream. Reports whether the stream is STOPPED — which includes "it already
 * was", the same never-throws contract `writeApi.ts`'s `deleteMessageCall` follows, for the same reason: a
 * caller that ensures a stream is closed before editing or deleting the now-ordinary message must not have
 * that made fatal by a second, harmless stop.
 *
 * `payload.metadata` is the ONLY point a streamed message can carry ownership metadata — see
 * `SlackStreamOpenPayload`'s own doc for why `chat.startStream` cannot.
 *
 * @param client the raw Slack client
 * @param posted the stream's identity
 * @param payload optional finalizing chunks, blocks and metadata
 * @param scopeId the shared-429-block key for this token
 * @returns true once the stream is stopped, including when it already was
 */
export async function stopStreamCall({
  client,
  posted,
  payload,
  scopeId,
}: {
  client: WebClient;
  posted: PostedMessage;
  payload: SlackStreamClosePayload | undefined;
  scopeId: string;
}): Promise<boolean> {
  const result = await safeProviderCall({
    execute: () =>
      client.chat.stopStream({
        channel: posted.channel,
        ts: posted.ts,
        ...(payload?.chunks === undefined ? {} : { chunks: [...payload.chunks] }),
        ...(payload?.blocks === undefined ? {} : { blocks: [...payload.blocks] }),
        ...(payload?.metadata === undefined ? {} : { metadata: payload.metadata }),
      }),
    operation: "slack.chat.stopStream",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (result.isOk()) {
    return true;
  }
  return isAlreadyStopped({ error: result.error });
}
