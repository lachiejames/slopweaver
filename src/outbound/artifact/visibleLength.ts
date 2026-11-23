/**
 * VISIBLE length — what a reader actually sees, which is the only honest thing to bound.
 *
 * The rule exists because a naive `.length` lets one long URL eat a whole budget: a 100-character
 * TL;DR carrying a link would be rejected for characters nobody ever reads. So a `link` contributes
 * only its label, a `[n]` citation chip contributes the width of `[n]`, a mention contributes roughly
 * its handle, and a URL contributes NOTHING.
 *
 * It is deliberately platform-free and lives beside the artifact schema rather than in a renderer:
 * the rule "a link costs its label" is identical on Linear, GitHub and Notion, and is exactly the
 * kind of thing that otherwise gets re-implemented four times with four different bugs.
 *
 * Counting is by UTF-16 code unit (plain `String.length`), matching how Slack's own limits behave and
 * how the reference measurements (125 / 166 / 170 / 559 / 1091) were taken.
 */
import type { CitationWidth, DetailBlock, InlineRun } from "./types.js";

/** A mention renders as `@` plus a handle; the identity key is the closest platform-free proxy. */
function mentionVisibleLength({ person }: { person: string }): number {
  return person.length + 1;
}

/**
 * A group renders as `@` plus its handle. The key IS the handle in the ordinary case, so it is a closer
 * proxy than a person's identity key is — an `S…` id addressed instead over-counts, which errs toward
 * refusing an over-long line rather than letting one through.
 */
function groupVisibleLength({ handle }: { handle: string }): number {
  return handle.length + 1;
}

/** A broadcast renders as `@here` / `@channel`. */
function broadcastVisibleLength({ range }: { range: "here" | "channel" }): number {
  return range.length + 1;
}

/** A citation chip renders as its `[n]` label; an unknown id contributes nothing rather than throwing. */
function citationVisibleLength({
  citationId,
  citations,
}: {
  citationId: string;
  citations: readonly CitationWidth[];
}): number {
  const found = citations.find((c) => c.id === citationId);
  return found === undefined ? 0 : found.label.length;
}

/**
 * The visible width of one inline run.
 *
 * @param run the run to measure
 * @param citations the artifact's citations, used to resolve a `[n]` chip's width
 * @returns the number of UTF-16 code units a reader sees
 */
export function visibleLengthOfRun({
  run,
  citations,
}: {
  run: InlineRun;
  citations: readonly CitationWidth[];
}): number {
  switch (run.type) {
    case "text":
      return run.text.length;
    case "link":
      return run.label.length;
    case "mention":
      return mentionVisibleLength({ person: run.person });
    case "group":
      return groupVisibleLength({ handle: run.handle });
    case "broadcast":
      return broadcastVisibleLength({ range: run.range });
    case "citation":
      return citationVisibleLength({ citationId: run.citationId, citations });
  }
}

/**
 * The visible width of a run sequence.
 *
 * @param runs the runs to measure
 * @param citations the artifact's citations
 * @returns the summed visible width
 */
export function visibleLengthOfRuns({
  runs,
  citations,
}: {
  runs: readonly InlineRun[];
  citations: readonly CitationWidth[];
}): number {
  return runs.reduce((total, run) => total + visibleLengthOfRun({ citations, run }), 0);
}

/**
 * The visible PROSE width of one detail sub-block. A table contributes ZERO: it is bounded
 * structurally by rows x columns and per-cell width, never by total characters, because borders and
 * padding would otherwise make a perfectly readable ten-row table look verbose.
 *
 * @param block the sub-block to measure
 * @param citations the artifact's citations
 * @returns the visible prose width, excluding tables entirely
 */
export function visibleLengthOfDetailBlock({
  block,
  citations,
}: {
  block: DetailBlock;
  citations: readonly CitationWidth[];
}): number {
  switch (block.type) {
    case "paragraph":
      return visibleLengthOfRuns({ citations, runs: block.runs });
    case "bullets":
    case "list":
      return block.items.reduce((total, item) => total + visibleLengthOfRuns({ citations, runs: item }), 0);
    case "table":
      return 0;
  }
}

/**
 * The total visible PROSE width of a detail sequence — the number the total-detail cap bounds.
 *
 * @param detail the ordered detail sub-blocks
 * @param citations the artifact's citations
 * @returns the summed visible prose width, tables excluded
 */
export function visibleLengthOfDetail({
  detail,
  citations,
}: {
  detail: readonly DetailBlock[];
  citations: readonly CitationWidth[];
}): number {
  return detail.reduce((total, block) => total + visibleLengthOfDetailBlock({ block, citations }), 0);
}

/**
 * One label cut to fit, on a CODE POINT boundary rather than a UTF-16 one — shared by both alert cards.
 *
 * `slice` alone splits a surrogate pair, so an emoji in a monitor title came out as half a character in front
 * of the ellipsis — found by a review pass reading the dry-run's own bytes. Width is still measured in UTF-16
 * units, because that is what every cap in `../assistant/contentLimits.ts` counts.
 *
 * @param text the label to fit
 * @param room how many units are left for it
 * @returns the label, ellipsised on a whole character when it did not fit
 */
export function clippedToWidth({ text, room }: { text: string; room: number }): string {
  if (text.length <= room) {
    return text;
  }
  const budget = Math.max(1, room - 1);
  let kept = "";
  for (const point of text) {
    if (kept.length + point.length > budget) {
      break;
    }
    kept += point;
  }
  return `${kept}…`;
}
