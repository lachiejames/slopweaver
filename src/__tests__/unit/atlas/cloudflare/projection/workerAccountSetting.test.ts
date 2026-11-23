import { describe, expect, it } from "vitest";

import { projectCloudflareWorkerAccountSetting } from "../../../../../atlas/cloudflare/projection/workerAccountSetting.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareWorkerAccountSetting", () => {
  it("projects both reads into one entity keyed by the account id", () => {
    const entity = projectCloudflareWorkerAccountSetting({
      accountId: ACCOUNT_ID,
      accountSetting: { default_usage_model: "standard", green_compute: true },
      at: AT,
      subdomain: { subdomain: "my-team" },
    });
    expect(entity.providerId).toBe(ACCOUNT_ID);
    expect(entity.detail).toEqual({
      defaultUsageModel: "standard",
      greenCompute: true,
      kind: "worker-account-setting",
      subdomain: "my-team",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareWorkerAccountSetting({
      accountId: ACCOUNT_ID,
      accountSetting: {},
      at: AT,
      subdomain: {},
    });
    expect(entity.detail).toEqual({
      defaultUsageModel: null,
      greenCompute: null,
      kind: "worker-account-setting",
      subdomain: null,
    });
  });
});
