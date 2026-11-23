import { describe, expect, it } from "vitest";

import { projectCloudflareZoneSetting } from "../../../../../atlas/cloudflare/projection/zoneSetting.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("projectCloudflareZoneSetting", () => {
  it("projects every field, keyed by the setting id", () => {
    const entity = projectCloudflareZoneSetting({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { editable: true, id: "always_online", modified_on: "2026-01-01T00:00:00Z", value: "off" },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("always_online");
    expect(entity.detail).toEqual({
      editable: true,
      kind: "zone-setting",
      modifiedOn: "2026-01-01T00:00:00Z",
      value: "off",
    });
  });

  it("keeps a nested object value as-is and defaults missing fields to null", () => {
    const entity = projectCloudflareZoneSetting({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "ciphers", value: ["ECDHE-ECDSA-AES128-GCM-SHA256"] },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      editable: null,
      kind: "zone-setting",
      modifiedOn: null,
      value: ["ECDHE-ECDSA-AES128-GCM-SHA256"],
    });
  });
});

describe("projectCloudflareZoneSetting across zones", () => {
  /** The measured shape: two zones return byte-identical sets of setting ids (`ssl`, `always_use_https`, …). */
  const SETTING_IDS = Array.from({ length: 56 }, (_, index) => `setting_${String(index)}`);
  const OTHER_ZONE_ID = "y".repeat(32);

  it("gives the same setting id in two zones two different entity ids", () => {
    const first = projectCloudflareZoneSetting({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "ssl", value: "full" },
      zoneId: ZONE_ID,
    });
    const second = projectCloudflareZoneSetting({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "ssl", value: "full" },
      zoneId: OTHER_ZONE_ID,
    });
    expect(first.providerId).toBe(second.providerId);
    expect(first.id).not.toBe(second.id);
  });

  it("keeps 56 settings in each of two zones distinct, rather than folding 112 onto 56", () => {
    const ids = [ZONE_ID, OTHER_ZONE_ID].flatMap((zoneId) =>
      SETTING_IDS.map(
        (id) => projectCloudflareZoneSetting({ accountId: ACCOUNT_ID, at: AT, raw: { id, value: "on" }, zoneId }).id,
      ),
    );
    expect(new Set(ids).size).toBe(112);
  });
});
