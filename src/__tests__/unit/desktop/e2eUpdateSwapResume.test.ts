import { describe, expect, it } from "vitest";

import type { E2eDesktopEvent } from "../../../desktop/e2eCallEvidence.js";
import { owedSinceIso, updateResumeProblem } from "../../../desktop/e2eUpdateSwapResume.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** The instant the test instance saved for the call it ended. */
const OWED = "2026-11-06T08:00:00.200Z";

/**
 * One update-resume line.
 *
 * @returns the event
 */
function resumeLine({
  decision,
  sinceIso,
  instance = "e2e",
}: {
  decision: "handed" | "retry-overlay-not-listening";
  sinceIso: string;
  instance?: "own" | "e2e";
}): E2eDesktopEvent {
  return { atIso: "2026-11-06T08:03:00.000Z", decision, instance, kind: "update-resume", sinceIso };
}

describe("updateResumeProblem", () => {
  it("passes one call back with the shell's handed line for this instance's ended call", () => {
    const events = [
      resumeLine({ decision: "retry-overlay-not-listening", sinceIso: OWED }),
      resumeLine({ decision: "handed", sinceIso: OWED }),
    ];
    expect(updateResumeProblem({ addedPlanCalls: 1, events, sinceIso: OWED })).toBeUndefined();
  });

  it("fails two calls back, and none, as not exactly one", () => {
    const events = [resumeLine({ decision: "handed", sinceIso: OWED })];
    expect(updateResumeProblem({ addedPlanCalls: 2, events, sinceIso: OWED })).toBe(
      "the update's restart opened 2 plan calls, not exactly one",
    );
    expect(updateResumeProblem({ addedPlanCalls: 0, events, sinceIso: OWED })).toBe(
      "the update's restart opened 0 plan calls, not exactly one",
    );
  });

  // The event log is shared with the owner's app, so a handed line of theirs — one for another ended call, or one
  // saved in the very same millisecond — must never stand in for the instance's own.
  it("fails a call back with only a retry line, a handed line for another ended call, or one the owner's app wrote", () => {
    const missing = `a call came back, but the desktop shell logged no update-resume line handing over the restart owed since ${OWED}`;
    const retried = [resumeLine({ decision: "retry-overlay-not-listening", sinceIso: OWED })];
    const another = [resumeLine({ decision: "handed", sinceIso: "2026-11-06T08:00:00.201Z" })];
    const ownApp = [resumeLine({ decision: "handed", instance: "own", sinceIso: OWED })];
    expect(updateResumeProblem({ addedPlanCalls: 1, events: retried, sinceIso: OWED })).toBe(missing);
    expect(updateResumeProblem({ addedPlanCalls: 1, events: another, sinceIso: OWED })).toBe(missing);
    expect(updateResumeProblem({ addedPlanCalls: 1, events: ownApp, sinceIso: OWED })).toBe(missing);
    expect(updateResumeProblem({ addedPlanCalls: 1, events: [], sinceIso: OWED })).toBe(missing);
  });
});

describe("owedSinceIso", () => {
  it("reads the saved instant out of the instance's state, whatever else it holds", () => {
    const text = JSON.stringify({ bounds: { height: 1 }, resumeVoice: { sinceIso: OWED } });
    expect(unwrap(owedSinceIso({ text }))).toBe(OWED);
  });

  it("refuses a state that owes no restart, and one that is not JSON", () => {
    expect(unwrapErr(owedSinceIso({ text: JSON.stringify({ bounds: {} }) }))).toEqual([
      "the test instance's state.json owes no restart after the shell ended its call for the update",
    ]);
    expect(unwrapErr(owedSinceIso({ text: "{" }))[0]).toContain("the test instance's state.json is not JSON: ");
  });
});
