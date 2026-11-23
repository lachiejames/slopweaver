import { describe, expect, it } from "vitest";

import { projectCloudflareAccountSetting } from "../../../../../atlas/cloudflare/projection/accountSetting.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareAccountSetting", () => {
  it("projects every field, keyed by the account id", () => {
    const entity = projectCloudflareAccountSetting({
      account: {
        created_on: "2020-01-01T00:00:00Z",
        id: ACCOUNT_ID,
        managed_by: { parent_org_id: "org-1", parent_org_name: "Parent Org" },
        name: "ACME OPERATIONS PTY LTD",
        settings: { abuse_contact_email: "abuse@example.test", enforce_twofactor: true },
        type: "enterprise",
      },
      at: AT,
    });
    expect(entity.providerId).toBe(ACCOUNT_ID);
    expect(entity.detail).toEqual({
      abuseContactEmail: "abuse@example.test",
      createdOn: "2020-01-01T00:00:00Z",
      enforceTwoFactor: true,
      kind: "account-setting",
      name: "ACME OPERATIONS PTY LTD",
      parentOrgId: "org-1",
      parentOrgName: "Parent Org",
      type: "enterprise",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareAccountSetting({ account: { id: ACCOUNT_ID, name: "Acme" }, at: AT });
    expect(entity.detail).toEqual({
      abuseContactEmail: null,
      createdOn: null,
      enforceTwoFactor: null,
      kind: "account-setting",
      name: "Acme",
      parentOrgId: null,
      parentOrgName: null,
      type: null,
    });
  });
});
