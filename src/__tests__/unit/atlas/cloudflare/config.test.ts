import { describe, expect, it } from "vitest";

import { resolveCloudflareSelection } from "../../../../atlas/cloudflare/config.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const VALID_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

describe("resolveCloudflareSelection", () => {
  it("resolves from explicit flags", () => {
    const result = resolveCloudflareSelection({
      accountIdFlag: VALID_ACCOUNT_ID,
      deepZoneFlag: "Example.Test",
      env: {},
    });
    expect(unwrap(result)).toEqual({ accountId: VALID_ACCOUNT_ID, deepZoneName: "example.test" });
  });

  it("falls back to CLOUDFLARE_ACCOUNT_ID then CF_ACCOUNT_ID, in that order", () => {
    const result = resolveCloudflareSelection({
      deepZoneFlag: "z",
      env: { CF_ACCOUNT_ID: "1".repeat(32), CLOUDFLARE_ACCOUNT_ID: VALID_ACCOUNT_ID },
    });
    expect(unwrap(result).accountId).toBe(VALID_ACCOUNT_ID);
  });

  it("falls back to CLOUDFLARE_DEEP_ZONE", () => {
    const result = resolveCloudflareSelection({
      accountIdFlag: VALID_ACCOUNT_ID,
      env: { CLOUDFLARE_DEEP_ZONE: "example.test" },
    });
    expect(unwrap(result).deepZoneName).toBe("example.test");
  });

  it("prefers an explicit flag over the environment", () => {
    const result = resolveCloudflareSelection({
      accountIdFlag: VALID_ACCOUNT_ID,
      deepZoneFlag: "flag.test",
      env: { CLOUDFLARE_DEEP_ZONE: "env.test" },
    });
    expect(unwrap(result).deepZoneName).toBe("flag.test");
  });

  it("reports both missing selectors at once", () => {
    const errors = unwrapErr(resolveCloudflareSelection({ env: {} }));
    expect(errors.some((line) => line.includes("account id"))).toBe(true);
    expect(errors.some((line) => line.includes("deep zone"))).toBe(true);
  });

  it("rejects a malformed account id", () => {
    const errors = unwrapErr(resolveCloudflareSelection({ accountIdFlag: "not-an-id", deepZoneFlag: "z", env: {} }));
    expect(errors[0]).toContain("32-character hex id");
  });
});
