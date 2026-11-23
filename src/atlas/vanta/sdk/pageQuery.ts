/**
 * The cursor-pagination query string Vanta's list endpoints share. Vanta's OpenAPI spec declares the same
 * optional `pageSize` and `pageCursor` on every paged read, so the Controls and Documents operations build
 * their paths through this one function rather than each carrying a copy.
 */

/**
 * A path with Vanta's optional cursor-pagination params appended, omitting any left undefined — `pageSize`
 * first, then `pageCursor` — and the bare path when neither was set.
 *
 * @param path the endpoint path the query string is appended to
 * @param pageSize how many records one page should carry, when the caller bounds it
 * @param pageCursor the opaque cursor a previous page returned, when this is not the first page
 * @returns the path, with `?` and the URL-encoded params only when at least one was set
 */
export function withVantaPageQuery({
  path,
  pageSize,
  pageCursor,
}: {
  path: string;
  pageSize: number | undefined;
  pageCursor: string | undefined;
}): string {
  const params = new URLSearchParams();
  if (pageSize !== undefined) {
    params.set("pageSize", String(pageSize));
  }
  if (pageCursor !== undefined) {
    params.set("pageCursor", pageCursor);
  }
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
}
