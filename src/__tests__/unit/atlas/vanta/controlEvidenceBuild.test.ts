import { describe, expect, it } from "vitest";

import { buildVantaControlEvidence, type VantaTestEntitiesOutcome } from "../../../../atlas/vanta/controlEvidence.js";
import type {
  VantaControlDetailDto,
  VantaControlTestDto,
  VantaTestEntityDto,
} from "../../../../atlas/vanta/controlEvidenceApiSchemas.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const CITATION = { label: "CTL-1 in Vanta's controls list", url: "https://app.vanta.com/c/tenant-one/controls" };

const control: VantaControlDetailDto = {
  creationDate: null,
  customFields: [],
  description: "every laptop is encrypted",
  domains: ["ENDPOINT_SECURITY"],
  externalId: "CTL-1",
  id: "laptop-encryption",
  modificationDate: null,
  name: "Laptop encryption",
  note: null,
  numDocumentsPassing: 1,
  numDocumentsTotal: 2,
  numTestsPassing: 1,
  numTestsTotal: 2,
  owner: { displayName: "A Person", emailAddress: "a@example.com", id: "u1" },
  role: null,
  source: "Vanta",
  status: "NEEDS_ATTENTION",
};

const failingTest: VantaControlTestDto = {
  category: "Endpoint security",
  deactivatedStatusInfo: { deactivatedReason: null, isDeactivated: false, lastUpdatedDate: null },
  description: "checks disk encryption",
  failureDescription: "3 laptops report encryption off",
  id: "t-encryption",
  integrations: ["jamf"],
  lastTestRunDate: AT,
  latestFlipDate: null,
  name: "Laptops are encrypted",
  owner: null,
  remediationDescription: "turn FileVault on",
  remediationStatusInfo: { itemCount: 3, soonestRemediateByDate: "2026-02-01T00:00:00.000Z", status: "OVERDUE" },
  status: "NEEDS_ATTENTION",
  version: { major: 1, minor: 0 },
};

const passingTest: VantaControlTestDto = {
  ...failingTest,
  failureDescription: "",
  id: "t-passing",
  name: "Laptops report in",
  remediationStatusInfo: { itemCount: 0, soonestRemediateByDate: null, status: "NONE" },
  status: "OK",
};

const entity: VantaTestEntityDto = {
  createdDate: null,
  deactivatedReason: null,
  displayName: "MacBook-01",
  entityStatus: "FAILING",
  id: "e1",
  lastUpdatedDate: AT,
  responseType: "Computer",
};

function build({ entitiesByTestId }: { entitiesByTestId: ReadonlyMap<string, VantaTestEntitiesOutcome> }) {
  return buildVantaControlEvidence({
    citation: CITATION,
    control,
    entitiesByTestId,
    generatedAt: AT,
    screenshot: { reason: "no browser leg ran", status: "unavailable" },
    tenantSlug: "tenant-one",
    tests: [failingTest, passingTest],
  });
}

describe("buildVantaControlEvidence", () => {
  it("projects the control detail onto the document's own field names", () => {
    const evidence = unwrap(build({ entitiesByTestId: new Map() }));

    expect(evidence.control.providerId).toBe("laptop-encryption");
    expect(evidence.control.externalId).toBe("CTL-1");
    expect(evidence.control.owner).toBe("A Person");
    expect(evidence.control.documentsPassing).toBe(1);
    expect(evidence.control.documentsTotal).toBe(2);
    expect(evidence.control.testsPassing).toBe(1);
    expect(evidence.control.testsTotal).toBe(2);
    expect(evidence.control.citation.url).toBe(CITATION.url);
    expect(evidence.tenantSlug).toBe("tenant-one");
    expect(evidence.kind).toBe("vanta-control-evidence");
  });

  it("carries the remediation Vanta reported, including its due date", () => {
    const evidence = unwrap(build({ entitiesByTestId: new Map() }));
    const test = evidence.tests[0]!;

    expect(test.id).toBe("t-encryption");
    expect(test.failureDescription).toBe("3 laptops report encryption off");
    expect(test.remediationDescription).toBe("turn FileVault on");
    expect(test.remediation.itemCount).toBe(3);
    expect(test.remediation.status).toBe("OVERDUE");
    expect(test.remediation.remediateBy).toBe("2026-02-01T00:00:00.000Z");
    expect(test.lastRunAt).toBe(AT);
    expect(test.integrations).toEqual(["jamf"]);
  });

  it("records an unasked entity read as not-requested rather than as an empty sample", () => {
    const evidence = unwrap(build({ entitiesByTestId: new Map() }));

    expect(evidence.tests[0]!.entities).toEqual({ status: "not-requested" });
  });

  it("projects a captured entity sample onto the document's own entity fields", () => {
    const evidence = unwrap(
      build({
        entitiesByTestId: new Map([["t-encryption", { hasMore: true, kind: "captured", sample: [entity] }]]),
      }),
    );

    expect(evidence.tests[0]!.entities).toEqual({
      hasMore: true,
      reportedItemCount: 1,
      sample: [{ id: "e1", name: "MacBook-01", status: "FAILING", type: "Computer", updatedAt: AT }],
      status: "captured",
    });
  });

  it("records a refused entity read with the reason it was refused", () => {
    const evidence = unwrap(
      build({
        entitiesByTestId: new Map([["t-encryption", { kind: "unavailable", reason: "HTTP 403" }]]),
      }),
    );

    expect(evidence.tests[0]!.entities).toEqual({ reason: "HTTP 403", status: "unavailable" });
  });

  it("refuses a document its own schema cannot accept, naming the field", () => {
    const built = buildVantaControlEvidence({
      citation: { label: "x", url: "not-a-url" },
      control,
      entitiesByTestId: new Map(),
      generatedAt: AT,
      screenshot: { reason: "no browser leg ran", status: "unavailable" },
      tenantSlug: "tenant-one",
      tests: [],
    });

    expect(built.isErr()).toBe(true);
    expect(unwrapErr(built).join("\n")).toContain("control.citation.url");
  });
});
