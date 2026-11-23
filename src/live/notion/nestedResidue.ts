/**
 * What a page read SAYS about its nested expansion: the residue lines and the coverage detail, derived from
 * the structured claims `blockTree.ts` returns so no wording is decided at the call site. Pure, so every
 * gap's sentence is a unit test.
 */
import type { NotionNestedExpansion } from "./blockShape.js";
import { NOTION_NESTED_CALLS_MAX, NOTION_NESTED_TIME_MS } from "./blockTree.js";

/**
 * The residue lines for one slice's nested expansion.
 *
 * Nothing is said when the expansion is whole and names no child object: a line on a complete read would be
 * noise a reader learns to skip, and then skips on the read where it matters.
 *
 * @param nested the structured claims the expansion returned
 * @returns the lines, the incompleteness first when there is any
 */
export function notionNestedResidue({ nested }: { nested: NotionNestedExpansion }): readonly string[] {
  const residue: string[] = [];
  if (!nested.complete) {
    residue.push(
      `nested blocks are INCOMPLETE: ${String(nested.unexpanded.length)} block(s) were not fully expanded — ` +
        "data.nested.unexpanded names each one and why",
    );
  }
  if (nested.stoppedBy === "calls") {
    residue.push(
      `nested expansion stopped at its ${String(nested.callLimit)}-call ceiling: raise it with --nested-calls ` +
        `<n> (at most ${String(NOTION_NESTED_CALLS_MAX)}), or read a smaller slice with --limit and continue with --after`,
    );
  }
  if (nested.stoppedBy === "time") {
    residue.push(
      `nested expansion started no call after ${String(NOTION_NESTED_TIME_MS / 1000)}s (the call already in ` +
        "flight finished, retries included): read a smaller slice with --limit and continue with --after",
    );
  }
  if (nested.linkedObjects.length > 0) {
    residue.push(
      `${String(nested.linkedObjects.length)} child page(s) or database(s) are named in data.nested.linkedObjects ` +
        "and not read: each is its own object, read by its url",
    );
  }
  return residue;
}

/**
 * The coverage detail for one page read, which claims a whole nested expansion only when it has one.
 *
 * @param after the cursor this slice resumed from, or undefined for the opening slice
 * @param complete whether every nested block beneath the slice was expanded
 * @returns the one-line detail
 */
export function notionPageCoverageDetail({
  after,
  complete,
}: {
  after: string | undefined;
  complete: boolean;
}): string {
  const slice =
    after === undefined
      ? "one page object and its first top-level block page"
      : "one page object and one continued top-level block page";
  if (complete) {
    return `${slice}, every block nested beneath it expanded; child pages and databases are named, not read`;
  }
  return `${slice}; its nested expansion is INCOMPLETE, see residue`;
}
