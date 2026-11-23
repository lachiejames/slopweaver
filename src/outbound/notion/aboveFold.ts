/**
 * What a reader sees on a Notion page BEFORE scrolling past the first heading.
 *
 * A Notion body is raw markdown rather than a typed form, so there is no `details` block and no five-block
 * chrome to count. The fold here is the FIRST heading line: everything above it is the lead a reader meets
 * on opening the page, and everything from that heading down is the document they chose to read.
 *
 * That boundary is a convention this repository is choosing rather than one Notion enforces, and it is the
 * honest one available: a page's opening paragraphs are what a reader judges it by, exactly as a pull
 * request's Problem cell is. `../voice/aboveFold.ts` owns the rules; this module owns which text they see.
 *
 * Fenced code and quoted lines are left in place, because `authoredProseOf` already removes both.
 */
import type { AboveFoldCell } from "../voice/aboveFold.js";

/** A markdown heading line, which is where the lead ends. */
const HEADING_LINE = /^[ \t]*#{1,6}[ \t]/;

/**
 * The lead of a Notion body: every line before the first heading.
 *
 * @param markdown the body to publish, without its H1 title line
 * @returns the one lead region, or none when the body opens with a heading
 */
export function notionAboveFoldCells({ markdown }: { markdown: string }): readonly AboveFoldCell[] {
  const lines = markdown.split(/\r?\n/u);
  const fold = lines.findIndex((line) => HEADING_LINE.test(line));
  const lead = (fold === -1 ? lines : lines.slice(0, fold)).join("\n");
  return lead.trim().length === 0 ? [] : [{ path: "body lead", text: lead }];
}

/**
 * The BODY of a Notion page: everything from the first heading down.
 *
 * The page is the owner-facing markdown deliverable the register's
 * `voice-rules-run-late-and-only-on-one-lane` class names, and until now a rule read its opening paragraphs
 * and nothing else — so a whole SOP could go out in a voice the owner does not write in, as long as its lead was
 * clean. One cell rather than one per section, because `authoredProseOf` already splits a multi-line region
 * into per-line prose and the finding reports the rule rather than every place it fired.
 *
 * @param markdown the body to publish, without its H1 title line
 * @returns the one body region, or none when the page is all lead
 */
export function notionBelowFoldCells({ markdown }: { markdown: string }): readonly AboveFoldCell[] {
  const lines = markdown.split(/\r?\n/u);
  const fold = lines.findIndex((line) => HEADING_LINE.test(line));
  if (fold === -1) {
    return [];
  }
  const body = lines.slice(fold).join("\n");
  return body.trim().length === 0 ? [] : [{ path: "body", text: body }];
}
