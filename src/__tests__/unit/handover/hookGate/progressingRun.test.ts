/*
 * A progressing run is not an abandoned one: `stopGateDecision` stays silent about a run that moved since the gate
 * last looked, and leads a refusal over a static run with the delta, or says it is a first look.
 */
import { describe, expect, it } from "vitest";

import type { GateObservation } from "../../../../handover/gateReport.js";
import { stopGateDecision } from "../../../../handover/hookGate.js";
import { NO_ENV, run, STOP } from "./harness.js";

/** What the gate recorded seeing last time, for the delta assertions. */
function seen({
  failed,
  atIso = "2026-08-06T02:00:00.000Z",
  head = "aaaaaaaaaaaa",
}: {
  failed: number;
  atIso?: string;
  head?: string | undefined;
}): GateObservation {
  return { atIso, head, tally: { failed, notEvaluated: 0, passed: 3 - failed } };
}

describe("a progressing run is not an abandoned one", () => {
  it("stays silent when the run moved since the gate last looked, and says which", () => {
    const runs = [
      run({ progress: { because: "the branch moved aaaaaaa → bbbbbbb", kind: "moved" }, slug: "busy-doc" }),
    ];
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs });

    expect(decision.kind).toBe("allow");
    expect(decision.kind === "allow" ? decision.why : "").toBe(
      "busy-doc is progressing (the branch moved aaaaaaa → bbbbbbb)",
    );
  });

  it("still blocks a run that has not moved since the last firing", () => {
    const runs = [run({ previous: seen({ failed: 2 }), progress: { kind: "static" } })];

    expect(stopGateDecision({ env: NO_ENV, payload: STOP, runs }).kind).toBe("block");
  });

  /** A gate that says the same thing nine times teaches the reader to skip the tenth. */
  it("leads the refusal with the delta rather than a restatement", () => {
    const runs = [
      run({
        previous: seen({ atIso: "2026-08-06T02:00:00.000Z", failed: 2 }),
        progress: { kind: "static" },
        slug: "stuck",
      }),
    ];
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs });
    const lines = decision.kind === "block" ? decision.lines : [];

    expect(lines[2]).toBe(
      "  stuck — NOTHING has changed since 2026-08-06T02:00:00.000Z: still 2 of 3 probe(s) unmet " +
        "(re-checked just now), branch still at aaaaaaa.",
    );
  });

  it("says it is a first look when the gate has no baseline for the run", () => {
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs: [run({ slug: "fresh" })] });
    const lines = decision.kind === "block" ? decision.lines : [];

    expect(lines[2]).toBe("  fresh — first look at this run: 2 of 3 probe(s) unmet (re-checked just now).");
  });
});
