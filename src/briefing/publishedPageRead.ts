/**
 * How the briefing's pure projections read a published page: a synchronous seam over bytes a verb already fetched
 * from the store (`docs/store/published-pages.md`, stage 4).
 *
 * The store is asynchronous and the projections (`./openPageCards.ts`, `./composedCardDrift.ts`, `./openPageRow.ts`)
 * are not, so a verb works out which pages they will read, PREFETCHES them over one store connection, and hands them
 * {@link mapPageReader} over what came back. A page the store holds no freeze of is answered as exactly that,
 * `PAGES_NEVER_FROZEN`, the one answer a projection may read as "nothing to hold a card to". Any other store failure
 * stops the prefetch, so it never reaches a projection at all. A URL the verb did not prefetch is its own error,
 * never "never frozen": a collector that missed a page is a defect, not a page with no history.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { FreezeKeyError } from "../outbound/briefing/errors.js";
import type { PublishedPageNeverFrozenError, PublishedPagesReadError } from "../store/publishedPages/readErrors.js";

/** The store could not give one page's latest freeze, for a reason other than holding none. */
export interface PublishedPageUnreadableError {
  readonly code: "PUBLISHED_PAGE_UNREADABLE";
  readonly message: string;
  readonly url: string;
  readonly cause: PublishedPagesReadError | FreezeKeyError | TypeError;
}

/** A projection asked for a page the verb never fetched. */
export interface PublishedPageNotPrefetchedError {
  readonly code: "PUBLISHED_PAGE_NOT_PREFETCHED";
  readonly message: string;
  readonly url: string;
}

/** Every way reading one published page through the seam fails. */
export type PublishedPageReadError =
  PublishedPageNeverFrozenError | PublishedPageNotPrefetchedError | PublishedPageUnreadableError;

export const PublishedPageReadErrors = {
  notPrefetched: ({ url }: { url: string }): PublishedPageNotPrefetchedError => ({
    code: "PUBLISHED_PAGE_NOT_PREFETCHED",
    message: `${url} was never fetched from the published-page store before the briefing read it — a defect in the verb, not a page with no history`,
    url,
  }),
  unreadable: ({
    url,
    cause,
  }: {
    url: string;
    cause: PublishedPagesReadError | FreezeKeyError | TypeError;
  }): PublishedPageUnreadableError => ({
    cause,
    code: "PUBLISHED_PAGE_UNREADABLE",
    message: `${url} could not be read from the published-page store: ${cause.message}`,
    url,
  }),
} as const;

/** A page's newest frozen bytes as text, or why there are none; what every briefing projection reads through. */
export type ReadPublishedPage = (args: { url: string }) => Result<string, PublishedPageReadError>;

/** One prefetched page: its frozen bytes as text, or the store's answer that it holds no freeze of it. */
export type PrefetchedPage = Result<string, PublishedPageNeverFrozenError>;

/** Fetch these pages from one home's store, answering a reader over them, or the first page that could not be read. */
export type PrefetchPublishedPages = (args: {
  home: string;
  urls: readonly string[];
}) => Promise<Result<ReadPublishedPage, PublishedPageUnreadableError>>;

/**
 * A reader over pages already fetched, keyed by the exact URL each was asked for.
 *
 * @param pages each fetched URL's answer
 * @returns a reader answering a fetched page from the map, and a URL never fetched as that defect
 */
export function mapPageReader({ pages }: { pages: ReadonlyMap<string, PrefetchedPage> }): ReadPublishedPage {
  return ({ url }) => {
    const page = pages.get(url);
    if (page === undefined) {
      return err(PublishedPageReadErrors.notPrefetched({ url }));
    }
    return page.isOk() ? ok(page.value) : err(page.error);
  };
}
