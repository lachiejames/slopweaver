/**
 * What one `handover quote` row came to, and how a whole run of them prints: each row's line, its steers under it,
 * each unreadable file, then the tally. The judging and writing is `./quoteRun.ts`; this is only the outcome's shape
 * and its human rendering.
 */
import { logger } from "../../../lib/logger.js";
import type { QuoteVerdict } from "./quotePlan.js";
import type { SteerOutcome } from "./quoteSteerRun.js";

/** One row's outcome, as printed and as `--json` carries it. */
export interface QuoteOutcome {
  readonly slug: string;
  readonly verdict: QuoteVerdict["kind"];
  readonly line: string;
  readonly wrote: boolean;
  readonly writeFailed: boolean;
  /** The record would not read at all — a store read that may pass next time, never a settled absence. */
  readonly recordUnreadable: boolean;
  /** Each further steer the row holds, judged and written one index at a time (`./quoteSteerRow.ts`). */
  readonly steers: readonly SteerOutcome[];
}

/**
 * The lines a whole run prints, in order: each row's line, each of its steers' under it, each unreadable file's, then
 * the tally. Pure, so the rendering is tested without a logger.
 *
 * @param outcomes every row in scope, in the order it was quoted
 * @param unreadable the board files that would not read, so were never quoted
 * @returns every line, ready to print one per line
 */
export function quoteOutcomeLines({
  outcomes,
  unreadable,
}: {
  outcomes: readonly QuoteOutcome[];
  unreadable: readonly string[];
}): readonly string[] {
  const lines: string[] = [];
  outcomes.forEach((outcome) => {
    lines.push(`handover quote: ${outcome.slug} — ${outcome.line}`);
    outcome.steers.forEach((steer) => {
      lines.push(`handover quote: ${outcome.slug} steer ${String(steer.index)} — ${steer.line}`);
    });
  });
  unreadable.forEach((name) => {
    lines.push(`handover quote: ${name} — not read: the file or its front matter would not read, so it was not quoted`);
  });
  lines.push(`handover quote: ${quoteTally({ outcomes })}`);
  return lines;
}

/**
 * Print {@link quoteOutcomeLines}, one line each.
 *
 * @param outcomes every row in scope, in the order it was quoted
 * @param unreadable the board files that would not read, so were never quoted
 */
export function printQuoteOutcomes({
  outcomes,
  unreadable,
}: {
  outcomes: readonly QuoteOutcome[];
  unreadable: readonly string[];
}): void {
  quoteOutcomeLines({ outcomes, unreadable }).forEach((line) => {
    logger.out({ line });
  });
}

/** One line counting the rows by verdict, in a fixed order. */
function quoteTally({ outcomes }: { outcomes: readonly QuoteOutcome[] }): string {
  const kinds: readonly QuoteVerdict["kind"][] = [
    "current",
    "add",
    "refresh",
    "repair",
    "drop",
    "unread",
    "still-unread",
    "malformed",
  ];
  const counts = kinds
    .map((kind) => ({ count: outcomes.filter((outcome) => outcome.verdict === kind).length, kind }))
    .filter(({ count }) => count > 0)
    .map(({ count, kind }) => `${String(count)} ${kind}`);
  return counts.length === 0
    ? "no row anchors on the owner's words"
    : `${String(outcomes.length)} rows: ${counts.join(", ")}`;
}
