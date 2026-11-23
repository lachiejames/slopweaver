/**
 * The Outlook seam's single-object reads: identity, one message, one draft, folders, categories and
 * attachments. Each is a Graph call inside `safeProviderCall`, `transient`, through its boundary; the attachment
 * and category lists follow every page through {@link everyPage}, because both are matched by name afterwards.
 * The shared rules are in `apiCore.ts`'s header.
 */
import { safeProviderCall } from "#lib/providerCall.js";
import { err, ok, type Result } from "#lib/result.js";
import {
  checked,
  DRAFT_SELECT,
  FOLDER_SELECT,
  FULL_SELECT,
  failed,
  followable,
  type OutlookApi,
  type Page,
  PREFER_IMMUTABLE,
  PREFER_READ,
  PROVIDER,
  segment,
} from "./apiCore.js";
import { ARRAYBUFFER_RESPONSE, type GraphClient } from "./client.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import { rethrowGraph } from "./graphThrow.js";
import { ATTACHMENT_PAGE, CATEGORY_PAGE, GET_ME, MAIL_FOLDER, MAIL_FOLDER_PAGE, MESSAGE } from "./graphWire.js";

/**
 * How many pages a whole-collection read follows. A message's attachments and the master category list are
 * each matched by name afterwards, so an answer drawn from part of either would be a confident wrong "no match".
 */
export const MAX_COLLECTION_PAGES = 20;

/**
 * Read every page of a collection, following only Graph-hosted links, and refuse rather than answer from a part.
 *
 * @param fetchPage reads the first page (no link) or the page a link names
 * @param operation the call's label, named in the refusal
 * @returns every item, or the first failure, or the ceiling's refusal
 */
export async function everyPage<T>({
  fetchPage,
  operation,
}: {
  fetchPage: (args: { link: string | undefined }) => Promise<Result<Page<T>, OutlookError>>;
  operation: string;
}): Promise<Result<readonly T[], OutlookError>> {
  const items: T[] = [];
  // `link` is a local string read off a parsed page, so the value checked is the value requested.
  let link: string | undefined;
  for (let pages = 0; pages < MAX_COLLECTION_PAGES; pages += 1) {
    if (link !== undefined) {
      const allowed = followable({ start: { link } });
      if (allowed.isErr()) {
        return err(allowed.error);
      }
    }
    const page = await fetchPage({ link });
    if (page.isErr()) {
      return err(page.error);
    }
    items.push(...page.value.items);
    if (page.value.nextLink === undefined) {
      return ok(items);
    }
    link = page.value.nextLink;
  }
  return err(OutlookErrors.collectionIncomplete({ operation, pages: MAX_COLLECTION_PAGES }));
}

/** The top-level folder listing, or one folder's children. */
function folderListPath({ parentId }: { parentId: string | undefined }): string {
  if (parentId === undefined) {
    return "/me/mailFolders";
  }
  return `/me/mailFolders/${segment({ id: parentId })}/childFolders`;
}

/** The read methods {@link readMethods} supplies. */
type ReadMethods = Pick<
  OutlookApi,
  | "attachmentBytes"
  | "getDraft"
  | "getFolder"
  | "getMessage"
  | "listAttachments"
  | "listCategories"
  | "listFolders"
  | "me"
>;

/**
 * The single-object read methods over one bound Graph client.
 *
 * @param graph the request-scoped client
 * @param scopeId the 429 block's scope for the bound mailbox
 * @returns those methods of {@link OutlookApi}
 */
// max-lines-exempt: one object literal of endpoint arms over one bound client, the shape `vantaPolicyEditor.ts`'s transport factory takes; each arm is one `safeProviderCall` and one boundary check, and splitting them out would re-thread `graph` and `scopeId` through every arm without removing a decision.
export function readMethods({ graph, scopeId }: { graph: GraphClient; scopeId: string }): ReadMethods {
  return {
    attachmentBytes: async ({ messageId, attachmentId }) => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api(`/me/messages/${segment({ id: messageId })}/attachments/${segment({ id: attachmentId })}/$value`)
            .header("Prefer", PREFER_IMMUTABLE)
            .responseType(ARRAYBUFFER_RESPONSE)
            .get()
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.attachments.get",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      if (!(result.value instanceof ArrayBuffer)) {
        return err(OutlookErrors.responseFieldMissing({ field: "(bytes)", operation: "outlook.attachments.get" }));
      }
      return ok(new Uint8Array(result.value));
    },
    getDraft: async ({ id }) => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api(`/me/messages/${segment({ id })}`)
            .select([...DRAFT_SELECT])
            .header("Prefer", PREFER_READ)
            .get()
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.drafts.get",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      return checked({ boundary: MESSAGE, operation: "outlook.drafts.get", value: result.value });
    },
    getFolder: async ({ reference }) => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api(`/me/mailFolders/${segment({ id: reference })}`)
            .select([...FOLDER_SELECT])
            .header("Prefer", PREFER_IMMUTABLE)
            .get()
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.folders.get",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        if (result.error.status === 404) {
          return err(OutlookErrors.referenceUnresolved({ candidates: [], kind: "folder", reference }));
        }
        return err(failed({ error: result.error }));
      }
      return checked({ boundary: MAIL_FOLDER, operation: "outlook.folders.get", value: result.value });
    },
    getMessage: async ({ id }) => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api(`/me/messages/${segment({ id })}`)
            .select([...FULL_SELECT])
            .header("Prefer", PREFER_READ)
            .get()
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.messages.get",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      return checked({ boundary: MESSAGE, operation: "outlook.messages.get", value: result.value });
    },
    listAttachments: ({ messageId }) =>
      everyPage({
        fetchPage: async ({ link }) => {
          const result = await safeProviderCall({
            execute: (): Promise<unknown> => {
              const request =
                link === undefined
                  ? graph
                      .api(`/me/messages/${segment({ id: messageId })}/attachments`)
                      .select(["id", "name", "contentType", "size", "isInline", "lastModifiedDateTime"])
                  : graph.api(link);
              return request
                .header("Prefer", PREFER_IMMUTABLE)
                .get()
                .catch((error: unknown) => rethrowGraph({ error }));
            },
            operation: "outlook.attachments.list",
            provider: PROVIDER,
            retryMode: "transient",
            scopeId,
          });
          if (result.isErr()) {
            return err(failed({ error: result.error }));
          }
          return checked({ boundary: ATTACHMENT_PAGE, operation: "outlook.attachments.list", value: result.value }).map(
            (page) => ({ items: page.value, nextLink: page["@odata.nextLink"] }),
          );
        },
        operation: "outlook.attachments.list",
      }),
    listCategories: () =>
      everyPage({
        fetchPage: async ({ link }) => {
          const result = await safeProviderCall({
            execute: (): Promise<unknown> => {
              const request = link === undefined ? graph.api("/me/outlook/masterCategories") : graph.api(link);
              return request
                .header("Prefer", PREFER_IMMUTABLE)
                .get()
                .catch((error: unknown) => rethrowGraph({ error }));
            },
            operation: "outlook.categories.list",
            provider: PROVIDER,
            retryMode: "transient",
            scopeId,
          });
          if (result.isErr()) {
            return err(failed({ error: result.error }));
          }
          return checked({ boundary: CATEGORY_PAGE, operation: "outlook.categories.list", value: result.value }).map(
            (page) => ({ items: page.value, nextLink: page["@odata.nextLink"] }),
          );
        },
        operation: "outlook.categories.list",
      }),
    listFolders: async (requested) => {
      const allowed = followable({ start: requested });
      if (allowed.isErr()) {
        return err(allowed.error);
      }
      const start = allowed.value;
      const result = await safeProviderCall({
        execute: (): Promise<unknown> => {
          const request =
            "link" in start
              ? graph.api(start.link)
              : graph
                  .api(folderListPath({ parentId: start.first.parentId }))
                  .select([...FOLDER_SELECT])
                  .top(100);
          return request
            .header("Prefer", PREFER_IMMUTABLE)
            .get()
            .catch((error: unknown) => rethrowGraph({ error }));
        },
        operation: "outlook.folders.list",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      return checked({ boundary: MAIL_FOLDER_PAGE, operation: "outlook.folders.list", value: result.value }).map(
        (page) => ({ items: page.value, nextLink: page["@odata.nextLink"] }),
      );
    },
    me: async () => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api("/me")
            .select(["id", "displayName", "mail", "userPrincipalName"])
            .header("Prefer", PREFER_IMMUTABLE)
            .get()
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.me.get",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      return checked({ boundary: GET_ME, operation: "outlook.me.get", value: result.value }).map((me) => ({
        id: me.id,
        mail: me.mail,
        userPrincipalName: me.userPrincipalName,
      }));
    },
  };
}
