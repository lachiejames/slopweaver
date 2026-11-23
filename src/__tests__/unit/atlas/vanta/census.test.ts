import { describe, expect, it } from "vitest";

import { VANTA_CENSUS_FAMILIES, VANTA_CENSUS_FAMILY_LIST } from "../../../../atlas/vanta/census.js";
import { vantaMonitoredComputerDtoSchema, vantaUserDtoSchema } from "../../../../atlas/vanta/censusApiSchemas.js";
import { projectVantaCensusRow, projectVantaEventShape } from "../../../../atlas/vanta/censusProjection.js";
import { VANTA_KINDS } from "../../../../atlas/vanta/model.js";
import { vantaPersonDtoSchema } from "../../../../atlas/vanta/personApiSchemas.js";

const AT = "2026-09-04T06:00:00.000Z";

describe("VANTA_CENSUS_FAMILIES", () => {
  it("keys every family by the kind it produces", () => {
    for (const [kind, family] of Object.entries(VANTA_CENSUS_FAMILIES)) {
      expect(family.kind).toBe(kind);
    }
  });

  it("declares every family's kind in the atlas's own vocabulary", () => {
    for (const family of VANTA_CENSUS_FAMILY_LIST) {
      expect(VANTA_KINDS.includes(family.kind)).toBe(true);
    }
  });

  it("gives every family a distinct surface name, so two cannot share a coverage cell", () => {
    const surfaces = VANTA_CENSUS_FAMILY_LIST.map((family) => family.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("marks the families carrying staff or machine identity for care before quoting", () => {
    const careful = VANTA_CENSUS_FAMILY_LIST.filter((family) => family.handleWithCare).map((family) => family.kind);
    expect(careful.toSorted()).toEqual([
      "answer-library-entry",
      "customer-trust-account",
      "group",
      "importable-idp-group",
      "integration",
      "monitored-computer",
      "person",
      "questionnaire",
      "questionnaire-assignable-user",
      "test",
      "user",
      "vulnerable-asset",
    ]);
  });
});

describe("projectVantaCensusRow", () => {
  const user = vantaUserDtoSchema.parse({
    displayName: "A Person",
    email: "a.person@example.test",
    id: "u1",
    isActive: true,
  });

  it("stores the row exactly as the provider returned it", () => {
    const entity = projectVantaCensusRow({ at: AT, dto: user, family: VANTA_CENSUS_FAMILIES.user });
    expect(entity.channels["manage-api"]!.detail).toEqual(user);
    expect(entity.channels.browser).toBe(null);
    expect(entity.providerId).toBe("u1");
    expect(entity.kind).toBe("user");
  });

  it("records the endpoint that produced the row, with no deep link to claim", () => {
    const entity = projectVantaCensusRow({ at: AT, dto: user, family: VANTA_CENSUS_FAMILIES.user });
    expect(entity.channels["manage-api"]!.source!.endpoint).toBe("/v1/users");
    expect(entity.channels["manage-api"]!.source!.deepLink).toBe(null);
    expect(entity.channels["manage-api"]!.source!.deepLinkStatus).toBe("unavailable");
    expect(entity.channels["manage-api"]!.source!.observedAt).toBe(AT);
  });

  it("marks a staff-identity family for care and leaves the provider's own opinion unstated", () => {
    const entity = projectVantaCensusRow({ at: AT, dto: user, family: VANTA_CENSUS_FAMILIES.user });
    expect(entity.sensitivity).toEqual({ handleWithCare: true, providerMarkedSensitive: null });
  });

  it("leaves a family carrying no identity unmarked", () => {
    const framework = {
      description: "d",
      displayName: "ISO 27001",
      id: "f1",
      numControlsCompleted: 1,
      numControlsTotal: 2,
      numDocumentsPassing: 1,
      numDocumentsTotal: 2,
      numTestsPassing: 1,
      numTestsTotal: 2,
      shorthandName: "iso",
    };
    const entity = projectVantaCensusRow({ at: AT, dto: framework, family: VANTA_CENSUS_FAMILIES.framework });
    expect(entity.sensitivity).toBe(null);
  });

  it("gives two kinds sharing a provider id two different entity ids", () => {
    const asUser = projectVantaCensusRow({ at: AT, dto: user, family: VANTA_CENSUS_FAMILIES.user });
    const person = vantaPersonDtoSchema.parse({
      emailAddress: "a.person@example.test",
      employment: { endDate: null, jobTitle: null, startDate: "2026-01-01", status: "ACTIVE" },
      groupIds: [],
      id: "u1",
      leaveInfo: null,
      name: { display: "A Person", first: "A", last: "Person" },
      sources: {
        emailAddress: { integrationId: "i", resourceId: "r", type: "INTEGRATION" },
        employment: {
          endDate: { integrationId: "i", resourceId: "r", type: "INTEGRATION" },
          startDate: { integrationId: "i", resourceId: "r", type: "INTEGRATION" },
        },
      },
      tasksSummary: {
        completionDate: null,
        details: {
          acceptPolicies: {
            acceptedPolicies: [],
            completionDate: null,
            disabled: null,
            dueDate: null,
            status: "s",
            taskType: "t",
            unacceptedPolicies: [],
          },
          completeBackgroundChecks: { completionDate: null, disabled: null, dueDate: null, status: "s", taskType: "t" },
          completeCustomTasks: {
            completedCustomTasks: [],
            completionDate: null,
            disabled: null,
            dueDate: null,
            incompleteCustomTasks: [],
            status: "s",
            taskType: "t",
          },
          completeOffboardingCustomTasks: {
            completedCustomOffboardingTasks: [],
            completionDate: null,
            disabled: null,
            dueDate: null,
            incompleteCustomOffboardingTasks: [],
            status: "s",
            taskType: "t",
          },
          completeTrainings: {
            completedTrainings: [],
            completionDate: null,
            disabled: null,
            dueDate: null,
            incompleteTrainings: [],
            status: "s",
            taskType: "t",
          },
          installDeviceMonitoring: { completionDate: null, disabled: null, dueDate: null, status: "s", taskType: "t" },
        },
        dueDate: null,
        status: "s",
      },
      userId: "u1",
    });
    const asPerson = projectVantaCensusRow({ at: AT, dto: person, family: VANTA_CENSUS_FAMILIES.person });
    expect(asUser.providerId).toBe(asPerson.providerId);
    expect(asUser.id).not.toBe(asPerson.id);
  });

  it("keys the integration family on integrationId rather than id", () => {
    const integration = { connections: [], displayName: "AWS", integrationId: "aws", resourceKinds: ["AwsRole"] };
    const entity = projectVantaCensusRow({ at: AT, dto: integration, family: VANTA_CENSUS_FAMILIES.integration });
    expect(entity.providerId).toBe("aws");
  });
});

describe("projectVantaEventShape", () => {
  it("makes the event kind the entity's own identity, and stores no event", () => {
    const entity = projectVantaEventShape({
      at: AT,
      shape: {
        action: "policy.updated",
        actorTypes: ["user"],
        attributes: [{ path: "action", types: ["string"] }],
        firstSeenDate: "2026-09-01T00:00:00Z",
        lastSeenDate: "2026-09-03T00:00:00Z",
        observedCount: 12,
        samples: [],
        targetTypes: ["policy"],
      },
    });
    expect(entity.kind).toBe("event-shape");
    expect(entity.providerId).toBe("policy.updated");
    expect(entity.channels["manage-api"]!.source!.endpoint).toBe("/v1/event-logs");
  });
});

describe("the monitored-computer schema", () => {
  it("carries the owner a turn needs to answer who a failing device belongs to", () => {
    const device = vantaMonitoredComputerDtoSchema.parse({
      antivirusInstallation: { outcome: "PASS" },
      diskEncryption: { outcome: "FAIL" },
      id: "d1",
      integrationId: "jumpcloud",
      lastCheckDate: "2026-09-01T00:00:00Z",
      operatingSystem: { type: "macOS", version: "15.0" },
      owner: { displayName: "A Person", emailAddress: "a.person@example.test", id: "u1" },
      passwordManager: { outcome: "PASS" },
      screenlock: { outcome: "PASS" },
      serialNumber: "S1",
      udid: "U1",
    });
    expect(device.owner!.emailAddress).toBe("a.person@example.test");
    expect(device.diskEncryption.outcome).toBe("FAIL");
  });

  it("refuses a row carrying a field this atlas does not know, rather than dropping it", () => {
    const parsed = vantaMonitoredComputerDtoSchema.safeParse({
      antivirusInstallation: { outcome: "PASS" },
      diskEncryption: { outcome: "PASS" },
      id: "d1",
      integrationId: "jumpcloud",
      lastCheckDate: null,
      operatingSystem: { type: "macOS", version: null },
      owner: null,
      passwordManager: { outcome: "PASS" },
      screenlock: { outcome: "PASS" },
      serialNumber: null,
      somethingVantaAddedLater: true,
      udid: "U1",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("the census vocabulary", () => {
  it("covers exactly these Manage API families — the SET rather than a count, so a swap cannot pass", () => {
    expect(VANTA_CENSUS_FAMILY_LIST.map((family) => family.kind).toSorted()).toEqual([
      "answer-library-entry",
      "customer-trust-account",
      "discovered-vendor",
      "framework",
      "group",
      "importable-idp-group",
      "integration",
      "issue",
      "library-control",
      "monitored-computer",
      "person",
      "questionnaire",
      "questionnaire-assignable-user",
      "test",
      "trust-tag-category",
      "user",
      "vendor-assessment-type",
      "vendor-risk-attribute",
      "vulnerability",
      "vulnerability-remediation",
      "vulnerable-asset",
    ]);
  });
});
