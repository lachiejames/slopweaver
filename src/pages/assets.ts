/**
 * Every reference in a page fragment that the console cannot load: an image or stylesheet the page names by a
 * `file:` address, by an absolute path, or by a relative path that climbs out of the page's own directory.
 *
 * ## Why a page may only reach what sits beside it
 *
 * The owner opens a page from the Queue at `http://localhost:3000/api/page/<slug>/index.html`, and that route serves
 * the page's own directory and nothing else (`site/lib/localPageServe.ts`). A browser refuses a `file:` image
 * from an `http` document outright, `/Users/...` resolves against the console rather than the disk, and
 * `../charts/x.png` is refused by the route's containment check. MEASURED: a briefing page
 * named every chart as `file:///Users/.../charts/*.png`, and the owner saw a broken
 * image icon in place of each one. The fix is always the same — copy the file under
 * `$SLOPWEAVER_HOME/pages/<slug>/` and link it relatively — so `page publish` refuses before writing a page that
 * would show the owner the icon.
 *
 * ## What is read, and what is deliberately not
 *
 * Structural, never one pattern over the bytes: parse5 builds the tree, so a reference quoted in a comment, in
 * prose or inside a `<template>` is not a reference. Read are `<img>` and `<source>` `src` and `srcset` (split by
 * the HTML candidate grammar, because a `data:` URL carries commas), a stylesheet `<link>`'s and an SVG
 * `<image>`'s `href`, and in CSS — a `<style>` element or a `style` attribute — every address `./cssUrls.ts` reads
 * (`url()`, `@import`, a top-level `image-set()` string), CSS escapes resolved. NOT read HERE: a `<video poster>`,
 * a media element's `src` and an `<object>`/`<embed>`; a publish's `documentEscapes` (`./loadedFiles.ts`) names
 * every one of those that resolves outside the page. A network address (`https:`, `//host`) and a `data:` image are
 * left alone: whether a local page may load from the network is a different rule from whether it can load at all.
 *
 * Pure: a string in, findings out.
 */
import { type DefaultTreeAdapterMap, parseFragment } from "parse5";

import { cssUrls } from "./cssUrls.js";

/** Where in the page a reference was read from. */
type PageAssetSource =
  "css-url" | "img-src" | "img-srcset" | "link-href" | "source-src" | "source-srcset" | "svg-image-href";

/** Why the console cannot load a reference. */
export type UnsafePageAssetKind = "file-url" | "parent-relative" | "root-absolute";

/** One reference the console cannot load, as the page wrote it. */
export interface UnsafePageAsset {
  readonly source: PageAssetSource;
  readonly kind: UnsafePageAssetKind;
  readonly reference: string;
}

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

/** The URL standard's leading and trailing strip set: C0 controls and space. */
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const EDGE_JUNK = /^[\u0000- ]+|[\u0000- ]+$/gu;

/** The URL standard removes every tab and newline anywhere in an address before reading it. */
const TAB_OR_NEWLINE = /[\t\n\r]/gu;

/** A scheme, as the URL standard reads one. */
const SCHEME = /^([a-z][a-z\d+.-]*):/iu;

/** A base that stands for "the page's own directory", so a relative reference can be resolved and checked. */
const PAGE_BASE = "http://page.invalid/slug/";

/**
 * Why one reference cannot load from the console, or `undefined` when it can.
 *
 * @param reference the address exactly as the page wrote it
 * @returns the failure kind, or `undefined` for a relative path inside the page, a network address or a data URL
 */
export function unsafeReferenceKind({ reference }: { reference: string }): UnsafePageAssetKind | undefined {
  const address = reference.replaceAll(EDGE_JUNK, "").replaceAll(TAB_OR_NEWLINE, "");
  const scheme = SCHEME.exec(address);
  if (scheme !== null) {
    return scheme[1]!.toLowerCase() === "file" ? "file-url" : undefined;
  }
  // The console is an `http` document, where a backslash is a slash.
  const slashed = address.replaceAll("\\", "/");
  if (slashed.startsWith("//")) {
    return undefined;
  }
  if (slashed.startsWith("/")) {
    return "root-absolute";
  }
  return new URL(slashed, PAGE_BASE).pathname.startsWith("/slug/") ? undefined : "parent-relative";
}

/** Whether a character is HTML's ASCII whitespace, which separates `srcset` candidates and descriptors. */
function isHtmlSpace({ char }: { char: string }): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\f" || char === "\r";
}

/**
 * The URLs of a `srcset`, read by the HTML standard's candidate grammar: a URL runs to whitespace, a comma at
 * its END closes the candidate, and a descriptor runs to a comma outside parentheses. A comma INSIDE a URL —
 * every `data:` URL has one — is part of it.
 *
 * @param srcset the attribute value
 * @returns each candidate's URL, in order
 */
export function srcsetUrls({ srcset }: { srcset: string }): readonly string[] {
  return srcsetUrlSpans({ srcset }).map((span) => span.url);
}

/**
 * Each `srcset` candidate's URL with where it sits in the attribute, read by {@link srcsetUrls}'s grammar, so a
 * rewrite can replace a URL and keep its descriptor.
 *
 * @param srcset the attribute value
 * @returns each URL and its `[start, end)` offsets, in order
 */
export function srcsetUrlSpans({
  srcset,
}: {
  srcset: string;
}): readonly { readonly url: string; readonly start: number; readonly end: number }[] {
  const urls: { url: string; start: number; end: number }[] = [];
  let at = 0;
  while (at < srcset.length) {
    at = skipWhile({ at, test: (char) => isHtmlSpace({ char }) || char === ",", text: srcset });
    const start = at;
    at = skipWhile({ at, test: (char) => !isHtmlSpace({ char }), text: srcset });
    const candidate = srcset.slice(start, at);
    const url = candidate.replace(/,+$/u, "");
    if (url.length > 0) {
      urls.push({ end: start + url.length, start, url });
    }
    if (!candidate.endsWith(",")) {
      at = descriptorEnd({ at, srcset });
    }
  }
  return urls;
}

/** The index of the first character from `at` on that `test` rejects, or the text's length. */
function skipWhile({ text, at, test }: { text: string; at: number; test: (char: string) => boolean }): number {
  let index = at;
  while (index < text.length && test(text[index]!)) {
    index += 1;
  }
  return index;
}

/** Where a candidate's descriptor ends: the first comma outside parentheses from `at`, or the end of the srcset. */
function descriptorEnd({ srcset, at }: { srcset: string; at: number }): number {
  let index = at;
  let depth = 0;
  while (index < srcset.length && (srcset[index] !== "," || depth > 0)) {
    if (srcset[index] === "(") {
      depth += 1;
    } else if (srcset[index] === ")" && depth > 0) {
      depth -= 1;
    }
    index += 1;
  }
  return index;
}

/** One attribute's value, or `undefined` when the element does not carry it. */
function attribute({ element, name }: { element: Element; name: string }): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

/** The text a `<style>` element holds. */
function styleText({ element }: { element: Element }): string {
  return element.childNodes.map((child) => ("value" in child ? child.value : "")).join("");
}

/** Every reference one element makes, with where each was read from. */
function elementReferences({
  element,
}: {
  element: Element;
}): readonly { readonly source: PageAssetSource; readonly reference: string }[] {
  return [...imageReferences({ element }), ...hrefReferences({ element }), ...styleReferences({ element })];
}

/**
 * The `href` of a linked stylesheet or of an SVG `<image>` (parse5 reads `xlink:href` as `href` too); nothing
 * for any other element.
 */
function hrefReferences({
  element,
}: {
  element: Element;
}): readonly { readonly source: PageAssetSource; readonly reference: string }[] {
  const href = attribute({ element, name: "href" });
  if (href === undefined) {
    return [];
  }
  const rel = attribute({ element, name: "rel" });
  const linkedSheet = element.tagName === "link" && rel !== undefined && /(^|\s)stylesheet(\s|$)/iu.test(rel);
  if (linkedSheet) {
    return [{ reference: href, source: "link-href" }];
  }
  return element.tagName === "image" ? [{ reference: href, source: "svg-image-href" }] : [];
}

/** The `src` and `srcset` addresses of an `<img>` or `<source>`; nothing for any other element. */
function imageReferences({
  element,
}: {
  element: Element;
}): readonly { readonly source: PageAssetSource; readonly reference: string }[] {
  const tag = element.tagName;
  if (tag !== "img" && tag !== "source") {
    return [];
  }
  const found: { source: PageAssetSource; reference: string }[] = [];
  const src = attribute({ element, name: "src" });
  if (src !== undefined) {
    found.push({ reference: src, source: tag === "img" ? "img-src" : "source-src" });
  }
  const srcset = attribute({ element, name: "srcset" });
  if (srcset !== undefined) {
    const source = tag === "img" ? "img-srcset" : "source-srcset";
    found.push(...srcsetUrls({ srcset }).map((reference) => ({ reference, source }) as const));
  }
  return found;
}

/** The CSS addresses of an element's `style` attribute and, for a `<style>`, its sheet. */
function styleReferences({
  element,
}: {
  element: Element;
}): readonly { readonly source: PageAssetSource; readonly reference: string }[] {
  const style = attribute({ element, name: "style" });
  const sheets = style === undefined ? [] : [style];
  if (element.tagName === "style") {
    sheets.push(styleText({ element }));
  }
  return sheets.flatMap((css) => cssUrls({ css }).map((reference) => ({ reference, source: "css-url" }) as const));
}

/**
 * Every reference in an authored fragment the console cannot load, in document order, so one refusal names the
 * whole repair.
 *
 * A `<template>`'s content is not walked: parse5 holds it apart from the tree, which is where a browser holds it.
 *
 * @param fragment the page as its author wrote it
 * @returns each unloadable reference, why, and where it was read; empty when the page loads whole
 */
export function unsafePageAssets({ fragment }: { fragment: string }): readonly UnsafePageAsset[] {
  const unsafe: UnsafePageAsset[] = [];
  const pending: Node[] = [...parseFragment(fragment).childNodes].toReversed();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (!("tagName" in node)) {
      continue;
    }
    for (const { reference, source } of elementReferences({ element: node })) {
      const kind = unsafeReferenceKind({ reference });
      if (kind !== undefined) {
        unsafe.push({ kind, reference, source });
      }
    }
    pending.push(...[...node.childNodes].toReversed());
  }
  return unsafe;
}
