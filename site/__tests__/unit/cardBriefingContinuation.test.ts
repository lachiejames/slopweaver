/*
 * Where a card's partial briefing says its rest starts (`site/lib/cardBriefings.ts` `BriefingRest`). An entire briefing must
 * be readable even when it takes multiple reads. The voice had been handed a cut briefing and a sentence to say, then
 * guessed a raw-markup offset for the rest and skipped part of the page.
 */
import { describe, expect, it } from "vitest";

import { type ReadCardBriefing, withFittedBriefings } from "../../lib/cardBriefings";

/** A briefing's real path under a pages directory. */
const PAGE = "/h/.slopweaver/pages/off-cmux/index.html";

/** The page's own cap, `../../components/live/talkSession.ts` `TOOL_OUTPUT_MAX`. */
const CAP_BYTES = 24 * 1024;

/** A card answer before its briefings. */
const ANSWER = { card: { key: "ask:x" } };

/**
 * The one briefing the fit hands back, as a partial one.
 *
 * @returns its text and rest
 */
function fittedPartial({ briefing }: { briefing: ReadCardBriefing }): {
  readonly text: string;
  readonly rest: { readonly from: number; readonly path: string };
} {
  const fitted = withFittedBriefings({ answer: ANSWER, briefings: [briefing], capBytes: CAP_BYTES, maxBytes: 4096 });
  const [one] = fitted.briefings;
  expect(one.read).toBe("partial");
  return one as { text: string; rest: { from: number; path: string } };
}

describe("a briefing cut to fit a card answer", () => {
  it("resumes at the carried prefix's UTF-8 bytes, so a multibyte page is neither skipped nor repeated", () => {
    const words = "é—".repeat(3000);
    const { text, rest } = fittedPartial({
      briefing: { read: true, slug: "off-cmux", source: { masked: false, path: PAGE }, text: words },
    });
    const bytes = Buffer.from(words, "utf8");
    expect([rest.path, rest.from === text.length, bytes.subarray(0, rest.from).toString("utf8") === text]).toEqual([
      PAGE,
      false,
      true,
    ]);
    expect(Buffer.byteLength(text, "utf8")).toBe(rest.from);
  });

  it("resumes at the top of the page when a mask changed the words' length, repeating rather than skipping", () => {
    const { rest } = fittedPartial({
      briefing: { read: true, slug: "off-cmux", source: { masked: true, path: PAGE }, text: "a".repeat(8000) },
    });
    expect(rest).toEqual({ from: 0, path: PAGE });
  });

  it("keeps the verb's own offset for a briefing the verb stopped at and the fit did not cut again", () => {
    const fitted = withFittedBriefings({
      answer: ANSWER,
      briefings: [
        {
          read: "partial",
          rest: { from: 524_288, path: PAGE },
          say: "I could only read the first part of the off-cmux briefing.",
          slug: "off-cmux",
          source: { masked: true, path: PAGE },
          text: "the first part",
        },
      ],
      capBytes: CAP_BYTES,
      maxBytes: 4096,
    });
    expect(fitted.briefings).toEqual([
      {
        read: "partial",
        rest: { from: 524_288, path: PAGE },
        say: "I could only read the first part of the off-cmux briefing.",
        slug: "off-cmux",
        text: "the first part",
      },
    ]);
  });

  it("moves a verb-stopped briefing's offset back to where the fit cut it, when the fit cuts it shorter", () => {
    const { text, rest } = fittedPartial({
      briefing: {
        read: "partial",
        rest: { from: 524_288, path: PAGE },
        say: "I could only read the first part of the off-cmux briefing.",
        slug: "off-cmux",
        source: { masked: false, path: PAGE },
        text: "b".repeat(8000),
      },
    });
    expect([rest.from, rest.from === text.length, rest.from < 8000]).toEqual([text.length, true, true]);
  });
});
