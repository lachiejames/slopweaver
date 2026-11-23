import { describe, expect, it } from "vitest";

import {
  UPLOAD_POLICY_VERSION_UNAPPROVED_CODE,
  type VantaPolicyUploadPlan,
  vantaPolicyUploadDigest,
  vantaUploadPolicyVersionApprovalGate,
} from "../../../atlas/vanta/policyVersionUpload.js";

/** One resolved upload. */
function plan(over: Partial<VantaPolicyUploadPlan> = {}): VantaPolicyUploadPlan {
  return {
    disposition: "draft-only",
    kind: "vanta-policy-version-upload-v1",
    markdownSha256: "m".repeat(64),
    pdfSha256: "p".repeat(64),
    policyId: "custom-ai-acceptable-use-policy",
    sourceCommit: "e341a151c0f33e6e0dd0957ee286ab9f6f9e5022",
    url: "https://app.vanta.com/c/acme/policies/custom-ai-acceptable-use-policy",
    ...over,
  };
}

describe("vantaPolicyUploadDigest", () => {
  it("is stable for the same upload", () => {
    expect(vantaPolicyUploadDigest({ plan: plan() })).toBe(vantaPolicyUploadDigest({ plan: plan() }));
  });

  it("moves when the PDF's own bytes move, so an approval cannot be transplanted", () => {
    expect(vantaPolicyUploadDigest({ plan: plan() })).not.toBe(
      vantaPolicyUploadDigest({ plan: plan({ pdfSha256: "q".repeat(64) }) }),
    );
  });

  it("moves when the approved markdown moves", () => {
    expect(vantaPolicyUploadDigest({ plan: plan() })).not.toBe(
      vantaPolicyUploadDigest({ plan: plan({ markdownSha256: "n".repeat(64) }) }),
    );
  });

  it("moves when the policy moves", () => {
    expect(vantaPolicyUploadDigest({ plan: plan() })).not.toBe(
      vantaPolicyUploadDigest({ plan: plan({ policyId: "access-control-policy" }) }),
    );
  });

  it("is sixteen hex characters", () => {
    expect(vantaPolicyUploadDigest({ plan: plan() })).toMatch(/^[0-9a-f]{16}$/);
  });
});

/** The request every gate below is asked about — the gate reads the digests it was built with, not this. */
const REQUEST = {
  action: { kind: "verb", noun: "write", verb: "vanta upload-policy-version" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/nope", requiresApproval: true },
} as const;

describe("vantaUploadPolicyVersionApprovalGate", () => {
  it("passes when the supplied digest is the expected one", () => {
    const gate = vantaUploadPolicyVersionApprovalGate({ expected: "abc123", supplied: "abc123" });
    expect(gate(REQUEST).length).toBe(0);
  });

  it("holds with no approval at all, saying what a renewal costs", () => {
    const findings = vantaUploadPolicyVersionApprovalGate({ expected: "abc123", supplied: null })(REQUEST);
    expect(findings.length).toBe(1);
    expect(findings[0]!.severity).toBe("hold");
    expect(findings[0]!.code).toBe(UPLOAD_POLICY_VERSION_UNAPPROVED_CODE);
    expect(findings[0]!.summary).toContain("starting a renewal creates a draft");
  });

  it("holds on a stale approval and says which half moved", () => {
    const findings = vantaUploadPolicyVersionApprovalGate({ expected: "abc123", supplied: "old999" })(REQUEST);
    expect(findings[0]!.summary).toContain("does not match this upload (abc123)");
  });

  it("names the exact re-run in its correction, and says the hold is not waivable", () => {
    const findings = vantaUploadPolicyVersionApprovalGate({ expected: "abc123", supplied: null })(REQUEST);
    expect(findings[0]!.correction).toContain("--approve abc123");
    expect(findings[0]!.correction).toContain("There is no override");
  });
});
