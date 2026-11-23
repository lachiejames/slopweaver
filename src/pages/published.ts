/**
 * Whether a page is published, asked of the store: the one check `page tag`, `incident note`, `incident postmortem`,
 * `browser present`, `talk meeting-due` and the `meeting-prep-due` monitor make before they point the owner at a page,
 * and the clock `proposal drift` reads a local page's last edit from. Stage 4 of
 * [the published pages doc](../../docs/store/published-pages.md).
 *
 * A page is published when the store holds a current `index.html` for it. A store that cannot be read is an error
 * the caller reports, never `false`: "not published" and "could not look" lead to different next moves, and a
 * missing page answered for an unreachable store would send the owner to republish a page that is there.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type PublishedPagesReader, withPublishedPagesReader } from "../store/publishedPages/read.js";
import type { PublishedPagesReadError } from "../store/publishedPages/readErrors.js";

/** The document every published page serves, the file whose presence makes a page published. */
const PAGE_DOCUMENT = "index.html";

/** Asks whether a page is published; the seam each caller injects. */
export type PagePublished = (args: { home: string; slug: string }) => Promise<Result<boolean, PublishedPagesReadError>>;

/**
 * Whether the store under this home holds a current document for the page, over one connection opened and closed.
 *
 * @param home the state home whose store is read
 * @param slug the page's key
 * @returns true when the store serves the page's document, false when it holds none, or why the store could not say
 */
export async function pagePublishedInStore({
  home,
  slug,
}: {
  home: string;
  slug: string;
}): Promise<Result<boolean, PublishedPagesReadError>> {
  return withPublishedPagesReader({
    home,
    read: (reader) => reader.fileExists({ pageKey: slug, relativePath: PAGE_DOCUMENT }),
  });
}

/** Asks which of several pages are published; the seam a caller with more than one slug injects. */
export type PublishedAmong = (args: {
  home: string;
  slugs: readonly string[];
}) => Promise<Result<ReadonlySet<string>, PublishedPagesReadError>>;

/**
 * Which of the named pages the store publishes, every one asked over one connection. One failed ask fails the whole
 * answer, so a page the store could not be asked about is never read as unpublished.
 *
 * @param home the state home whose store is read
 * @param slugs the pages' keys, a repeat asked once
 * @returns the published slugs among them, or why the store could not say
 */
export async function publishedAmongInStore({
  home,
  slugs,
}: {
  home: string;
  slugs: readonly string[];
}): Promise<Result<ReadonlySet<string>, PublishedPagesReadError>> {
  return withPublishedPagesReader({ home, read: (reader) => publishedAmongOver({ reader, slugs }) });
}

/**
 * Which of the named pages a reader's store publishes, over the reader's own open connection.
 *
 * @param reader the open reader; only its file check is asked
 * @param slugs the pages' keys, a repeat asked once
 * @returns the published slugs among them, or the first refusal — never a partial set
 */
export async function publishedAmongOver({
  reader,
  slugs,
}: {
  reader: Pick<PublishedPagesReader, "fileExists">;
  slugs: readonly string[];
}): Promise<Result<ReadonlySet<string>, PublishedPagesReadError>> {
  const published = new Set<string>();
  for (const slug of new Set(slugs)) {
    const present = await reader.fileExists({ pageKey: slug, relativePath: PAGE_DOCUMENT });
    if (present.isErr()) {
      return err(present.error);
    }
    if (present.value) {
      published.add(slug);
    }
  }
  return ok(published);
}

/** A page's clock as the store keeps it: not published, or published and last frozen at an instant. */
export type PageClock = { readonly published: false } | { readonly published: true; readonly frozenAt: Date };

/** Asks the store for a page's clock; the seam `proposal drift` injects. */
export type ReadPageClock = (args: {
  home: string;
  slug: string;
}) => Promise<Result<PageClock, PublishedPagesReadError>>;

/**
 * Whether the store publishes a page and, when it does, the instant of its newest freeze, over one connection. A
 * page the store no longer publishes answers unpublished even though its freezes outlive it, so a deleted page never
 * reads as last edited at its final freeze.
 *
 * @param home the state home whose store is read
 * @param slug the page's key, which is also its freeze key
 * @returns the page's clock, or why the store could not give it — a page published and never frozen is an error
 */
export async function pageClockInStore({
  home,
  slug,
}: {
  home: string;
  slug: string;
}): Promise<Result<PageClock, PublishedPagesReadError>> {
  return withPublishedPagesReader<PageClock>({
    home,
    read: async (reader) => {
      const present = await reader.fileExists({ pageKey: slug, relativePath: PAGE_DOCUMENT });
      if (present.isErr()) {
        return err(present.error);
      }
      if (!present.value) {
        return ok({ published: false });
      }
      const latest = await reader.latestFrozen({ pageKey: slug });
      return latest.map((frozen): PageClock => ({ frozenAt: frozen.frozenAt, published: true }));
    },
  });
}
