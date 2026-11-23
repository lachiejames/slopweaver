/**
 * `rulingHeldOutcome` — the outcome `automation run-due` reports for a due row a standing ruling holds.
 *
 * Pure: gates and one row id in, the held outcome or `null` out. The verb-level behaviour (no firing, no stamp,
 * no `--limit` place) is `./runDueRulingGate.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { rulingHeldOutcome } from "../../../../../cli/commands/automation/runDueRulingGate.js";
import type { StandingGate } from "../../../../../handover/rulingGate.js";

/** A standing gate on `automation run-due`, scoped to the subjects given. */
function gate({ id, subjects, words }: { id: string; subjects: readonly string[]; words: string }): StandingGate {
  return {
    anchor: `transcript:${id}`,
    id,
    placedIso: "2026-09-08T11:00:00.000Z",
    slug: "a-row",
    subjects,
    verbs: [{ noun: "automation", verb: "run-due" }],
    words,
  };
}

describe("rulingHeldOutcome", () => {
  it("names every gate holding the row, each with its words and anchor, and fails nothing", () => {
    const held = rulingHeldOutcome({
      gates: [
        gate({ id: "a-row#1", subjects: ["held-row"], words: "hold it" }),
        gate({ id: "b-row#2", subjects: [], words: "no automation today" }),
        gate({ id: "c-row#3", subjects: ["other-row"], words: "not this one" }),
      ],
      recipeId: "held-row",
    })!;

    expect(held.line).toBe("recipe held-row · HELD · ruling gate a-row#1, b-row#2 · they said: hold it");
    expect(held.detail).toEqual([
      "  ruling gate a-row#1",
      "    they said: hold it",
      "    where: transcript:a-row#1",
      "  ruling gate b-row#2",
      "    they said: no automation today",
      "    where: transcript:b-row#2",
    ]);
    expect([held.failed, held.ran, held.exitCode]).toEqual([false, false, null]);
  });

  it("is null when no gate names the row", () => {
    const outcome = rulingHeldOutcome({
      gates: [gate({ id: "c-row#3", subjects: ["other-row"], words: "not this one" })],
      recipeId: "held-row",
    });

    expect(outcome).toBeNull();
  });
});
