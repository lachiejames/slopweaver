/**
 * The Outlook seam's message delta: one folder's changes, page by page, for the corpus ingest
 * (`src/corpus/outlook/`). Microsoft documents delta as folder-scoped — an initial round that enumerates the
 * folder, `@odata.nextLink` pages, then a final `@odata.deltaLink` the next round resumes from
 * (learn.microsoft.com/graph/delta-query-messages). Its result order is not guaranteed, so nothing here
 * assumes newest first.
 *
 * The `Prefer` header goes on EVERY request, the continuation links included: the immutable-id preference is
 * what keeps a message's id stable across a move between folders, and a page read without it would answer a
 * different id for the same message. The page size rides the same header (`odata.maxpagesize`), which is
 * Microsoft's documented way to size a delta page.
 */
import type { IngestError } from "#lib/ingestError.js";
import { safeProviderCall } from "#lib/providerCall.js";
import { err, ok, type Result } from "#lib/result.js";
import {
  checked,
  FULL_SELECT,
  failed,
  followable,
  type MessageDeltaPage,
  type OutlookApi,
  PREFER_READ,
  PROVIDER,
  segment,
} from "./apiCore.js";
import type { GraphClient } from "./client.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import { graphCodeIs, rethrowGraph } from "./graphThrow.js";
import { MESSAGE_DELTA_PAGE } from "./graphWire.js";

/** The largest page a delta request may ask for; a mail body rides each item, so a page stays small. */
export const MAX_DELTA_PAGE_SIZE = 100;

/** The label every delta call is paced and named under. */
const OPERATION = "outlook.messages.delta";

/**
 * Whether a failed delta call means Graph no longer holds the round's state: HTTP 410, or Graph's
 * `syncStateNotFound` (learn.microsoft.com/graph/delta-query-overview § "Synchronization reset"). Pure.
 *
 * @param error the boundary failure the call produced
 * @returns true when the folder must be read again from an initial round
 */
function isDeltaStateExpired({ error }: { error: IngestError }): boolean {
  return (
    error.status === 410 ||
    graphCodeIs({ cause: error.cause, code: "syncStateNotFound" }) ||
    graphCodeIs({ cause: error.cause, code: "SyncStateNotFound" })
  );
}

/**
 * Read one validated delta page, refusing a page that carries both links or neither: the round's state is
 * one or the other, and a page claiming both cannot say which to keep.
 *
 * @param value the raw page Graph answered
 * @returns the page, or the drift
 */
function deltaPage({ value }: { value: unknown }): Result<MessageDeltaPage, OutlookError> {
  const parsed = checked({ boundary: MESSAGE_DELTA_PAGE, operation: OPERATION, value });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const nextLink = parsed.value["@odata.nextLink"];
  const deltaLink = parsed.value["@odata.deltaLink"];
  if ((nextLink === undefined) === (deltaLink === undefined)) {
    return err(
      OutlookErrors.responseFieldMissing({
        field: "exactly one of @odata.nextLink and @odata.deltaLink",
        operation: OPERATION,
      }),
    );
  }
  return ok({ deltaLink, items: parsed.value.value, nextLink });
}

/**
 * The delta method over one bound Graph client.
 *
 * @param graph the request-scoped client
 * @param scopeId the 429 block's scope for the bound mailbox
 * @returns that method of {@link OutlookApi}
 */
export function deltaMethods({
  graph,
  scopeId,
}: {
  graph: GraphClient;
  scopeId: string;
}): Pick<OutlookApi, "messageDelta"> {
  return {
    messageDelta: async ({ start: requested, maxPageSize }) => {
      const allowed = followable({ start: requested });
      if (allowed.isErr()) {
        return err(allowed.error);
      }
      const start = allowed.value;
      const size = Math.min(Math.max(1, Math.floor(maxPageSize)), MAX_DELTA_PAGE_SIZE);
      const prefer = `${PREFER_READ}, odata.maxpagesize=${String(size)}`;
      const result = await safeProviderCall({
        execute: (): Promise<unknown> => {
          const request =
            "link" in start
              ? graph.api(start.link)
              : graph
                  .api(`/me/mailFolders/${segment({ id: start.first.folderId })}/messages/delta`)
                  .select([...FULL_SELECT]);
          return request
            .header("Prefer", prefer)
            .get()
            .catch((error: unknown) => rethrowGraph({ error }));
        },
        // Spelled inline, not as `OPERATION`, so the `operation-labels` gate can check it against the class map.
        operation: "outlook.messages.delta",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        return err(
          isDeltaStateExpired({ error: result.error })
            ? OutlookErrors.deltaStateExpired({ cause: result.error })
            : failed({ error: result.error }),
        );
      }
      return deltaPage({ value: result.value });
    },
  };
}
