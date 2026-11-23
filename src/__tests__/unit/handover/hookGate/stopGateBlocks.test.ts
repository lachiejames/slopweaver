/*
 * `stopGateDecision` in the one case it is for: an open run whose branch still exists, refused with the run, the
 * branch, the re-checked tally, every escape and the kill switch named.
 */
import { describe, expect, it } from "vitest";

import { HOOK_KILL_SWITCH, stopGateDecision } from "../../../../handover/hookGate.js";
import { NO_ENV, run, STOP } from "./harness.js";

describe("stopGateDecision — it blocks only in the one case it is for", () => {
  it("blocks an open run whose branch still exists", () => {
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs: [run()] });

    expect(decision.kind).toBe("block");
  });

  it("names the run, the branch and the RE-CHECKED tally in the refusal", () => {
    const runs = [run({ slug: "my-doc", tally: { failed: 3, notEvaluated: 1, passed: 2 } })];
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs });
    const text = decision.kind === "block" ? decision.lines.join("\n") : "";

    expect(text).toContain("my-doc");
    expect(text).toContain("feat/a");
    expect(text).toContain("4 of 6 probe(s) unmet (re-checked just now)");
    expect(text).toContain("2 passing, 3 failing, 1 unexamined");
  });

  /**
   * The exact phrase the previous version printed on every one of eight or nine firings in one session, while
   * the truth on disk moved from 2-of-6 passing to all six passing. Asserted as an absence because the sentence
   * itself was the defect: it labelled its own number unverified and then blocked a turn on it.
   */
  it("never claims a number it did not verify", () => {
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs: [run()] });
    const text = decision.kind === "block" ? decision.lines.join("\n") : "";

    expect(text).not.toContain("unverified");
    expect(text).not.toContain("from the journal");
  });

  /** A refusal the reader cannot act on is what makes hooks feel haunted. */
  it("spells out all three escapes and the kill switch", () => {
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs: [run({ slug: "my-doc" })] });
    const text = decision.kind === "block" ? decision.lines.join("\n") : "";

    expect(text).toContain("handover ask my-doc");
    expect(text).toContain("handover finish my-doc");
    expect(text).toContain("handover abandon my-doc");
    expect(text).toContain(HOOK_KILL_SWITCH);
  });
});
