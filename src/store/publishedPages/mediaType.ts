/**
 * The media type a published page's file is stored as, derived from its extension.
 *
 * A restatement of the console's `CONTENT_TYPES` (`site/lib/localPageHref.ts`), because a file under `src/` may not
 * import one under `site/` (`tsconfig.build.json`'s `rootDir`). `site/__tests__/unit/localPageHref.test.ts`, in the
 * lane that reaches both roots, binds the two: every extension maps to the same essence, and no extension one serves
 * is missing from the other.
 *
 * Stored as a MIME essence with no `; charset=…` parameter: the body row records what the bytes are, and what a
 * reader adds to its own `Content-Type` header stays the reader's.
 */

/** Every extension a page may serve, lower-cased, and the media type its body is stored as. */
export const PUBLISHED_PAGE_MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  ["css", "text/css"],
  ["gif", "image/gif"],
  ["html", "text/html"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["js", "text/javascript"],
  ["json", "application/json"],
  ["mp4", "video/mp4"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["txt", "text/plain"],
  ["webm", "video/webm"],
  ["webp", "image/webp"],
]);

/**
 * A file no reader serves — a page's measurement script, a `.tsv` beside it — is still the page's, and is carried
 * as opaque bytes rather than refused or left behind. Measured on the operator's home, with
 * `find ~/.slopweaver/pages -type f -not -name '*.html' -not -name '*.png' -not -name '*.webp' -not -name .DS_Store`:
 * `.md`, `.tsv`, `.ts`, `.mjs`, `.jsonl` and `.re` files under three pages' `measure/` folders.
 */
export const UNSERVED_MEDIA_TYPE = "application/octet-stream";

/**
 * The media type a page file is served as, from the extension of its last path segment.
 *
 * @param relativePath the `/`-separated path under the page directory
 * @returns the MIME essence, or `undefined` when no extension or an unknown one means no reader serves it
 */
export function publishedPageMediaType({ relativePath }: { relativePath: string }): string | undefined {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot === -1) {
    return undefined;
  }
  return PUBLISHED_PAGE_MEDIA_TYPES.get(name.slice(dot + 1).toLowerCase());
}
