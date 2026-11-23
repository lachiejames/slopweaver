/**
 * The lines under a row of the owner's list's headline: the owner's code-owner share of a review ask, then the subject's title.
 *
 * Split from `./render.ts`, which sits at the code-line floor `file-size-ratchet` holds it to; the row's headline
 * and fold stay there because they render through that module's own content and fold renderers.
 */
import { codeOwnerSliceRuns } from "../../review/codeOwnerSlice.js";
import { escapeText } from "./escape.js";
import type { BriefingYourRow } from "./types.js";

/**
 * The slice line, each path as `<code>` — a path is an identifier, never prose, so a file whose name starts with a hash
 * never reads to the page's bare-reference gate as a pull-request number — then the title, each only when the
 * row carries it.
 *
 * @param row the ranked row, as the session-start verb produced it
 * @returns the HTML between the row's headline and its fold, empty when it carries neither
 */
export function renderUnderHeadline({ row }: { row: BriefingYourRow }): string {
  const slice =
    row.codeOwnerSlice === undefined
      ? ""
      : `<div class="bg">${codeOwnerSliceRuns({ slice: row.codeOwnerSlice })
          .map((run) => (run.code ? `<code>${escapeText({ text: run.text })}</code>` : escapeText({ text: run.text })))
          .join("")}</div>`;
  const title = row.title === undefined ? "" : `<div class="bg">${escapeText({ text: row.title })}</div>`;
  return `${slice}${title}`;
}
