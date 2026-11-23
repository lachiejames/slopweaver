/**
 * Which Linear-hosted files a read just fetched the ADDRESSES of — the pure half of `linear read --pdf`.
 *
 * ## Why this walks the payload rather than reading its schema
 *
 * Every Linear object kind carries markdown somewhere, and each carries it under a different name: an issue
 * has `description`, a comment has `body`, a project has `description`, a document has `content`, and an
 * `Attachment` node has `url`. A reader that named those fields would need a fifth branch the first time
 * Linear adds a kind, and would silently miss the one it had not been told about. Walking the string leaves
 * of an already-fetched payload costs one pass and knows nothing about any of them — the same idiom
 * `../providerRead.ts`'s `collectPaginationResidue` uses over the same payloads.
 *
 * ## The host filter is a credential guard, not a tidy-up
 *
 * Most `Attachment` rows in a real workspace are EXTERNAL links — a GitHub pull request, a Slack thread —
 * so `Attachment.url` routinely points off-host. Fetching those bytes means presenting this installation's
 * Linear API key to github.com. So the URL set is defined by the host rather than by where in the payload
 * the string was found, and an attachment node gets no special trust for being an attachment node.
 */

/** The one host that ever receives the Linear credential. Linear's asset storage, and nothing else. */
export const LINEAR_ASSET_ORIGIN = "https://uploads.linear.app/";

/**
 * Trailing characters a URL picks up from the prose around it — a markdown link's closing bracket, a
 * sentence's full stop. Linear's asset paths are UUIDs, so none of these can be part of a real one.
 */
const TRAILING_PUNCTUATION = /[.,;:!?)\]>"']+$/u;

/**
 * Every Linear-hosted asset URL in one string, with the prose it was embedded in trimmed off.
 *
 * Matched as any `https:` URL and then filtered against {@link LINEAR_ASSET_ORIGIN}, rather than pattern-
 * matching the host directly, so that constant is the single definition of "ours" that the fetcher's own
 * host guard also reads.
 */
function assetUrlsIn({ text }: { text: string }): readonly string[] {
  const matches = text.matchAll(/https:\/\/[^\s)>\]"']+/giu);
  return [...matches]
    .map((match) => match[0].replace(TRAILING_PUNCTUATION, ""))
    .filter((url) => url.startsWith(LINEAR_ASSET_ORIGIN));
}

/** Append every asset URL reachable from one payload node, depth-first, into `found`. */
function walk({ node, found }: { node: unknown; found: string[] }): void {
  if (typeof node === "string") {
    found.push(...assetUrlsIn({ text: node }));
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walk({ found, node: item });
    }
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const value of Object.values(node)) {
      walk({ found, node: value });
    }
  }
}

/**
 * Every distinct Linear-hosted asset a payload addresses, in the order it first appears.
 *
 * Order is first-appearance rather than sorted so a caller reporting "the first 3 of 7" names the three a
 * reader would have met first, and `max` therefore truncates the tail rather than an arbitrary slice.
 *
 * @param data the provider payload exactly as the reader assembled it
 * @param max how many URLs to return, because each one costs a round trip and a document to hold
 * @returns the distinct asset URLs, capped, and how many were found before the cap
 */
export function planLinearAssets({ data, max }: { data: unknown; max: number }): {
  readonly urls: readonly string[];
  readonly found: number;
} {
  const collected: string[] = [];
  walk({ found: collected, node: data });
  const distinct = [...new Set(collected)];
  return { found: distinct.length, urls: distinct.slice(0, max) };
}
