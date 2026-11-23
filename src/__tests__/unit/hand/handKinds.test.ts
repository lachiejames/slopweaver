/*
 * The narrow set of steps only the owner's hands can take is ONE list. The skill names it, the FLEET_CAN_DO_IT refusal names
 * it and `hand post --help` names it; when the skill gains a kind, the other two must gain it in the same change.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { POST_USAGE } from "../../../cli/commands/hand/core.js";
import { HandStepErrors } from "../../../hand/errors.js";
import { HAND_STEP_KINDS, handStepKindsPhrase } from "../../../hand/handKinds.js";

const SKILL = fileURLToPath(new URL("../../../../skills/hand/SKILL.md", import.meta.url));

describe("the hand-step set", () => {
  it("is the four kinds the skill names, in its order", () => {
    expect(HAND_STEP_KINDS).toEqual([
      "a sign-in",
      "an approval",
      "a code-owner pick",
      "asking an access holder for named access",
    ]);
  });

  it("is the bold set the skill states", () => {
    expect(readFileSync(SKILL, "utf8")).toContain(`**${handStepKindsPhrase()}**`);
  });

  it("is what the FLEET_CAN_DO_IT refusal names", () => {
    expect(HandStepErrors.fleetCanDoIt({ phrase: "the session" }).message).toContain(
      "This register is for a sign-in, an approval, a code-owner pick, asking an access holder for named access:",
    );
  });

  it("is what hand post --help names", () => {
    expect(POST_USAGE).toContain(`only the owner's hands can take — ${handStepKindsPhrase()} —`);
  });
});
