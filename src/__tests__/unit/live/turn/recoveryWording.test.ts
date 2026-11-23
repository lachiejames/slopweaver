import { describe, expect, it } from "vitest";

import {
  FOLLOW_THROUGH_STOPPED_FINDING,
  type RecoveryContext,
  recoveryCardReason,
  recoveryClause,
} from "../../../../live/turn/recoveryWording.js";

const EVERY: readonly RecoveryContext[] = [
  "nothing-ran",
  "never-routed",
  "lease-ran-out",
  "worker-stopped",
  "follow-through-stopped",
];

describe("recoveryClause", () => {
  it("never tells the reader to tag the bot again, in any failure", () => {
    for (const context of EVERY) {
      expect(recoveryClause({ context })).not.toContain("re-tag");
    }
  });

  it("never hands the reader an instruction at all, in any failure", () => {
    for (const context of EVERY) {
      expect(recoveryClause({ context })).not.toContain("try again");
    }
  });

  it("still says the turn is unfinished, so the failure stays loud", () => {
    expect(recoveryClause({ context: "never-routed" })).toBe(
      "no session picked it up, and it is still waiting for one",
    );
  });

  it("distinguishes never having been routed from having run and stopped", () => {
    expect(recoveryClause({ context: "nothing-ran" })).not.toBe(recoveryClause({ context: "never-routed" }));
  });

  it("says a lease that ran out leaves the ask queued rather than dead", () => {
    expect(recoveryClause({ context: "lease-ran-out" })).toBe("it is back in the queue for a session to pick up");
  });
});

describe("recoveryCardReason", () => {
  it("keeps the sweep's own finding in front of the state sentence", () => {
    expect(recoveryCardReason({ context: "never-routed", reason: "no routing decision was ever recorded" })).toBe(
      "no routing decision was ever recorded; no session picked it up, and it is still waiting for one",
    );
  });

  it("says the plan above stands when a builder stopped after its first answer", () => {
    expect(recoveryCardReason({ context: "follow-through-stopped", reason: FOLLOW_THROUGH_STOPPED_FINDING })).toBe(
      "the first answer above was posted; the session building it stopped before it finished; one re-dispatch pending",
    );
  });

  it("promises no timing, because the measured recovery rate is not a guarantee", () => {
    for (const context of EVERY) {
      const composed = recoveryCardReason({ context, reason: "something broke" });
      expect(composed).not.toContain("shortly");
      expect(composed).not.toContain("soon");
    }
  });
});
