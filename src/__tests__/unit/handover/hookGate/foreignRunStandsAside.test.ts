/*
 * A run another session is driving is never blocked on: `stopGateDecision` stands aside for a run held elsewhere,
 * released or unidentifiable, and `observableRuns` never records an observation against a foreign run's journal.
 */
import { describe, expect, it } from "vitest";

import { observableRuns, stopGateDecision } from "../../../../handover/hookGate.js";
import { MINE, NO_ENV, OTHER_WRITER, run, STOP } from "./harness.js";

describe("a run another session is driving is never blocked on", () => {
  /**
   * The measured cross-session case. The gate fired on a run a live driver held and offered four ways out:
   * `resume` started a second agent on a branch already being driven — the collision that produced two competing
   * all-green PRs for one fix — and `finish`/`abandon`/`ask` each wrote to the other session's journal.
   */
  it("stands aside for a run held elsewhere, naming the session rather than an exit", () => {
    const runs = [run({ ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER }, slug: "held" })];
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs });

    expect(decision.kind).toBe("allow");
    expect(decision.kind === "allow" ? decision.why : "").toBe("held is held by another session");
  });

  /** Its exits are the damage, so a refusal about another run must not mention them even in passing. */
  it("offers no exit against a foreign run even when it blocks on one of this session's", () => {
    const runs = [
      run({ ownership: { kind: "mine", writer: { ...OTHER_WRITER, sessionId: MINE } }, slug: "mine-doc" }),
      run({ ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER }, slug: "theirs-doc" }),
    ];
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs });
    const text = decision.kind === "block" ? decision.lines.join("\n") : "";

    expect(decision.kind).toBe("block");
    expect(text).toContain("mine-doc");
    expect(text).not.toContain("theirs-doc");
  });

  /** "I might be the owner" is not verification, and the cost of being wrong is another session's run. */
  it("stands aside when this session cannot identify itself at all", () => {
    const runs = [run({ ownership: { kind: "elsewhere", thisSession: undefined, writer: OTHER_WRITER } })];

    expect(stopGateDecision({ env: NO_ENV, payload: STOP, runs }).kind).toBe("allow");
  });

  it("blocks normally on a run this session owns", () => {
    const runs = [run({ ownership: { kind: "mine", writer: { ...OTHER_WRITER, sessionId: MINE } } })];

    expect(stopGateDecision({ env: NO_ENV, payload: STOP, runs }).kind).toBe("block");
  });

  /**
   * The confirmed incident: a released run used to collapse to `unowned`, and `unowned` is freely
   * actionable. This is the case that must stand down like `elsewhere`, not like `unowned`.
   */
  it("stands aside for a run that was released and never reclaimed, distinctly from being held elsewhere", () => {
    const runs = [
      run({
        ownership: { kind: "released", releasedAtIso: OTHER_WRITER.atIso, why: "handing off", writer: OTHER_WRITER },
        slug: "held",
      }),
    ];
    const decision = stopGateDecision({ env: NO_ENV, payload: STOP, runs });

    expect(decision.kind).toBe("allow");
    expect(decision.kind === "allow" ? decision.why : "").toBe("held was released and has not been claimed since");
  });

  it("never records an observation against a foreign run's journal", () => {
    const runs = [
      run({ ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER }, slug: "theirs-doc" }),
      run({ ownership: { kind: "unowned" }, slug: "nobodys-doc" }),
      run({
        ownership: { kind: "released", releasedAtIso: OTHER_WRITER.atIso, why: "handing off", writer: OTHER_WRITER },
        slug: "released-doc",
      }),
    ];

    expect(observableRuns({ runs }).map((each) => each.slug)).toEqual(["nobodys-doc"]);
  });

  /** The baseline must advance even when the gate said nothing, or the next delta compares against stale state. */
  it("records an observation against a progressing run it deliberately stayed silent about", () => {
    const runs = [run({ progress: { because: "the branch moved", kind: "moved" }, slug: "moving" })];

    expect(observableRuns({ runs }).map((each) => each.slug)).toEqual(["moving"]);
  });
});
