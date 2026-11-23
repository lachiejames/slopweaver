/**
 * The Linear DOCUMENT renderer — pure, deterministic, and the only place a document's byte layout lives.
 *
 * Every block is rendered by `./render.ts`'s `renderBlock`, the same function an issue body uses, so a
 * paragraph, list, image or code fence comes out byte-identical wherever it is sent. What a document adds is
 * only the arrangement: the caller's blocks, in the caller's order, one blank line apart, with nothing
 * synthesised around them — no section headings and no collapsible, because neither belongs to a page.
 *
 * Determinism carries the same weight it does for an issue: `update` re-renders the form, so identical input
 * must produce identical bytes or every re-render reads as an edit.
 */

import { renderBlock } from "./render.js";
import type { FreeformBlock } from "./types.js";

/** The one blank line that separates every top-level block — the same gap `./render.ts` uses. */
const GAP = "\n\n";

/**
 * Render a document body to the exact markdown sent as Linear's `content`.
 *
 * @param content the document's blocks, in order
 * @returns the markdown, with no trailing newline
 */
export function renderDocumentContent({ content }: { content: readonly FreeformBlock[] }): string {
  return content.map((block) => renderBlock({ block })).join(GAP);
}
