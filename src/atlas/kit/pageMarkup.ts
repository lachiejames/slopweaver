/**
 * The small HTML pieces every section of an atlas page is built from: a cell, a link cell, a wrapped table and
 * a collapsed block.
 *
 * Apart from `./pageHtml.ts` so a section can live in its own module without importing back from the file that
 * assembles it. Provider-authored text is escaped here; a table's `rows` and a block's `body` are markup a
 * section already rendered, so they pass through as they are.
 */
import { escapeHtml } from "./pageTable.js";

/**
 * One `<td>` holding escaped text.
 *
 * @returns the cell's HTML
 */
export function cell({ value }: { value: string }): string {
  return `<td>${escapeHtml({ value })}</td>`;
}

/**
 * One `<td>` holding an escaped value in a monospace run.
 *
 * @returns the cell's HTML
 */
export function codeCell({ value }: { value: string }): string {
  return `<td><code>${escapeHtml({ value })}</code></td>`;
}

/**
 * Whether one stored link may be rendered as something a reader can click.
 *
 * `atlasSourceSchema` accepts any URL a provider handed back, with no scheme restriction, so a stored
 * `javascript:` or `data:text/html` link would otherwise become a clickable payload on a page published for
 * somebody else to open. A Codex pre-mortem named exactly that. Only the two web schemes are
 * navigable here; anything else is printed as text, which loses nothing and executes nothing.
 *
 * @param href the stored deep link
 * @returns whether it is safe to put in an `href`
 */
function isNavigable({ href }: { href: string }): boolean {
  try {
    const scheme = new URL(href).protocol;
    return scheme === "https:" || scheme === "http:";
  } catch {
    return false;
  }
}

/**
 * A link cell — a link for a web URL, the raw text for anything else, an em dash for nothing.
 *
 * @returns the cell's HTML
 */
export function linkCell({ href }: { href: string | null }): string {
  if (href === null) {
    return '<td class="muted">—</td>';
  }
  const safe = escapeHtml({ value: href });
  if (!isNavigable({ href })) {
    return `<td class="muted" title="not a web URL, so it is printed rather than linked"><code>${safe}</code></td>`;
  }
  return `<td><a href="${safe}" rel="noreferrer">open</a></td>`;
}

/**
 * Wrap a table so a wide one scrolls inside its own box rather than pushing the page sideways.
 *
 * @returns the wrapped table's HTML
 */
export function scrollTable({ head, rows }: { head: readonly string[]; rows: readonly string[] }): string {
  const header = head.map((label) => `<th>${escapeHtml({ value: label })}</th>`).join("");
  return `<div class="scroll"><table><thead><tr>${header}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

/**
 * One collapsed section. `open` is reserved for the panels a defect can hide in.
 *
 * @returns the section's HTML
 */
export function details({ summary, body, open }: { summary: string; body: string; open: boolean }): string {
  return `<details${open ? " open" : ""}><summary>${escapeHtml({ value: summary })}</summary>${body}</details>`;
}
