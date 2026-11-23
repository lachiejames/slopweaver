import { describe, expect, it } from "vitest";

import {
  type CloudflareCasbIntegrationDetail,
  type CloudflareDlpProfileDetail,
  projectCloudflareCasbIntegration,
  projectCloudflareDlpProfile,
} from "../../../../../atlas/cloudflare/projection/zeroTrustData.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareDlpProfile", () => {
  it("keeps the detector entries inside the profile rather than splitting them out", () => {
    const detail = projectCloudflareDlpProfile({
      accountId: ACCOUNT_ID,
      at: AT,
      profile: {
        confidence_threshold: "high",
        entries: [{ enabled: true, id: "entry-1", name: "credit card" }],
        id: "dlp-1",
        name: "payment data",
        ocr_enabled: false,
        type: "predefined",
      },
    }).detail as CloudflareDlpProfileDetail;
    expect(JSON.stringify(detail.entries)).toContain("credit card");
    expect(detail.type).toBe("predefined");
    expect(detail.confidenceThreshold).toBe("high");
    expect(detail.ocrEnabled).toBe(false);
  });

  it("stores null for every field when the profile row carries nothing but an id", () => {
    const detail = projectCloudflareDlpProfile({ accountId: ACCOUNT_ID, at: AT, profile: { id: "dlp-2" } }).detail;
    expect(detail).toEqual({
      aiContextEnabled: null,
      allowedMatchCount: null,
      confidenceThreshold: null,
      contextAwareness: null,
      createdAt: null,
      description: null,
      entries: null,
      kind: "dlp-profile",
      name: null,
      ocrEnabled: null,
      sharedEntries: null,
      type: null,
      updatedAt: null,
    });
  });

  it("keeps a zero match count and an explicit false, which are values rather than absences", () => {
    const detail = projectCloudflareDlpProfile({
      accountId: ACCOUNT_ID,
      at: AT,
      profile: { ai_context_enabled: false, allowed_match_count: 0, id: "dlp-3" },
    }).detail as CloudflareDlpProfileDetail;
    expect(detail.allowedMatchCount).toBe(0);
    expect(detail.aiContextEnabled).toBe(false);
  });
});

describe("projectCloudflareCasbIntegration", () => {
  it("keeps the SaaS application the integration is bound to, and its paused state", () => {
    const entity = projectCloudflareCasbIntegration({
      accountId: ACCOUNT_ID,
      at: AT,
      integration: {
        application: { name: "example-saas" },
        created: AT,
        id: "casb-1",
        is_paused: false,
        name: "prod tenant",
        status: "healthy",
      },
    });
    const detail = entity.detail as CloudflareCasbIntegrationDetail;
    expect(detail.status).toBe("healthy");
    expect(detail.isPaused).toBe(false);
    expect(JSON.stringify(detail.application)).toContain("example-saas");
    expect(detail.createdAt).toBe(AT);
    expect(entity.source.operation).toBe("casb-integrations-list");
  });

  it("stores null for every field when the integration row carries nothing but an id", () => {
    const detail = projectCloudflareCasbIntegration({
      accountId: ACCOUNT_ID,
      at: AT,
      integration: { id: "casb-2" },
    }).detail;
    expect(detail).toEqual({
      application: null,
      createdAt: null,
      isPaused: null,
      kind: "casb-integration",
      name: null,
      status: null,
      updatedAt: null,
    });
  });
});
