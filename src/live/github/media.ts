/**
 * Which pictures and videos a GitHub issue or pull request body embeds, read off GitHub's own rendered HTML.
 *
 * A private repository's attachment (`https://github.com/user-attachments/assets/<id>`) cannot be fetched with
 * the API token; what can be is the short-lived signed address GitHub writes into `bodyHTML` in its place. So the
 * markdown body names WHICH attachments there are, and the rendered body is the only place their bytes can be
 * reached from. This module is the pure half of that: it reads the rendered HTML and names each candidate, and
 * never fetches anything.
 *
 * Only `video[src]` and `img[src]` on an exact attachment host are candidates. A shields.io badge, an avatar, a
 * link, a poster frame or any other `githubusercontent.com` subdomain is not — a body's proof badge is an `img`
 * too, and downloading it as "the media" would be the wrong file with the right confidence.
 */

import { parse } from "parse5";

import { childrenOf, type Element, isElement, type Node } from "../../prformat/drawnNodes.js";

/**
 * The hosts GitHub serves a body's attachments from, exactly. Never a parent-domain wildcard: every other
 * `githubusercontent.com` subdomain serves something that is not an attachment of this body.
 */
export const GITHUB_ATTACHMENT_HOSTS: ReadonlySet<string> = new Set([
  "private-user-images.githubusercontent.com",
  "user-images.githubusercontent.com",
]);

/** One picture or video the rendered body embeds, in the order a reader meets it. */
export interface GithubRenderedMediaCandidate {
  readonly kind: "image" | "video";
  /** 1-based position among the candidates, which is what the file written for it is numbered by. */
  readonly index: number;
  /** The signed address. It carries a token, so it is never printed. */
  readonly url: string;
}

/** Every element under `node`, itself first, in document order. */
function elementsOf({ node }: { node: Node }): readonly Element[] {
  const own = isElement(node) ? [node] : [];
  return [...own, ...childrenOf({ node }).flatMap((child) => elementsOf({ node: child }))];
}

/** An element's `src`, or undefined when it has none or it is empty. */
function sourceOf({ element }: { element: Element }): string | undefined {
  const value = element.attrs.find((attr) => attr.name === "src")?.value;
  return value === "" ? undefined : value;
}

/**
 * The host of an absolute https address, or undefined when it is not one.
 *
 * @param address the element's `src`
 * @returns the lowercase host
 */
function httpsHostOf({ address }: { address: string }): string | undefined {
  if (!URL.canParse(address)) {
    return undefined;
  }
  const url = new URL(address);
  return url.protocol === "https:" ? url.hostname.toLowerCase() : undefined;
}

/**
 * Name every attachment a rendered GitHub body embeds.
 *
 * An empty body is an answer, not a failure: it embeds nothing. Two signed addresses for the same asset carry
 * different tokens, so a duplicate is judged on the address WITHOUT its query, and the first one is kept.
 *
 * @param html the body as GitHub rendered it (`bodyHTML`)
 * @param allowedHosts the exact hosts an attachment may be served from
 * @returns the candidates in document order, each asset once, numbered after filtering
 */
export function githubRenderedMedia({
  html,
  allowedHosts,
}: {
  html: string;
  allowedHosts: ReadonlySet<string>;
}): readonly GithubRenderedMediaCandidate[] {
  const seen = new Set<string>();
  const candidates: GithubRenderedMediaCandidate[] = [];
  for (const element of elementsOf({ node: parse(html) })) {
    if (element.tagName !== "video" && element.tagName !== "img") {
      continue;
    }
    const url = sourceOf({ element });
    if (url === undefined) {
      continue;
    }
    const host = httpsHostOf({ address: url });
    const identity = unsignedAddress({ url });
    if (host === undefined || !allowedHosts.has(host) || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    candidates.push({ index: candidates.length + 1, kind: element.tagName === "video" ? "video" : "image", url });
  }
  return candidates;
}

/** The file extension each attachment content type is written with. A signed address need not carry one. */
const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/**
 * A content type's bare `type/subtype`, lowercased, or undefined when the header is not one. Parameters are
 * dropped and anything that is not a plain media-type token is refused, because the header is provider text
 * and a reflected one could carry the signed address this module never prints.
 *
 * @param contentType the `Content-Type` the attachment host answered with
 * @returns the bare media type, safe to print
 */
export function bareContentType({ contentType }: { contentType: string | undefined }): string | undefined {
  if (contentType === undefined) {
    return undefined;
  }
  const bare = contentType.split(";")[0]!.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(bare) ? bare : undefined;
}

/**
 * The name one downloaded attachment is written under: its position and an extension its content type decides.
 * Never a name taken from the address, so nothing the provider sends can steer where the file lands.
 *
 * @param index the candidate's 1-based position; anything else names no file
 * @param contentType the `Content-Type` the attachment host answered with
 * @returns the file name, or undefined when the content type is not an attachment this verb writes
 */
export function githubMediaFileName({
  index,
  contentType,
}: {
  index: number;
  contentType: string | undefined;
}): string | undefined {
  const bare = bareContentType({ contentType });
  if (bare === undefined || !Number.isInteger(index) || index < 1) {
    return undefined;
  }
  const extension = EXTENSION_BY_CONTENT_TYPE[bare];
  if (extension === undefined) {
    return undefined;
  }
  return `github-media-${String(index).padStart(2, "0")}.${extension}`;
}

/**
 * An address fit to appear in a message: host and path, with the query that carries the signing token removed.
 *
 * @param url the signed address
 * @returns the address without its query or fragment
 */
export function unsignedAddress({ url }: { url: string }): string {
  if (!URL.canParse(url)) {
    return "(an unparseable address)";
  }
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}
