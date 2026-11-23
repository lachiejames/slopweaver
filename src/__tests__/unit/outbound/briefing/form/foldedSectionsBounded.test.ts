/** A folded section's notes and the page's history sections are capped, each refusal naming the archive verb. */
import { describe, expect, it } from "vitest";

import { HISTORY_MAX_SECTIONS, SECTION_MAX_NOTES } from "../../../../../briefing/caps.js";
import type { BriefingContent } from "../../../../../outbound/briefing/types.js";
import { FORM, text } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the folded sections are bounded too", () => {
  /** `count` one-line notes. */
  function manyNotes({ count }: { count: number }): readonly { headline: BriefingContent }[] {
    return Array.from({ length: count }, (_, index) => ({ headline: text({ value: `Note ${String(index)}.` }) }));
  }

  it("admits a section at exactly the note cap", () => {
    const form = { ...FORM, earlierToday: { notes: manyNotes({ count: SECTION_MAX_NOTES }), summary: "earlier" } };

    expect(refusals({ form })).toEqual([]);
  });

  it("refuses a section one note over the cap, naming the archive verb", () => {
    const form = { ...FORM, earlierToday: { notes: manyNotes({ count: SECTION_MAX_NOTES + 1 }), summary: "earlier" } };

    expect(refusals({ form })).toEqual([
      `earlierToday.notes: a section holds at most ${String(SECTION_MAX_NOTES)} notes; the page was 690 KB with 489 of them. ` +
        "Run `slopweaver briefing archive --form <path>` to move the oldest notes into a dated archive file, then render again.",
    ]);
  });

  it("refuses more history sections than the cap, naming the archive verb", () => {
    const section = { notes: manyNotes({ count: 1 }), summary: "a day" };
    const form = { ...FORM, history: Array.from({ length: HISTORY_MAX_SECTIONS + 1 }, () => section) };

    expect(refusals({ form })).toEqual([
      `history: the page carries at most ${String(HISTORY_MAX_SECTIONS)} history sections. Run ` +
        "`slopweaver briefing archive --form <path>` to move the oldest sections into a dated archive file.",
    ]);
  });
});
