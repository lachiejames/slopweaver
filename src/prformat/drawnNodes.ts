/**
 * The HTML a pull-request body renders to, as `./renderedTables.ts` reads it: which node is an element, what it holds,
 * which tags break a line, read straight through, strike or hide, and which children a reader sees without a click.
 */

import type { DefaultTreeAdapterMap } from "parse5";

export type Node = DefaultTreeAdapterMap["node"];
export type Element = DefaultTreeAdapterMap["element"];

/**
 * Whether a node is an element.
 *
 * @returns true for an element, false for text, a comment or a document
 */
export function isElement(node: Node): node is Element {
  return "tagName" in node;
}

/**
 * The child nodes of a node, empty for one that holds none, and a template's inert content as its children.
 *
 * @returns the node's children in document order
 */
export function childrenOf({ node }: { node: Node }): readonly Node[] {
  if (isElement(node) && "content" in node) {
    return node.content.childNodes;
  }
  return "childNodes" in node ? node.childNodes : [];
}

/**
 * Whether an element is ruby text, drawn small ABOVE the word it annotates rather than in it: the letters a reader is
 * shown leave it out, so `Pro<ruby>b<rt>x</rt></ruby>lem` still spells Problem (fallback review r27).
 *
 * @returns true for an `<rt>`
 */
export function annotates({ node }: { node: Node }): boolean {
  return isElement(node) && node.tagName === "rt";
}

/**
 * The tags a reader sees as a break between what comes before and after them: a line break, a block, and a raised or
 * lowered run. `Ri<br>sk`, `<p>Ri</p><p>sk</p>` and `R<sup>isk</sup>` do not read as the word Risk, so each reads with
 * a space (fallback review r14).
 */
export const SEPARATED = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

/**
 * The {@link SEPARATED} tags a spelling reads straight through: a raised or lowered run keeps its line, so an empty
 * `Pro<sub></sub>blem` is still drawn as one word (fallback review r26).
 */
export const RAISED = new Set(["sub", "sup"]);

/** The tags a reader sees struck through, whose text is read between `~` as a struck `~~Risk~~` source reads. */
export const STRUCK = new Set(["del", "s", "strike"]);

/**
 * The inline tags a reader reads straight through: their text is the word as written, however it is styled. The set
 * is an ALLOWLIST (fallback review r15): a tag outside it and outside {@link SEPARATED} and {@link STRUCK} — `<rp>`,
 * which draws nothing, `<bdo dir="rtl">`, which draws the word reversed, `<q>`, `<ruby>` — reads as
 * `DRAWN_OBJECT` (`./renderedTables.ts`): something is drawn, but no word, so an unknown tag can cost a refusal and never an acceptance.
 */
export const READ_THROUGH = new Set([
  "a",
  "abbr",
  "b",
  "big",
  "body",
  "cite",
  "code",
  "dfn",
  "em",
  "head",
  "html",
  "i",
  "ins",
  "kbd",
  "mark",
  "samp",
  "small",
  "span",
  "strong",
  "tt",
  "u",
  "var",
]);

/**
 * Whether an element hides itself and everything under it: one carrying `hidden`, a `<template>`, whose content is
 * inert, or an `<rp>`, which ruby text hides. Neither reads as nothing: were GitHub to strip the attribute or the tag, its text would show, so reading it
 * as nothing let `<span hidden>No </span>Risk` pass as Risk (fallback review r18). It reads as `DRAWN_OBJECT` (`./renderedTables.ts`),
 * and a table, row or cell under it reads as that marker too, so hiding costs a refusal and never an acceptance.
 *
 * @returns true for an element a reader is not shown
 */
export function conceals({ node }: { node: Node }): boolean {
  return (
    isElement(node) &&
    (node.tagName === "rp" || node.tagName === "template" || node.attrs.some((attr) => attr.name === "hidden"))
  );
}

/**
 * The children a reader sees without a click: a closed `<details>` shows its FIRST `<summary>` alone, as HTML
 * draws it — a second one is hidden with the rest (fallback review r16).
 *
 * @returns the children drawn open
 */
export function shownChildren({ node }: { node: Node }): readonly Node[] {
  const children = childrenOf({ node });
  const closed = isElement(node) && node.tagName === "details" && !node.attrs.some((attr) => attr.name === "open");
  if (!closed) {
    return children;
  }
  const summary = children.find((child) => isElement(child) && child.tagName === "summary");
  return summary === undefined ? [] : [summary];
}
