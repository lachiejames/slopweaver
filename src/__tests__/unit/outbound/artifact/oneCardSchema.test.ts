import { describe, expect, it } from "vitest";

import { oneCardArtifactSchema } from "../../../../outbound/artifact/asMeSchema.js";

const BOUNDS = { cardVisibleMax: 60, maxLines: 3 };

/** One line carrying a single text run — the common shape, stated once. */
function line({ text }: { text: string }) {
  return { runs: [{ text, type: "text" }] };
}

describe("oneCardArtifactSchema", () => {
  it("accepts a multi-line card and keeps every line, because `lines` IS the line structure", () => {
    const parsed = oneCardArtifactSchema(BOUNDS).safeParse({
      kind: "one-card",
      lines: [line({ text: "pls review" }), line({ text: "one card, rendered clean" })],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.lines.length : 0).toBe(2);
  });

  it("bounds the WHOLE card, so a caller cannot get under the cap by adding lines", () => {
    const singleWideLine = oneCardArtifactSchema(BOUNDS).safeParse({
      kind: "one-card",
      lines: [line({ text: "x".repeat(61) })],
    });
    const sameTextAcrossThreeLines = oneCardArtifactSchema(BOUNDS).safeParse({
      kind: "one-card",
      lines: [line({ text: "x".repeat(21) }), line({ text: "x".repeat(20) }), line({ text: "x".repeat(20) })],
    });

    expect(singleWideLine.success).toBe(false);
    expect(sameTextAcrossThreeLines.success).toBe(false);
  });

  it("names the measurement, the cap, and that splitting will not help", () => {
    const parsed = oneCardArtifactSchema(BOUNDS).safeParse({
      kind: "one-card",
      lines: [line({ text: "x".repeat(61) })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("61 visible chars, over the 60 cap");
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("Splitting it into more lines will NOT");
  });

  it("accepts a card sitting exactly ON the whole-card cap", () => {
    const parsed = oneCardArtifactSchema(BOUNDS).safeParse({
      kind: "one-card",
      lines: [line({ text: "x".repeat(30) }), line({ text: "y".repeat(30) })],
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses more lines than the cap allows", () => {
    const parsed = oneCardArtifactSchema(BOUNDS).safeParse({
      kind: "one-card",
      lines: [line({ text: "a" }), line({ text: "b" }), line({ text: "c" }), line({ text: "d" })],
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses an empty card, because a message with nothing in it is not a post", () => {
    const parsed = oneCardArtifactSchema(BOUNDS).safeParse({ kind: "one-card", lines: [] });

    expect(parsed.success).toBe(false);
  });

  it("refuses a `\\n` smuggled into a text run, pointing at `lines` as where a break goes", () => {
    const parsed = oneCardArtifactSchema(BOUNDS).safeParse({
      kind: "one-card",
      lines: [line({ text: "pls review\nand merge" })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("`lines` IS the line structure");
  });

  it("refuses a `\\n` in a link LABEL too — a label is rendered prose like any other", () => {
    const parsed = oneCardArtifactSchema(BOUNDS).safeParse({
      kind: "one-card",
      lines: [{ runs: [{ label: "the\nPR", type: "link", url: "https://example.test/1" }] }],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("`lines` IS the line structure");
  });

  it("converts a raw `<@U…>` in a line into a typed mention run, exactly as the drip form does", () => {
    const parsed = oneCardArtifactSchema(BOUNDS).safeParse({
      kind: "one-card",
      lines: [line({ text: "<@U123> pls review" })],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.lines[0]!.runs[0] : null).toEqual({ person: "U123", type: "mention" });
  });

  it("refuses an unknown key rather than dropping it", () => {
    const parsed = oneCardArtifactSchema(BOUNDS).safeParse({
      kind: "one-card",
      lines: [line({ text: "hi" })],
      messages: [],
    });

    expect(parsed.success).toBe(false);
  });
});
