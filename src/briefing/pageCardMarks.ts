/**
 * The question and lean a published page DECLARES for its own card, read out of the page's bytes.
 *
 * ## Why a card cannot type these two any more
 *
 * A projected card's `question` and `lean` written by a supervisor session from its memory of the page drift
 * from it: a card can ask questions the page does not ask, or carry lean B where the page's lean is A, so the
 * owner's "go with your lean" answers the CARD and a lock-in is stamped B before the owning session catches it
 * against the published file. Both read coherently alone and diverge only side by side. A claim a
 * composer can type is a claim that reads right while being wrong, so the fix is at construction: the page says
 * which sentence is its question and which is its lean, and `./openPageCards.ts` reads them from here.
 *
 * ## Why a declared mark rather than a heuristic
 *
 * Pages are free-form fragments (`skills/page/SKILL.md`). MEASURED over every page under
 * `$SLOPWEAVER_HOME/pages`, a lean is drawn at least eight different ways (`<p class="lean">`,
 * `<div class="lean">`, `<span class="lean">`, `<div class="opt lean">`, `<tr class="lean">` …) and
 * nothing says which of them, if any, is the card-sized sentence. Reproduce:
 *
 * ```bash
 * grep -rohiE --include=index.html '<[a-z0-9]+ class="[^"]*lean[^"]*"' ~/.slopweaver/pages | sort | uniq -c | sort -rn
 * ```
 *
 * So the page names them itself: exactly one element carrying `data-card="question"` and one carrying
 * `data-card="lean"`, each holding the one sentence the card shows. The attribute draws nothing, so marking a
 * sentence the page already shows costs the page no visible change.
 *
 * Pure: bytes in, marks or refusals out. parse5 builds a tree and reads nothing.
 */
import { parse } from "parse5";

import { err, ok, type Result } from "../lib/result.js";
import {
  childrenOf,
  conceals,
  isElement,
  type Node,
  READ_THROUGH,
  SEPARATED,
  STRUCK,
  shownChildren,
} from "../prformat/drawnNodes.js";

/** The attribute a page marks its card sentences with. */
const PAGE_CARD_MARK = "data-card";

/** The two fields a page may mark, in the order a refusal names them. */
const MARKED_FIELDS = ["question", "lean"] as const;

/** One field a page may mark. */
type MarkedField = (typeof MARKED_FIELDS)[number];

/** What a page's marks answered: both sentences, or a page that marks neither. */
export type PageCardMarks =
  { readonly kind: "marked"; readonly question: string; readonly lean: string } | { readonly kind: "unmarked" };

/** Whether a mark value names one of the two fields. */
function isMarkedField(value: string): value is MarkedField {
  return (MARKED_FIELDS as readonly string[]).includes(value);
}

/**
 * The tags a mark may sit on, sit under, or hold — an ALLOWLIST, for the reason `../prformat/drawnNodes.ts` gives
 * for its own: every element that draws its text as words, plus a struck run (dropped, see {@link textOf}) and an
 * image, which draws none. Two review passes found a new way to hide a word each time the rule was a list of
 * hiding tags — a closed `<details>`, then `<dialog>`, `<title>`, `<select>`, an SVG `<desc>` — and enumerating
 * those is a race the next spelling wins. A tag outside this set costs a refusal, never a wrong card.
 */
const DRAWN: ReadonlySet<string> = new Set([...READ_THROUGH, ...SEPARATED, ...STRUCK, "img"]);

/**
 * Whether one inline style declaration on an ANCESTOR removes what is under it from view. A mark and everything
 * inside it may carry no style at all ({@link undrawnInside}); an ancestor's style is judged by this, because
 * pages wrap their content in styled boxes. A stylesheet rule doing the same is not seen, and is the named
 * residue. Read declaration by declaration rather than by one pattern over the whole attribute, which could
 * backtrack without bound on a crafted style.
 *
 * @param property the declaration's property, lowercased
 * @param value the declaration's value, lowercased with any `!important` removed
 * @returns true when the declaration hides the element
 */
function declarationHides({ property, value }: { property: string; value: string }): boolean {
  switch (property) {
    case "display":
      return value === "none";
    case "visibility":
      return value === "hidden" || value === "collapse";
    case "content-visibility":
      return value === "hidden";
    case "opacity":
    case "font-size":
      return Number.parseFloat(value) <= 0;
    default:
      return false;
  }
}

/** Whether an element's inline style hides it, read with its CSS comments removed so a comment cannot split one. */
function styleHides({ node }: { node: Node }): boolean {
  const style = isElement(node) ? node.attrs.find((attr) => attr.name === "style") : undefined;
  if (style === undefined) {
    return false;
  }
  return style.value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .some((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon < 0) {
        return false;
      }
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration
        .slice(colon + 1)
        .replace(/!\s*important/i, "")
        .trim()
        .toLowerCase();
      return declarationHides({ property, value });
    });
}

/**
 * Whether an element is concealed: `../prformat/drawnNodes.ts`'s `hidden`, `<template>` and `<rp>`, plus a
 * `popover`, which a browser's own stylesheet hides until something opens it — the same as `hidden` does — and a
 * `<details name>`, whose `open` a browser removes on insertion when another member of its group is already open.
 */
function concealedHere({ node }: { node: Node }): boolean {
  if (!isElement(node)) {
    return false;
  }
  const exclusiveGroup = node.tagName === "details" && node.attrs.some((attr) => attr.name === "name");
  return conceals({ node }) || exclusiveGroup || node.attrs.some((attr) => attr.name === "popover");
}

/** A bidirectional control character, which reorders the words a reader sees without changing the bytes' order. */
const BIDI_CONTROL = /[؜‎‏‪-‮⁦-⁩]/;

/**
 * Whether an element keeps everything under it from reading as the page's own words: {@link concealedHere}, outside
 * {@link DRAWN}, hidden by an inline style, or STRUCK — a struck run is a withdrawn claim, and reading it into a
 * lean unstruck would put the retracted option on the card.
 */
function hidesWhatItHolds({ node }: { node: Node }): boolean {
  if (!isElement(node)) {
    return false;
  }
  return concealedHere({ node }) || !DRAWN.has(node.tagName) || STRUCK.has(node.tagName) || styleHides({ node });
}

/**
 * An attribute value as a browser's URL parser reads its scheme: leading control characters and spaces stripped,
 * every tab and newline removed, lowercased — so ` java\tscript:` is `javascript:`.
 */
function urlText({ value }: { value: string }): string {
  let start = 0;
  while (start < value.length && value.charCodeAt(start) <= 0x20) {
    start += 1;
  }
  return value
    .slice(start)
    .replace(/[\t\n\r]/g, "")
    .toLowerCase();
}

/**
 * The attributes a browser loads a document or resource from. Only these are read for a `data:` URL: in any other
 * attribute `data:` is just a word — `alt="Data: weekly signups"` must not refuse an honest page.
 * An SVG `xlink:href` parses to the name `href`.
 */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "action",
  "background",
  "data",
  "formaction",
  "href",
  "poster",
  "src",
]);

/**
 * The scheme of an attribute that runs script or draws a document of its own — `javascript:` or `vbscript:` in any
 * attribute, as this check always read them, or a `data:` URL that is not an image in a {@link URL_ATTRIBUTES} one —
 * or nothing. A `data:image/…` URL stays allowed: it is how a briefing embeds a screenshot, and an image draws no
 * words.
 *
 * @param name the attribute's name, which decides whether a `data:` value is a URL at all
 * @returns the scheme as a refusal names it, or `undefined` when the value is no such URL
 */
function scriptScheme({ name, value }: { name: string; value: string }): string | undefined {
  const url = urlText({ value });
  if (url.startsWith("data:")) {
    return URL_ATTRIBUTES.has(name) && !url.startsWith("data:image/") ? "data:" : undefined;
  }
  return ["javascript:", "vbscript:"].find((scheme) => url.startsWith(scheme));
}

/**
 * What on the page could change the words a reader sees AFTER the bytes are read, or nothing: script in any spelling
 * — a `<script>`, an `on…` event handler, a `javascript:`, `vbscript:` or document `data:` URL, an `<iframe srcdoc>`
 * reaching its parent — can rewrite
 * a mark, a `<meta http-equiv="refresh">` navigates away from it, and a declarative shadow root draws its own content
 * in place of its host's children, marked ones included. None belongs on a page whose card is read from its bytes.
 * MEASURED: 5 pages under `$SLOPWEAVER_HOME/pages` carry a script, a refresh, a shadow root or a
 * `popover`, so the refusal is cheap:
 *
 * ```bash
 * grep -rlis --include=index.html -E "<script|http-equiv=.?refresh|shadowrootmode|popover" ~/.slopweaver/pages | wc -l
 * ```
 *
 * @returns the offending element as a refusal names it, or `undefined` when the page draws only its own bytes
 */
function redrawnBy({ node }: { node: Node }): string | undefined {
  return firstInTree({ find: redrawnHere, node });
}

/** What on this one element could change the words a reader sees, per {@link redrawnBy}, or nothing. */
function redrawnHere({ node }: { node: Node }): string | undefined {
  if (!isElement(node)) {
    return undefined;
  }
  const refresh = node.attrs.some(
    (attr) => attr.name === "http-equiv" && attr.value.trim().toLowerCase() === "refresh",
  );
  const shadowRoot = node.attrs.some((attr) => attr.name === "shadowrootmode" || attr.name === "shadowroot");
  const handler = node.attrs.find((attr) => attr.name.startsWith("on"));
  const scriptUrl = node.attrs
    .map((attr) => scriptScheme({ name: attr.name, value: attr.value }))
    .find((scheme) => scheme !== undefined);
  if (node.tagName === "script") {
    return "a <script>";
  }
  if (handler !== undefined) {
    return `an ${handler.name} event handler`;
  }
  if (scriptUrl !== undefined) {
    return `a ${scriptUrl} URL`;
  }
  if (node.attrs.some((attr) => attr.name === "srcdoc")) {
    return `a <${node.tagName} srcdoc>`;
  }
  if (node.tagName === "meta" && refresh) {
    return 'a <meta http-equiv="refresh">';
  }
  return node.tagName === "template" && shadowRoot ? "a declarative shadow root" : undefined;
}

/**
 * What inside a marked element could hide words from a reader while the card still read them, or nothing when
 * all of it is plain drawn text. Stricter than {@link hidesWhatItHolds} on purpose: inside a mark ANY inline style
 * is refused, since the author is marking one sentence and has no reason to style part of it away.
 *
 * @returns the offending tag or attribute as a refusal names it, or `undefined` when every element is drawn
 */
function undrawnInside({ node }: { node: Node }): string | undefined {
  return firstInTree({ find: undrawnHere, node });
}

/** What in this one node could hide words from a reader, per {@link undrawnInside}, or nothing. */
function undrawnHere({ node }: { node: Node }): string | undefined {
  if (node.nodeName === "#text" && "value" in node) {
    return BIDI_CONTROL.test(node.value) ? "a bidirectional control character" : undefined;
  }
  if (!isElement(node)) {
    return undefined;
  }
  if (concealedHere({ node }) || !DRAWN.has(node.tagName)) {
    return `<${node.tagName}>`;
  }
  if (node.attrs.some((attr) => attr.name === "style")) {
    return "an inline style";
  }
  // A browser draws an image's alt text whenever the image fails to load, as words the card never reads.
  if (node.tagName === "img" && node.attrs.some((attr) => attr.name === "alt" && attr.value.trim() !== "")) {
    return "an <img> with alt text";
  }
  // A `dir` isolates its run, and runs inside a right-to-left line are drawn right to left: `B ahead of A` reads
  // `A ahead of B`.
  return node.attrs.some((attr) => attr.name === "dir") ? "a dir attribute" : undefined;
}

/**
 * The first answer `find` gives for a node or anything under it, in document order.
 *
 * @param find what one node offends with, or nothing
 * @returns that answer, or `undefined` when no node in the tree gives one
 */
function firstInTree({
  node,
  find,
}: {
  node: Node;
  find: (args: { node: Node }) => string | undefined;
}): string | undefined {
  const here = find({ node });
  if (here !== undefined) {
    return here;
  }
  for (const child of childrenOf({ node })) {
    const found = firstInTree({ find, node: child });
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * The words a reader sees inside one node: every shown text descendant, a space where a block breaks the line,
 * and whitespace collapsed — so `<p>A, <b>one</b> command</p>` reads `A, one command`. A struck run, and a closed
 * `<details>` beyond its summary, contribute nothing, because a card must say exactly what the page shows.
 */
function textOf({ node }: { node: Node }): string {
  if (node.nodeName === "#text" && "value" in node) {
    return node.value;
  }
  if (isElement(node) && STRUCK.has(node.tagName)) {
    return "";
  }
  const inner = shownChildren({ node })
    .map((child) => textOf({ node: child }))
    .join("");
  return isElement(node) && SEPARATED.has(node.tagName) ? ` ${inner} ` : inner;
}

/** One marked element: the value it carries, its shown text, and whether where it sits disqualifies it. */
interface MarkedElement {
  readonly value: string;
  readonly text: string;
  /** On or under something that hides it — {@link hidesWhatItHolds}, or past a closed `<details>` summary. */
  readonly concealed: boolean;
  /** What inside the mark could hide words from a reader, per {@link undrawnInside}; absent when nothing does. */
  readonly undrawn: string | undefined;
  /** Under another marked element, so its words would be read twice, into two fields. */
  readonly nested: boolean;
}

/**
 * Every element under a node carrying the mark attribute, in document order, with where it sits.
 *
 * @param concealed whether an ancestor draws no words, so nothing under it is shown
 * @param nested whether an ancestor is itself marked
 */
function markedElements({
  node,
  concealed,
  nested,
}: {
  node: Node;
  concealed: boolean;
  nested: boolean;
}): readonly MarkedElement[] {
  const mark = isElement(node) ? node.attrs.find((attr) => attr.name === PAGE_CARD_MARK) : undefined;
  const own: readonly MarkedElement[] =
    mark === undefined
      ? []
      : [
          {
            concealed: concealed || hidesWhatItHolds({ node }),
            nested,
            text: textOf({ node }).replace(/\s+/g, " ").trim(),
            undrawn: undrawnInside({ node }),
            value: mark.value.trim(),
          },
        ];
  // A closed `<details>` shows only its summary, so a mark past it is one a reader never sees without a click.
  const shown = new Set(shownChildren({ node }));
  const hidden = concealed || hidesWhatItHolds({ node });
  const inside = nested || mark !== undefined;
  return [
    ...own,
    ...childrenOf({ node }).flatMap((child) =>
      markedElements({ concealed: hidden || !shown.has(child), nested: inside, node: child }),
    ),
  ];
}

/**
 * Why one marked element cannot be read into a card at all, or nothing when it can.
 *
 * @param found the fields already read from earlier marks, so a second mark of one is refused
 * @returns the refusal line, or `undefined` when the mark reads
 */
function markRefusal({
  found,
  mark,
}: {
  found: ReadonlyMap<MarkedField, string>;
  mark: MarkedElement;
}): string | undefined {
  const named = `${PAGE_CARD_MARK}="${mark.value}"`;
  if (mark.concealed) {
    return (
      `${named} marks an element the page may never show (hidden, collapsed, struck, or inside a tag that does ` +
      "not draw its text as words); mark a sentence a reader sees"
    );
  }
  if (mark.undrawn !== undefined) {
    return `${named} holds ${mark.undrawn}, which can hide words from a reader that the card would still read; mark plain text`;
  }
  if (mark.nested) {
    return `${named} sits inside another ${PAGE_CARD_MARK} mark; mark two separate elements`;
  }
  if (!isMarkedField(mark.value)) {
    return `${named} marks nothing a card reads; the two values are ${MARKED_FIELDS.join(" and ")}`;
  }
  return found.has(mark.value) ? `${named} is marked more than once; mark exactly one element` : undefined;
}

/**
 * Read the question and lean a page marks for its card.
 *
 * A page marking NEITHER answers `unmarked` rather than refusing, because whether an unmarked page may still
 * become a card is `./openPageCards.ts`'s decision, not a fact about the bytes. Everything short of both is
 * refused, one line per problem: a value that is neither field (a misspelt mark would otherwise read as no mark
 * at all), a field marked twice, one field without the other, and a mark around no words.
 *
 * @param html the page's published bytes
 * @returns both marked sentences, `unmarked` when the page marks neither, or one line per problem
 */
export function readPageCardMarks({ html }: { html: string }): Result<PageCardMarks> {
  const page = parse(html);
  const marks = markedElements({ concealed: false, nested: false, node: page });
  if (marks.length === 0) {
    return ok({ kind: "unmarked" });
  }
  const redrawn = redrawnBy({ node: page });
  const problems: string[] =
    redrawn === undefined
      ? []
      : [
          `the page carries ${redrawn}, which can change what a reader sees after the card reads its marks; a ` +
            "marked page is static HTML",
        ];
  const found = new Map<MarkedField, string>();
  for (const mark of marks) {
    const refusal = markRefusal({ found, mark });
    if (refusal !== undefined) {
      problems.push(refusal);
      continue;
    }
    if (mark.text.length === 0) {
      problems.push(`${PAGE_CARD_MARK}="${mark.value}" marks an element holding no words`);
    }
    // markRefusal refused every value that is not a field, so this only narrows the type.
    if (isMarkedField(mark.value)) {
      found.set(mark.value, mark.text);
    }
  }
  const missing = MARKED_FIELDS.filter((field) => !found.has(field));
  problems.push(
    ...missing.map(
      (field) => `the page marks no ${PAGE_CARD_MARK}="${field}", and a card needs both sentences from it`,
    ),
  );
  const question = found.get("question");
  const lean = found.get("lean");
  if (problems.length > 0 || question === undefined || lean === undefined) {
    return err(problems);
  }
  return ok({ kind: "marked", lean, question });
}
