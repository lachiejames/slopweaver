/**
 * Every URL a pull-request description's RENDERING carries, sorted by how it carries it — the reader half of the
 * settled-evidence criterion (`./settledEvidenceCore.ts`), which judges what a write loses from two of these.
 *
 * A body is read off `renderedDocument` (`src/prformat/renderedTables.ts`), micromark with GFM and parse5, never its
 * source: a source reader chased markdown one construct at a time, and four review passes each found an image it
 * missed. Anything a `hidden` attribute or a `<template>` conceals is not read at all, and a body is read twice —
 * whole, and as drawn open without a click, a closed `<details>` showing its summary alone — so evidence shown open
 * is never kept by a duplicate folded away (the twelfth review pass). Every URL is resolved against the pull
 * request's own page, as GitHub resolves an `href` (the seventeenth).
 */
import {
  childrenOf,
  conceals,
  type Element,
  isElement,
  type Node,
  SEPARATED,
  shownChildren,
} from "../../../prformat/drawnNodes.js";
import { renderedDocument } from "../../../prformat/renderedTables.js";

/** Every URL a rendering carries, sorted by how it carries it; each list in document order, repeats kept. */
export interface Reading {
  /** From a `src` or `srcset` an element draws from. */
  readonly drawn: readonly string[];
  /** An `<a>` whose text is its own URL — a bare URL GitHub autolinked. */
  readonly autolinked: readonly string[];
  /** An `<a href>` with text of its own. */
  readonly linked: readonly string[];
  /** In visible text outside a link. */
  readonly loose: readonly string[];
  /** In an attribute nothing draws from (`alt`, `title`, a `data-` one) — shown to nobody. */
  readonly held: readonly string[];
  /** Every URL in visible text, link text included — never one held only in an attribute such as `alt`. */
  readonly present: readonly string[];
}

/** A reading under construction, its lists still open. */
interface OpenReading {
  readonly drawn: string[];
  readonly autolinked: string[];
  readonly linked: string[];
  readonly loose: string[];
  readonly held: string[];
  readonly present: string[];
}

/**
 * Every http(s) URL in rendered text or an attribute: the whole run up to whitespace or a quote. The text is
 * rendered, so no markdown syntax is left to stop at, and stopping at a `(` read `…?name=(proof)` and `…?name=` as
 * one URL (the ninth review pass).
 */
const ANY_URL = /https?:\/\/[^\s"'<>`]+/giu;

/**
 * The elements that draw a picture, each with the attributes it draws from. A `src` anywhere else draws nothing, so a
 * `<div src>` naming the URL never stands in for the `<img>` it shares it with (the thirteenth review pass). A
 * `<source>` is `sourceDraws`' question, since whether it draws depends on its parent. Only what GitHub's sanitiser
 * keeps is listed — a `poster`, or a `srcset` on a bare `<img>`, may be stripped, and a copy that draws nothing never
 * stands in for one that drew (the twenty-eighth review pass); `srcset` stays on `<source>`, GitHub's dark-mode shape.
 */
const DRAWING_ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["img", new Set(["src"])],
  ["source", new Set(["src", "srcset"])],
  ["video", new Set(["src"])],
]);

/**
 * Which body a reading is of. The two are read to OPPOSITE sides of every doubt, so a doubt costs a refusal and never
 * a loss: the live body protects anything that may draw, and the new body is credited only with what surely does.
 */
export type ReadingSide = "live" | "kept";

/** The smallest `width` or `height`, read as a number in whatever unit it carries, at which a copy is credited. */
const MIN_KEPT_SIZE = 10;

/** A dimension as HTML parses one — leading digits after whitespace — or undefined where it is ignored. */
function htmlDimension({ value }: { value: string }): number | undefined {
  const digits = /^[\t\n\f\r ]*(\d+(?:\.\d+)?)/u.exec(value);
  return digits === null ? undefined : Number(digits[1]);
}

/**
 * Whether an element is sized too small to count on this side. A new body's copy under {@link MIN_KEPT_SIZE} never
 * stands in for the one a reader saw (the twenty-seventh review pass), while a live picture is protected unless it is
 * sized to exactly zero, since a 9px one still draws (the thirtieth) and a value HTML ignores draws at full size.
 */
function tooSmall({ element, side }: { element: Element; side: ReadingSide }): boolean {
  return element.attrs.some((attribute) => {
    if (attribute.name !== "width" && attribute.name !== "height") {
      return false;
    }
    return side === "kept"
      ? Number.parseFloat(attribute.value) < MIN_KEPT_SIZE
      : htmlDimension({ value: attribute.value }) === 0;
  });
}

/**
 * Whether a `<source>` under this parent draws: in a `<video>`, or in a `<picture>` with a shown `<img>` to draw
 * through. Alone, or in a `<picture>` with no image, it draws nothing (the fourteenth review pass), while a dark-mode
 * `<source>` beside its `<img>` is a picture of its own (the fifteenth).
 */
function sourceDraws({ parent, side }: { parent: Node | undefined; side: ReadingSide }): boolean {
  if (parent === undefined || !isElement(parent)) {
    return false;
  }
  if (parent.tagName === "video") {
    return !tooSmall({ element: parent, side });
  }
  return (
    parent.tagName === "picture" &&
    childrenOf({ node: parent }).some(
      (child) =>
        isElement(child) &&
        child.tagName === "img" &&
        !conceals({ node: child }) &&
        !tooSmall({ element: child, side }),
    )
  );
}

/**
 * A URL as two bodies are compared: an absolute one in its WHATWG form. Nothing is trimmed here — a `.` ending an
 * attribute value is part of the URL, and stripping it let `…/a.` stand in for `…/a` (the fifth review pass).
 */
function normalised({ url }: { url: string }): string {
  const trimmed = url.trim();
  // The WHATWG form lower-cases the scheme and host, so `HTTPS://GitHub.com/…` and `https://github.com/…` compare
  // equal on both sides of a write. A relative one stays as written here, and `resolved` places it on the page.
  return URL.canParse(trimmed) ? new URL(trimmed).href : trimmed;
}

/**
 * The URL parsed, when it is an absolute one.
 *
 * @returns the parsed URL, or undefined for a relative or malformed one
 */
export function parsedUrl({ url }: { url: string }): URL | undefined {
  return URL.canParse(url) ? new URL(url) : undefined;
}

/**
 * Every http(s) URL in a text, exactly as rendered and normalised. Nothing is trimmed, so a URL a sentence ended
 * with a `.` keeps it: rewording one costs a refusal at worst, and never lets two URLs pass as one.
 *
 * @returns each URL in order, repeats kept
 */
export function urlsInText({ text }: { text: string }): readonly string[] {
  return [...text.matchAll(ANY_URL)].map((match) => normalised({ url: match[0] }));
}

/** Every candidate a `srcset` lists, its width or density descriptor dropped. */
function srcsetUrls({ value }: { value: string }): readonly string[] {
  // The HTML srcset algorithm: a candidate's URL is the whole run up to whitespace, so a comma inside it is part
  // of it — only trailing commas end it — and its descriptors run to the next comma. Splitting on every comma read
  // `…/a,…/b 1x` as two images (the eighth review pass).
  const urls: string[] = [];
  let rest = value.replace(/^[\s,]+/u, "");
  while (rest !== "") {
    const run = /^\S+/u.exec(rest)![0];
    rest = rest.slice(run.length);
    urls.push(normalised({ url: run.replace(/,+$/u, "") }));
    if (!run.endsWith(",")) {
      const comma = rest.indexOf(",");
      rest = comma === -1 ? "" : rest.slice(comma + 1);
    }
    rest = rest.replace(/^[\s,]+/u, "");
  }
  return urls;
}

/** The media elements whose children are fallback a browser that plays them never renders, bar what they play from. */
const MEDIA_ELEMENTS: ReadonlySet<string> = new Set(["audio", "video"]);

/**
 * The children a walk reads: every one when reading `whole`, else only those drawn open without a click — and under
 * a `<video>` or `<audio>`, only its `<source>` and `<track>`, so a link left in its fallback is never read as one a
 * reader can follow (the thirty-first review pass).
 */
function walked({ node, whole }: { node: Node; whole: boolean }): readonly Node[] {
  const children = whole ? childrenOf({ node }) : shownChildren({ node });
  if (!isElement(node) || !MEDIA_ELEMENTS.has(node.tagName)) {
    return children;
  }
  return children.filter((child) => isElement(child) && (child.tagName === "source" || child.tagName === "track"));
}

/** The text a reader sees in a node, every walked descendant's joined. */
function visibleText({ node, skipLinks, whole }: { node: Node; skipLinks: boolean; whole: boolean }): string {
  // Read as a reader reads it: inline markup joins its text (`…/actions/<em>runs</em>/123` is one URL, the eleventh
  // review pass), a block or a line break separates it, and what is concealed — or, when asked, a link — is a gap.
  if (conceals({ node }) || (skipLinks && isElement(node) && node.tagName === "a")) {
    return " ";
  }
  if (node.nodeName === "#text" && "value" in node) {
    return node.value;
  }
  const inner = walked({ node, whole })
    .map((child) => visibleText({ node: child, skipLinks, whole }))
    .join("");
  return isElement(node) && SEPARATED.has(node.tagName) ? ` ${inner} ` : inner;
}

/**
 * A character a reader can see: a letter, number, punctuation or symbol — never whitespace, a format character such
 * as U+200B or a lone combining mark — and none of the Hangul fillers or the blank braille cell, which are letters
 * and symbols that draw nothing.
 */
const VISIBLE_CHARACTER = new RegExp(
  `(?![${String.fromCodePoint(0x115f, 0x1160, 0x3164, 0xffa0, 0x2800)}])[\\p{L}\\p{N}\\p{P}\\p{S}]`,
  "u",
);

/**
 * Whether a link shows a reader anything to click: a visible character, or a picture inside it. A link with only
 * zero-width text renders as nothing, so it never keeps the link it replaced (the twenty-fifth review pass).
 */
function showsSomething({ node, side }: { node: Node; side: ReadingSide }): boolean {
  if (conceals({ node })) {
    return false;
  }
  if (node.nodeName === "#text" && "value" in node) {
    return VISIBLE_CHARACTER.test(node.value);
  }
  if (isElement(node) && DRAWING_ATTRIBUTES.has(node.tagName) && node.tagName !== "source") {
    return !tooSmall({ element: node, side });
  }
  return walked({ node, whole: true }).some((child) => showsSomething({ node: child, side }));
}

/** Sort one element's attributes into the reading: what it draws from, what it links to, what it merely holds. */
function readElement({
  element,
  parent,
  reading,
  side,
}: {
  element: Element;
  parent: Node | undefined;
  reading: OpenReading;
  side: ReadingSide;
}): void {
  const draws = DRAWING_ATTRIBUTES.get(element.tagName);
  const drawing = (element.tagName !== "source" || sourceDraws({ parent, side })) && !tooSmall({ element, side });
  for (const attribute of element.attrs) {
    if (drawing && draws?.has(attribute.name) === true) {
      reading.drawn.push(...drawnUrls({ attribute }));
    } else if (element.tagName === "a" && attribute.name === "href") {
      readLink({ element, reading, side, value: attribute.value });
    } else {
      reading.held.push(...urlsInText({ text: attribute.value }));
    }
  }
}

/** The URLs one drawing attribute draws from: every candidate a `srcset` lists, else its one URL. */
function drawnUrls({ attribute }: { attribute: { name: string; value: string } }): readonly string[] {
  return attribute.name === "srcset" ? srcsetUrls({ value: attribute.value }) : [normalised({ url: attribute.value })];
}

/** Sort a link's target: autolinked when its text is its own URL, linked when it shows other text, held when it shows nothing. */
function readLink({
  element,
  reading,
  side,
  value,
}: {
  element: Element;
  reading: OpenReading;
  side: ReadingSide;
  value: string;
}): void {
  const href = normalised({ url: value });
  if (!showsSomething({ node: element, side })) {
    reading.held.push(href);
    return;
  }
  const bare = normalised({ url: visibleText({ node: element, skipLinks: false, whole: true }) }) === href;
  (bare ? reading.autolinked : reading.linked).push(href);
}

/** Walk a rendered node's elements into the reading, skipping whatever a reader is never shown. */
function readElements({
  node,
  parent,
  reading,
  side,
  whole,
}: {
  node: Node;
  parent: Node | undefined;
  reading: OpenReading;
  side: ReadingSide;
  whole: boolean;
}): void {
  if (conceals({ node })) {
    return;
  }
  if (isElement(node)) {
    readElement({ element: node, parent, reading, side });
  }
  for (const child of walked({ node, whole })) {
    readElements({ node: child, parent: node, reading, side, whole });
  }
}

/** A URL resolved against the page it is shown on, as a browser resolves an `href`; one that will not stays as written. */
function resolved({ page, url }: { page: string; url: string }): string {
  return URL.canParse(url, page) ? new URL(url, page).href : url;
}

/** Read a rendered document whole, or only what is drawn open, every URL resolved against its page. */
function readDocument({
  page,
  root,
  side,
  whole,
}: {
  page: string;
  root: Node;
  side: ReadingSide;
  whole: boolean;
}): Reading {
  const reading: OpenReading = { autolinked: [], drawn: [], held: [], linked: [], loose: [], present: [] };
  readElements({ node: root, parent: undefined, reading, side, whole });
  reading.present.push(...urlsInText({ text: visibleText({ node: root, skipLinks: false, whole }) }));
  reading.loose.push(...urlsInText({ text: visibleText({ node: root, skipLinks: true, whole }) }));
  return {
    autolinked: reading.autolinked.map((url) => resolved({ page, url })),
    drawn: reading.drawn.map((url) => resolved({ page, url })),
    held: reading.held.map((url) => resolved({ page, url })),
    linked: reading.linked.map((url) => resolved({ page, url })),
    loose: reading.loose.map((url) => resolved({ page, url })),
    present: reading.present.map((url) => resolved({ page, url })),
  };
}

/**
 * A description's rendering read twice: whole, and as a reader sees it without opening a closed `<details>`.
 *
 * @param body the description's markdown
 * @param page the pull request's own page, which its relative links resolve against
 * @param side whether the body is the live one being protected or the new one being credited
 * @returns the shown reading and the whole one
 */
export function renderingsOf({ body, page, side }: { body: string; page: string; side: ReadingSide }): {
  shown: Reading;
  whole: Reading;
} {
  const root = renderedDocument({ markdown: body });
  return {
    shown: readDocument({ page, root, side, whole: false }),
    whole: readDocument({ page, root, side, whole: true }),
  };
}
