import { describe, expect, it } from "vitest";

import { credentialsAbsentClient } from "../../../../atlas/vanta/credentialsAbsentClient.js";
import { type VantaSurfaceError, vantaSurfaceCondition } from "../../../../atlas/vanta/surfaceErrors.js";
import { type Result, unwrapErr } from "../../../../lib/result.js";

describe("credentialsAbsentClient", () => {
  it("refuses every read with the credentials-absent grade, chosen where absence is known", async () => {
    const client = credentialsAbsentClient();
    const reads: readonly Result<unknown, VantaSurfaceError>[] = await Promise.all([
      client.listCensusFamily({ surface: "people" }),
      client.listChildSurface({ parentId: "p1", surface: "integration-resource-kinds" }),
      client.listControlsActive(),
      client.listControlsDeactivated(),
      client.listEventLog(),
      client.listEvidenceDocuments(),
      client.listKnowledgeBaseResources(),
      client.listPolicies(),
      client.listRisksEnterpriseRisk(),
      client.listRisksRiskScenario(),
      client.listVendors(),
    ]);
    expect(reads.length).toBe(11);
    expect(reads.map((read) => unwrapErr(read).code)).toEqual(Array(11).fill("API_CREDENTIAL_NOT_CONFIGURED"));
    expect(vantaSurfaceCondition({ error: unwrapErr(reads[0]!) })).toBe("api-credential-not-configured");
  });
});
