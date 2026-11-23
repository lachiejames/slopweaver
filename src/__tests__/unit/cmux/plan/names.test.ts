/*
 * `deriveWorkspaceTitle` and `dispatchSessionName`: the title an ask's workspace shows, and the harness session name
 * one ask's worker and its reviewer answer to.
 */
import { describe, expect, it } from "vitest";

import { deriveWorkspaceTitle, dispatchSessionName } from "../../../../cmux/planNames.js";

describe("deriveWorkspaceTitle", () => {
  it("returns the question unchanged when it already fits", () => {
    expect(deriveWorkspaceTitle({ askQuestion: "why did the staging pool exhaust?" })).toBe(
      "why did the staging pool exhaust?",
    );
  });

  it("collapses embedded newlines and repeated whitespace into single spaces", () => {
    expect(deriveWorkspaceTitle({ askQuestion: "why did\n  the staging   pool\nexhaust?" })).toBe(
      "why did the staging pool exhaust?",
    );
  });

  it("truncates past the max length with a trailing ellipsis", () => {
    const long = "a".repeat(80);

    const title = deriveWorkspaceTitle({ askQuestion: long });

    expect(title).toBe(`${"a".repeat(59)}…`);
    expect(title.length).toBe(60);
  });

  it("falls back to a fixed placeholder for a blank question", () => {
    expect(deriveWorkspaceTitle({ askQuestion: "   " })).toBe("(no question text)");
  });
});

describe("dispatchSessionName", () => {
  it("names one ask's worker and its reviewer distinctly, from the same coordinates", () => {
    expect(dispatchSessionName({ askChannel: "CtestChan01", askMessageTs: "1787720788.183959", role: "ask" })).toBe(
      "ask-CtestChan01-1787720788.183959",
    );
    expect(dispatchSessionName({ askChannel: "CtestChan01", askMessageTs: "1787720788.183959", role: "review" })).toBe(
      "review-CtestChan01-1787720788.183959",
    );
  });

  it("stays inside the 40 characters the harness registry shows before it truncates", () => {
    const name = dispatchSessionName({
      askChannel: "CtestChan01",
      askMessageTs: "1787720788.183959",
      role: "review",
    });

    expect(name.length).toBe(36);
  });

  it("collapses everything a shell would read as syntax — the name is typed onto a boot LINE", () => {
    expect(dispatchSessionName({ askChannel: "C1; rm -rf /", askMessageTs: "1787720788.183959", role: "ask" })).toBe(
      "ask-C1-rm-rf-1787720788.183959",
    );
  });

  it("gives up channel characters rather than the ts, so two asks in one channel stay distinguishable", () => {
    const first = dispatchSessionName({
      askChannel: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      askMessageTs: "1787720788.183959",
      role: "review",
    });
    const second = dispatchSessionName({
      askChannel: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      askMessageTs: "1787720788.999999",
      role: "review",
    });

    expect(first).toBe("review-CAAAAAAAAAAAAAA-1787720788.183959");
    expect(first.length).toBe(40);
    expect(second).toBe("review-CAAAAAAAAAAAAAA-1787720788.999999");
  });

  it("keeps the TAIL of an over-long ts, which is the half that tells two asks apart", () => {
    expect(dispatchSessionName({ askChannel: "C1", askMessageTs: "99991787720788.183959", role: "ask" })).toBe(
      "ask-C1-1787720788.183959",
    );
  });
});
