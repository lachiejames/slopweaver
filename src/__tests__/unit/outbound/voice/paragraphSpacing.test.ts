import { describe, expect, it } from "vitest";

import {
  isParagraphDense,
  isQuoteAnswerGapped,
  paragraphSpacingRefusalFor,
} from "../../../../outbound/voice/paragraphSpacing.js";

/** The shape the owner pointed at as what this rule encodes, re-worded: short paragraphs, one blank line apart. */
const HIS_SHAPE = [
  "Was just chatting with Kieran about the shared config pain.",
  "",
  "Kieran had an idea worth trying: move these feature-specific constants out of the shared module and into the one that reads them",
  "",
  "E.g. move `export const widgets` from `lib/shared/constants/widgets.ts` to `lib/widgets/constants.ts`",
].join("\n");

/**
 * The owner's own hand-fixed thread reply — each answer directly under the quote it answers, a
 * blank line only between separate ideas. `slopweaver slack read-thread
 * 'https://acme.slack.com/archives/C0SYN000002/p1790600627898889?thread_ts=1790566514.594969&cid=C0SYN000002' --around 0`
 */
const HIS_QUOTE_SHAPE = [
  "> where we list out all 22 UI variants? There is great value in this and I'd rather it not cut it off",
  "it wouldn't cut it off i think. only problem and change are capped, 60 words each, since that's what a reviewer reads before deciding to open the diff",
  "",
  "the 22 variants would go in detail, which renders folded with no word cap (20k chars total), so the whole list survives",
  "",
  "> Please let's not cap PR description word counts with a hard limit",
  "same answer for this one, everything below problem and change is uncapped",
].join("\n");

/** The same reply as this gate used to force it: a blank line pushed between each quote and its answer. */
const FORCED_QUOTE_SHAPE = [
  "> where we list out all 22 UI variants? There is great value in this and I'd rather it not cut it off",
  "",
  "it wouldn't cut it off i think. only problem and change are capped, 60 words each, since that's what a reviewer reads before deciding to open the diff",
  "",
  "the 22 variants would go in detail, which renders folded with no word cap (20k chars total), so the whole list survives",
  "",
  "> Please let's not cap PR description word counts with a hard limit",
  "",
  "same answer for this one, everything below problem and change is uncapped",
].join("\n");

describe("isParagraphDense", () => {
  it("passes the owner's own three-paragraph message, blank line between each", () => {
    expect(isParagraphDense({ text: HIS_SHAPE })).toBe(false);
  });

  it("refuses the same three paragraphs with the blank lines taken out", () => {
    expect(
      isParagraphDense({
        text: HIS_SHAPE.split("\n")
          .filter((line) => line.length > 0)
          .join("\n"),
      }),
    ).toBe(true);
  });

  it("passes a single paragraph with no break in it at all", () => {
    expect(isParagraphDense({ text: "shipping the retry fix today, staging looked clean overnight" })).toBe(false);
  });

  it("passes the empty string", () => {
    expect(isParagraphDense({ text: "" })).toBe(false);
  });

  it("passes two paragraphs separated by several blank lines", () => {
    expect(isParagraphDense({ text: "one idea\n\n\n\nthe next idea" })).toBe(false);
  });

  it("refuses exactly two paragraphs run together", () => {
    expect(isParagraphDense({ text: "one idea\nthe next idea" })).toBe(true);
  });

  it("passes a run of bullet list items, which is one paragraph however many lines it takes", () => {
    expect(isParagraphDense({ text: "- one\n- two\n- three" })).toBe(false);
  });

  it("passes a nested list, sub-points indented under their headline the way a one-list's fallback spells them", () => {
    expect(isParagraphDense({ text: "• a\n    ◦ a1, e.g. this\n    ◦ a2\n• b" })).toBe(false);
  });

  it("passes a numbered list, in both `1.` and `1)` spellings", () => {
    expect(isParagraphDense({ text: "1. one\n2. two" })).toBe(false);
    expect(isParagraphDense({ text: "1) one\n2) two" })).toBe(false);
  });

  it("refuses a sentence welded to the list under it", () => {
    expect(isParagraphDense({ text: "here are the options:\n- one\n- two" })).toBe(true);
  });

  it("passes a multi-line blockquote", () => {
    expect(isParagraphDense({ text: "> the reviewer said this\n> and then this" })).toBe(false);
  });

  it("passes a fenced code block whose lines all touch", () => {
    expect(isParagraphDense({ text: "the repro:\n\n```\nyarn validate\nyarn lint\n```" })).toBe(false);
  });

  it("refuses two paragraphs that touch after a fenced block, not only before one", () => {
    expect(isParagraphDense({ text: "```\ncode\n```\n\nfirst idea\nsecond idea" })).toBe(true);
  });

  it("treats a CRLF break exactly as a LF break", () => {
    expect(isParagraphDense({ text: "one idea\r\nthe next idea" })).toBe(true);
    expect(isParagraphDense({ text: "one idea\r\n\r\nthe next idea" })).toBe(false);
  });

  it("treats a whitespace-only line as the blank line it looks like", () => {
    expect(isParagraphDense({ text: "one idea\n   \nthe next idea" })).toBe(false);
  });

  it("passes a quote with its answer directly under it, which is one block", () => {
    expect(isParagraphDense({ text: HIS_QUOTE_SHAPE })).toBe(false);
  });

  it("passes a multi-line quote answered by more than one touching line", () => {
    expect(isParagraphDense({ text: "> one\n> two\nanswer\nand its second line" })).toBe(false);
  });

  it("refuses two quote-and-answer pairs welded together with no blank line between the ideas", () => {
    expect(isParagraphDense({ text: "> first point\nfirst answer\n> second point\nsecond answer" })).toBe(true);
  });

  it("refuses a sentence welded to the quote under it", () => {
    expect(isParagraphDense({ text: "the reviewer said:\n> the point\nmy answer" })).toBe(true);
  });
});

describe("isQuoteAnswerGapped", () => {
  it("passes the owner's own hand-fixed reply, answer directly under each quote", () => {
    expect(isQuoteAnswerGapped({ text: HIS_QUOTE_SHAPE })).toBe(false);
  });

  it("refuses the shape the gate used to force, a blank line after each quote", () => {
    expect(isQuoteAnswerGapped({ text: FORCED_QUOTE_SHAPE })).toBe(true);
  });

  it("refuses a single quote pushed one blank line off its answer", () => {
    expect(isQuoteAnswerGapped({ text: "> the point\n\nmy answer" })).toBe(true);
  });

  it("passes a message that is only a quote", () => {
    expect(isQuoteAnswerGapped({ text: "> the point" })).toBe(false);
  });

  it("passes two quotes separated by a blank line, since a quote is not an answer", () => {
    expect(isQuoteAnswerGapped({ text: "> first\n\n> second\nanswer" })).toBe(false);
  });

  it("passes a quote followed by a fenced block", () => {
    expect(isQuoteAnswerGapped({ text: "> the error\n\n```\nstack\n```" })).toBe(false);
  });

  it("passes text with no quote in it", () => {
    expect(isQuoteAnswerGapped({ text: HIS_SHAPE })).toBe(false);
  });
});

describe("paragraphSpacingRefusalFor", () => {
  const ESCAPE = 'slopweaver hatch open voice-rules --reason "<why this one is a legitimate exception>", then re-run';

  it("returns nothing for text that already breathes", () => {
    expect(paragraphSpacingRefusalFor({ escape: ESCAPE, text: HIS_SHAPE })).toEqual([]);
  });

  it("returns nothing for the owner's quote-and-answer reply", () => {
    expect(paragraphSpacingRefusalFor({ escape: ESCAPE, text: HIS_QUOTE_SHAPE })).toEqual([]);
  });

  it("returns exactly one refusal naming the quote gap and the escape for a blank line after a quote", () => {
    const refusals = paragraphSpacingRefusalFor({ escape: ESCAPE, text: FORCED_QUOTE_SHAPE });

    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("a quote has a blank line between it and its answer");
    expect(refusals[0]).toContain(`for one deliberate exception run ${ESCAPE};`);
  });

  it("returns both refusals when a message has each defect", () => {
    const refusals = paragraphSpacingRefusalFor({
      escape: ESCAPE,
      text: "> the point\n\nmy answer\nan unrelated second idea",
    });

    expect(refusals.length).toBe(2);
    expect(refusals[0]).toContain("its paragraphs run together");
    expect(refusals[1]).toContain("a quote has a blank line between it and its answer");
  });

  it("returns exactly one refusal naming the escape for dense text", () => {
    const refusals = paragraphSpacingRefusalFor({ escape: ESCAPE, text: "one idea\nthe next idea" });

    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("its paragraphs run together");
    expect(refusals[0]).toContain(`for one deliberate exception run ${ESCAPE};`);
  });
});
