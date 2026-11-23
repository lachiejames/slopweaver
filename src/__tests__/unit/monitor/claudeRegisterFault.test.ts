import { describe, expect, it } from "vitest";

import { postingRefusal } from "../../../hand/posting.js";
import { unwrap } from "../../../lib/result.js";
import { buildArrival } from "../../../monitor/card.js";
import { claudeRegisterFaultKey, evaluateClaudeRegisterFault } from "../../../monitor/claudePlanUnusable.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import { PlanRegisterErrors } from "../../../plans/errors.js";

import { firing } from "./readings.js";

describe("evaluateClaudeRegisterFault", () => {
  const unreadable = PlanRegisterErrors.registerUnreadable({ path: "/home/owner/.slopweaver/plans.json" });

  it("fires one subject naming the register, blind to every plan, its departures preserved", () => {
    const fired = firing({ reading: evaluateClaudeRegisterFault({ error: unreadable }) });
    const subject = fired.subjects[0]!;
    expect([fired.subjects.length, fired.preservesDepartures, fired.blindSpot, subject.id, subject.label]).toEqual([
      1,
      true,
      "the plans register did not read, so no plan's own card was judged this pass",
      "plans register",
      "the plans register file is there and does not read",
    ]);
    expect(subject.details![0]!.startsWith("REGISTER_UNREADABLE: the plan register at")).toBe(true);
  });

  it("keys an unreadable register by its path, so another path is another card", () => {
    const other = PlanRegisterErrors.registerUnreadable({ path: "/elsewhere/plans.json" });
    const key = claudeRegisterFaultKey({ error: unreadable });
    expect([
      key === claudeRegisterFaultKey({ error: unreadable }),
      key === claudeRegisterFaultKey({ error: other }),
    ]).toEqual([true, false]);
    expect(key).toMatch(/^register-[0-9a-f]{16}$/);
  });

  it("keys an invalid register by its problems in any order, and a new problem as a new card", () => {
    const one = PlanRegisterErrors.registerInvalid({ problems: ["row 1 has no alias", "row 2 repeats plan-two"] });
    const swapped = PlanRegisterErrors.registerInvalid({ problems: ["row 2 repeats plan-two", "row 1 has no alias"] });
    const grown = PlanRegisterErrors.registerInvalid({ problems: ["row 1 has no alias", "row 3 has no store"] });
    const key = claudeRegisterFaultKey({ error: one });
    expect([
      key === claudeRegisterFaultKey({ error: swapped }),
      key === claudeRegisterFaultKey({ error: grown }),
    ]).toEqual([true, false]);
  });

  it("keys an unreachable store by its code alone, so a changed store message keeps the one card", () => {
    const first = PlanRegisterErrors.registerStoreUnavailable({ doing: "be opened", reason: "ECONNREFUSED :54322" });
    const second = PlanRegisterErrors.registerStoreUnavailable({ doing: "be queried", reason: "timeout at 07:59" });
    expect(claudeRegisterFaultKey({ error: first })).toBe(claudeRegisterFaultKey({ error: second }));
  });
});

describe("the claude-plan-unusable register card", () => {
  it("asks for the register's repair and says every new session waits on it", () => {
    const error = PlanRegisterErrors.registerInvalid({ problems: ["row 1 has no alias"] });
    const registerSubject = firing({ reading: evaluateClaudeRegisterFault({ error }) }).subjects[0]!;
    const step = unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition: monitorDefinition({ monitorId: "claude-plan-unusable" }),
        nowIso: "2026-11-04T01:00:00.000Z",
        postedBy: "supervisor",
        subject: registerSubject,
      }),
    );
    expect([step.what, step.unblocks, step.where]).toEqual([
      "Ask on this card for a plans register repair — the plans register reads but holds something unusable",
      "Every new Claude session refuses to start until the plans register reads again, because the usage limit you set on each plan cannot be read",
      "Your own terminal for a sign-in, or this card on the Queue for a repair — the card clears when a probe reads the plan",
    ]);
    expect(postingRefusal({ step })).toBeUndefined();
  });
});
