/*
 * `slackDoorRequest`: the external write a send declares to the door — no approval claimed, the duplicate key and
 * no message prose, and the picture question's answer on the ledger row only when there was one.
 */
import { describe, expect, it } from "vitest";

import { doorDecisionRecord } from "../../../../../../admit/ledger.js";
import { slackDoorRequest } from "../../../../../../cli/commands/slack/core.js";
import { planFor } from "./harness.js";

describe("slackDoorRequest", () => {
  it("declares an external write that claims no approval", () => {
    const request = slackDoorRequest({ home: "/home", mediaCount: 0, plan: planFor(), resendUnconfirmed: false });

    expect(request.meta.effect).toBe("external-write");
    expect(request.meta.requiresApproval).toBe(false);
    expect(request.action).toEqual({ kind: "verb", noun: "slack", verb: "post" });
  });

  it("carries the duplicate key and NO message prose", () => {
    const plan = planFor();
    const request = slackDoorRequest({ home: "/home", mediaCount: 2, plan, resendUnconfirmed: false });

    expect(request.artifact["duplicateKey"]).toBe(plan.duplicateKey);
    expect(request.artifact["mediaCount"]).toBe(2);
    expect(JSON.stringify(request)).not.toContain("A short lead.");
  });

  it("puts the picture question's answer on the send's ledger row, and nothing when there was none", () => {
    const acknowledgements = [{ reason: "the tickets show only their titles", subject: "unshown-items" as const }];
    const answered = slackDoorRequest({
      acknowledgements,
      home: "/home",
      mediaCount: 0,
      plan: planFor(),
      resendUnconfirmed: false,
    });
    const record = doorDecisionRecord({
      decision: { findings: [], overridden: [], status: "pass" },
      request: answered,
      runId: "r1",
      tsIso: "2026-09-25T00:00:00.000Z",
    });
    expect(record).toMatchObject({ acknowledgements });

    const plain = slackDoorRequest({ home: "/home", mediaCount: 0, plan: planFor(), resendUnconfirmed: false });
    expect(Object.hasOwn(plain, "acknowledgements")).toBe(false);
  });
});
