/**
 * The two renderings of a `slopweaver slack tagged` document: a human text block, and `--json`.
 *
 * Pure. The header says first whether the list can be trusted as whole, and every row's "no later word" names the
 * instant it holds to, its own — a row in a channel the crawl reached less far holds less far.
 */

import { safeJsonStringify } from "../../lib/safeJson.js";
import type { SlackTaggedDocument, SlackTaggedRow } from "./taggedTypes.js";

/**
 * How a row says whether the owner has answered.
 *
 * @param row the row, its answered flag and the horizon a `false` holds to
 * @returns the phrase
 */
function answeredPhrase({ row }: { row: SlackTaggedRow }): string {
  if (row.answered === null) {
    return "whether you replied is unknown (found by live search only)";
  }
  if (row.answered) {
    return "you replied in the thread since";
  }
  if (row.answeredThroughIso === null) {
    return "no later word from you in the thread, though how far this channel was read is unknown";
  }
  return `no later word from you in the thread up to ${row.answeredThroughIso}`;
}

/**
 * The header line, which says first whether the list can be trusted as whole.
 *
 * @param document the document to head
 * @returns the line
 */
function headerOf({ document }: { document: SlackTaggedDocument }): string {
  const window = `in the last ${String(document.coverage.windowDays)} day(s)`;
  if (document.status === "unavailable") {
    return "slack tagged: UNAVAILABLE — the corpus could not be read, so this is NOT an all-clear (reason under residue)";
  }
  if (document.status === "incomplete") {
    return (
      `slack tagged: INCOMPLETE — ${String(document.rows.length)} tag(s) of you ${window} listed from what could be ` +
      "read, and one may be missing, so this is NOT an all-clear (reason under residue)"
    );
  }
  return (
    `slack tagged: ${String(document.rows.length)} tag(s) of you by a person ${window}, newest first ` +
    `(${String(document.counts.unanswered)} with no later word from you, each up to the instant its row names)`
  );
}

/**
 * The human rendering: a header, one three-line block per row, then the residue — always, zero rows or not.
 *
 * @param document the document to render
 * @returns the lines to print, in order
 */
export function renderSlackTaggedText({ document }: { document: SlackTaggedDocument }): readonly string[] {
  const lines = [headerOf({ document })];
  for (const row of document.rows) {
    lines.push(
      `${row.taggedAtIso} · ${row.authorName} in ${row.room} · ${answeredPhrase({ row })}`,
      `  ${row.text}`,
      `  ${row.permalink}`,
    );
  }
  lines.push("residue:", ...document.coverage.residue.map((line) => `  - ${line}`));
  return lines;
}

/**
 * The `--json` rendering: one pretty-printed document through the size-guarded serialiser.
 *
 * @param document the document to serialise
 * @returns the JSON text, with no trailing newline
 */
export function renderSlackTaggedJson({ document }: { document: SlackTaggedDocument }): string {
  return safeJsonStringify({ label: "slack tagged document", space: 2, value: document });
}
