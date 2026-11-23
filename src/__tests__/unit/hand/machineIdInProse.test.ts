/*
 * The posting rule: a step whose card the Queue would withhold for a raw machine id is refused at
 * posting, naming the field and the id, so the note never goes up over a card the owner cannot see. Which fields both gates
 * read is bound by `site/__tests__/unit/handPostMachineIdParity.test.ts`; this file holds the refusal itself.
 */
import { describe, expect, it } from "vitest";

import { machineIdInProse } from "../../../hand/machineIdInProse.js";
import { postingRefusal } from "../../../hand/posting.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** A step every posting rule passes. */
const CLEAN: HandStepDraft = {
  id: "approve-the-reply",
  postedBy: "supervisor",
  postedIso: "2026-11-01T04:39:00.000Z",
  unblocks: "the reply to the release thread",
  url: "https://github.com/acme/app/pull/12",
  what: "Read the release reply the room is waiting on and say whether it goes out today",
  witness: "slopweaver hand done approve-the-reply",
};

/**
 * A step built from {@link CLEAN} with some fields replaced.
 *
 * @returns the built step
 */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(buildHandStep({ draft: { ...CLEAN, ...over } }));
}

describe("machineIdInProse", () => {
  it("passes a step whose drawn prose names nothing by its machine id", () => {
    expect(machineIdInProse({ step: step() })).toBeUndefined();
  });

  it("refuses a witness naming a call by its id, naming the field and the id", () => {
    const refused = machineIdInProse({ step: step({ witness: "the reply call a0000019 asked for is sent" }) })!;
    expect(refused.code).toBe("INVALID_FIELD");
    expect(refused.message).toContain('witness names "call a0000019" by its machine id');
  });

  it("names a whole session UUID rather than its first eight digits", () => {
    const session = "a0000021-1b2c-4d3e-8f90-a1b2c3d4e5f6";
    const refused = machineIdInProse({ step: step({ unblocks: `the reply session ${session} owes` }) })!;
    expect(refused.message).toContain(`unblocks names "${session}"`);
  });

  it("passes a notice, which is on no Queue and so has no card to withhold", () => {
    const named = { ...step({ unblocks: "the reply call a0000019 asked for" }) };
    expect(machineIdInProse({ step: named })).not.toBeUndefined();
    expect(machineIdInProse({ step: { ...named, notice: true } })).toBeUndefined();
  });

  it("allows an id behind a URL in prose, which the card draws as a link", () => {
    expect(
      machineIdInProse({ step: step({ witness: "https://example.test/call/a0000019 is answered" }) }),
    ).toBeUndefined();
  });
});

describe("postingRefusal", () => {
  it("reaches the machine-id rule, so every writer of the register is refused it", () => {
    expect(postingRefusal({ step: step() })).toBeUndefined();
    const refused = postingRefusal({ step: step({ witness: "the reply call a0000019 asked for is sent" }) })!;
    expect(refused.message).toContain('witness names "call a0000019"');
  });
});
