import { describe, expect, it } from "vitest";

import {
  projectCloudflareCasbFinding,
  projectCloudflareDexFleetStatus,
  projectCloudflareDexTest,
  projectCloudflareDlpDataset,
  projectCloudflareRiskScore,
  projectCloudflareRiskScoreSummary,
} from "../../../../../atlas/cloudflare/projection/zeroTrustPosture.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

type DlpDataset = Parameters<typeof projectCloudflareDlpDataset>[0]["dataset"];
type CasbFinding = Parameters<typeof projectCloudflareCasbFinding>[0]["finding"];
type DexTest = Parameters<typeof projectCloudflareDexTest>[0]["test"];

/** The stored `integrations` reference itself (not a parsed copy), so identity can be asserted. */
function integrationsOf({ detail }: { detail: unknown }): unknown {
  if (typeof detail === "object" && detail !== null && "integrations" in detail) {
    return detail.integrations;
  }
  throw new Error("risk-score detail carries no integrations field");
}

describe("projectCloudflareDlpDataset", () => {
  it("maps every field, keeping falsy-but-present values", () => {
    const dataset: DlpDataset = {
      columns: [{ entry_id: "col-1", header_name: "email" }],
      created_at: "2025-12-01T00:00:00Z",
      description: "customer emails",
      encoding_version: 0,
      id: "dataset-1",
      name: "customers",
      num_cells: 0,
      secret: false,
      status: "complete",
      updated_at: "2025-12-02T00:00:00Z",
    };
    const entity = projectCloudflareDlpDataset({ accountId: ACCOUNT_ID, at: AT, dataset });
    expect(entity.kind).toBe("dlp-dataset");
    expect(entity.providerId).toBe("dataset-1");
    expect(entity.source.operation).toBe("dlp-datasets-list");
    expect(entity.detail).toEqual({
      columns: [{ entry_id: "col-1", header_name: "email" }],
      createdAt: "2025-12-01T00:00:00Z",
      description: "customer emails",
      encodingVersion: 0,
      kind: "dlp-dataset",
      name: "customers",
      numCells: 0,
      secret: false,
      status: "complete",
      updatedAt: "2025-12-02T00:00:00Z",
    });
  });

  it("stores every optional field as null when only the id is present", () => {
    const entity = projectCloudflareDlpDataset({ accountId: ACCOUNT_ID, at: AT, dataset: { id: "dataset-2" } });
    expect(entity.providerId).toBe("dataset-2");
    expect(entity.source.operation).toBe("dlp-datasets-list");
    expect(entity.detail).toEqual({
      columns: null,
      createdAt: null,
      description: null,
      encodingVersion: null,
      kind: "dlp-dataset",
      name: null,
      numCells: null,
      secret: null,
      status: null,
      updatedAt: null,
    });
  });
});

describe("projectCloudflareCasbFinding", () => {
  it("maps every field, keeping zero counts", () => {
    const finding: CasbFinding = {
      active_count: 0,
      archived_count: 3,
      finding: { name: "Public bucket", severity: "high" },
      id: "finding-1",
      instance_count: 7,
      integration: { id: "int-1", name: "Google Workspace" },
      latest_affliction_date: "2025-12-03T00:00:00Z",
    };
    const entity = projectCloudflareCasbFinding({ accountId: ACCOUNT_ID, at: AT, finding });
    expect(entity.kind).toBe("casb-finding");
    expect(entity.providerId).toBe("finding-1");
    expect(entity.source.operation).toBe("casb-posture-findings-list");
    expect(entity.detail).toEqual({
      activeCount: 0,
      archivedCount: 3,
      finding: { name: "Public bucket", severity: "high" },
      instanceCount: 7,
      integration: { id: "int-1", name: "Google Workspace" },
      kind: "casb-finding",
      latestAfflictionDate: "2025-12-03T00:00:00Z",
    });
  });

  it("stores every optional field as null when only the id is present", () => {
    const entity = projectCloudflareCasbFinding({ accountId: ACCOUNT_ID, at: AT, finding: { id: "finding-2" } });
    expect(entity.providerId).toBe("finding-2");
    expect(entity.source.operation).toBe("casb-posture-findings-list");
    expect(entity.detail).toEqual({
      activeCount: null,
      archivedCount: null,
      finding: null,
      instanceCount: null,
      integration: null,
      kind: "casb-finding",
      latestAfflictionDate: null,
    });
  });
});

describe("projectCloudflareRiskScore", () => {
  it("stores the behaviours and a copy of the integrations under the fixed provider id", () => {
    const behaviours = { "high-dlp": { enabled: true, risk_level: "high" } };
    const integrations = [{ id: "int-1" }, { id: "int-2" }];
    const entity = projectCloudflareRiskScore({ accountId: ACCOUNT_ID, at: AT, behaviours, integrations });
    expect(entity.kind).toBe("risk-score");
    expect(entity.providerId).toBe("risk-score");
    expect(entity.source.operation).toBe("risk-scoring-get");
    expect(entity.detail).toEqual({
      behaviours: { "high-dlp": { enabled: true, risk_level: "high" } },
      integrations: [{ id: "int-1" }, { id: "int-2" }],
      kind: "risk-score",
    });
  });

  it("copies the integrations array rather than aliasing the input", () => {
    const integrations = [{ id: "int-1" }];
    const entity = projectCloudflareRiskScore({ accountId: ACCOUNT_ID, at: AT, behaviours: {}, integrations });
    const stored = integrationsOf({ detail: entity.detail });
    expect(stored).not.toBe(integrations);
    expect(stored).toEqual(integrations);
  });

  it("stores an empty integrations list as an empty array", () => {
    const entity = projectCloudflareRiskScore({ accountId: ACCOUNT_ID, at: AT, behaviours: null, integrations: [] });
    expect(entity.detail).toEqual({ behaviours: null, integrations: [], kind: "risk-score" });
  });
});

describe("projectCloudflareRiskScoreSummary", () => {
  it("carries the whole summary under the fixed provider id", () => {
    const summary = { users: [{ email: "a@example.test", risk_level: "low" }] };
    const entity = projectCloudflareRiskScoreSummary({ accountId: ACCOUNT_ID, at: AT, summary });
    expect(entity.kind).toBe("risk-score-summary");
    expect(entity.providerId).toBe("risk-score-summary");
    expect(entity.source.operation).toBe("risk-scoring-summary-get");
    expect(entity.detail).toEqual({
      kind: "risk-score-summary",
      summary: { users: [{ email: "a@example.test", risk_level: "low" }] },
    });
  });
});

describe("projectCloudflareDexTest", () => {
  it("maps every field, keeping falsy-but-present values", () => {
    const test: DexTest = {
      description: "reach the intranet",
      enabled: false,
      host: "intranet.example.test",
      id: "test-1",
      interval: "0h30m0s",
      kind: "http",
      method: "GET",
      name: "intranet",
      target_policies: [{ default: true, id: "policy-1", name: "Default" }],
      targeted: false,
    };
    const entity = projectCloudflareDexTest({ accountId: ACCOUNT_ID, at: AT, test });
    expect(entity.kind).toBe("dex-test");
    expect(entity.providerId).toBe("test-1");
    expect(entity.source.operation).toBe("dex-tests-list");
    expect(entity.detail).toEqual({
      description: "reach the intranet",
      enabled: false,
      host: "intranet.example.test",
      interval: "0h30m0s",
      kind: "dex-test",
      method: "GET",
      name: "intranet",
      targetPolicies: [{ default: true, id: "policy-1", name: "Default" }],
      targeted: false,
      testKind: "http",
    });
  });

  it("stores every optional field as null when only the id is present", () => {
    const entity = projectCloudflareDexTest({ accountId: ACCOUNT_ID, at: AT, test: { id: "test-2" } });
    expect(entity.providerId).toBe("test-2");
    expect(entity.source.operation).toBe("dex-tests-list");
    expect(entity.detail).toEqual({
      description: null,
      enabled: null,
      host: null,
      interval: null,
      kind: "dex-test",
      method: null,
      name: null,
      targetPolicies: null,
      targeted: null,
      testKind: null,
    });
  });
});

describe("projectCloudflareDexFleetStatus", () => {
  it("keys a complete sample on device@timestamp and stores the whole sample", () => {
    // Telemetry beyond the two identity fields, so a projection keeping only its key would fail here.
    const sample = { colo: "MEL", deviceId: "device-1", status: "connected", timestamp: "2026-01-01T00:00:00Z" };
    const entity = projectCloudflareDexFleetStatus({ accountId: ACCOUNT_ID, at: AT, sample });
    expect(entity.kind).toBe("dex-fleet-status");
    expect(entity.providerId).toBe("device-1@2026-01-01T00:00:00Z");
    expect(entity.source.operation).toBe("dex-fleet-status-devices-list");
    expect(entity.detail).toEqual({
      kind: "dex-fleet-status",
      sample: { colo: "MEL", deviceId: "device-1", status: "connected", timestamp: "2026-01-01T00:00:00Z" },
    });
  });
});
