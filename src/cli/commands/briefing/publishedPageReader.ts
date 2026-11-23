/**
 * The production answer to `../../../briefing/publishedPageRead.ts`'s seam: a local page's newest FROZEN bytes, read
 * from the store's Storage over one connection and shared by `briefing render`, `briefing card` and
 * `briefing corrections`, so the three verbs read a page's question, lean and previous version from the same place.
 *
 * The freeze rather than the page's current document, although the two are the same bytes after every
 * `page publish`: the freeze is the version a lock-in rules against and `briefing corrections` diffs. There is no
 * folder fallback — stage 7 of `docs/store/published-pages.md` deletes the folders — so a store that cannot be read
 * stops the verb, naming the page.
 */
import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import type { PagesOpened } from "../../../briefing/composedCardDrift.js";
import {
  mapPageReader,
  type PrefetchedPage,
  type PublishedPageReadError,
  PublishedPageReadErrors,
  type PublishedPageUnreadableError,
  type ReadPublishedPage,
} from "../../../briefing/publishedPageRead.js";
import { artifactKey } from "../../../outbound/briefing/freezeStore.js";
import { PAGE_FILENAME } from "../../../pages/url.js";
import { type PublishedPagesReader, withPublishedPagesReader } from "../../../store/publishedPages/read.js";
import type { PublishedPagesReadError } from "../../../store/publishedPages/readErrors.js";

/** Opens one home's store, runs `read` over its reader, and closes it; `withPublishedPagesReader` in production. */
export type OpenPagesReader = <T>(args: {
  read: (reader: Pick<PublishedPagesReader, "latestFrozen">) => Promise<Result<T, PublishedPagesReadError>>;
}) => Promise<Result<T, PublishedPagesReadError>>;

/** The URLs asked for, grouped by the store key each resolves to, so two spellings of one page read it once. */
type UrlsByKey = ReadonlyMap<string, readonly string[]>;

/**
 * Resolve every URL to its store key before anything is opened.
 *
 * @param urls the URLs a verb will read, possibly repeated
 * @returns each key with the URLs naming it, or the first URL that names no page the store could key
 */
function urlsByKey({ urls }: { urls: readonly string[] }): Result<UrlsByKey, PublishedPageUnreadableError> {
  const grouped = new Map<string, string[]>();
  for (const url of new Set(urls)) {
    const key = artifactKey({ artifact: url });
    if (key.isErr()) {
      return err(PublishedPageReadErrors.unreadable({ cause: key.error, url }));
    }
    const held = grouped.get(key.value);
    if (held === undefined) {
      grouped.set(key.value, [url]);
    } else {
      held.push(url);
    }
  }
  return ok(grouped);
}

/**
 * A freeze's bytes as text, refusing bytes that are not UTF-8 rather than substituting a replacement character.
 *
 * @returns the text, or the decoder's refusal
 */
function decoded({ bytes }: { bytes: Uint8Array }): Result<string, TypeError> {
  try {
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error: unknown) {
    return err(error instanceof TypeError ? error : new TypeError(String(error)));
  }
}

/**
 * Read each key's latest freeze in turn over one reader — sequentially, because the connection holds one client.
 *
 * @param reader the open store's reads
 * @param keys each key with the URLs naming it
 * @returns every URL's page, or the first page the store could not give for a reason other than holding no freeze
 */
async function readEach({
  reader,
  keys,
}: {
  reader: Pick<PublishedPagesReader, "latestFrozen">;
  keys: UrlsByKey;
}): Promise<Result<ReadonlyMap<string, PrefetchedPage>, PublishedPageUnreadableError>> {
  const pages = new Map<string, PrefetchedPage>();
  for (const [pageKey, urls] of keys) {
    const first = urls[0]!;
    const latest = await reader.latestFrozen({ pageKey });
    let page: PrefetchedPage;
    if (latest.isOk()) {
      const text = decoded({ bytes: latest.value.bytes });
      if (text.isErr()) {
        return err(PublishedPageReadErrors.unreadable({ cause: text.error, url: first }));
      }
      page = ok(text.value);
    } else if (latest.error.code === "PAGES_NEVER_FROZEN") {
      page = err(latest.error);
    } else {
      return err(PublishedPageReadErrors.unreadable({ cause: latest.error, url: first }));
    }
    for (const url of urls) {
      pages.set(url, page);
    }
  }
  return ok(pages);
}

/**
 * Fetch these pages through an injected opener — the testable core of {@link prefetchPublishedPages}. No URL opens
 * nothing; any URL opens the store exactly once.
 *
 * @param urls every page URL the verb's projections may read
 * @param open opens the store, reads, and closes it
 * @returns a reader over the fetched pages, or the first page that could not be read, named
 */
export async function prefetchPagesWith({
  urls,
  open,
}: {
  urls: readonly string[];
  open: OpenPagesReader;
}): Promise<Result<ReadPublishedPage, PublishedPageUnreadableError>> {
  const keys = urlsByKey({ urls });
  if (keys.isErr()) {
    return err(keys.error);
  }
  if (keys.value.size === 0) {
    return ok(mapPageReader({ pages: new Map() }));
  }
  const read = await open({ read: async (reader) => ok(await readEach({ keys: keys.value, reader })) });
  if (read.isErr()) {
    // Opening or closing the store failed, which no one page caused; the first one asked for names the set.
    return err(PublishedPageReadErrors.unreadable({ cause: read.error, url: urls[0]! }));
  }
  return read.value.map((pages) => mapPageReader({ pages }));
}

/**
 * Fetch these pages from one home's store over one connection.
 *
 * @param home the state home whose store is read
 * @param urls every page URL the verb's projections may read
 * @returns a reader over the fetched pages, or the first page that could not be read, named
 */
export async function prefetchPublishedPages({
  home,
  urls,
}: {
  home: string;
  urls: readonly string[];
}): Promise<Result<ReadPublishedPage, PublishedPageUnreadableError>> {
  return prefetchPagesWith({ open: ({ read }) => withPublishedPagesReader({ home, read }), urls });
}

/**
 * One page's newest frozen bytes from the store, what `briefing corrections` diffs a new version against.
 *
 * @param home the state home whose store is read
 * @param artifact the page's published URL, or an artifact's bare id
 * @returns the bytes as text, or why the store gave none
 */
export async function latestPublishedPage({
  home,
  artifact,
}: {
  home: string;
  artifact: string;
}): Promise<Result<string, PublishedPageReadError>> {
  const reader = await prefetchPublishedPages({ home, urls: [artifact] });
  if (reader.isErr()) {
    return err(reader.error);
  }
  return reader.value({ url: artifact });
}

/**
 * A file's identity on disk, its device and inode, after every symlink and firmlink; nothing when it is not there.
 *
 * @returns the identity as one comparable string
 */
function identityOf({ path }: { path: string }): string | undefined {
  try {
    const stats = statSync(path, { bigint: true });
    return `${stats.dev}:${stats.ino}`;
  } catch {
    return undefined;
  }
}

/**
 * The pages a card subject opens, for `composedCardDrift`'s address fold: every `pages/<slug>/index.html` that is
 * the same file on disk, by device and inode.
 *
 * Identity rather than a resolved path: a page spelled through the macOS firmlink
 * `/System/Volumes/Data/private/…`, which `realpathSync.native` answers unchanged while the home resolves to
 * `/private/…`, so two spellings of one file compared unequal. `stat` answers one device and inode for every name
 * of a file — a letter-case variant, a symlink, a firmlink, a hard link. Reproduce, with a published `queue` page:
 * `stat -f '%d %i' /System/Volumes/Data<home>/pages/queue/index.html <home>/pages/queue/index.html`.
 *
 * A subject naming no file is matched by its DIRECTORY instead, so an alias spelling of a page whose local copy was
 * removed still reaches that page's freeze.
 *
 * @returns the slugs of those pages, empty when the subject is none of them
 */
export const pagesOpenedOnDisk: PagesOpened = ({ path, pagesDirectory }) => {
  const file = identityOf({ path });
  const namesPageFile = basename(path).toLowerCase() === PAGE_FILENAME;
  const directory = file === undefined && namesPageFile ? identityOf({ path: dirname(path) }) : undefined;
  if (file === undefined && directory === undefined) {
    return [];
  }
  let slugs: readonly string[];
  try {
    slugs = readdirSync(pagesDirectory);
  } catch {
    return [];
  }
  return slugs.filter((slug) =>
    file === undefined
      ? identityOf({ path: join(pagesDirectory, slug) }) === directory
      : identityOf({ path: join(pagesDirectory, slug, PAGE_FILENAME) }) === file,
  );
};
