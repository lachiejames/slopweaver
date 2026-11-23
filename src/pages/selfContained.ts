/**
 * One published page as ONE file that carries its own images, built from the files the store holds for it, so a page
 * dragged into Slack shows what the owner saw. A page
 * lives in the store only (`docs/store/published-pages.md`), and Reveal in Finder copies one out once, on demand.
 *
 * ## What is inlined, and what is reported instead
 *
 * Every reference the page LOADS through an attribute and that names a file the page serves becomes a `data:` URL of
 * that file's bytes: every attribute `./pageReferences.ts`'s `loadingAttributes` names, the same set a publish
 * stores (every media element's and script's `src`, each `srcset` candidate, a video's `poster`, an object's `data`, a stylesheet
 * `<link>`'s and an SVG `<image>`'s `href`). Two kinds are left as written and REPORTED, never dropped: a
 * relative reference naming a file the page does not serve, and a CSS `url()` or `@import` naming a page file, in
 * the document or inside a stylesheet it links, which is resolved against that sheet's own path.
 * MEASURED, no published page loads a page file from CSS:
 * `grep -rliE "url\(['\"]?[A-Za-z0-9._-]+\.(png|webp|jpe?g|gif|svg|css)" $SLOPWEAVER_HOME/pages --include=index.html`
 * prints nothing, while 75 `<img src>` references load one. A link (`<a href>`) is navigation, not a load, and stays.
 *
 * Structural, through parse5, the same reading `assets.ts` makes: a reference quoted in prose or a comment is not
 * one. Which page file a reference loads is `./pageReferences.ts`'s reading, the one a publish names its files by.
 * The document is re-serialised, so its bytes differ from the stored ones; what it shows does not. Pure.
 */
import { type DefaultTreeAdapterMap, parse, serialize } from "parse5";

import { publishedPageMediaType, UNSERVED_MEDIA_TYPE } from "../store/publishedPages/mediaType.js";

import { srcsetUrlSpans } from "./assets.js";
import { cssUrls } from "./cssUrls.js";
import {
  cleaned,
  documentBase,
  eachElement,
  elementCss,
  loadingAttributes,
  type PageAddress,
  pageAddress,
  pageFileFrom,
} from "./pageReferences.js";

type Element = DefaultTreeAdapterMap["element"];

/** Why a reference to a page file was left as written. */
type NotInlinedWhy = "css" | "not-served";

/** One reference the copy still makes to a file beside it, which a dragged copy cannot load. */
export interface NotInlined {
  readonly reference: string;
  readonly why: NotInlinedWhy;
}

/** The one file, and what building it did. */
export interface SelfContainedPage {
  readonly html: string;
  /** Each page file now carried inside the document, by path, once. */
  readonly inlined: readonly string[];
  readonly notInlined: readonly NotInlined[];
}

/** The rewrite in progress: the page's files, and what has been inlined or reported so far. */
interface Pass {
  /** Where the document's own references resolve from: its base URL, as a browser froze it. */
  readonly base: URL;
  readonly page: PageAddress;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly inlined: Set<string>;
  readonly notInlined: NotInlined[];
}

/**
 * A `data:` URL carrying one file, typed by its extension as the console serves it.
 *
 * @param relativePath the file's path under the page
 * @param bytes the file's bytes
 * @returns the URL
 */
export function dataUrlOf({ relativePath, bytes }: { relativePath: string; bytes: Uint8Array }): string {
  let mediaType = UNSERVED_MEDIA_TYPE;
  const known = publishedPageMediaType({ relativePath });
  if (known !== undefined) {
    mediaType = known;
  }
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** The page file a reference written in the document names, through its base. */
function documentFileOf({ pass, reference }: { pass: Pass; reference: string }): string | undefined {
  return pageFileFrom({ base: pass.base, page: pass.page, reference });
}

/** One reference, inlined when it names a served file, reported when it names an unserved one, else unchanged. */
function rewritten({ pass, reference }: { pass: Pass; reference: string }): string {
  const relativePath = documentFileOf({ pass, reference });
  if (relativePath === undefined) {
    return reference;
  }
  const bytes = pass.files.get(relativePath);
  if (bytes === undefined) {
    pass.notInlined.push({ reference, why: "not-served" });
    return reference;
  }
  pass.inlined.add(relativePath);
  return dataUrlOf({ bytes, relativePath });
}

/** A `srcset` with each candidate URL rewritten and every descriptor kept. */
function rewrittenSrcset({ pass, srcset }: { pass: Pass; srcset: string }): string {
  let out = "";
  let at = 0;
  for (const { url, start, end } of srcsetUrlSpans({ srcset })) {
    out += srcset.slice(at, start) + rewritten({ pass, reference: url });
    at = end;
  }
  return out + srcset.slice(at);
}

/**
 * Report every page file a linked stylesheet's own bytes load, resolved against the sheet's path: the sheet travels
 * as a `data:` URL, so nothing it names beside it can load from the copy (Codex review, r3).
 */
function reportSheet({ pass, href }: { pass: Pass; href: string }): void {
  const sheetPath = documentFileOf({ pass, reference: href });
  if (sheetPath === undefined) {
    return;
  }
  const bytes = pass.files.get(sheetPath);
  if (bytes === undefined) {
    return;
  }
  const sheet = new URL(cleaned({ reference: href }), pass.base);
  for (const reference of cssUrls({ css: new TextDecoder().decode(bytes) })) {
    if (pageFileFrom({ base: sheet, page: pass.page, reference }) !== undefined) {
      pass.notInlined.push({ reference, why: "css" });
    }
  }
}

/** Report every page file a stylesheet or `style` attribute loads, which this copy does not inline. */
function reportCss({ pass, element }: { pass: Pass; element: Element }): void {
  for (const reference of elementCss({ element }).flatMap((css) => cssUrls({ css }))) {
    if (documentFileOf({ pass, reference }) !== undefined) {
      pass.notInlined.push({ reference, why: "css" });
    }
  }
}

/** Rewrite one element's loading attributes in place, and report what its CSS loads. */
function rewriteElement({ pass, element }: { pass: Pass; element: Element }): void {
  const loading = loadingAttributes({ element });
  for (const attr of element.attrs) {
    // Every attribute by its local name, so an SVG image's `xlink:href` and `href` are both rewritten (Codex, r3).
    const srcset = loading.find((candidate) => candidate.name === attr.name)?.srcset;
    if (srcset === undefined) {
      continue;
    }
    if (element.tagName === "link") {
      reportSheet({ href: attr.value, pass });
    }
    attr.value = srcset ? rewrittenSrcset({ pass, srcset: attr.value }) : rewritten({ pass, reference: attr.value });
  }
  reportCss({ element, pass });
}

/**
 * The page as one file: every file it loads by attribute carried inside it as a `data:` URL, a `<template>`'s
 * content included.
 *
 * @param document the page's `index.html`, decoded
 * @param files every file the page serves, by its path under the page
 * @param slug the page's slug, which fixes the address its references resolve from
 * @returns the document, what it now carries, and every page file it still names and cannot load
 */
export function selfContainedPage({
  document,
  files,
  slug,
}: {
  document: string;
  files: ReadonlyMap<string, Uint8Array>;
  slug: string;
}): SelfContainedPage {
  const tree = parse(document);
  const page = pageAddress({ slug });
  const pass: Pass = { base: documentBase({ page, tree }), files, inlined: new Set(), notInlined: [], page };
  eachElement({
    tree,
    visit: (element) => {
      rewriteElement({ element, pass });
    },
  });
  return { html: serialize(tree), inlined: [...pass.inlined].toSorted(), notInlined: pass.notInlined };
}
