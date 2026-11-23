import { describe, expect, it } from "vitest";

import {
  extractCloudflareAccessPolicyBody,
  projectCloudflareAccessPolicy,
} from "../../../../../atlas/cloudflare/projection/accessPolicy.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("extractCloudflareAccessPolicyBody", () => {
  it("strips id, precedence, app_count and reusable, keeping the rest as config", () => {
    const body = extractCloudflareAccessPolicyBody({
      raw: {
        id: "pol-1",
        app_count: 2,
        decision: "allow",
        name: "Allow admins",
        precedence: 3,
        reusable: true,
        include: [{ email: {} }],
      },
    });
    expect(body).toEqual({ config: { include: [{ email: {} }] }, decision: "allow", name: "Allow admins" });
  });

  it("defaults a missing name and decision to null", () => {
    const body = extractCloudflareAccessPolicyBody({ raw: { id: "pol-1" } });
    expect(body).toEqual({ config: {}, decision: null, name: null });
  });
});

describe("projectCloudflareAccessPolicy", () => {
  it("sorts bindings by applicationId and derives referringApplicationIds from them", () => {
    const entity = projectCloudflareAccessPolicy({
      accountId: ACCOUNT_ID,
      at: AT,
      bindings: [
        { applicationId: "app-2", precedence: 1 },
        { applicationId: "app-1", precedence: null },
      ],
      body: { config: {}, decision: "allow", name: "Allow admins" },
      policyId: "pol-1",
      reusable: true,
    });
    const detail = entity.detail as {
      bindings: readonly { applicationId: string }[];
      referringApplicationIds: readonly string[];
    };
    expect(detail.bindings.map((binding) => binding.applicationId)).toEqual(["app-1", "app-2"]);
    expect(detail.referringApplicationIds).toEqual(["app-1", "app-2"]);
  });

  it("projects a reusable policy with no bindings", () => {
    const entity = projectCloudflareAccessPolicy({
      accountId: ACCOUNT_ID,
      at: AT,
      bindings: [],
      body: { config: {}, decision: "allow", name: "Unattached" },
      policyId: "pol-2",
      reusable: true,
    });
    expect(entity.kind).toBe("access-policy");
    expect(entity.providerId).toBe("pol-2");
  });
});
