/**
 * The `fetch` the ONE Notion write-lane client is built with (`./writeApi.ts`'s `makeNotionWriteSeam`), and the
 * only place a request from it can be stopped after the SDK has finished building it.
 *
 * ## Why the transport, and not the seam's methods
 *
 * By the time the SDK calls `fetch` it has serialised a JSON body or built its multipart `FormData`, so what is
 * judged here is what is sent. Every route the client reaches crosses it — page, block and upload mutations, the
 * `blocks.delete` the attach pass makes, and any endpoint added later — so a new write is guarded by construction
 * rather than by somebody remembering to add a call. Its two refusals (`../../outbound/notion/writePrivacy.ts`'s
 * `refuseNotionWrite`: the dead Datadog host first, then the outbound privacy check) run before the underlying
 * `fetch`; one of the five reads goes straight through and never loads the policy.
 *
 * ## The types are the SDK's own
 *
 * {@link NotionFetch} is read off the `Client` constructor, so this module never declares a second fetch protocol.
 * {@link globalNotionFetch} adapts the platform `fetch` to it field by field rather than by a cast, which is also
 * why it reads the global at call time: a test harness that replaces `globalThis.fetch` is still the one called.
 */
import type { Client } from "@notionhq/client";

import { type NotionWritePrivacy, refuseNotionWrite } from "../../outbound/notion/writePrivacy.js";
import { notionWriteRequest } from "../../outbound/notion/writePrivacyPayload.js";

/** The options the Notion SDK's `Client` takes. */
type NotionClientOptions = NonNullable<ConstructorParameters<typeof Client>[0]>;

/** The `fetch` the Notion SDK calls, exactly as its constructor declares it. */
export type NotionFetch = NonNullable<NotionClientOptions["fetch"]>;

/** The response shape the SDK reads back from a {@link NotionFetch}. */
type NotionResponse = Awaited<ReturnType<NotionFetch>>;

/** The streamed body the SDK reads for a streaming endpoint. */
type NotionResponseBody = NonNullable<NotionResponse["body"]>;

/**
 * A platform response body as the SDK's reader shape, or null when the response has none.
 *
 * @param body the platform response's own stream
 * @returns the same stream behind the reader the SDK calls
 */
function readerBody({ body }: { body: Response["body"] }): NotionResponseBody | null {
  if (body === null) {
    return null;
  }
  return {
    getReader: () => {
      const reader = body.getReader();
      return {
        cancel: () => reader.cancel(),
        read: async () => {
          const chunk = await reader.read();
          if (chunk.done) {
            return { done: true };
          }
          return { done: false, value: chunk.value };
        },
        releaseLock: () => {
          reader.releaseLock();
        },
      };
    },
  };
}

/**
 * The platform `fetch` in the SDK's own shape — what the client sends through once a request has passed both
 * refusals. Looked up on `globalThis` at each call.
 *
 * @returns the platform response's status, headers, text and streamed body, in the shape the SDK reads
 */
export const globalNotionFetch: NotionFetch = async (url, init) => {
  const response = await globalThis.fetch(url, init);
  return {
    body: readerBody({ body: response.body }),
    headers: response.headers,
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
};

/**
 * Wrap a `fetch` so every request that is not one of the write lane's five reads is refused before it is sent when
 * it carries a dead Datadog console host or fails the outbound privacy check.
 *
 * @param fetch the underlying transport — {@link globalNotionFetch} in production, a counting function in a test
 * @param privacy the capability built from the verb's own home, its policy loaded afresh on every write
 * @returns the `fetch` the write-lane client is constructed with
 */
export function guardedNotionFetch({
  fetch,
  privacy,
}: {
  fetch: NotionFetch;
  privacy: NotionWritePrivacy;
}): NotionFetch {
  return async (url, init) => {
    const request = await notionWriteRequest({ body: init?.body, method: init?.method, url });
    if (request !== undefined) {
      await refuseNotionWrite({ privacy, request });
    }
    return fetch(url, init);
  };
}
