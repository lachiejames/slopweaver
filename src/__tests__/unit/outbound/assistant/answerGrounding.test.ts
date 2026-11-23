/**
 * `answerGroundingSchema` — the three grounding arms an answer nests under `grounding`, accepted and refused
 * on their own, without the rest of the answer form around them.
 */
import { describe, expect, it } from "vitest";

import { answerGroundingSchema } from "../../../../outbound/assistant/answerGrounding.js";

const EVIDENCE = {
  consultedEmpty: [],
  couldNotSee: { blindSpots: [], reason: "the command's own output was sufficient" },
  premiseChecks: [],
  read: [{ label: "src/pane/section.ts" }],
  substitutedForReal: [],
};
const PROVENANCE = { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: ["fleet"] };

const CONVERSATION = {
  evidence: EVIDENCE,
  kind: "conversation",
  provenance: PROVENANCE,
  reason: "the code itself already answers this",
};
const VERB = {
  capability: { command: ["fleet", "status"], id: "fleet-status", what: "every open pull request" },
  evidence: EVIDENCE,
  kind: "verb",
  provenance: PROVENANCE,
  result: "553 events over a closed 48h",
};
const UNREACHABLE = {
  evidence: EVIDENCE,
  kind: "unreachable",
  provenance: PROVENANCE,
  surface: { id: "billing", what: "the payment processor" },
  why: "no connector reaches it",
};

describe("answerGroundingSchema", () => {
  it.each([
    ["conversation", CONVERSATION],
    ["verb", VERB],
    ["unreachable", UNREACHABLE],
  ])("accepts a complete %s arm unchanged", (_kind, arm) => {
    const parsed = answerGroundingSchema.safeParse(arm);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(arm);
  });

  it("refuses a kind that names none of the three arms", () => {
    expect(answerGroundingSchema.safeParse({ kind: "mystery", why: "invented" }).success).toBe(false);
  });

  it("refuses a conversation arm with no reason", () => {
    const { reason: _dropped, ...withoutReason } = CONVERSATION;

    expect(answerGroundingSchema.safeParse(withoutReason).success).toBe(false);
  });

  it("refuses a verb arm whose capability carries an empty command", () => {
    const empty = { ...VERB, capability: { ...VERB.capability, command: [] } };

    expect(answerGroundingSchema.safeParse(empty).success).toBe(false);
  });

  it("refuses an unreachable arm with no surface", () => {
    const { surface: _dropped, ...withoutSurface } = UNREACHABLE;

    expect(answerGroundingSchema.safeParse(withoutSurface).success).toBe(false);
  });

  it("refuses an invented key on an arm rather than dropping it", () => {
    expect(answerGroundingSchema.safeParse({ ...CONVERSATION, impact: "high" }).success).toBe(false);
  });

  it("defaults the evidence lists an arm leaves out to empty", () => {
    const { premiseChecks: _dropped, ...evidence } = EVIDENCE;

    const parsed = answerGroundingSchema.safeParse({ ...CONVERSATION, evidence });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ evidence: { premiseChecks: [] } });
  });
});
