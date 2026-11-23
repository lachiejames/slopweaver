/**
 * PURE sanitising of a received mail's HTML body into one inert document the Queue draws inside a triage card, so the owner
 * sees exactly what is in the email before giving a steer.
 *
 * The body is hostile by default: its sender chose every byte. So this is an ALLOWLIST serialiser, not a filter. parse5
 * (the WHATWG parser, scripting disabled) builds the tree, and this file writes out ONLY the elements, attributes and
 * CSS declarations it names (the tables are `./mailHtmlAllowlist.ts`, the CSS checks `./mailCss.ts`), with its own
 * escaping — parse5's serialiser never sees the untrusted tree, so nothing it would have kept can survive by default.
 *
 * Three properties hold by construction, and the console's iframe (`sandbox=""`, no capability at all) plus the CSP
 * this file writes into the document's head are the second boundary for each:
 *
 * - **Nothing runs.** No script, no event handler, no form, no frame, no foreign (SVG/MathML) content — none is on the
 *   allowlist, and the dropped set takes their contents with them.
 * - **Nothing is fetched.** A remote image loses its `src` (its `alt` and size stay, an inert placeholder) and is
 *   counted; `srcset` is never kept; a CSS declaration naming `url(` or any other fetching function is dropped, and a
 *   `<style>` block holding one is dropped whole. Only a base64 `data:` raster image keeps its source.
 * - **Nothing navigates.** Every link loses its `href`; the target stays in `title`, so hovering shows where it went.
 */
import { type DefaultTreeAdapterMap, parse, html as parse5Html } from "parse5";
import { sanitizeInlineStyle, sanitizeStyleBlock } from "./mailCss.js";
import {
  DATA_IMAGE,
  DROPPED_ELEMENTS,
  ELEMENT_ATTRIBUTES,
  GLOBAL_ATTRIBUTES,
  KEPT_ELEMENTS,
  REMOTE_SOURCE,
  VOID_ELEMENTS,
} from "./mailHtmlAllowlist.js";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type Attribute = Element["attrs"][number];

/** What sanitising one body produced. */
export interface SanitizedMailHtml {
  /** A whole HTML document, safe as an iframe's `srcdoc`. */
  readonly document: string;
  /** How many `<img>` pointed at a remote host and were drawn without their source. */
  readonly remoteImagesBlocked: number;
  /**
   * Whether anything a reader can see survived: a non-whitespace character of text, or an image kept with its source.
   * A body that was only a tracking pixel and layout sanitises to a blank page, and a card draws the plain-text
   * alternative instead (`./cardMailRender.ts`).
   */
  readonly hasVisibleContent: boolean;
}

/** The document's own policy: nothing but inline style and `data:` images and fonts, no form, no base. */
export const MAIL_DOCUMENT_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";

const HTML_NAMESPACE = parse5Html.NS.HTML;

/** Text escaped for an element's content. */
function escapeText({ text }: { text: string }): string {
  return text.replace(/[&<>]/g, (char) => {
    if (char === "&") {
      return "&amp;";
    }
    return char === "<" ? "&lt;" : "&gt;";
  });
}

/** Text escaped for a double-quoted attribute value. */
function escapeAttribute({ value }: { value: string }): string {
  return escapeText({ text: value }).replace(/"/g, "&quot;");
}

/** Whether a node is an element. */
function isElement(node: Node): node is Element {
  return "tagName" in node;
}

/** The text a node holds, concatenated — what a `<style>` element's children carry. */
function textOf({ node }: { node: Node }): string {
  if (node.nodeName === "#text" && "value" in node) {
    return node.value;
  }
  if (!("childNodes" in node)) {
    return "";
  }
  return node.childNodes.map((child) => textOf({ node: child })).join("");
}

/** What the walk has written so far, threaded through one serialisation. */
interface WalkState {
  remoteImagesBlocked: number;
  visible: boolean;
  readonly styles: string[];
}

/** An image source as kept: a `data:` raster only; a remote one is counted and dropped. */
function keptImageSource({ value, state }: { value: string; state: WalkState }): string | undefined {
  if (REMOTE_SOURCE.test(value)) {
    state.remoteImagesBlocked += 1;
    return undefined;
  }
  if (!DATA_IMAGE.test(value.trim())) {
    return undefined;
  }
  state.visible = true;
  return value;
}

/** One allowlisted attribute's value as written, or undefined when it is not kept. */
function keptAttributeValue({
  tagName,
  name,
  value,
  state,
}: {
  tagName: string;
  name: string;
  value: string;
  state: WalkState;
}): string | undefined {
  if (!GLOBAL_ATTRIBUTES.has(name) && ELEMENT_ATTRIBUTES[tagName]?.has(name) !== true) {
    return undefined;
  }
  if (name === "style") {
    const css = sanitizeInlineStyle({ css: value });
    return css.length === 0 ? undefined : css;
  }
  if (name === "src") {
    return keptImageSource({ state, value });
  }
  return value;
}

/** Whether an attribute is a plain one, rather than namespaced (`xlink:href`, `xml:lang`) foreign markup. */
function isPlainAttribute({ attr }: { attr: Attribute }): boolean {
  return attr.namespace === undefined || attr.namespace === "";
}

/** The attributes one kept element writes, already filtered, rewritten and escaped, each with a leading space. */
function attributesOf({ element, state }: { element: Element; state: WalkState }): string {
  const written: string[] = [];
  let title: string | undefined;
  let href: string | undefined;
  for (const attr of element.attrs.filter((candidate) => isPlainAttribute({ attr: candidate }))) {
    const name = attr.name.toLowerCase();
    if (element.tagName === "a" && name === "href") {
      href = attr.value.trim();
      continue;
    }
    if (name === "title") {
      title = attr.value;
      continue;
    }
    const value = keptAttributeValue({ name, state, tagName: element.tagName, value: attr.value });
    if (value !== undefined) {
      written.push(` ${name}="${escapeAttribute({ value })}"`);
    }
  }
  const shownTitle = linkTitle({ href, title });
  if (shownTitle !== undefined) {
    written.push(` title="${escapeAttribute({ value: shownTitle })}"`);
  }
  return written.join("");
}

/**
 * The title an element shows on hover: its own, with a link's target appended so the dropped `href` stays readable.
 *
 * @param href the link target this element carried, when it was a link with one
 * @param title the element's own title attribute
 * @returns the title to write, when there is one
 */
function linkTitle({ href, title }: { href: string | undefined; title: string | undefined }): string | undefined {
  if (href === undefined || href.length === 0) {
    return title;
  }
  if (title === undefined || title.trim().length === 0) {
    return href;
  }
  return `${title} (${href})`;
}

/**
 * Write one node and everything under it that survives.
 *
 * @param node the node to write
 * @param state the walk's counters and the style blocks it collected
 * @returns the serialised HTML
 */
function writeNode({ node, state }: { node: Node; state: WalkState }): string {
  if (node.nodeName === "#text" && "value" in node) {
    if (node.value.trim().length > 0) {
      state.visible = true;
    }
    return escapeText({ text: node.value });
  }
  if (!isElement(node)) {
    return "";
  }
  if (node.namespaceURI !== HTML_NAMESPACE || DROPPED_ELEMENTS.has(node.tagName)) {
    return "";
  }
  if (node.tagName === "style") {
    const kept = sanitizeStyleBlock({ css: textOf({ node }) });
    if (kept !== undefined) {
      state.styles.push(kept);
    }
    return "";
  }
  const inner = node.childNodes.map((child) => writeNode({ node: child, state })).join("");
  if (!KEPT_ELEMENTS.has(node.tagName)) {
    return inner;
  }
  const open = `<${node.tagName}${attributesOf({ element: node, state })}>`;
  if (VOID_ELEMENTS.has(node.tagName)) {
    return open;
  }
  return `${open}${inner}</${node.tagName}>`;
}

/**
 * The `<style>` blocks a mail put in its `<head>` — where most bulk mail keeps its layout. Only `<style>` is read there;
 * everything else in the head (`<meta>`, `<base>`, `<link>`, `<script>`, `<title>`) is dropped.
 *
 * @param head the parsed head element
 * @param state where kept blocks are collected
 */
function collectHeadStyles({ head, state }: { head: Element; state: WalkState }): void {
  for (const child of head.childNodes) {
    if (isElement(child) && child.tagName === "style" && child.namespaceURI === HTML_NAMESPACE) {
      const kept = sanitizeStyleBlock({ css: textOf({ node: child }) });
      if (kept !== undefined) {
        state.styles.push(kept);
      }
    }
  }
}

/** The house style under every mail: no margin of its own, and a blocked image drawn as a dashed box. */
const BASE_STYLE = "body{margin:0;padding:8px;overflow-wrap:anywhere}img:not([src]){outline:1px dashed #9ca3af}";

/**
 * Sanitise one received mail's HTML body into an inert, self-contained document.
 *
 * Total: any input, malformed included, yields a document — at worst an empty body.
 *
 * @param html the decoded `text/html` alternative exactly as the sender wrote it
 * @returns the document and how many remote images it was drawn without
 */
export function sanitizeMailHtml({ html }: { html: string }): SanitizedMailHtml {
  const root = parse(html, { scriptingEnabled: false });
  const state: WalkState = { remoteImagesBlocked: 0, styles: [], visible: false };
  const htmlElement = root.childNodes.find((child) => isElement(child) && child.tagName === "html");
  let body = "";
  if (htmlElement !== undefined && isElement(htmlElement)) {
    for (const child of htmlElement.childNodes) {
      if (isElement(child) && child.tagName === "head") {
        collectHeadStyles({ head: child, state });
      } else if (isElement(child) && child.tagName === "body") {
        body = child.childNodes.map((node) => writeNode({ node, state })).join("");
      }
    }
  }
  const styles = [BASE_STYLE, ...state.styles].map((css) => `<style>${css}</style>`).join("");
  const document =
    "<!doctype html><html><head>" +
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${MAIL_DOCUMENT_CSP}">` +
    `${styles}</head><body>${body}</body></html>`;
  return { document, hasVisibleContent: state.visible, remoteImagesBlocked: state.remoteImagesBlocked };
}
