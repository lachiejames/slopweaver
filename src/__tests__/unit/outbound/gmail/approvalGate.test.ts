/**
 * The gate that stands between a draft and a person's inbox. Pure: both digests are computed by the caller,
 * so the gate is a function of two strings and nothing else.
 *
 * The severity assertions are the point of this file. A `warn` would carry an override token and therefore
 * be waivable by an environment variable, which is not an owner — so "this is a hold" is a correctness
 * property, not a stylistic one, and it is asserted rather than assumed.
 */
import { describe, expect, it } from "vitest";

import { admitDoor } from "../../../../admit/door.js";
import type { DoorRequest } from "../../../../admit/types.js";
import { gmailSendApprovalGate, SEND_UNAPPROVED_CODE } from "../../../../outbound/gmail/approvalGate.js";

/** The request shape a send makes; the gate reads none of it, which is itself worth pinning. */
const request: DoorRequest = {
  action: { kind: "verb", noun: "gmail", verb: "send" },
  artifact: { digest: "3f9a2c7e1b4d5006", draftId: "d-1" },
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: true },
};

describe("gmailSendApprovalGate", () => {
  it("passes when the supplied digest matches exactly", () => {
    const gate = gmailSendApprovalGate({ expected: "3f9a2c7e1b4d5006", supplied: "3f9a2c7e1b4d5006" });
    expect(gate(request)).toEqual([]);
  });

  it("holds when no approval was supplied at all", () => {
    const gate = gmailSendApprovalGate({ expected: "3f9a2c7e1b4d5006", supplied: undefined });
    expect(gate(request)[0]!.severity).toBe("hold");
  });

  it("holds when the approval is for different content — the transplant case", () => {
    const gate = gmailSendApprovalGate({ expected: "3f9a2c7e1b4d5006", supplied: "0000000000000000" });
    expect(gate(request)[0]!.severity).toBe("hold");
  });

  it("says WHICH failure it was, because 'never approved' and 'approved then edited' need different fixes", () => {
    const never = gmailSendApprovalGate({ expected: "aaaa", supplied: undefined })(request);
    const edited = gmailSendApprovalGate({ expected: "aaaa", supplied: "bbbb" })(request);
    expect(never[0]!.summary).toContain("has not been approved");
    expect(edited[0]!.summary).toContain("it was approved, then it changed");
  });

  it("puts the exact command to run in the correction, so nobody reconstructs it by hand", () => {
    const finding = gmailSendApprovalGate({ expected: "3f9a2c7e1b4d5006", supplied: undefined })(request)[0]!;
    expect(finding.correction).toContain("--approve 3f9a2c7e1b4d5006");
  });

  it("fires under its own code", () => {
    const finding = gmailSendApprovalGate({ expected: "aaaa", supplied: undefined })(request)[0]!;
    expect(finding.code).toBe(SEND_UNAPPROVED_CODE);
  });

  it("is case-sensitive and whitespace-sensitive, so a mangled paste is refused rather than accepted", () => {
    const gate = gmailSendApprovalGate({ expected: "3f9a2c7e1b4d5006", supplied: "3F9A2C7E1B4D5006" });
    expect(gate(request).length).toBe(1);
  });
});

describe("the door's verdict on an unapproved send", () => {
  it("is hold, not warn — so the caller must not perform the effect", () => {
    const decision = admitDoor({
      env: {},
      gates: [gmailSendApprovalGate({ expected: "aaaa", supplied: undefined })],
      request,
    });
    expect(decision.status).toBe("hold");
  });

  it("is STILL hold with every override token set, which is the property that makes this a gate", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: `${SEND_UNAPPROVED_CODE},${SEND_UNAPPROVED_CODE}:v1,gmail.send` },
      gates: [gmailSendApprovalGate({ expected: "aaaa", supplied: undefined })],
      request,
    });
    expect(decision.status).toBe("hold");
    expect(decision.overridden).toEqual([]);
  });

  it("passes once the right digest is supplied", () => {
    const decision = admitDoor({
      env: {},
      gates: [gmailSendApprovalGate({ expected: "aaaa", supplied: "aaaa" })],
      request,
    });
    expect(decision.status).toBe("pass");
  });
});
