import { describe, expect, it } from "vitest";

import { type PressWaiver, unprovenClause, waiverClause } from "../../../../../cli/commands/github/pressJudgment.js";

// `judgmentAtPressTime` itself is exercised end to end in `./landingRun/`, over the same fixtures the
// press loop uses — what has no witness there is the two clause functions, whose whole job is that the two
// tenses of one sentence never drift apart.

const WAIVERS: readonly PressWaiver[] = [
  {
    did: ", acknowledging the Codex pairing floor on a standing human approval",
    reason: "a standing human approval",
    subject: "codex-loop-incomplete",
    would: "; a standing human approval would acknowledge the Codex pairing floor",
  },
  {
    did: ", acknowledging the superseded rollup on a replacement this read proved",
    reason: "every pinning run was replaced",
    subject: "ci-rollup-superseded",
    would: "; a proven replacement would acknowledge the superseded rollup",
  },
];

describe("waiverClause", () => {
  it("is the empty string when the press answered nothing, so the outcome reads as it always did", () => {
    expect(waiverClause({ tense: "did", waivers: [] })).toBe("");
  });

  it("joins the DID spellings in the order the waivers were composed", () => {
    expect(waiverClause({ tense: "did", waivers: WAIVERS })).toBe(
      ", acknowledging the Codex pairing floor on a standing human approval" +
        ", acknowledging the superseded rollup on a replacement this read proved",
    );
  });

  it("joins the WOULD spellings for a dry run, so a preview cannot describe a different act", () => {
    expect(waiverClause({ tense: "would", waivers: WAIVERS })).toBe(
      "; a standing human approval would acknowledge the Codex pairing floor" +
        "; a proven replacement would acknowledge the superseded rollup",
    );
  });
});

describe("unprovenClause", () => {
  it("is the empty string when there was no rollup disagreement to prove anything about", () => {
    expect(unprovenClause({ unproven: undefined })).toBe("");
  });

  it("says the rollup was NOT acknowledged, and why, beside the enqueue's own refusal", () => {
    expect(unprovenClause({ unproven: "the head's check page was truncated" })).toBe(
      "; the superseded rollup was NOT acknowledged — the head's check page was truncated",
    );
  });
});
