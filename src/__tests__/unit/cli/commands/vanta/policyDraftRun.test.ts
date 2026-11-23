import { describe, expect, it } from "vitest";

import type { VantaEditorMutation } from "../../../../../browser/vantaPolicyEditor.js";
import { runVantaEditPolicyDraft, unpersistedLines } from "../../../../../cli/commands/vanta/policyDraftRun.js";

/** A mutation the editor took and the reopened draft does not hold — each case below changes one field. */
const UNPERSISTED: VantaEditorMutation = {
  after: "Access is reviewed quarterly.",
  before: "Access is reviewed annually.",
  finalUrl: "https://app.vanta.com/acme/policies/access-control/edit",
  matched: true,
  persistError: null,
  persisted: false,
  refused: null,
  saveError: null,
  saved: true,
  screenshotPath: null,
  typeError: null,
  typed: true,
};

describe("unpersistedLines", () => {
  it("names the re-read error, says the outcome is unknown and not to repeat the command when the reopened read failed", () => {
    expect(unpersistedLines({ mutation: { ...UNPERSISTED, persistError: "the editor never reopened" } })).toEqual([
      "edit-policy-draft typed into the draft and then COULD NOT RE-READ IT: the editor never reopened",
      "  the editor autosaves, so the outcome is genuinely unknown. Open the draft and look before running anything else against it. Do not repeat this command",
    ]);
  });

  it("says the keystroke was not delivered, with the reason the snippet gave, and that nothing was written", () => {
    expect(
      unpersistedLines({ mutation: { ...UNPERSISTED, matched: false, typeError: "focus was lost", typed: false } }),
    ).toEqual([
      "edit-policy-draft could not deliver the keystroke: focus was lost",
      "  the reopened draft is unchanged, so nothing was written",
    ]);
  });

  it("says no reason was given, and that nothing was written, when an undelivered keystroke carries none", () => {
    expect(unpersistedLines({ mutation: { ...UNPERSISTED, matched: false, typed: false } })).toEqual([
      "edit-policy-draft could not deliver the keystroke: no reason given",
      "  the reopened draft is unchanged, so nothing was written",
    ]);
  });

  it("says the editor's text is not what the plan expected, and that nothing was stored, when the keystroke landed but did not match", () => {
    expect(unpersistedLines({ mutation: { ...UNPERSISTED, matched: false } })).toEqual([
      "edit-policy-draft typed, and the editor's own text is not what the plan expected",
      "  the reopened draft does not hold the substitution either, so nothing was stored",
    ]);
  });

  it("says Vanta stored nothing, and why the reopened read exists, when the editor took the substitution and the reopened draft lacks it", () => {
    expect(unpersistedLines({ mutation: UNPERSISTED })).toEqual([
      "edit-policy-draft typed, the editor took it, and the REOPENED draft does not hold it — Vanta stored nothing",
      "  nothing was written. This is the failure mode the reopened read exists to catch: a save that reports success and persists the model it already had",
    ]);
  });
});

describe("runVantaEditPolicyDraft", () => {
  it("answers 0 for --help", async () => {
    expect(await runVantaEditPolicyDraft(["node", "slopweaver", "write", "vanta", "edit-policy-draft", "--help"])).toBe(
      0,
    );
  });
});
