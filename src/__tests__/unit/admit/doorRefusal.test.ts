import { describe, expect, it } from "vitest";
import { doorFindingLines, doorRefusalLines } from "../../../admit/doorRefusal.js";
import type { DoorDecision, DoorFinding } from "../../../admit/types.js";
import { JUDGEMENT_NOTE } from "../../../hatch/render.js";

/** Every door token is in the journalled lane, so the refusal names the grant verb. */
const JOURNALLED_SKILL_LOAD =
  'slopweaver hatch open skill-load --reason "<why this one is a legitimate exception>", then re-run';
const JOURNALLED_DOOR_DEMO =
  'slopweaver hatch open door-demo --reason "<why this one is a legitimate exception>", then re-run';

const REGISTERED_WARN: DoorFinding = {
  code: "answer.skill-load",
  correction: "read the skill, then name it in grounding.provenance.skillsLoaded",
  override: "answer.skill-load:v1",
  severity: "warn",
  summary: "no skill was loaded for an ask a skill covers",
};

const UNREGISTERED_WARN: DoorFinding = {
  code: "stub.warn",
  correction: "do the thing the stub describes",
  override: "stub.warn:v1",
  severity: "warn",
  summary: "a demonstration warn",
};

const HOLD: DoorFinding = {
  code: "approval.unbacked",
  correction: "install an approval gate, or stop declaring requiresApproval",
  severity: "hold",
  summary: "this request claims approval with no approval gate behind it",
};

describe("a door refusal", () => {
  it("prints the override token for a registered warn, with that hatch's exceptions", () => {
    const lines = doorFindingLines({ command: "slopweaver slack post", finding: REGISTERED_WARN });
    expect(lines).toEqual([
      "slopweaver slack post blocked because no skill was loaded for an ask a skill covers [answer.skill-load].",
      "To satisfy it instead: read the skill, then name it in grounding.provenance.skillsLoaded",
      "Legitimate exceptions may include you read every candidate skill and none of them owns this ask; the ask is a pure lookup with no procedure attached to it.",
      `To override use the designated escape hatch ${JOURNALLED_SKILL_LOAD} slopweaver slack post.`,
      JUDGEMENT_NOTE,
    ]);
  });

  it("still prints the token for a warn the register has no row for", () => {
    const lines = doorFindingLines({ command: "slopweaver dev door", finding: UNREGISTERED_WARN });
    expect(lines[3]).toBe(`To override use the designated escape hatch ${JOURNALLED_DOOR_DEMO} slopweaver dev door.`);
  });

  it("says a hold has no hatch, and why, rather than going quiet", () => {
    const lines = doorFindingLines({ command: "slopweaver gmail send", finding: HOLD });
    expect(lines[1]).toBe(
      "There is no escape hatch for this one: a hold is the irreversible-harm arm of the door and no per-action token waives it.",
    );
    expect(lines.at(-1)).toBe(JUDGEMENT_NOTE);
  });

  it("leads with the door's verdict, then every finding", () => {
    const decision: DoorDecision = { findings: [REGISTERED_WARN, HOLD], overridden: [], status: "hold" };
    const lines = doorRefusalLines({ command: "slopweaver slack post", decision });
    expect(lines[0]).toBe("the door did not admit this (hold). Nothing was changed.");
    expect(lines.length).toBe(1 + 5 + 4);
  });

  it("prints only the verdict when the door refused with no findings", () => {
    const decision: DoorDecision = { findings: [], overridden: [], status: "warn" };
    expect(doorRefusalLines({ command: "slopweaver slack post", decision })).toEqual([
      "the door did not admit this (warn). Nothing was changed.",
    ]);
  });
});
