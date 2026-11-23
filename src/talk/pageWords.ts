/**
 * A published briefing's words, as the console voice is handed them: the page's HTML with its markup gone. It runs
 * BEFORE the credential mask (`./pageWordsRead.ts`), never after: a page holding
 * `ghp&#95;AAAA…` matched no token shape as markup and came back as `ghp_AAAA…` once decoded, and a tag splitting
 * a token is joined the same way.
 *
 * The voice must be able to read the briefings associated with the cards it opens. MEASURED over every call in one
 * stretch: of 20 briefings attached to a card the voice opened, 5
 * were read whole, 10 in part and 5 never. The model read each one itself through `file_read` in 10 KiB windows of
 * RAW markup, and the page shell's `<style>` block alone is about 7,500 bytes, so a first window carried about
 * 2,500 bytes of words and the model picked its own `--from` past the rest. Through this module, the 29 pages
 * published that week are 8.3 KiB at the median and 18 KiB at p90 as a JSON string, 26 of them under 18 KiB, which
 * is what lets the card's answer carry one whole (`site/lib/cardBriefings.ts`); the largest, 97 KiB, is cut and says
 * so. Repro: `slopweaver talk file read --path <each page of the week> --words --budget 524288 --json`.
 *
 * A PARSER, parse5, not a scanner: what counts as a tag, a comment, an unclosed script or an entity is whatever HTML's
 * own tokenizer says, so the words are the text a browser lays out. A hand-written scanner met a new spelling on
 * every review pass — a visible `2 < 3 > 1` cut as a tag, `&copy;` left undecoded, an unclosed `<script>` read as
 * words — and the spec table has no such gap. Pure: a string in, a string out.
 */
import { type DefaultTreeAdapterMap, parse } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

/** Elements whose contents are never words the owner reads: the head, styles, scripts, templates, drawings. */
const NON_CONTENT: ReadonlySet<string> = new Set(["head", "noscript", "script", "style", "svg", "template"]);

/**
 * The elements that run on inside a line of words — HTML's phrasing content that carries text. EVERY other element
 * opens and closes a line of its own: a list of blocks missed `address` and ran two of them together,
 * whereas an element this list misses costs at most a line break, never two words joined.
 */
const INLINE: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "font",
  "i",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

/**
 * Whether a tree node is an element, carrying a tag and attributes.
 *
 * @returns true on an element
 */
function isElement(node: Node): node is Element {
  return "tagName" in node;
}

/**
 * An image as the words that stand in for it: `[image: <alt>]`, or nothing with no alt text.
 *
 * @returns the stand-in, spaced off the words around it
 */
function imageWords({ image }: { image: Element }): string {
  const alt = image.attrs.find((attr) => attr.name === "alt");
  if (alt === undefined || alt.value.trim() === "") {
    return " ";
  }
  return ` [image: ${alt.value.trim()}] `;
}

/**
 * One node's words, its children's in order: text as the parser decoded it, a list item as a bullet, a table cell
 * closed by a column break, every block a line of its own; comments and non-content elements give nothing.
 *
 * @returns the node's words, lines not yet collapsed
 */
function nodeWords({ node }: { node: Node }): string {
  if (node.nodeName === "#text" && "value" in node) {
    return node.value;
  }
  if (!("childNodes" in node)) {
    return "";
  }
  if (!isElement(node)) {
    return node.childNodes.map((child) => nodeWords({ node: child })).join("");
  }
  if (NON_CONTENT.has(node.tagName)) {
    return " ";
  }
  if (node.tagName === "img") {
    return imageWords({ image: node });
  }
  const inner = node.childNodes.map((child) => nodeWords({ node: child })).join("");
  if (node.tagName === "li") {
    return `\n- ${inner}\n`;
  }
  if (node.tagName === "td" || node.tagName === "th") {
    return `${inner} | `;
  }
  if (INLINE.has(node.tagName)) {
    return inner;
  }
  return `\n${inner}\n`;
}

/**
 * The words of one briefing: non-content blocks dropped, images as their alt text, list items as bullets, every
 * block a line of its own, entities decoded by the parser, runs of spaces collapsed and no blank line: every byte is
 * the voice's.
 *
 * @param html the page's HTML, to be masked again once it is words
 * @returns the briefing's words, trimmed; empty for a page with none
 */
export function pageWords({ html }: { html: string }): string {
  return nodeWords({ node: parse(html) })
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/gu, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}
