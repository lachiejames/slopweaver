/*
 * The intake field `handover reconcile` hands the briefing: the owner-turn sentence, then the voice-relay one
 * when there is anything to say. A clean install must read exactly as it did before voice relays were swept.
 */
import { describe, expect, it } from "vitest";

import { fullIntakeClause } from "../../../../../cli/commands/handover/reconcilePrint.js";
import { type IntakeReport, intakeClause } from "../../../../../supervisor/intake.js";

const INTAKE: IntakeReport = { kind: "unavailable", why: "no supervisor transcript" };

describe("fullIntakeClause", () => {
  it("is the owner-turn sentence alone when every voice relay reached the chair", () => {
    expect(fullIntakeClause({ intake: INTAKE, voice: { kind: "read", relays: [] } })).toBe(
      intakeClause({ report: INTAKE }),
    );
  });

  it("follows it with the voice-relay sentence, one space between", () => {
    expect(fullIntakeClause({ intake: INTAKE, voice: { kind: "unavailable", why: "turn file gone" } })).toBe(
      `${intakeClause({ report: INTAKE })} Voice relays unread: turn file gone.`,
    );
  });
});
