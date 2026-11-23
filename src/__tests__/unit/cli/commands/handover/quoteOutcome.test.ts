/**
 * `quoteOutcomeLines`: each row's line, its steers under it, each unreadable file, then a tally counting rows by
 * verdict in a fixed order — or saying no row anchors on the owner's words when none was quoted.
 */
import { describe, expect, it } from "vitest";

import { type QuoteOutcome, quoteOutcomeLines } from "../../../../../cli/commands/handover/quoteOutcome.js";

/** One row outcome with the given slug, verdict and steers; the flags are irrelevant to rendering. */
function outcome({
  slug,
  verdict,
  steers = [],
}: {
  slug: string;
  verdict: QuoteOutcome["verdict"];
  steers?: QuoteOutcome["steers"];
}): QuoteOutcome {
  return { line: `${verdict} line`, recordUnreadable: false, slug, steers, verdict, writeFailed: false, wrote: false };
}

describe("quoteOutcomeLines", () => {
  it("prints each row, its steers under it, each unreadable file, then the tally in verdict order", () => {
    const lines = quoteOutcomeLines({
      outcomes: [
        outcome({
          slug: "row-a",
          steers: [
            { index: 1, line: "add steer", recordUnreadable: false, verdict: "add", writeFailed: false, wrote: true },
          ],
          verdict: "add",
        }),
        outcome({ slug: "row-b", verdict: "current" }),
        outcome({ slug: "row-c", verdict: "add" }),
      ],
      unreadable: ["broken.md"],
    });

    expect(lines).toEqual([
      "handover quote: row-a — add line",
      "handover quote: row-a steer 1 — add steer",
      "handover quote: row-b — current line",
      "handover quote: row-c — add line",
      "handover quote: broken.md — not read: the file or its front matter would not read, so it was not quoted",
      "handover quote: 3 rows: 1 current, 2 add",
    ]);
  });

  it("says no row anchors on the owner's words when nothing was quoted", () => {
    expect(quoteOutcomeLines({ outcomes: [], unreadable: [] })).toEqual([
      "handover quote: no row anchors on the owner's words",
    ]);
  });
});
