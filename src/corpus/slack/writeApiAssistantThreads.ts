/**
 * The two `assistant.threads.*` writes — the agent thread's title and its native thinking indicator — cut
 * out of `writeApi.ts` because they share one shape nothing else there has: `WebClient` throws on
 * `ok:false` and buries the body (including a `missing_scope` refusal's `needed` field) on `error.data`, so
 * each catches INSIDE `execute`, hands the paced door a normal resolution, and lets the outbound reader
 * turn the real body into a typed outcome. Same one-raw-call-per-function discipline as the parent; the
 * transport in `writeApi.ts` is still the only place either is wired.
 */
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import {
  type AssistantStatusArgs,
  type AssistantStatusOutcome,
  readAssistantStatusResponse,
} from "../../outbound/assistant/status.js";
import {
  type AssistantTitleArgs,
  type AssistantTitleOutcome,
  readAssistantTitleResponse,
} from "../../outbound/assistant/title.js";

/**
 * The `assistant.threads.setTitle` method as {@link setThreadTitleCall} reaches it on its client.
 *
 * The client parameter is typed as this one method rather than as `WebClient`, which satisfies it unchanged,
 * so a test can stand in for Slack without a socket. The call itself still sits inside the paced door.
 * @internal
 */
export type SetThreadTitleRequest = (args: AssistantTitleArgs) => Promise<unknown>;

/**
 * The `assistant.threads.setStatus` method as {@link setAssistantStatusCall} reaches it on its client: the
 * wire object with every optional key either present with a value or omitted, never holding `undefined`.
 * @internal
 */
export type SetAssistantStatusRequest = (args: {
  readonly channel_id: string;
  readonly status: string;
  readonly thread_ts: string;
  readonly loading_messages?: string[];
  readonly username?: string;
  readonly icon_emoji?: string;
}) => Promise<unknown>;

/**
 * `assistant.threads.setTitle` — the agent thread's name.
 *
 * Two things here are deliberate and neither is obvious.
 *
 * **The API-level refusal is unwrapped into a RESULT, not a throw.** `WebClient` raises on `ok:false` and
 * hangs the body off `error.data`, which is where `missing_scope`'s `needed` field lives. Letting that throw
 * would either lose the field or force a catch at every call site; catching it HERE, inside `execute`, means
 * the paced door sees a normal resolution for something Slack answered normally, and `readAssistantTitleResponse`
 * gets the real body. A genuine transport failure (no `data` to read) is rethrown, so the door still maps and
 * retries it as the network error it is.
 *
 * **`retryMode: "transient"`.** Setting a title is idempotent — the same call twice leaves the same title —
 * so unlike a post there is nothing a repeat can duplicate.
 *
 * @returns the typed outcome the reader built from Slack's own body
 */
export async function setThreadTitleCall({
  client,
  args,
  scopeId,
}: {
  client: { readonly assistant: { readonly threads: { readonly setTitle: SetThreadTitleRequest } } };
  args: AssistantTitleArgs;
  scopeId: string;
}): Promise<AssistantTitleOutcome> {
  const body = orThrow({
    result: await safeProviderCall<unknown>({
      execute: async () => {
        try {
          return await client.assistant.threads.setTitle(args);
        } catch (error) {
          const data = isRecord(error) ? error["data"] : undefined;
          if (isRecord(data)) {
            // Slack answered; it just said no. That is a body to read, not a failure to retry.
            return data;
          }
          throw error;
        }
      },
      operation: "slack.assistant.threads.setTitle",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  return readAssistantTitleResponse({ body });
}

/**
 * `assistant.threads.setStatus` — the native thinking indicator.
 *
 * Same unwrap-then-read shape as {@link setThreadTitleCall}, and for the same reason: `WebClient` throws on
 * `ok:false` and buries the body — including a `missing_scope` refusal's `needed` field — on `error.data`.
 * Catching it here, inside `execute`, means the paced door sees a normal resolution for something Slack
 * answered normally, and `readAssistantStatusResponse` gets the real body. A genuine transport failure (no
 * `data` to read) is rethrown, so the door still maps and retries it as the network error it is.
 *
 * `retryMode: "transient"`: setting a status (or clearing one with an empty string) is idempotent — the
 * same call twice leaves the same status — so unlike a post there is nothing a repeat can duplicate.
 *
 * @returns the typed outcome the reader built from Slack's own body
 */
export async function setAssistantStatusCall({
  client,
  args,
  scopeId,
}: {
  client: { readonly assistant: { readonly threads: { readonly setStatus: SetAssistantStatusRequest } } };
  args: AssistantStatusArgs;
  scopeId: string;
}): Promise<AssistantStatusOutcome> {
  const body = orThrow({
    result: await safeProviderCall<unknown>({
      execute: async () => {
        try {
          // Rebuilt as a fresh object rather than passed straight through: `AssistantStatusArgs`'s optional
          // fields are typed `X | undefined` (this repo's `exactOptionalPropertyTypes` convention), which the
          // SDK's own optional fields refuse — an omitted key and a key holding `undefined` are different
          // things under that flag. The conditional spread is the same pattern every other optional wire
          // field in this file uses.
          return await client.assistant.threads.setStatus({
            channel_id: args.channel_id,
            status: args.status,
            thread_ts: args.thread_ts,
            ...(args.loading_messages === undefined ? {} : { loading_messages: [...args.loading_messages] }),
            ...(args.username === undefined ? {} : { username: args.username }),
            ...(args.icon_emoji === undefined ? {} : { icon_emoji: args.icon_emoji }),
          });
        } catch (error) {
          const data = isRecord(error) ? error["data"] : undefined;
          if (isRecord(data)) {
            // Slack answered; it just said no. That is a body to read, not a failure to retry.
            return data;
          }
          throw error;
        }
      },
      operation: "slack.assistant.threads.setStatus",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  return readAssistantStatusResponse({ body });
}
