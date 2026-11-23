/**
 * When each proposal destination was last edited — the one reading `proposal drift` takes from a provider.
 *
 * Each provider answers from the clock it actually keeps, and each answer is the instant the PUBLISHED thing last
 * changed, never the instant something was recorded about it:
 *
 * - a Notion page: the page's own `last_edited_time`, which advances on any edit to its blocks;
 * - a Linear document: the document's `updatedAt`, read by id through the same read the `linear document` door
 *   checks its writes with;
 * - a local page: the instant of its newest freeze, read from the store. A local page has exactly one writer, the
 *   `page publish` core, and every publish freezes the bytes it wrote, so the newest freeze IS the last edit
 *   slopweaver made. A hand edit to the folder copy is not seen; the page door's own freeze-and-diff model has the
 *   same edge. A page the store no longer publishes is unassessable, because its freezes outlive it and would
 *   otherwise read as fresh. The store's reader refuses a freeze pointer naming none of the page's versions and
 *   verifies the frozen body against its digest (`../../../store/publishedPages/read.ts`), so a pointer at another
 *   page's freeze, or a body that no longer matches, is an unassessable page here rather than a wrong clock.
 *
 * One client per provider serves the whole scan. Each API's rate scheduler is instance-local, so building one
 * per proposal would hand each its own private budget and defeat the pacing entirely.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "#lib/errorMessage.js";
import { linearToken, notionToken } from "../../../config.js";
import { type LinearDocumentWriteApi, makeLinearDocumentWriteApi } from "../../../corpus/linear/writeDocument.js";
import { makeNotionWriteApi, makeNotionWriteSeam, type NotionWriteApi } from "../../../corpus/notion/writeApi.js";
import { READ_ONLY_LINEAR_PRIVACY } from "../../../outbound/linear/writePrivacy.js";
import type { ProposalAddress } from "../../../outbound/proposal/address.js";
import { pageClockInStore, type ReadPageClock } from "../../../pages/published.js";
import { localPageSlug, PAGE_FILENAME, PAGES_DIRECTORY } from "../../../pages/url.js";

/** A destination's last edit, or the reason it cannot be read. */
export type DestinationFreshness = { readonly lastEditedIso: string } | { readonly why: string };

/** The one Notion call a drift scan makes. */
export type NotionPageReader = Pick<NotionWriteApi, "retrievePage">;

/** The one Linear call a drift scan makes. */
export type LinearDocumentReader = Pick<LinearDocumentWriteApi, "readDocument">;

/** What a client is built from: the home it serves and the token that home resolved. */
type ClientKey = { readonly home: string; readonly token: string };

/**
 * Build a client once per home and token, on first use, and hand every later caller with both the same one. Keyed on
 * the pair so a reader asked about a second home, or after a rotation, never answers through the first one's — and a
 * Notion client, whose every write is judged under its home's policy, is never shared across homes.
 */
function shared<T>({ make }: { make: (args: ClientKey) => T }): (args: ClientKey) => T {
  const built = new Map<string, T>();
  return ({ home, token }) => {
    const key = JSON.stringify([home, token]);
    const existing = built.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const client = make({ home, token });
    built.set(key, client);
    return client;
  };
}

/** A Notion page's `last_edited_time`. */
async function notionLastEdited({
  api,
  home,
  pageId,
}: {
  api: (args: ClientKey) => NotionPageReader;
  home: string;
  pageId: string;
}): Promise<DestinationFreshness> {
  const token = notionToken({ home });
  if (token === undefined) {
    return { why: "no Notion token configured; run `slopweaver connect notion`" };
  }
  const page = await api({ home, token }).retrievePage({ pageId });
  if (page.isErr()) {
    return { why: page.error.message };
  }
  if (page.value === undefined) {
    return { why: `Notion has no page ${pageId} (deleted, or the integration cannot see it)` };
  }
  if (page.value.archived) {
    return { why: `Notion page ${pageId} is archived or in the trash` };
  }
  const lastEditedIso = page.value.lastEditedTime;
  return lastEditedIso === undefined
    ? { why: `Notion returned page ${pageId} with no last_edited_time` }
    : { lastEditedIso };
}

/** A Linear document's `updatedAt`. */
async function linearLastEdited({
  api,
  home,
  documentId,
}: {
  api: (args: ClientKey) => LinearDocumentReader;
  home: string;
  documentId: string;
}): Promise<DestinationFreshness> {
  const token = linearToken({ home });
  if (token === undefined) {
    return { why: "no Linear token configured; run `slopweaver connect linear`" };
  }
  const document = await api({ home, token }).readDocument({ id: documentId });
  if (document.isErr()) {
    return { why: document.error.message };
  }
  if (document.value === undefined) {
    return { why: `Linear has no document ${documentId} (deleted, or the token cannot see it)` };
  }
  return { lastEditedIso: document.value.updatedAt };
}

/**
 * A local page's newest freeze, keyed on the URL its publish answered with — but only while the store still
 * publishes the page. The freezes outlive the page they froze, so a deleted page would otherwise read as last edited
 * at its final freeze rather than as gone.
 */
async function localLastEdited({
  address,
  home,
  readPageClock,
}: {
  address: ProposalAddress;
  home: string;
  readPageClock: ReadPageClock;
}): Promise<DestinationFreshness> {
  if (address.url === undefined) {
    return { why: `local page ${address.id} was recorded with no URL, so its freezes cannot be found` };
  }
  const urlSlug = localPageSlug({ url: address.url });
  if (urlSlug === undefined) {
    return { why: `local page ${address.id} was recorded at ${address.url}, which is not a local page address` };
  }
  // `proposal publish` records a local page's id AS the slug it published under, so a URL naming another page is a
  // damaged record; reading it would report that other page's clock for this one.
  if (urlSlug !== address.id) {
    return { why: `local page ${address.id} was recorded at ${address.url}, which names page ${urlSlug}` };
  }
  const publishedPath = fileURLToPath(address.url);
  // The freezes are looked up in THIS home by slug, so any file but the one this home publishes that slug to (a page
  // under another home, a home since moved, a nested look-alike) would be judged by another page's clock.
  const ownPath = resolve(home, PAGES_DIRECTORY, address.id, PAGE_FILENAME);
  if (resolve(publishedPath) !== ownPath) {
    return {
      why: `local page ${address.id} is at ${publishedPath}, not ${ownPath} where this home publishes it, so its freezes are not here`,
    };
  }
  const clock = await readPageClock({ home, slug: address.id });
  if (clock.isErr()) {
    return { why: `local page ${address.id} could not be read from the store: ${clock.error.message}` };
  }
  if (!clock.value.published) {
    return { why: `local page ${address.id} is no longer published in the store` };
  }
  return { lastEditedIso: clock.value.frozenAt.toISOString() };
}

/**
 * The production last-edit reader, dispatching on the address's provider.
 *
 * @param makeNotionApi builds the Notion client from a home and its token — a plain fake under test; production
 *   builds a guarded write-lane client under that home's policy, whose one call here is a read that loads none
 * @param makeLinearApi builds the Linear document client from a token — a plain fake under test
 * @param readPageClock asks the store for a local page's clock — a plain fake under test
 * @returns a reader whose Notion and Linear clients are each built once and shared by every proposal it reads
 */
export function productionDestinationLastEdited({
  makeNotionApi = ({ home, token }) => makeNotionWriteApi({ seam: makeNotionWriteSeam({ home, token }) }),
  makeLinearApi = ({ token }) => makeLinearDocumentWriteApi({ privacy: READ_ONLY_LINEAR_PRIVACY, token }),
  readPageClock = pageClockInStore,
}: {
  makeNotionApi?: (args: ClientKey) => NotionPageReader;
  makeLinearApi?: (args: ClientKey) => LinearDocumentReader;
  readPageClock?: ReadPageClock;
} = {}): (args: { address: ProposalAddress; home: string }) => Promise<DestinationFreshness> {
  const notionApi = shared({ make: makeNotionApi });
  const linearApi = shared({ make: makeLinearApi });
  return async ({ address, home }) => {
    // A client is typed to answer with a Result, but a promise can still reject; that is one proposal this scan
    // could not see, never a broken tool.
    try {
      return await readOne({ address, home, linearApi, notionApi, readPageClock });
    } catch (error: unknown) {
      return { why: `${address.provider} ${address.id} could not be read (${errorMessage({ error })})` };
    }
  };
}

/** One destination's last edit, dispatched on the provider the address was recorded with. */
async function readOne({
  address,
  home,
  linearApi,
  notionApi,
  readPageClock,
}: {
  address: ProposalAddress;
  home: string;
  linearApi: (args: ClientKey) => LinearDocumentReader;
  notionApi: (args: ClientKey) => NotionPageReader;
  readPageClock: ReadPageClock;
}): Promise<DestinationFreshness> {
  switch (address.provider) {
    case "notion":
      return notionLastEdited({ api: notionApi, home, pageId: address.id });
    case "linear":
      return linearLastEdited({ api: linearApi, documentId: address.id, home });
    case "local":
      return localLastEdited({ address, home, readPageClock });
  }
}
