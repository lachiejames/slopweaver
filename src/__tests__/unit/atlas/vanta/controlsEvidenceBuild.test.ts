import { describe, expect, it } from "vitest";

import { vantaControlsCitation, vantaTenantRootFromSlug } from "../../../../atlas/vanta/browserPages.js";
import { buildVantaControlsEvidenceV1, controlsEvidenceLines } from "../../../../atlas/vanta/controlsEvidence.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("buildVantaControlsEvidenceV1", () => {
  it("files a version 1 document carrying the count the NEEDS_ATTENTION filter measured", () => {
    const evidence = unwrap(
      buildVantaControlsEvidenceV1({
        citation: vantaControlsCitation({ label: "Vanta controls", tenantSlug: "tenant-one" }),
        filter: "NOT_COMPLETED",
        generatedAt: AT,
        screenshot: { reason: "no browser leg ran", status: "unavailable" },
        tenantSlug: "tenant-one",
        total: 5,
      }),
    );

    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.kind).toBe("vanta-controls-evidence");
    expect(evidence.filter).toBe("NOT_COMPLETED");
    expect(evidence.total).toBe(5);
    expect(evidence.tenantSlug).toBe("tenant-one");
    expect(evidence.citation.url).toBe("https://app.vanta.com/c/tenant-one/controls");
  });

  it("accepts a clean posture as zero rather than as a missing count", () => {
    const evidence = unwrap(
      buildVantaControlsEvidenceV1({
        citation: vantaControlsCitation({ label: "Vanta controls", tenantSlug: "tenant-one" }),
        filter: "NOT_COMPLETED",
        generatedAt: AT,
        screenshot: { reason: "no browser leg ran", status: "unavailable" },
        tenantSlug: "tenant-one",
        total: 0,
      }),
    );

    expect(evidence.total).toBe(0);
    expect(controlsEvidenceLines({ artifactPath: "/tmp/e.json", evidence })[0]).toBe(
      "0 Vanta control(s) need attention for tenant-one (filter: NOT_COMPLETED)",
    );
  });

  it("refuses a document its own schema cannot accept, naming the field", () => {
    const built = buildVantaControlsEvidenceV1({
      citation: { label: "Vanta controls", url: "not-a-url" },
      filter: "NOT_COMPLETED",
      generatedAt: AT,
      screenshot: { reason: "no browser leg ran", status: "unavailable" },
      tenantSlug: "tenant-one",
      total: 1,
    });

    expect(built.isErr()).toBe(true);
    expect(unwrapErr(built).join("\n")).toContain("citation.url");
  });
});

describe("vantaTenantRootFromSlug", () => {
  it("builds the same shape a redirect-learned tenant root has", () => {
    expect(vantaTenantRootFromSlug({ tenantSlug: "tenant-one" })).toBe("https://app.vanta.com/c/tenant-one");
  });

  it("cites the controls list rather than guessing a per-control route", () => {
    expect(vantaControlsCitation({ label: "CTL-1 in Vanta's controls list", tenantSlug: "tenant-one" })).toEqual({
      label: "CTL-1 in Vanta's controls list",
      url: "https://app.vanta.com/c/tenant-one/controls",
    });
  });
});
