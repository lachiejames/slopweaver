/**
 * The rule that makes `requiresApproval` a fact: a request declaring it, with no marked approval gate in
 * its list, is refused by the door itself.
 *
 * The falsifiable half is the LAST describe block — the same request passes the moment a marked gate is in
 * the list, so these tests fail if the rule ever stops firing AND if it starts firing on everything.
 */
import { describe, expect, it } from "vitest";

import { APPROVAL_UNBACKED_CODE, approvalGate, isApprovalGate } from "../../../admit/approval.js";
import { admitDoor, DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorGate, DoorRequest } from "../../../admit/types.js";

const CLAIMS_APPROVAL: DoorRequest = {
  action: { kind: "verb", noun: "write", verb: "vanta deactivate" },
  artifact: { findings: ["v_1"] },
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: true },
};

const CLAIMS_NOTHING: DoorRequest = {
  ...CLAIMS_APPROVAL,
  meta: { ...CLAIMS_APPROVAL.meta, requiresApproval: false },
};

/** A marked gate that approves everything — enough to prove the door looks at the MARK, not the verdict. */
const SATISFIED = approvalGate({ gate: () => [] });

/** A marked gate that refuses — what a real approval gate does when the caller showed no evidence. */
const REFUSING = approvalGate({
  gate: () => [{ code: "test.unapproved", correction: "pass --approve", severity: "hold", summary: "no approval" }],
});

/** An ordinary, unmarked gate that happens to return nothing — the shape the mark exists to distinguish. */
const UNMARKED_QUIET: DoorGate = () => [];

describe("the approval mark", () => {
  it("recognises a gate it built", () => {
    expect(isApprovalGate(SATISFIED)).toBe(true);
  });

  it("does not recognise an ordinary gate, however quiet it is", () => {
    expect(isApprovalGate(UNMARKED_QUIET)).toBe(false);
  });

  it("leaves the gate's own decision untouched", () => {
    expect(REFUSING(CLAIMS_APPROVAL)).toEqual([
      { code: "test.unapproved", correction: "pass --approve", severity: "hold", summary: "no approval" },
    ]);
  });
});

describe("a request claiming approval that no gate can decide", () => {
  it("is held when it passes the empty compose seam", () => {
    const decision = admitDoor({ env: {}, gates: DEFAULT_GATES, request: CLAIMS_APPROVAL });
    expect(decision.status).toBe("hold");
    expect(decision.findings.map((f) => f.code)).toEqual([APPROVAL_UNBACKED_CODE]);
  });

  it("is held even when an unmarked gate in its list returned nothing", () => {
    const decision = admitDoor({ env: {}, gates: [UNMARKED_QUIET], request: CLAIMS_APPROVAL });
    expect(decision.status).toBe("hold");
    expect(decision.findings.map((f) => f.code)).toEqual([APPROVAL_UNBACKED_CODE]);
  });

  it("names the verb that made the claim, so a reader knows which one lied", () => {
    const decision = admitDoor({ env: {}, gates: DEFAULT_GATES, request: CLAIMS_APPROVAL });
    expect(decision.findings[0]!.summary).toContain("write vanta deactivate declares requiresApproval");
  });

  it("cannot be waived by the per-action override token, because a hold carries none", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: `${APPROVAL_UNBACKED_CODE},anything,else` },
      gates: DEFAULT_GATES,
      request: CLAIMS_APPROVAL,
    });
    expect(decision.status).toBe("hold");
    expect(decision.overridden).toEqual([]);
  });

  it("leads the findings, so the refusal opens with why it could never have passed", () => {
    const noisy: DoorGate = () => [
      { code: "other.finding", correction: "do the other thing", severity: "hold", summary: "something else" },
    ];
    const decision = admitDoor({ env: {}, gates: [noisy], request: CLAIMS_APPROVAL });
    expect(decision.findings.map((f) => f.code)).toEqual([APPROVAL_UNBACKED_CODE, "other.finding"]);
  });
});

describe("the rule fires on the claim and on nothing else", () => {
  it("passes a request that claims approval and carries a marked gate that granted it", () => {
    const decision = admitDoor({ env: {}, gates: [SATISFIED], request: CLAIMS_APPROVAL });
    expect(decision.status).toBe("pass");
    expect(decision.findings).toEqual([]);
  });

  it("passes a request that claims nothing through the empty compose seam", () => {
    const decision = admitDoor({ env: {}, gates: DEFAULT_GATES, request: CLAIMS_NOTHING });
    expect(decision.status).toBe("pass");
    expect(decision.findings).toEqual([]);
  });

  it("still holds a claiming request whose marked gate refused, reporting that gate's own finding", () => {
    const decision = admitDoor({ env: {}, gates: [REFUSING], request: CLAIMS_APPROVAL });
    expect(decision.status).toBe("hold");
    expect(decision.findings.map((f) => f.code)).toEqual(["test.unapproved"]);
  });
});
