/**
 * Which page file a reference in a published page LOADS, read as the browser reads it in the console: through the
 * page's served address `/api/page/<slug>/index.html` and its first `<base href>`. One reading, shared by the two
 * places that need it to agree: `./selfContained.ts`, which carries a page's files inside one exported document, and
 * `./loadedFiles.ts`, which names the files a publish must take from `--assets-from`. A publish that missed a load
 * the export carries would store a page that shows a broken image (`docs/store/published-pages.md` § A publish).
 *
 * Pure: parse5 trees and URL parsing only.
 */
import { type DefaultTreeAdapterMap, html } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

/**
 * The console's origin as a page sees it: plain `http:` on a host this module never names, so `http:shot.png` is
 * relative, as the URL standard reads it there, and a reference naming any real host lands outside the page.
 */
const CONSOLE_ORIGIN = "http://console.invalid";

/** The URL standard's leading and trailing strip set: C0 controls and space. */
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const EDGE_JUNK = /^[\u0000- ]+|[\u0000- ]+$/gu;

/** Where the console serves one page: its directory's path, and its document's full address. */
export interface PageAddress {
  readonly prefix: string;
  readonly document: URL;
}

/**
 * The address the console serves a page at, `/api/page/<slug>/index.html`, which its references resolve from.
 *
 * @param slug the page's slug
 * @returns the page directory's path and the document's address
 */
export function pageAddress({ slug }: { slug: string }): PageAddress {
  const prefix = `/api/page/${encodeURIComponent(slug)}/`;
  return { document: new URL(`${prefix}index.html`, CONSOLE_ORIGIN), prefix };
}

/**
 * The address one page file is served at, which a reference written inside that file (a stylesheet's `url()`)
 * resolves from.
 *
 * @param page the page's address
 * @param relativePath the `/`-separated path under the page
 * @returns the file's full address
 */
export function pageFileAddress({ page, relativePath }: { page: PageAddress; relativePath: string }): URL {
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(`${page.prefix}${encoded}`, CONSOLE_ORIGIN);
}

/**
 * A reference as the URL parser reads it: edge junk and tabs or newlines stripped, backslashes as slashes.
 *
 * @param reference the address exactly as the page wrote it
 * @returns what the parser is handed
 */
export function cleaned({ reference }: { reference: string }): string {
  return reference
    .replaceAll(EDGE_JUNK, "")
    .replaceAll(/[\t\n\r]/gu, "")
    .replaceAll("\\", "/");
}

/**
 * The page file a reference names when it resolves through `base`, or `undefined` when it lands outside the page.
 * The URL parser decides every form (Codex review, r3): `http:shot.png`, `/api/page/<slug>/shot.png` and `?raw` all
 * name a page file, exactly as they load one in the console.
 *
 * @param reference the address exactly as the page wrote it
 * @param base what it resolves against: the document's base, or the stylesheet it is written in
 * @param page the page's address
 * @returns the `/`-separated path under the page, query and fragment dropped
 */
export function pageFileFrom({
  reference,
  base,
  page,
}: {
  reference: string;
  base: URL;
  page: PageAddress;
}): string | undefined {
  const address = cleaned({ reference });
  if (address === "" || !URL.canParse(address, base)) {
    return undefined;
  }
  const { origin, pathname } = new URL(address, base);
  if (origin !== CONSOLE_ORIGIN || !pathname.startsWith(page.prefix) || pathname === page.prefix) {
    return undefined;
  }
  try {
    return decodeURIComponent(pathname.slice(page.prefix.length));
  } catch {
    return undefined;
  }
}

/**
 * Whether a reference reaches for a local file outside the page: a path that climbs out of the page's directory, or
 * a `file:` address. The console can never serve either, unlike a remote or inline address it never asks it for.
 *
 * @param reference the address exactly as the page wrote it
 * @param base what it resolves against
 * @param page the page's address
 * @returns true when the reference resolves to a local address outside the page
 */
export function leavesPage({ reference, base, page }: { reference: string; base: URL; page: PageAddress }): boolean {
  const address = cleaned({ reference });
  if (address === "" || !URL.canParse(address, base)) {
    return false;
  }
  const { origin, pathname, protocol } = new URL(address, base);
  return protocol === "file:" || (origin === CONSOLE_ORIGIN && !pathname.startsWith(page.prefix));
}

/**
 * The page file a reference in the page's document names, as a path under the page, or `undefined` when it names
 * none: another scheme or host (`https:`, `data:`, `file:`), or a path that lands outside the page's directory.
 *
 * @param reference the address exactly as the page wrote it
 * @param slug the page the document belongs to, which a root-absolute reference names
 * @returns the `/`-separated path under the page, query and fragment dropped
 */
export function referencedPageFile({ reference, slug }: { reference: string; slug: string }): string | undefined {
  const page = pageAddress({ slug });
  return pageFileFrom({ base: page.document, page, reference });
}

/**
 * The document's base URL, frozen as a browser freezes it off the first `<base href>` (Codex review, r3). HTML's
 * "document base URL" is the first such element's frozen URL even when it does not parse, never a later one's: the
 * document's own address with none, with one that does not parse, or with a `data:` or `javascript:` one; else the
 * href resolved against the document, wherever that lands.
 *
 * @param tree the parsed document
 * @param page the page's address
 * @returns the URL the document's references resolve against
 */
export function documentBase({ tree, page }: { tree: Node; page: PageAddress }): URL {
  const href = firstBaseHref({ tree });
  if (href === undefined) {
    return page.document;
  }
  const address = cleaned({ reference: href });
  if (!URL.canParse(address, page.document)) {
    return page.document;
  }
  const base = new URL(address, page.document);
  if (base.protocol === "data:" || base.protocol === "javascript:") {
    return page.document;
  }
  return base;
}

/** The `href` of the document's first `<base>` carrying one, in document order, outside any template. */
function firstBaseHref({ tree }: { tree: Node }): string | undefined {
  const pending: Node[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop()!;
    const isBase = "tagName" in node && node.tagName === "base" && node.namespaceURI === html.NS.HTML;
    const href = isBase ? node.attrs.find((a) => a.name === "href") : undefined;
    if (href !== undefined) {
      return href.value;
    }
    if ("childNodes" in node) {
      pending.push(...[...node.childNodes].toReversed());
    }
  }
  return undefined;
}

/** A plain `src` that loads one file. */
const SRC = { name: "src", srcset: false } as const;

/**
 * The loading attributes of every element whose loads do not depend on another attribute: each element a browser
 * fetches a file for by `src`, `srcset`, `poster`, `href` or `data`.
 */
const ELEMENT_LOADS: ReadonlyMap<string, readonly { name: string; srcset: boolean }[]> = new Map([
  ["img", [SRC, { name: "srcset", srcset: true }]],
  ["source", [SRC, { name: "srcset", srcset: true }]],
  ["video", [SRC, { name: "poster", srcset: false }]],
  ["audio", [SRC]],
  ["script", [SRC]],
  ["track", [SRC]],
  ["embed", [SRC]],
  ["iframe", [SRC]],
  ["object", [{ name: "data", srcset: false }]],
  ["image", [{ name: "href", srcset: false }]],
]);

/**
 * The attributes of one element that load a file, each with whether its value is a `srcset`.
 *
 * @returns the loading attributes by local name; none for an element that loads nothing
 */
export function loadingAttributes({ element }: { element: Element }): readonly { name: string; srcset: boolean }[] {
  const tag = element.tagName;
  const fixed = ELEMENT_LOADS.get(tag);
  if (fixed !== undefined) {
    return fixed;
  }
  const attribute = ({ name }: { name: string }): string | undefined =>
    element.attrs.find((attr) => attr.name === name)?.value;
  if (tag === "input") {
    return attribute({ name: "type" })?.toLowerCase() === "image" ? [SRC] : [];
  }
  const rel = attribute({ name: "rel" });
  const linkedSheet = tag === "link" && rel !== undefined && /(^|\s)stylesheet(\s|$)/iu.test(rel);
  return linkedSheet ? [{ name: "href", srcset: false }] : [];
}

/**
 * The CSS one element carries itself: its `style` attribute, and a `<style>` element's text.
 *
 * @returns each stylesheet text, empty when it carries none
 */
export function elementCss({ element }: { element: Element }): readonly string[] {
  const sheets = element.attrs.filter((attr) => attr.name === "style").map((attr) => attr.value);
  if (element.tagName === "style") {
    sheets.push(element.childNodes.map((child) => ("value" in child ? child.value : "")).join(""));
  }
  return sheets;
}

/**
 * Visit every element of a document in document order, `<template>` content included: parse5 holds it apart from the
 * tree, but a script that stamps it out later loads what it names (Codex review, r3).
 *
 * @param tree the parsed document
 * @param visit called once per element
 */
export function eachElement({ tree, visit }: { tree: Node; visit: (element: Element) => void }): void {
  const pending: Node[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if ("tagName" in node) {
      visit(node);
    }
    if ("childNodes" in node) {
      pending.push(...[...node.childNodes].toReversed());
    }
    if ("content" in node) {
      pending.push(...[...node.content.childNodes].toReversed());
    }
  }
}
