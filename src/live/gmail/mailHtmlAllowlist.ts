/**
 * What `./mailHtml.ts` writes out of a received mail's HTML — the ALLOWLIST itself, kept apart from the walker so a
 * reviewer reads the whole policy in one place. Anything not named here is not written: an element not kept has its
 * text kept and its tag dropped, an element in {@link DROPPED_ELEMENTS} is dropped with everything inside it, and an
 * attribute not named is never written at all.
 */
import { characterRunEnd } from "#lib/base64Run.js";

/** Elements written out, with their allowlisted attributes. */
export const KEPT_ELEMENTS: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "b",
  "bdi",
  "bdo",
  "big",
  "blockquote",
  "br",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "font",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "tt",
  "u",
  "ul",
  "var",
  "wbr",
]);

/** Elements dropped WITH everything inside them: active, embedding, form or hidden-content elements. */
export const DROPPED_ELEMENTS: ReadonlySet<string> = new Set([
  "audio",
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "frame",
  "frameset",
  "head",
  "iframe",
  "input",
  "link",
  "math",
  "meta",
  "noscript",
  "object",
  "option",
  "picture",
  "script",
  "select",
  "source",
  "svg",
  "template",
  "textarea",
  "title",
  "track",
  "video",
]);

/** Elements with no closing tag. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set(["br", "col", "hr", "img", "wbr"]);

/** Attributes any kept element may carry. */
export const GLOBAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "align",
  "aria-label",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "class",
  "color",
  "dir",
  "face",
  "height",
  "id",
  "lang",
  "role",
  "size",
  "style",
  "summary",
  "title",
  "valign",
  "width",
]);

/** Attributes one element may carry beyond the global set. */
export const ELEMENT_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  img: new Set(["alt", "src"]),
  li: new Set(["value"]),
  ol: new Set(["reversed", "start", "type"]),
  td: new Set(["abbr", "colspan", "headers", "rowspan", "scope"]),
  th: new Set(["abbr", "colspan", "headers", "rowspan", "scope"]),
  ul: new Set(["type"]),
};

/** The header of a kept image source. Every quantifier in it is bounded, so a long source cannot overflow it. */
const DATA_IMAGE_HEADER = /^data:image\/(?:png|gif|jpeg|webp);base64,/i;

/** One character outside a kept image's body: base64, padding or whitespace. Both cases spelled, since no flag survives. */
const OUTSIDE_DATA_IMAGE_BODY = /[^A-Za-z0-9+/=\s]/;

/**
 * Whether an image source is the only kind kept: a base64 raster `data:` URL. SVG is not a raster and can carry script.
 *
 * The body is walked with `characterRunEnd` rather than matched by a regex quantified over it: an inline image runs to
 * millions of characters, and such a regex throws `RangeError: Maximum call stack size exceeded` once V8 compiles it
 * unoptimised (`src/lib/base64Run.ts` carries the mechanism and its reproduction). It accepts exactly what
 * `/^data:image\/(?:png|gif|jpeg|webp);base64,[a-z0-9+/=\s]+$/i` did.
 *
 * @param source the `src` attribute's value, already trimmed by the caller
 * @returns true when the source is a non-empty base64 png, gif, jpeg or webp data URL
 */
export function isKeptDataImage({ source }: { source: string }): boolean {
  const header = DATA_IMAGE_HEADER.exec(source);
  if (header === null) {
    return false;
  }
  const bodyStart = header[0].length;
  if (bodyStart === source.length) {
    return false;
  }
  return characterRunEnd({ from: bodyStart, outside: OUTSIDE_DATA_IMAGE_BODY, text: source }) === source.length;
}

/** A source that would reach a remote host: `http:`, `https:` or protocol-relative. */
export const REMOTE_SOURCE = /^\s*(?:https?:)?\/\//i;
