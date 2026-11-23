import { describe, expect, it } from "vitest";

import { turnTaskLabel } from "../../../../../live/turn/taskLabel.js";

describe("turnTaskLabel", () => {
  it("carries the question so the author row says what the bot is doing", () => {
    expect(turnTaskLabel({ question: "what did we decide?" })).toBe("answering: what did we decide?");
  });

  it("falls back to a bare label for an empty question", () => {
    expect(turnTaskLabel({ question: "   " })).toBe("answering");
  });

  it("uses only the first line of a multi-line question", () => {
    expect(turnTaskLabel({ question: "first line\nsecond line" })).toBe("answering: first line");
  });

  it("clamps a long question rather than wrapping the author row", () => {
    expect(turnTaskLabel({ question: "x".repeat(200) })).toBe(`answering: ${"x".repeat(47)}…`);
  });

  it("drops a leading self-address so the label starts at the actual question", () => {
    expect(
      turnTaskLabel({
        question: "@(U1) which PRs are waiting on someone else?",
      }),
    ).toBe("answering: which PRs are waiting on someone else?");
  });

  it("keeps a mid-sentence id — only a LEADING run of addressing is dropped", () => {
    expect(turnTaskLabel({ question: "@(U1) add @(U2) to the whitelist" })).toBe(
      "answering: add @(U2) to the whitelist",
    );
  });
});
