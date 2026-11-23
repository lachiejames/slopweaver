import { describe, expect, it } from "vitest";

import type {
  VantaControlDto,
  VantaDocumentDto,
  VantaPolicyDto,
  VantaVendorDto,
} from "../../../../atlas/vanta/apiSchemas.js";
import {
  projectVantaControl,
  projectVantaEvidence,
  projectVantaPolicy,
  projectVantaRisk,
  projectVantaVendor,
} from "../../../../atlas/vanta/projection.js";
import { type VantaRiskScenarioDto } from "../../../../atlas/vanta/riskApiSchemas.js";

const AT = "2026-01-01T00:00:00.000Z";

const controlDto: VantaControlDto = {
  creationDate: null,
  customFields: [],
  description: "d",
  domains: [],
  externalId: "EXT-1",
  id: "control-1",
  modificationDate: null,
  name: "A control",
  owner: null,
  role: null,
  source: "Custom",
};

describe("projectVantaControl", () => {
  it("populates only the manage-api channel", () => {
    const { entity, pendingWrite } = projectVantaControl({ at: AT, dto: controlDto });
    expect(entity.channels["manage-api"]).not.toBeNull();
    expect(entity.channels.browser).toBeNull();
    expect(pendingWrite).toBeNull();
  });

  it("keys the entity id on the provider id, not the external id", () => {
    const { entity } = projectVantaControl({ at: AT, dto: controlDto });
    expect(entity.providerId).toBe("control-1");
  });
});

const riskDto: VantaRiskScenarioDto = {
  categories: [],
  ciaCategories: [],
  customFields: [],
  description: "d",
  detailedDescription: null,
  identificationDate: AT,
  impact: null,
  isArchived: false,
  isSensitive: null,
  likelihood: null,
  note: null,
  owner: null,
  requiredApprovers: [],
  residualImpact: null,
  residualLikelihood: null,
  reviewStatus: "NOT_REVIEWED",
  riskId: "risk-1",
  riskRegister: null,
  scoreBreakdown: null,
  treatment: null,
  type: "Risk Scenario",
};

describe("projectVantaRisk", () => {
  it("carries no sensitivity when isSensitive is null", () => {
    const { entity } = projectVantaRisk({ at: AT, dto: riskDto });
    expect(entity.sensitivity).toBeNull();
  });

  it("marks sensitivity when isSensitive is true", () => {
    const { entity } = projectVantaRisk({ at: AT, dto: { ...riskDto, isSensitive: true } });
    expect(entity.sensitivity).toEqual({ handleWithCare: true, providerMarkedSensitive: true });
  });

  it("keys the entity id on riskId", () => {
    const { entity } = projectVantaRisk({ at: AT, dto: riskDto });
    expect(entity.providerId).toBe("risk-1");
  });
});

const policyDto: VantaPolicyDto = {
  approvedAtDate: null,
  description: "d",
  id: "policy-1",
  latestApprovedVersion: {
    documents: [{ language: null, slugId: "s", url: "https://app.vanta.com/policy/s" }],
    versionId: "v1",
  },
  latestVersion: { status: "APPROVED" },
  name: "A policy",
  status: "OK",
};

describe("projectVantaPolicy", () => {
  it("uses the first approved document's url as the deep link", () => {
    const { entity } = projectVantaPolicy({ at: AT, dto: policyDto });
    expect(entity.channels["manage-api"]!.source!.deepLink).toBe("https://app.vanta.com/policy/s");
    expect(entity.channels["manage-api"]!.source!.deepLinkStatus).toBe("provider-provided");
  });

  it("has no deep link when there is no approved version", () => {
    const { entity } = projectVantaPolicy({ at: AT, dto: { ...policyDto, latestApprovedVersion: null } });
    expect(entity.channels["manage-api"]!.source!.deepLink).toBeNull();
  });
});

const documentDto: VantaDocumentDto = {
  category: "IT",
  description: "d",
  id: "doc-1",
  isSensitive: true,
  ownerId: null,
  title: "A document",
  uploadStatus: "OK",
  uploadStatusDate: null,
  url: "https://app.vanta.com/documents/doc-1",
};

describe("projectVantaEvidence", () => {
  it("always carries a sensitivity marker (isSensitive is required, not deprecated)", () => {
    const { entity } = projectVantaEvidence({ at: AT, dto: documentDto });
    expect(entity.sensitivity).toEqual({ handleWithCare: true, providerMarkedSensitive: true });
  });

  it("uses the document's own url as the deep link", () => {
    const { entity } = projectVantaEvidence({ at: AT, dto: documentDto });
    expect(entity.channels["manage-api"]!.source!.deepLink).toBe("https://app.vanta.com/documents/doc-1");
  });
});

const vendorDto: VantaVendorDto = {
  accountManagerEmail: null,
  accountManagerName: null,
  additionalNotes: null,
  authDetails: {
    method: null,
    passwordMFA: null,
    passwordMinimumLength: null,
    passwordRequiresNumber: null,
    passwordRequiresSymbol: null,
  },
  businessOwnerUserId: null,
  category: null,
  contractAmount: { amount: 5000, currency: "USD" },
  contractRenewalDate: null,
  contractStartDate: null,
  contractTerminationDate: null,
  customFields: null,
  id: "vendor-1",
  inherentRiskLevel: "LOW",
  isRiskAutoScored: null,
  isVisibleToAuditors: null,
  lastSecurityReviewCompletionDate: null,
  latestDecision: null,
  linkedTaskTrackerTaskProcurementRequest: null,
  name: "A vendor",
  nextSecurityReviewDueDate: null,
  residualRiskLevel: "LOW",
  riskAttributeIds: [],
  securityOwnerUserId: null,
  servicesProvided: null,
  status: "MANAGED",
  vendorHeadquarters: null,
  websiteUrl: null,
};

describe("projectVantaVendor", () => {
  it("never carries the contract amount in the committed detail", () => {
    const { entity } = projectVantaVendor({ at: AT, dto: vendorDto });
    const detail = entity.channels["manage-api"]!.detail as Record<string, unknown>;
    expect(detail["contractAmount"]).toBeUndefined();
  });

  it("produces a financial pointer and a pending write when a contract amount is present", () => {
    const { entity, pendingWrite } = projectVantaVendor({ at: AT, dto: vendorDto });
    expect(entity.financialDetail).not.toBeNull();
    expect(pendingWrite).not.toBeNull();
    expect(pendingWrite!.value).toEqual({ amount: 5000, currency: "USD" });
  });

  it("produces neither a pointer nor a pending write when there is no contract amount", () => {
    const { entity, pendingWrite } = projectVantaVendor({ at: AT, dto: { ...vendorDto, contractAmount: null } });
    expect(entity.financialDetail).toBeNull();
    expect(pendingWrite).toBeNull();
  });

  it("the financial pointer names the entity's own stable id", () => {
    const { entity } = projectVantaVendor({ at: AT, dto: vendorDto });
    expect(entity.financialDetail!.companionRelativePath).toBe(`atlas/vanta/_sensitive/vendor/${entity.id}.json`);
  });
});
