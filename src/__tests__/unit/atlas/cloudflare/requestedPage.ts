/**
 * Which page a Cloudflare SDK request asked a routed fake for. The SDK names no page or cursor on its FIRST
 * request, so each reader below says what that absence means rather than substituting a value for it.
 */

/**
 * The page-number a request asked for — the SDK's page-paginated lists send `page` from page two on.
 *
 * @param url the request's URL
 * @returns the page asked for, 1 on the first request
 */
export function requestedPage({ url }: { url: URL }): number {
  const page = url.searchParams.get("page");
  if (page === null) {
    return 1;
  }
  return Number(page);
}

/**
 * The cursor a request carried — the SDK's cursor-paginated lists send one only once a page has named it.
 *
 * @param url the request's URL
 * @returns the cursor carried, or `null` on the first request
 */
export function requestedCursor({ url }: { url: URL }): string | null {
  return url.searchParams.get("cursor");
}
