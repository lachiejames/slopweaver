/** A first signal kill holds nothing; a second in a row, any other death, or an unread history holds the row. */
import { describe, expect, it } from "vitest";

import type { RecipeDefinitionRun } from "../../../../live/automation/definitionRunStore.js";
import { signalDeathHolds } from "../../../../live/automation/signalKillGrace.js";

/** One stamped run, overridable field by field. */
function run(over: Partial<RecipeDefinitionRun> = {}): RecipeDefinitionRun {
  return {
    exitCode: 0,
    lastRunAtIso: "2026-11-12T01:05:00.000Z",
    watermarkIso: "2026-11-12T01:00:00.000Z",
    ...over,
  };
}

describe("signalDeathHolds", () => {
  it("does not hold a first kill after a clean run, so the next slot fires", () => {
    expect(signalDeathHolds({ previous: run(), reason: "KILLED_BY_SIGNAL" })).toBe(false);
  });

  it("does not hold a kill on a row that never ran", () => {
    expect(signalDeathHolds({ previous: null, reason: "KILLED_BY_SIGNAL" })).toBe(false);
  });

  it("does not hold a kill after a run that died some other way", () => {
    const previous = run({ exitCode: 1, failureCause: "HOLDER_GONE: started and died" });
    expect(signalDeathHolds({ previous, reason: "KILLED_BY_SIGNAL" })).toBe(false);
  });

  it("holds a second kill on consecutive stamped firings", () => {
    const previous = run({ exitCode: 1, failureCause: "KILLED_BY_SIGNAL: SIGTERM arrived while the verb ran" });
    expect(signalDeathHolds({ previous, reason: "KILLED_BY_SIGNAL" })).toBe(true);
  });

  it("holds a second kill whose previous cause is the bare reason with no detail", () => {
    const previous = run({ exitCode: 1, failureCause: "KILLED_BY_SIGNAL" });
    expect(signalDeathHolds({ previous, reason: "KILLED_BY_SIGNAL" })).toBe(true);
  });

  it("does not read a different reason that merely shares the prefix as a kill", () => {
    const previous = run({ exitCode: 1, failureCause: "KILLED_BY_SIGNALLED_PEER: not a kill of this row" });
    expect(signalDeathHolds({ previous, reason: "KILLED_BY_SIGNAL" })).toBe(false);
  });

  it("holds a kill whose history will not read, since an unread history is never read as clean", () => {
    expect(signalDeathHolds({ previous: "unreadable", reason: "KILLED_BY_SIGNAL" })).toBe(true);
  });

  it.each(["ATTEMPTS_EXHAUSTED", "OUTCOME_UNKNOWN", "HOLDER_GONE"] as const)(
    "holds every other death, %s, even after a clean run",
    (reason) => {
      expect(signalDeathHolds({ previous: run(), reason })).toBe(true);
    },
  );
});
