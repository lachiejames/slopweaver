/*
 * `stopGateDecision` — every way it disarms: no run, the harness's own once-per-turn bound, a vanished branch, a
 * recorded question, a closed run, the kill switch, an unreadable payload, several runs, and nothing evaluable.
 */
import { describe, expect, it } from "vitest";

import { HOOK_KILL_SWITCH, stopGateDecision } from "../../../../handover/hookGate.js";
import { NO_ENV, run, STOP } from "./harness.js";

describe("stopGateDecision — every way it disarms", () => {
  it("is inert when no run exists at all", () => {
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs: [] });

    expect(decision.kind).toBe("allow");
    expect(decision.kind === "allow" ? decision.why : "").toBe("no run is open");
  });

  /** The harness's own bound: true once this gate has blocked this turn, so it refuses at most once. */
  it("allows the stop when stop_hook_active is set, without looking at the runs", () => {
    const decision = stopGateDecision({
      env: NO_ENV,
      payload: { hook_event_name: "Stop", stop_hook_active: true },
      runs: [run()],
    });

    expect(decision.kind).toBe("allow");
    expect(decision.kind === "allow" ? decision.why : "").toContain("stop_hook_active");
  });

  it("allows the stop when the recorded branch no longer exists, and says so", () => {
    const decision = stopGateDecision({
      env: NO_ENV,
      payload: STOP,
      runs: [run({ branchResolves: false, slug: "stale-doc" })],
    });

    expect(decision.kind).toBe("allow");
    expect(decision.kind === "allow" ? decision.why : "").toContain("stale-doc");
  });

  it("allows the stop when a question has been recorded — a legitimate ending", () => {
    expect(stopGateDecision({ env: NO_ENV, payload: STOP, runs: [run({ phase: "waiting-on-owner" })] }).kind).toBe(
      "allow",
    );
  });

  it("allows the stop when the run is closed", () => {
    expect(stopGateDecision({ env: NO_ENV, payload: STOP, runs: [run({ phase: "closed" })] }).kind).toBe("allow");
  });

  it("honours the kill switch before anything else", () => {
    const decision = stopGateDecision({ env: { [HOOK_KILL_SWITCH]: "1" }, payload: STOP, runs: [run()] });

    expect(decision.kind).toBe("allow");
    expect(decision.kind === "allow" ? decision.why : "").toBe(`${HOOK_KILL_SWITCH}=1`);
  });

  it("ignores a kill switch set to anything other than 1, so a stray value cannot silently disable it", () => {
    expect(stopGateDecision({ env: { [HOOK_KILL_SWITCH]: "0" }, payload: STOP, runs: [run()] }).kind).toBe("block");
  });

  it("treats an unreadable payload as not-already-blocked rather than throwing", () => {
    expect(stopGateDecision({ env: NO_ENV, payload: "not an object", runs: [] }).kind).toBe("allow");
    expect(stopGateDecision({ env: NO_ENV, payload: undefined, runs: [run()] }).kind).toBe("block");
  });

  it("blocks once for several open runs rather than per run", () => {
    const decision = stopGateDecision({
      env: NO_ENV,
      payload: STOP,
      runs: [run({ slug: "one" }), run({ slug: "two" })],
    });

    expect(decision.kind).toBe("block");
    expect(decision.kind === "block" ? decision.lines[0] : "").toContain("2 of THIS session's");
  });

  it("allows the stop when every open run is stale, even alongside closed ones", () => {
    const runs = [run({ branchResolves: false }), run({ phase: "closed", slug: "done-one" })];

    expect(stopGateDecision({ env: NO_ENV, payload: STOP, runs }).kind).toBe("allow");
  });

  it("allows the stop when nothing about the run could actually be evaluated", () => {
    const runs = [run({ slug: "unprobeable", tally: { failed: 0, notEvaluated: 4, passed: 0 } })];
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs });

    expect(decision.kind).toBe("allow");
    expect(decision.kind === "allow" ? decision.why : "").toBe("unprobeable has no probe anything could evaluate");
  });
});
