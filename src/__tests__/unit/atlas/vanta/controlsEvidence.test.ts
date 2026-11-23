import { describe, expect, it } from "vitest";

import {
  controlsEvidenceLines,
  type VantaControlsEvidence,
  vantaControlsEvidenceSchema,
} from "../../../../atlas/vanta/controlsEvidence.js";

const AT = "2026-01-01T00:00:00.000Z";

const v1: VantaControlsEvidence = {
  citation: { label: "[1]", url: "https://app.vanta.com/controls?status=needs_attention" },
  filter: "NEEDS_ATTENTION",
  generatedAt: AT,
  kind: "vanta-controls-evidence",
  schemaVersion: 1,
  screenshot: { path: "/tmp/shot.png", status: "captured", displayedTotal: 3 },
  tenantSlug: "acme-corp",
  total: 3,
};

describe("vantaControlsEvidenceSchema", () => {
  it("accepts a valid version-1 document", () => {
    expect(vantaControlsEvidenceSchema.safeParse(v1).success).toBe(true);
  });

  it("rejects a filter other than NEEDS_ATTENTION", () => {
    expect(vantaControlsEvidenceSchema.safeParse({ ...v1, filter: "ANYTHING" }).success).toBe(false);
  });
});

describe("controlsEvidenceLines", () => {
  it("states the total, the citation, and where the screenshot was captured", () => {
    const lines = controlsEvidenceLines({ artifactPath: "/tmp/evidence.json", evidence: v1 });
    expect(lines[0]).toContain("3 Vanta control(s) need attention");
    expect(lines).toContain("citation: https://app.vanta.com/controls?status=needs_attention");
    expect(lines).toContain("screenshot: /tmp/shot.png");
    expect(lines.at(-1)).toBe("evidence filed: /tmp/evidence.json");
  });

  it("states why, when the screenshot is unavailable", () => {
    const lines = controlsEvidenceLines({
      artifactPath: "/tmp/e.json",
      evidence: { ...v1, screenshot: { reason: "login required", status: "unavailable" } },
    });
    expect(lines).toContain("screenshot: unavailable — login required");
  });

  it("includes per-framework lines for a version-2 document", () => {
    const v2 = {
      citation: v1.citation,
      filter: "NEEDS_ATTENTION" as const,
      focus: {
        citation: v1.citation,
        controls: [],
        frameworkId: "f1",
        frameworkName: "ISO 27001",
        screenshot: v1.screenshot,
        total: 0,
      },
      frameworks: [
        {
          controlsCompleted: 8,
          controlsNeedingAttention: 2,
          controlsTotal: 10,
          id: "f1",
          name: "ISO 27001",
          testsPassing: 4,
          testsTotal: 5,
        },
      ],
      generatedAt: AT,
      kind: "vanta-controls-evidence" as const,
      schemaVersion: 2 as const,
      screenshot: v1.screenshot,
      tenantSlug: "acme-corp",
      total: 2,
    };
    expect(vantaControlsEvidenceSchema.safeParse(v2).success).toBe(true);
    const lines = controlsEvidenceLines({ artifactPath: "/tmp/e.json", evidence: v2 });
    expect(lines.some((line) => line.includes("ISO 27001: 2 control gap(s)"))).toBe(true);
  });
});
