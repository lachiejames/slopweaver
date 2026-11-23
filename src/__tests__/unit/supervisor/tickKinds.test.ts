/**
 * The tick ledger's closed vocabularies: every listed kind is one the strict schemas accept, and a kind off the
 * list is refused — so the lists and the enums cannot drift apart.
 */
import { describe, expect, it } from "vitest";

import { TICK_ACTION_KINDS, TICK_SUBJECT_KINDS } from "../../../supervisor/tickKinds.js";
import { actionSchema, judgementSchema } from "../../../supervisor/tickSchema.js";

const AT = "2026-09-28T09:00:00.000Z";
const WITNESS = { kind: "command", ref: "slopweaver machine capacity --json" };

/** An action of `kind`, about a ceiling. */
function action({ kind }: { kind: string }): unknown {
  return {
    actionId: "a-1",
    kind,
    outcome: "completed",
    recordedIso: AT,
    subject: { id: "machine", kind: "ceiling", label: "the machine" },
    witness: WITNESS,
  };
}

/** A hold-rationale about a subject of `kind`. */
function judgement({ kind }: { kind: string }): unknown {
  return {
    claim: "held on the machine",
    judgementId: "j-1",
    kind: "hold-rationale",
    recordedIso: AT,
    subject: { id: "s-1", kind, label: "the subject" },
    whyNotDerived: "operational-context",
    witness: WITNESS,
  };
}

describe("tick kinds", () => {
  it("accepts every listed action kind and refuses one off the list", () => {
    expect(TICK_ACTION_KINDS.length).toBeGreaterThan(0);
    expect(TICK_ACTION_KINDS.filter((kind) => !actionSchema.safeParse(action({ kind })).success)).toStrictEqual([]);
    expect(actionSchema.safeParse(action({ kind: "merged" })).success).toBe(false);
  });

  it("accepts every listed subject kind, ceiling included, and refuses one off the list", () => {
    expect(TICK_SUBJECT_KINDS.length).toBeGreaterThan(0);
    expect(TICK_SUBJECT_KINDS.filter((kind) => !judgementSchema.safeParse(judgement({ kind })).success)).toStrictEqual(
      [],
    );
    expect(TICK_SUBJECT_KINDS.includes("ceiling")).toBe(true);
    expect(judgementSchema.safeParse(judgement({ kind: "plan" })).success).toBe(false);
  });
});
