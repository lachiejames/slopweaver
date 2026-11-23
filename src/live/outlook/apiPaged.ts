/**
 * The Outlook seam's paged message listings: a folder's messages, a search, and one conversation. Each
 * follows only a Graph-hosted paging link (`followable`), and each states which OData combination Graph
 * refuses, because the refusal is the reason for the query's shape. The shared rules are in `apiCore.ts`.
 */
import { safeProviderCall } from "#lib/providerCall.js";
import { err } from "#lib/result.js";
import {
  FULL_SELECT,
  failed,
  followable,
  messagePage,
  type OutlookApi,
  odataQuoted,
  PREFER_READ,
  PROVIDER,
  SUMMARY_SELECT,
  searchQuoted,
  segment,
} from "./apiCore.js";
import type { GraphClient } from "./client.js";
import { OutlookErrors } from "./errors.js";
import { graphCodeIs, rethrowGraph } from "./graphThrow.js";

/** How many messages one conversation page asks for. */
const THREAD_PAGE_SIZE = 50;

/** An unread listing's `$filter`: the sort property first, as Graph requires beside `$orderby`. */
export const UNREAD_NEWEST_FIRST = "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false";

/** The paged methods {@link pagedMethods} supplies. */
type PagedMethods = Pick<OutlookApi, "conversation" | "listMessages" | "searchMessages">;

/**
 * The paged listing methods over one bound Graph client.
 *
 * @param graph the request-scoped client
 * @param scopeId the 429 block's scope for the bound mailbox
 * @returns those methods of {@link OutlookApi}
 */
// max-lines-exempt: one object literal of paged-endpoint arms over one bound client, the same shape as `apiRead.ts`'s `readMethods`; each arm is one `safeProviderCall` that either builds the first page's request or follows the paging link Graph handed back, and the two branches read only beside each other.
export function pagedMethods({ graph, scopeId }: { graph: GraphClient; scopeId: string }): PagedMethods {
  return {
    conversation: async (requested) => {
      const allowed = followable({ start: requested });
      if (allowed.isErr()) {
        return err(allowed.error);
      }
      const start = allowed.value;
      let filter = "(a paging link Graph handed back)";
      if ("first" in start) {
        filter = `conversationId eq ${odataQuoted({ value: start.first.conversationId })}`;
      }
      const result = await safeProviderCall({
        execute: (): Promise<unknown> => {
          // No `$orderby`: Graph refuses it beside a `conversationId` filter; `messages.ts` orders in memory.
          const request =
            "link" in start
              ? graph.api(start.link)
              : graph
                  .api("/me/messages")
                  .select([...FULL_SELECT])
                  .filter(filter)
                  .top(THREAD_PAGE_SIZE);
          return request
            .header("Prefer", PREFER_READ)
            .get()
            .catch((error: unknown) => rethrowGraph({ error }));
        },
        operation: "outlook.messages.thread",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        const refused =
          graphCodeIs({ cause: result.error.cause, code: "InefficientFilter" }) ||
          graphCodeIs({ cause: result.error.cause, code: "ErrorInvalidProperty" });
        return err(refused ? OutlookErrors.inefficientFilter({ filter }) : failed({ error: result.error }));
      }
      return messagePage({ operation: "outlook.messages.thread", value: result.value });
    },
    listMessages: async (requested) => {
      const allowed = followable({ start: requested });
      if (allowed.isErr()) {
        return err(allowed.error);
      }
      const start = allowed.value;
      const result = await safeProviderCall({
        execute: (): Promise<unknown> => {
          if ("link" in start) {
            return graph
              .api(start.link)
              .header("Prefer", PREFER_READ)
              .get()
              .catch((error: unknown) => rethrowGraph({ error }));
          }
          const { folderId, unreadOnly, top } = start.first;
          const request = graph
            .api(`/me/mailFolders/${segment({ id: folderId })}/messages`)
            .select([...SUMMARY_SELECT])
            .top(top);
          // Graph answers InefficientFilter unless every `$orderby` property leads the `$filter`, in order
          // (learn.microsoft.com/graph/api/user-list-messages § "Using filter and orderby in the same query"),
          // so an unread listing restates `receivedDateTime` first with a bound every message meets.
          const ordered = request.orderby("receivedDateTime desc");
          const shaped = unreadOnly ? ordered.filter(UNREAD_NEWEST_FIRST) : ordered;
          return shaped
            .header("Prefer", PREFER_READ)
            .get()
            .catch((error: unknown) => rethrowGraph({ error }));
        },
        operation: "outlook.messages.list",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      return messagePage({ operation: "outlook.messages.list", value: result.value });
    },
    searchMessages: async (requested) => {
      const allowed = followable({ start: requested });
      if (allowed.isErr()) {
        return err(allowed.error);
      }
      const start = allowed.value;
      const result = await safeProviderCall({
        execute: (): Promise<unknown> => {
          // `$search` takes neither `$filter` nor `$orderby` on messages; Graph sorts by sent time, at most
          // 1,000 results (learn.microsoft.com/graph/search-query-parameter § messages).
          const request =
            "link" in start
              ? graph.api(start.link)
              : graph
                  .api(`/me/mailFolders/${segment({ id: start.first.folderId })}/messages`)
                  .select([...SUMMARY_SELECT])
                  .search(searchQuoted({ query: start.first.search }))
                  .top(start.first.top);
          return request
            .header("Prefer", PREFER_READ)
            .get()
            .catch((error: unknown) => rethrowGraph({ error }));
        },
        operation: "outlook.messages.search",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      return messagePage({ operation: "outlook.messages.search", value: result.value });
    },
  };
}
