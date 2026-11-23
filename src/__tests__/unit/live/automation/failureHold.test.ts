/**
 * The pure rules of a FAILURE HOLD: the finding slug a failure files under, whether a hold stands, and every
 * case of a finding's row that decides whether the fix has landed.
 */
import { describe, expect, it } from "vitest";

import { DerivedRowReadErrors, type ReadableDerivedRowState } from "../../../../handover/rowState.js";
import { isSafeSlug } from "../../../../handover/runStore.js";
import { err, ok } from "../../../../lib/result.js";
import type { RecipeHold } from "../../../../live/automation/definition.js";
import {
  failureFindingSlug,
  failureFindingState,
  failureHoldReason,
  holdStands,
} from "../../../../live/automation/failureHold.js";

const FINDING = "recipe-failing-vanta-a1";

/** One readable row, overridable field by field. */
function row(over: Partial<ReadableDerivedRowState> = {}): ReadableDerivedRowState {
  return {
    archived: false,
    authoredStatus: "ready",
    settlement: undefined,
    settlementWitness: undefined,
    slug: FINDING,
    status: "ready",
    ...over,
  };
}

describe("failureFindingSlug", () => {
  it("derives a readable board slug from the row, the firing and the attempt", () => {
    expect(
      failureFindingSlug({ attempt: 2, recipeId: "resync-atlas-vanta", slotIso: "2026-09-29T02:00:00.000Z" }),
    ).toBe("recipe-failing-resync-atlas-vanta-2026-09-29t02-00-00.000z-a2");
  });

  it("falls back to a digest when the readable form is not a slug the run store can open", () => {
    const slug = failureFindingSlug({ attempt: 1, recipeId: "odd id/with slash", slotIso: "2026-09-29T02:00:00.000Z" });
    expect(slug).toMatch(/^recipe-failing-[0-9a-f]{16}-a1$/);
    expect(isSafeSlug({ slug })).toBe(true);
  });

  it("names the same row for the same failure, so a retried registration cannot file a second one", () => {
    const args = { attempt: 1, recipeId: "odd id/with slash", slotIso: "2026-09-29T02:00:00.000Z" };
    expect(failureFindingSlug(args)).toBe(failureFindingSlug(args));
  });
});

describe("holdStands", () => {
  const HOLD: RecipeHold = { askedIso: "2026-09-29T02:00:00.000Z", clearedBy: null, reason: "the owner's hold" };
  const RELEASE = { atIso: "2026-09-29T03:00:00.000Z", runSlug: "turn-291-1" };

  it("answers false for no hold at all", () => {
    expect(holdStands({ hold: undefined })).toBe(false);
  });

  it("stands an owner hold until clearedBy is written", () => {
    expect(holdStands({ hold: HOLD })).toBe(true);
    expect(holdStands({ hold: { ...HOLD, clearedBy: RELEASE } })).toBe(false);
  });

  it("stands a failure hold read in the stored view — it never lifts on evidence it did not read", () => {
    expect(holdStands({ hold: { ...HOLD, finding: FINDING } })).toBe(true);
  });

  it("follows the finding's evidence in the lifted view", () => {
    const held: RecipeHold = {
      ...HOLD,
      finding: FINDING,
      findingState: { held: true, line: "x", stage: { kind: "queued" } },
    };
    const lifted: RecipeHold = {
      ...HOLD,
      finding: FINDING,
      findingState: { held: false, line: "x", stage: { kind: "landed" } },
    };
    expect(holdStands({ hold: held })).toBe(true);
    expect(holdStands({ hold: lifted })).toBe(false);
  });

  it("lets clearedBy lift a failure hold whatever its finding says", () => {
    const findingState = { held: true, line: "x", stage: { kind: "queued" } } as const;
    const hold = { ...HOLD, clearedBy: RELEASE, finding: FINDING, findingState };
    expect(holdStands({ hold })).toBe(false);
  });
});

describe("failureFindingState", () => {
  it("lifts on a finding settled answered, naming its witness", () => {
    const state = failureFindingState({
      finding: FINDING,
      row: ok(row({ settlement: "answered", settlementWitness: "#1580", status: "done" })),
      witness: null,
    });
    expect(state).toEqual({
      held: false,
      line: `its finding ${FINDING} was settled answered (#1580)`,
      stage: { kind: "landed" },
    });
  });

  it("holds on a finding settled declined, routing the lift to the owner's clearedBy", () => {
    const state = failureFindingState({
      finding: FINDING,
      row: ok(row({ settlement: "declined", status: "done" })),
      witness: null,
    });
    expect(state.held).toBe(true);
    expect(state.line).toContain("settled declined");
    expect(state.line).toContain("hold.clearedBy");
  });

  it("lifts on a finding filed as a row that is done", () => {
    const state = failureFindingState({
      finding: FINDING,
      row: ok(row({ settlement: "filed", settlementWitness: "the-fix", status: "done" })),
      witness: ok(row({ slug: "the-fix", status: "done" })),
    });
    expect(state).toEqual({
      held: false,
      line: `its finding ${FINDING} was filed as the-fix, which is done`,
      stage: { kind: "landed" },
    });
  });

  it("holds on a finding filed as a row that is not done yet", () => {
    const state = failureFindingState({
      finding: FINDING,
      row: ok(row({ settlement: "filed", settlementWitness: "the-fix", status: "done" })),
      witness: ok(row({ slug: "the-fix", status: "in-progress" })),
    });
    expect(state).toEqual({
      held: true,
      line: `its finding ${FINDING} was filed as the-fix, which is in-progress — held until that row is done`,
      stage: { kind: "filed", status: "in-progress" },
    });
  });

  it("holds on a finding filed as a row the board does not carry", () => {
    const state = failureFindingState({
      finding: FINDING,
      row: ok(row({ settlement: "filed", settlementWitness: "the-fix", status: "done" })),
      witness: err(DerivedRowReadErrors.missing({ slug: "the-fix" })),
    });
    expect(state.held).toBe(true);
    expect(state.line).toContain("the-fix is not on the board");
  });

  it("holds on a finding filed with no witness a run store could open", () => {
    const state = failureFindingState({
      finding: FINDING,
      row: ok(row({ settlement: "filed", status: "done" })),
      witness: null,
    });
    expect(state.held).toBe(true);
    expect(state.line).toContain("filed as no witness, which names no board row");
  });

  it("holds on an unsettled finding, saying how to lift it", () => {
    const state = failureFindingState({ finding: FINDING, row: ok(row()), witness: null });
    expect(state).toEqual({
      held: true,
      line: `its finding ${FINDING} is ready and unsettled — settle ${FINDING} \`answered --witness <the fix>\` once the fix lands`,
      stage: { kind: "queued" },
    });
  });

  it("reads an unsettled finding a session took up as taken, and one paused as parked", () => {
    const taken = failureFindingState({ finding: FINDING, row: ok(row({ status: "in-progress" })), witness: null });
    const parked = failureFindingState({ finding: FINDING, row: ok(row({ status: "paused" })), witness: null });
    expect(taken.stage).toEqual({ kind: "taken" });
    expect(parked.stage).toEqual({ kind: "parked" });
  });

  it("reads a finding whose row ended unsettled as closed, naming how it ended", () => {
    const state = failureFindingState({ finding: FINDING, row: ok(row({ status: "cancelled" })), witness: null });
    expect(state.held).toBe(true);
    expect(state.stage).toEqual({ kind: "closed-unsettled", status: "cancelled" });
  });

  it("reads a declined finding, a missing one and a filed one with an unreadable witness by stage", () => {
    const declined = failureFindingState({
      finding: FINDING,
      row: ok(row({ settlement: "declined", status: "done" })),
      witness: null,
    });
    const missing = failureFindingState({
      finding: FINDING,
      row: err(DerivedRowReadErrors.missing({ slug: FINDING })),
      witness: null,
    });
    const filed = failureFindingState({
      finding: FINDING,
      row: ok(row({ settlement: "filed", settlementWitness: "the-fix", status: "done" })),
      witness: err(DerivedRowReadErrors.missing({ slug: "the-fix" })),
    });
    expect(declined.stage).toEqual({ kind: "declined" });
    expect(missing.stage).toEqual({ kind: "unread" });
    expect(filed.stage).toEqual({ kind: "filed", status: null });
  });

  it("holds on a finding the board does not carry", () => {
    const state = failureFindingState({
      finding: FINDING,
      row: err(DerivedRowReadErrors.missing({ slug: FINDING })),
      witness: null,
    });
    expect(state.held).toBe(true);
    expect(state.line).toContain(`${FINDING} is not on the board`);
  });

  it("never reads an unreadable finding as a landed fix", () => {
    const state = failureFindingState({
      finding: FINDING,
      row: err(DerivedRowReadErrors.unreadable({ slug: FINDING, why: "front-matter has 1 problem(s)" })),
      witness: null,
    });
    expect(state.held).toBe(true);
    expect(state.line).toContain("did not read whole (front-matter has 1 problem(s))");
  });
});

describe("failureHoldReason", () => {
  it("names what failed, when, and the finding whose fix lifts it", () => {
    const reason = failureHoldReason({
      attempt: 1,
      finding: FINDING,
      recipeId: "resync-atlas-vanta",
      slotIso: "2026-09-29T02:00:00.000Z",
      what: "exit 1",
    });
    expect(reason).toContain("resync-atlas-vanta's 2026-09-29T02:00:00.000Z firing failed on attempt 1 (exit 1)");
    expect(reason).toContain(`board row ${FINDING}`);
  });
});
