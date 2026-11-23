import { describe, expect, it } from "vitest";

import { vantaIssueDtoSchema } from "../../../../atlas/vanta/issueApiSchemas.js";

/** A POA&M issue carrying every field the document's `StandardPOAM` requires. */
const poam = {
  closedMetadata: null,
  controlDomain: null,
  correctiveAction: null,
  createdBy: { actorId: "u1", actorType: "USER" },
  createdDate: "2026-10-01T00:00:00Z",
  customFields: [],
  description: "a finding",
  detectedDate: "2026-10-01T00:00:00Z",
  dueDate: null,
  id: "issue-1",
  lastModifiedBy: { actorId: "u1", actorType: "USER" },
  lastModifiedDate: "2026-10-02T00:00:00Z",
  mappedControlIds: [],
  mappedPolicyIds: [],
  mappedRiskScenarioIds: [],
  owners: [{ ownerId: "u1", ownerType: "USER" }],
  readableIssueId: "ISS-1",
  requiredResources: null,
  rootCause: null,
  severity: "HIGH",
  source: null,
  status: "NOT_STARTED",
  systemsDescription: "the booking service",
  template: "STANDARD_POAM",
  title: "Patch the host",
};

describe("vantaIssueDtoSchema", () => {
  it("reads a POA&M issue by its template", () => {
    const parsed = vantaIssueDtoSchema.parse(poam);
    expect(parsed.template).toBe("STANDARD_POAM");
    expect(parsed.readableIssueId).toBe("ISS-1");
  });

  it("refuses a standard issue carrying a POA&M-only field", () => {
    const result = vantaIssueDtoSchema.safeParse({ ...poam, template: "STANDARD_ISSUE", type: null });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.code)).toEqual(["unrecognized_keys"]);
  });
});
