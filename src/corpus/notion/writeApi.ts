/**
 * The Notion WRITE lane — the only place in this repo that mutates a Notion workspace.
 *
 * ## It writes MARKDOWN, not blocks, and that is measured rather than assumed
 *
 * Notion's own API converts an enhanced-Markdown document into blocks: `pages.create` accepts a `markdown`
 * body, `pages.updateMarkdown` replaces a page's whole content in place, and `pages.retrieveMarkdown` reads
 * it back in a canonical form. A bespoke markdown→block converter was written first and then deleted: it
 * duplicated a first-party provider capability and would have drifted against Notion's own format forever.
 *
 * What was measured live before committing to it, against a real page:
 *
 *  - every construct the golden proposal shape uses survives the round trip — blockquote, headings, pipe
 *    tables with a header row, fenced `mermaid` code, `<details>`/`<summary>` toggles, bulleted lists,
 *    `<table_of_contents color="gray"/>`, external images, and links anchored over their own words;
 *  - the canonical read-back is STABLE: the same source markdown re-sent produces a byte-identical
 *    canonical string, and feeding that canonical string back produces the same one again. The update-safety
 *    digest depends on exactly that property;
 *  - Notion's canonical form is NOT the input form (a pipe table comes back as `<table>`, blank lines are
 *    dropped), so the digest is taken over the canonical READ-BACK and never over what was sent.
 *
 * ## The API version is pinned here and nowhere else
 *
 * The SDK defaults to an older API version; the markdown endpoints need the one `NOTION_MARKDOWN_API_VERSION` pins. That version is
 * set on THIS client only. Moving the ingest readers onto a new API version as a side effect of adding a
 * write path would be a silent change to every corpus projection.
 *
 * ## Retry posture
 *
 * A `pages.create` may NOT be retried: Notion assigns the page id, so a retried create that already landed
 * produces a SECOND page nothing can tell apart from the first. Every mutation therefore uses
 * `retryMode: "never"`, and the caller's ledger — not a retry — is what makes a lost response recoverable.
 * Read-backs keep the transient retry, since repeating them cannot change anything.
 *
 * Every call, mutation included, is raced against the shared Notion deadline (see `./callDeadline.ts`) that
 * the read lanes already use, because the observed hang was a stuck SOCKET rather than a slow endpoint and
 * nothing about a write makes it immune. A mutation that hits the deadline is reported as INDETERMINATE and
 * never retried, which is the honest reading: it may well have landed.
 */
import { Client, type CreatePageParameters } from "@notionhq/client";

import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type NotionWritePrivacy, notionWritePrivacy } from "../../outbound/notion/writePrivacy.js";
import { type GatedCall, makeNotionGatedCall } from "./callDeadline.js";
import { globalNotionFetch, guardedNotionFetch, type NotionFetch } from "./guardedFetch.js";
import { type NotionApiError, type NotionWriteError, NotionWriteErrors } from "./writeErrors.js";

/** The API version that serves the markdown create/retrieve/update endpoints. */
const NOTION_MARKDOWN_API_VERSION = "2026-03-11";

/**
 * One page as this lane needs it back.
 *
 * `lastEditedBy` is what makes a Notion update safe in a way the Linear lane cannot manage. A Linear personal
 * API key attributes every write to the HUMAN who owns it, so `linear issue update` has to establish
 * authorship from a local ledger alone. A Notion internal integration has its own bot user, so the provider
 * itself will say whether anyone but the bot has touched the page since it was written.
 */
export interface WrittenPage {
  readonly id: string;
  readonly url: string;
  readonly archived: boolean;
  /** The user id of whoever last edited the page — the bot's own id iff nobody else has touched it. */
  readonly lastEditedBy: string | undefined;
  readonly lastEditedTime: string | undefined;
  /**
   * Where the page currently hangs, as Notion's own `parent` object reports it.
   *
   * `kind` is Notion's discriminator verbatim (`page_id`, `data_source_id`, `database_id`, `block_id`,
   * `workspace`) and `id` is the referenced object, absent for a workspace-parented page which references
   * nothing. Read rather than assumed, because `move` has no other way to report that a page was ALREADY
   * where it was being sent — and a move that reports success without having moved anything is the failure
   * this field exists to make impossible.
   */
  readonly parent: { readonly kind: string; readonly id: string | undefined } | undefined;
}

/**
 * A page read back as canonical markdown, WITH the two completeness flags Notion reports.
 *
 * `truncated` and `unknownBlockIds` are not advisory. A digest taken over a partial read would compare equal
 * to nothing and unequal to everything, so a caller that ignores them turns update-safety into a coin flip.
 */
export interface CanonicalMarkdown {
  readonly markdown: string;
  readonly truncated: boolean;
  readonly unknownBlockIds: readonly string[];
}

/** The mutating and read-back seams one Notion page write needs. */
export interface NotionWriteApi {
  createPage(args: {
    parentPageId: string;
    title: string;
    icon: string | undefined;
    markdown: string;
  }): Promise<Result<WrittenPage, NotionApiError>>;
  replaceMarkdown(args: { pageId: string; markdown: string }): Promise<Result<undefined, NotionApiError>>;
  retrieveMarkdown(args: { pageId: string }): Promise<Result<CanonicalMarkdown, NotionApiError>>;
  retrievePage(args: { pageId: string }): Promise<Result<WrittenPage | undefined, NotionApiError>>;
  updatePageHeader(args: {
    pageId: string;
    title: string | undefined;
    icon: string | undefined;
  }): Promise<Result<undefined, NotionApiError>>;
  /**
   * Move a page to Notion's trash, which is what "delete" means through the API.
   *
   * Recoverable rather than destructive — Notion keeps a trashed page for thirty days and its id and URL
   * survive — which is why this is `archive` and not `delete`. Nothing here can permanently remove a page,
   * and that is the right ceiling for a door verb.
   */
  archivePage(args: { pageId: string }): Promise<Result<undefined, NotionApiError>>;
  /**
   * Re-parent a page under another page, keeping its id, its URL and every byte of its content.
   *
   * A move is the one page mutation here that touches no content at all, and that is why it is a separate
   * method rather than a field on `updatePageHeader`: Notion serves it from its own `POST /v1/pages/{id}/move`
   * endpoint, and folding it into the property update would have sent a `parent` the update endpoint does
   * not accept. NEVER retried, for the same reason every mutation here is not — a move whose response is
   * lost is settled by reading the page's parent back, not by sending it again.
   */
  movePage(args: { pageId: string; parentPageId: string }): Promise<Result<undefined, NotionApiError>>;
  /** The integration's own bot user id, so an update can ask the provider who last touched the page. */
  botUserId(): Promise<Result<string, NotionApiError>>;
}

/** The string at `field`, or undefined when it is absent or not a string. */
function stringField({
  record,
  field,
}: {
  record: Readonly<Record<string, unknown>>;
  field: string;
}): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Notion's `parent` object, reduced to the discriminator and the id it names.
 *
 * The id lives under a key named for the kind (`page_id`, `data_source_id`, …), so the kind is read first
 * and used to look the id up. A `workspace` parent carries `workspace: true` and no id at all, which is why
 * the id is optional rather than defaulted to an empty string a caller could mistake for a real address.
 *
 * @param value the raw `parent` field off a page response
 * @returns the parent, or undefined when the response carried none
 */
function parentOf({
  value,
}: {
  value: unknown;
}): { readonly kind: string; readonly id: string | undefined } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = stringField({ field: "type", record: value });
  return kind === undefined ? undefined : { id: stringField({ field: kind, record: value }), kind };
}

/**
 * Narrow the SDK's loosely-typed page response into {@link WrittenPage}.
 *
 * Narrowed with `isRecord` rather than a type assertion. The SDK's create response is a UNION whose partial
 * arm carries only `id`, so asserting the full shape would compile while describing a payload the provider
 * is entitled not to send.
 *
 * @param value the raw SDK page response
 * @returns the page, or the reason the response cannot confirm a write
 */
export function writtenPageOf({ value }: { value: unknown }): Result<WrittenPage, NotionWriteError> {
  if (!isRecord(value)) {
    return err(NotionWriteErrors.notAPage());
  }
  const id = stringField({ field: "id", record: value });
  const url = stringField({ field: "url", record: value });
  if (id === undefined || url === undefined) {
    return err(NotionWriteErrors.pageUnidentified());
  }
  const editedBy = value["last_edited_by"];
  return ok({
    archived: value["archived"] === true || value["in_trash"] === true,
    id,
    lastEditedBy: isRecord(editedBy) ? stringField({ field: "id", record: editedBy }) : undefined,
    lastEditedTime: stringField({ field: "last_edited_time", record: value }),
    parent: parentOf({ value: value["parent"] }),
    url,
  });
}

/**
 * The page title property Notion expects, built from one plain string.
 *
 * The return type is the SDK's own `CreatePageParameters["properties"]` rather than a hand-written shape, so
 * the compiler checks this against the provider contract instead of a cast waving it through.
 *
 * @param title the plain-text page title
 * @returns the `properties` payload carrying it
 */
function titleProperty({ title }: { title: string }): NonNullable<CreatePageParameters["properties"]> {
  return { title: { title: [{ text: { content: title }, type: "text" }] } };
}

/** The emoji icon property, or nothing when the caller supplied no icon. */
function iconProperty({ icon }: { icon: string | undefined }): Readonly<Record<string, unknown>> {
  return icon === undefined ? {} : { icon: { emoji: icon, type: "emoji" } };
}

/**
 * The rate-gated, deadline-raced, safe-wrapped call shape every method below shares.
 *
 * Exported so the image lane (`./mediaApi.ts`) can be built on the SAME client, scheduler and 429 scope
 * rather than constructing a second one. Notion's 3 req/s allowance is per-INTEGRATION, so a page write and
 * the image pass that follows it must pace as one caller — and the markdown API version is pinned on this
 * client alone, which is the other reason there is exactly one construction site.
 */
export interface NotionWriteSeam {
  readonly client: Client;
  readonly call: GatedCall;
  readonly scopeId: string;
  /** The policy every write this client sends is judged under, built from the verb's own home. */
  readonly privacy: NotionWritePrivacy;
}

/** The local alias the methods below read with. */
type Seam = NotionWriteSeam;

/** `pages.create` with a markdown body. NEVER retried: Notion assigns the id, so a retry makes a second page. */
function createPageMethod({ client, call, scopeId }: Seam): NotionWriteApi["createPage"] {
  return async ({ parentPageId, title, icon, markdown }) => {
    const called = await safeProviderCall({
      execute: () =>
        call(() =>
          client.pages.create({
            markdown,
            parent: { page_id: parentPageId, type: "page_id" },
            properties: titleProperty({ title }),
            ...iconProperty({ icon }),
          }),
        ),
      operation: "notion.pages.create",
      provider: "notion",
      retryMode: "never",
      scopeId,
    });
    return called.isErr()
      ? err(called.error)
      : writtenPageOf({ value: called.value }).mapErr((error): NotionApiError => error);
  };
}

/** `pages.updateMarkdown` with `replace_content`, which keeps the page id and URL. NEVER retried. */
function replaceMarkdownMethod({ client, call, scopeId }: Seam): NotionWriteApi["replaceMarkdown"] {
  return async ({ pageId, markdown }) => {
    const called = await safeProviderCall({
      execute: () =>
        call(() =>
          client.pages.updateMarkdown({
            page_id: pageId,
            // `allow_deleting_content` is REQUIRED for a replace that removes anything, and a replace always
            // does. Notion refuses the call without it rather than silently keeping the old body.
            replace_content: { allow_deleting_content: true, new_str: markdown },
            type: "replace_content",
          }),
        ),
      operation: "notion.pages.updateMarkdown",
      provider: "notion",
      retryMode: "never",
      scopeId,
    });
    return called.isErr() ? err(called.error) : ok(undefined);
  };
}

/** `pages.retrieveMarkdown` — the canonical read-back the update-safety digest is taken over. */
function retrieveMarkdownMethod({ client, call, scopeId }: Seam): NotionWriteApi["retrieveMarkdown"] {
  return async ({ pageId }) => {
    const called = await safeProviderCall({
      execute: () => call(() => client.pages.retrieveMarkdown({ page_id: pageId })),
      operation: "notion.pages.retrieveMarkdown",
      provider: "notion",
      retryMode: "transient",
      scopeId,
    });
    return called.isErr()
      ? err(called.error)
      : ok({
          markdown: called.value.markdown,
          truncated: called.value.truncated,
          unknownBlockIds: called.value.unknown_block_ids,
        });
  };
}

/** `pages.retrieve` — used for the URL and, crucially, for `last_edited_by`. */
function retrievePageMethod({ client, call, scopeId }: Seam): NotionWriteApi["retrievePage"] {
  return async ({ pageId }) => {
    const called = await safeProviderCall({
      execute: () => call(() => client.pages.retrieve({ page_id: pageId })),
      operation: "notion.pages.retrieve.write",
      provider: "notion",
      retryMode: "transient",
      scopeId,
    });
    if (called.isErr()) {
      // A read-back that 404s is the "it is not there" answer, not a transport failure to report as one.
      return /could not be found|object_not_found/i.test(called.error.message) ? ok(undefined) : err(called.error);
    }
    const page = writtenPageOf({ value: called.value });
    return page.isErr() ? err(page.error) : ok(page.value);
  };
}

/** `pages.update` for the title and icon only — the body never travels this way. NEVER retried. */
function updateHeaderMethod({ client, call, scopeId }: Seam): NotionWriteApi["updatePageHeader"] {
  return async ({ pageId, title, icon }) => {
    const called = await safeProviderCall({
      execute: () =>
        call(() =>
          client.pages.update({
            page_id: pageId,
            ...(title === undefined ? {} : { properties: titleProperty({ title }) }),
            ...iconProperty({ icon }),
          }),
        ),
      operation: "notion.pages.update",
      provider: "notion",
      retryMode: "never",
      scopeId,
    });
    return called.isErr() ? err(called.error) : ok(undefined);
  };
}

/** `pages.update` with `in_trash` — the only "delete" Notion's API offers, and it is recoverable. */
function archivePageMethod({ client, call, scopeId }: Seam): NotionWriteApi["archivePage"] {
  return async ({ pageId }) => {
    const called = await safeProviderCall({
      execute: () => call(() => client.pages.update({ in_trash: true, page_id: pageId })),
      operation: "notion.pages.update",
      provider: "notion",
      retryMode: "never",
      scopeId,
    });
    return called.isErr() ? err(called.error) : ok(undefined);
  };
}

/** `pages.move` — re-parent the page. Content, id and URL all survive it. NEVER retried. */
function movePageMethod({ client, call, scopeId }: Seam): NotionWriteApi["movePage"] {
  return async ({ pageId, parentPageId }) => {
    const called = await safeProviderCall({
      execute: () => call(() => client.pages.move({ page_id: pageId, parent: { page_id: parentPageId } })),
      operation: "notion.pages.move",
      provider: "notion",
      retryMode: "never",
      scopeId,
    });
    return called.isErr() ? err(called.error) : ok(undefined);
  };
}

/** `users.me` — the integration's own bot id, which is the provider's authorship evidence. */
function botUserIdMethod({ client, call, scopeId }: Seam): NotionWriteApi["botUserId"] {
  return async () => {
    const called = await safeProviderCall({
      execute: () => call(() => client.users.me({})),
      operation: "notion.users.me",
      provider: "notion",
      retryMode: "transient",
      scopeId,
    });
    if (called.isErr()) {
      return err(called.error);
    }
    return botUserIdOf({ value: called.value }).mapErr((error): NotionApiError => error);
  };
}

/**
 * The bot id off a `users.me` response, or the refusal when the response carries none. Pure.
 *
 * @param value the raw SDK `users.me` response
 * @returns the bot user id, or `RESPONSE_INCOMPLETE` when the response carries none
 */
export function botUserIdOf({ value }: { value: unknown }): Result<string, NotionWriteError> {
  const id = isRecord(value) ? stringField({ field: "id", record: value }) : undefined;
  return id === undefined ? err(NotionWriteErrors.botUserIdMissing()) : ok(id);
}

/**
 * The ONE Notion write-lane client, with its own scheduler and 429 scope.
 *
 * The scheduler is local to this instance, exactly as the read lanes' are. Notion's 3 req/s allowance is
 * per-INTEGRATION rather than per-client, so two live instances could together exceed it; that is a
 * pre-existing property of every Notion lane here rather than something this one introduces, and the shared
 * 429 block is what actually catches it. It is also why the image lane takes a seam rather than a token: a
 * page write and the image pass that follows it are one caller, and must pace as one.
 *
 * Every request it sends crosses `./guardedFetch.ts` before the network: a write is refused there when it carries a
 * dead Datadog console host or fails the outbound privacy check under the policy of `home`, read afresh each time.
 *
 * @param token the configured Notion integration token
 * @param home the state home the verb resolved, whose private-terms file every write is judged under
 * @param fetch the transport under the guard; omitted in production, a counting function in a test
 * @returns the client, the paced-and-deadlined runner, the 429 scope they share, and the privacy capability
 */
export function makeNotionWriteSeam({
  token,
  home,
  fetch = globalNotionFetch,
}: {
  token: string;
  home: string;
  fetch?: NotionFetch;
}): NotionWriteSeam {
  const privacy = notionWritePrivacy({ home });
  // devlint: sdk-factory -- the Notion WRITE lane: markdown-API version pinned, mutations never retry, writes guarded
  const client = new Client({
    auth: token,
    fetch: guardedNotionFetch({ fetch, privacy }),
    notionVersion: NOTION_MARKDOWN_API_VERSION,
  });
  return { call: makeNotionGatedCall(), client, privacy, scopeId: scopeIdForToken({ token }) };
}

/**
 * Build the Notion page-write seam.
 *
 * Each method is built by its own factory above rather than inline here, so every provider call sits
 * lexically inside a `safeProviderCall` the boundary-residue gate can see. A shared `guarded` helper read
 * better and hid all six boundaries from it.
 *
 * @param seam the write lane's one client, paced runner, 429 scope and privacy capability
 * @returns the mutating + read-back methods, sharing the seam's rate scheduler
 */
export function makeNotionWriteApi({ seam }: { seam: NotionWriteSeam }): NotionWriteApi {
  return {
    botUserId: botUserIdMethod(seam),
    createPage: createPageMethod(seam),
    movePage: movePageMethod(seam),
    replaceMarkdown: replaceMarkdownMethod(seam),
    retrieveMarkdown: retrieveMarkdownMethod(seam),
    retrievePage: retrievePageMethod(seam),
    archivePage: archivePageMethod(seam),
    updatePageHeader: updateHeaderMethod(seam),
  };
}
