/**
 * The page files a published page LOADS, by path under the page: what a publish must take from `--assets-from`
 * (`./pageAssets.ts`) so the store holds every file the console will be asked for. The reading is
 * `./pageReferences.ts`'s, the one `./selfContained.ts` exports a page by, so a file the export would carry is a file
 * the publish stored.
 *
 * A document's loads are its loading attributes (`./pageReferences.ts`'s `loadingAttributes`: every media element's and
 * script's `src`, each `srcset` candidate, a video's `poster`, an object's `data`, a linked stylesheet's and an SVG image's
 * `href`, `<template>` content included) and every `url()` or `@import` in its own CSS,
 * all resolved through its first `<base href>`. A stylesheet's loads resolve against the sheet's own address. The
 * document itself (`index.html`, a query-only `?raw` included) is never one: the publish generates it.
 *
 * A `<template>`'s files count as loads ON PURPOSE: a script that stamps one out fetches them, and no reading of the
 * document can tell whether one will. So a page whose template is never stamped stores a file it does not load, read
 * from `--assets-from` under every check any other file passes; the alternative ships a page that breaks the moment
 * its script runs. Codex review r3 named this twice from opposite sides; this side is the one that never 404s. Pure.
 */
import { parse } from "parse5";

import { srcsetUrls } from "./assets.js";
import { cssUrls } from "./cssUrls.js";
import {
  documentBase,
  eachElement,
  elementCss,
  leavesPage,
  loadingAttributes,
  type PageAddress,
  pageAddress,
  pageFileAddress,
  pageFileFrom,
} from "./pageReferences.js";
import { PAGE_FILENAME } from "./url.js";

/** One page file a document or stylesheet loads, and the reference that first named it. */
export interface LoadedPageFile {
  readonly reference: string;
  readonly relativePath: string;
}

/**
 * Every page file a page's document loads, each once, in document order.
 *
 * @param document the complete document, shell included
 * @param slug the page's slug, which fixes the address its references resolve from
 * @returns the files, the document itself never among them
 */
export function documentLoads({ document, slug }: { document: string; slug: string }): readonly LoadedPageFile[] {
  const { base, page, references } = documentReferences({ document, slug });
  return distinctLoads({
    loads: references.map((reference) => ({ reference, relativePath: pageFileFrom({ base, page, reference }) })),
  });
}

/**
 * Every reference in the page's document that, resolved through its `<base href>`, reaches for a local file outside
 * the page, which the console could never serve. A `<base>` makes a plain relative reference one of these.
 *
 * @param document the complete document, shell included
 * @param slug the page's slug
 * @returns the references as the document wrote them, in document order
 */
export function documentEscapes({ document, slug }: { document: string; slug: string }): readonly string[] {
  const { base, page, references } = documentReferences({ document, slug });
  return [...new Set(references.filter((reference) => leavesPage({ base, page, reference })))];
}

/**
 * Every reference the document loads, with the base and page address they resolve against.
 *
 * @param document the complete document
 * @param slug the page's slug
 * @returns the resolution context and the references in document order
 */
function documentReferences({ document, slug }: { document: string; slug: string }): {
  base: URL;
  page: PageAddress;
  references: readonly string[];
} {
  const tree = parse(document);
  const page = pageAddress({ slug });
  const base = documentBase({ page, tree });
  const references: string[] = [];
  eachElement({
    tree,
    visit: (element) => {
      const loading = loadingAttributes({ element });
      for (const attr of element.attrs) {
        const srcset = loading.find((candidate) => candidate.name === attr.name)?.srcset;
        if (srcset === true) {
          references.push(...srcsetUrls({ srcset: attr.value }));
        } else if (srcset === false) {
          references.push(attr.value);
        }
      }
      references.push(...elementCss({ element }).flatMap((css) => cssUrls({ css })));
    },
  });
  return { base, page, references };
}

/**
 * Every page file one of the page's stylesheets loads, resolved against that sheet's own address.
 *
 * @param css the stylesheet's text
 * @param relativePath where the sheet sits under the page
 * @param slug the page's slug
 * @returns the files, each once, the document itself never among them
 */
export function stylesheetLoads({
  css,
  relativePath,
  slug,
}: {
  css: string;
  relativePath: string;
  slug: string;
}): readonly LoadedPageFile[] {
  const page = pageAddress({ slug });
  const base = pageFileAddress({ page, relativePath });
  return distinctLoads({
    loads: cssUrls({ css }).map((reference) => ({ reference, relativePath: pageFileFrom({ base, page, reference }) })),
  });
}

/**
 * Every reference in one of the page's stylesheets that reaches for a local file outside the page, which the console
 * could never serve and so a publish refuses rather than dropping.
 *
 * @param css the stylesheet's text
 * @param relativePath where the sheet sits under the page
 * @param slug the page's slug
 * @returns the references as the sheet wrote them, in order
 */
export function stylesheetEscapes({
  css,
  relativePath,
  slug,
}: {
  css: string;
  relativePath: string;
  slug: string;
}): readonly string[] {
  const page = pageAddress({ slug });
  const base = pageFileAddress({ page, relativePath });
  return cssUrls({ css }).filter((reference) => leavesPage({ base, page, reference }));
}

/**
 * The loads that name a page file other than the document, each path once, first reference kept.
 *
 * @param loads every reference with the page file it resolved to, if any
 * @returns the distinct page files
 */
function distinctLoads({
  loads,
}: {
  loads: readonly { reference: string; relativePath: string | undefined }[];
}): readonly LoadedPageFile[] {
  const seen = new Map<string, LoadedPageFile>();
  for (const { reference, relativePath } of loads) {
    if (relativePath !== undefined && relativePath !== PAGE_FILENAME && !seen.has(relativePath)) {
      seen.set(relativePath, { reference, relativePath });
    }
  }
  return [...seen.values()];
}
