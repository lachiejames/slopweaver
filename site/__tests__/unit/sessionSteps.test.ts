/**
 * A source line's parts, joined whole and split into what the owner reads and what a session runs: the split follows the
 * producer's marks, never the punctuation.
 */
import { describe, expect, it } from "vitest";

import { sourceLineCopy, standingAddStep } from "../../lib/sessionSteps";

describe("sourceLineCopy", () => {
  it("keeps the line whole in order and splits interleaved parts by their marks", () => {
    expect(
      sourceLineCopy({
        parts: [
          { kind: "reader", text: "A Claude session put this on your queue." },
          { kind: "session-step", text: "A session runs `slopweaver profile words`." },
          { kind: "reader", text: "No standing ask covers it." },
          { kind: "session-step", text: "It records one with `slopweaver profile standing add`." },
        ],
      }),
    ).toStrictEqual({
      lead: "A Claude session put this on your queue. No standing ask covers it.",
      steps: ["A session runs `slopweaver profile words`.", "It records one with `slopweaver profile standing add`."],
      whole:
        "A Claude session put this on your queue. A session runs `slopweaver profile words`. No standing ask covers " +
        "it. It records one with `slopweaver profile standing add`.",
    });
  });

  it("leaves reader prose whole however it is punctuated, backticks included", () => {
    const text = "It came from v1.2 of the `queue` read, e.g. a Board row. Then it stopped.";
    expect(sourceLineCopy({ parts: [{ kind: "reader", text }] })).toStrictEqual({
      lead: text,
      steps: [],
      whole: text,
    });
  });

  it("draws nothing for no parts, and drops an empty part without a stray space", () => {
    expect(sourceLineCopy({ parts: [] })).toStrictEqual({ lead: "", steps: [], whole: "" });
    expect(
      sourceLineCopy({
        parts: [
          { kind: "reader", text: "" },
          { kind: "session-step", text: "Run `x`." },
        ],
      }),
    ).toStrictEqual({ lead: "", steps: ["Run `x`."], whole: "Run `x`." });
  });
});

describe("standingAddStep", () => {
  it("names the coverage in the command a session runs", () => {
    expect(standingAddStep({ coverage: "registered-rows" })).toBe(
      "If one of your standing asks covers it, a session finds your turn with `slopweaver profile words` and records " +
        "it with `slopweaver profile standing add <id> --anchor <anchor> --covers registered-rows`.",
    );
  });
});
