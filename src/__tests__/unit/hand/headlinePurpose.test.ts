/*
 * A hand step's headline says what is asked of the owner and what it is about (from the
 * Codex hooks card the owner could not tell the purpose of).
 */
import { describe, expect, it } from "vitest";

import { headlineWithoutPurpose } from "../../../hand/headlinePurpose.js";
import { postingRefusal } from "../../../hand/posting.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** The hooks card the owner could not place, word for word. */
const HOOKS_CARD =
  "Approve the 13 Slopweaver hooks Codex now skips, six changed by recent landings and seven never trusted";

/** A step built by the real builder, with whatever a case overrides. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "headline-purpose",
        postedBy: "workspace:1",
        postedIso: "2026-10-05T12:00:00.000Z",
        unblocks: "board row headline-purpose",
        what: HOOKS_CARD,
        witness: "slopweaver hand done headline-purpose --did approved",
        ...over,
      },
    }),
  );
}

describe("headlineWithoutPurpose", () => {
  it("refuses the hooks card the owner could not place, naming the what field", () => {
    const refused = headlineWithoutPurpose({ step: step() })!;
    expect([refused.code, refused.message]).toEqual([
      "INVALID_FIELD",
      expect.stringContaining("says what to do but not what it is about"),
    ]);
  });

  it.each([
    ["so", "Approve the Slopweaver hooks in Codex, so its sessions run them again"],
    ["because", "Sign in to Datadog because the incident read stopped at its page"],
    ["until", "Leave the Airwallex tab open until the read finishes"],
    ["before", "Sign in to Google Cloud before the deploy runs"],
    ["a colon", "Pick a layout: the store page's two columns"],
    ["a spaced dash", "Choose restart, repair, or retire for store-backup-daily — stopped firing"],
    ["whether", "Say whether to drop the steer or grant what it needs"],
    ["a question", "Keep the nightly Vanta sync on?"],
  ])("passes a headline joined by %s", (_joint, what) => {
    expect(headlineWithoutPurpose({ step: step({ what }) })).toBe(undefined);
  });

  it("does not read a joint inside a word, so 'also' and 'Sonnet' carry no purpose", () => {
    expect(headlineWithoutPurpose({ step: step({ what: "Press Sonnet and also Opus" }) })!.code).toBe("INVALID_FIELD");
  });

  it("leaves a notice alone, which asks nothing", () => {
    expect(headlineWithoutPurpose({ step: step({ notice: true, what: "Codex trusts every hook" }) })).toBe(undefined);
  });

  it("is the last posting rule asked, so a sharper refusal still names itself first", () => {
    expect(postingRefusal({ step: step() })!.message).toContain("say where");
    expect(postingRefusal({ step: step({ unaddressed: "said on the call" }) })!.message).toContain(
      "says what to do but not what it is about",
    );
  });
});
