/**
 * The escapes every pull-request body fragment goes through, so a caller's text can never become markup, and the
 * inline-run renderer both description renderers (`./render.ts` and `./legacy/renderLayout.ts`) fill a block with.
 * Pure.
 */

import type { Content, Inline } from "./types.js";

/**
 * Escape text destined for an HTML element body.
 *
 * `&` first, or the ampersands introduced by the later replacements get double-escaped.
 *
 * @param text the raw caller text
 * @returns the text safe to place inside an element
 */
export function escapeCell({ text }: { text: string }): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Escape text destined for a double-quoted HTML attribute.
 *
 * @param text the raw caller text
 * @returns the text safe to place inside `attr="…"`
 */
export function escapeAttr({ text }: { text: string }): string {
  return escapeCell({ text }).replaceAll('"', "&quot;");
}

/**
 * One `<img>` tag. A display width is written LAST, and only when set, so `./parseContent.ts`'s `IMG` reads the
 * attributes in one fixed order and a body written before widths existed renders byte for byte as it did.
 *
 * @param url the image source
 * @param alt the alt text
 * @param width the display width in pixels GitHub sizes the picture to, when the author set one
 * @returns the escaped tag
 */
export function imageTag({ url, alt, width }: { url: string; alt: string; width?: number | undefined }): string {
  const sized = width === undefined ? "" : ` width="${String(width)}"`;
  return `<img src="${escapeAttr({ text: url })}" alt="${escapeAttr({ text: alt })}"${sized}>`;
}

/**
 * One inline run. Its text is escaped, and the renderer alone owns the tag.
 *
 * @param run the run to render
 * @returns the HTML for it
 */
export function renderInline({ run }: { run: Inline }): string {
  const text = escapeCell({ text: run.text });
  switch (run.kind) {
    case "text":
      return text;
    case "strong":
      return `<strong>${text}</strong>`;
    case "em":
      return `<em>${text}</em>`;
    case "code":
      return `<code>${text}</code>`;
    case "link":
      return `<a href="${escapeAttr({ text: run.url })}">${text}</a>`;
  }
}

/**
 * A whole block's content. Every run escapes its text, so a caller can never emit markup.
 *
 * @param content the ordered runs
 * @returns the HTML for the block's interior
 */
export function renderContent({ content }: { content: Content }): string {
  return content.map((run) => renderInline({ run })).join("");
}
