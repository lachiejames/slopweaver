import { describe, expect, it } from "vitest";

import {
  controlEvidenceLines,
  type VantaControlEvidence,
  vantaControlEvidenceSchema,
} from "../../../../atlas/vanta/controlEvidence.js";

const AT = "2026-01-01T00:00:00.000Z";

const evidence: VantaControlEvidence = {
  control: {
    citation: { label: "[1]", url: "https://app.vanta.com/controls/c1" },
    description: "d",
    documentsPassing: 1,
    documentsTotal: 1,
    domains: [],
    externalId: "EXT-1",
    name: "A control",
    owner: null,
    providerId: "c1",
    status: "OK",
    testsPassing: 4,
    testsTotal: 5,
  },
  generatedAt: AT,
  kind: "vanta-control-evidence",
  schemaVersion: 1,
  screenshot: { path: "/tmp/shot.png", status: "captured" },
  tenantSlug: "acme-corp",
  tests: [
    {
      category: "IT",
      description: "d",
      entities: { status: "not-requested" },
      failureDescription: "fail",
      id: "t1",
      integrations: [],
      lastRunAt: AT,
      name: "A failing test",
      remediation: { itemCount: 3, remediateBy: null, status: "IN_PROGRESS" },
      remediationDescription: "fix it",
      status: "NEEDS_ATTENTION",
      version: { major: 1, minor: 0 },
    },
    {
      category: "IT",
      description: "d",
      entities: { status: "not-requested" },
      failureDescription: "",
      id: "t2",
      integrations: [],
      lastRunAt: AT,
      name: "A passing test",
      remediation: { itemCount: 0, remediateBy: null, status: "OK" },
      remediationDescription: "",
      status: "OK",
      version: { major: 1, minor: 0 },
    },
  ],
};

describe("vantaControlEvidenceSchema", () => {
  it("accepts a valid document", () => {
    expect(vantaControlEvidenceSchema.safeParse(evidence).success).toBe(true);
  });
});

describe("controlEvidenceLines", () => {
  it("names the control by its external id and reports the failing-test count", () => {
    const lines = controlEvidenceLines({ artifactPath: "/tmp/e.json", evidence });
    expect(lines[0]).toBe("EXT-1: A control");
    expect(lines.some((line) => line.includes("1 mapped automated test(s) need attention"))).toBe(true);
  });

  it("lists only the failing test, with its remediation", () => {
    const lines = controlEvidenceLines({ artifactPath: "/tmp/e.json", evidence });
    expect(lines.some((line) => line.includes("A failing test"))).toBe(true);
    expect(lines.some((line) => line.includes("A passing test"))).toBe(false);
  });

  it("falls back to the provider id when no external id is set", () => {
    const lines = controlEvidenceLines({
      artifactPath: "/tmp/e.json",
      evidence: { ...evidence, control: { ...evidence.control, externalId: null } },
    });
    expect(lines[0]).toBe("c1: A control");
  });
});
