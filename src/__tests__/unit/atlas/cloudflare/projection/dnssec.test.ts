import { describe, expect, it } from "vitest";

import { projectCloudflareDnssec } from "../../../../../atlas/cloudflare/projection/dnssec.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("projectCloudflareDnssec", () => {
  it("projects every field, keyed by the zone id", () => {
    const entity = projectCloudflareDnssec({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        algorithm: "8",
        digest: "abc123",
        digest_algorithm: "2",
        digest_type: "DS",
        dnssec_multi_signer: false,
        dnssec_presigned: false,
        dnssec_use_nsec3: false,
        ds: "example DS record",
        flags: 257,
        key_tag: 1,
        key_type: "RSASHA256",
        modified_on: "2026-01-01T00:00:00Z",
        public_key: "base64key",
        status: "active",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe(ZONE_ID);
    expect(entity.detail).toEqual({
      algorithm: "8",
      digest: "abc123",
      digestAlgorithm: "2",
      digestType: "DS",
      dnssecMultiSigner: false,
      dnssecPresigned: false,
      dnssecUseNsec3: false,
      ds: "example DS record",
      flags: 257,
      keyTag: 1,
      keyType: "RSASHA256",
      kind: "dnssec",
      modifiedOn: "2026-01-01T00:00:00Z",
      publicKey: "base64key",
      status: "active",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareDnssec({ accountId: ACCOUNT_ID, at: AT, raw: {}, zoneId: ZONE_ID });
    expect(entity.detail).toEqual({
      algorithm: null,
      digest: null,
      digestAlgorithm: null,
      digestType: null,
      dnssecMultiSigner: null,
      dnssecPresigned: null,
      dnssecUseNsec3: null,
      ds: null,
      flags: null,
      keyTag: null,
      keyType: null,
      kind: "dnssec",
      modifiedOn: null,
      publicKey: null,
      status: null,
    });
  });
});
