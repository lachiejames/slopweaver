import { describe, expect, it } from "vitest";

import { projectCloudflareDnsRecord } from "../../../../../atlas/cloudflare/projection/dnsRecord.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("projectCloudflareDnsRecord", () => {
  it("projects the stable fields and folds type-specific extras into the open config bucket", () => {
    const entity = projectCloudflareDnsRecord({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        comment: "primary MX",
        content: "mail.example.test",
        created_on: "2026-01-01T00:00:00Z",
        id: "record-1",
        modified_on: "2026-01-02T00:00:00Z",
        name: "example.test",
        priority: 10,
        proxiable: false,
        proxied: false,
        tags: ["prod"],
        ttl: 3600,
        type: "MX",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("record-1");
    expect(entity.detail).toEqual({
      comment: "primary MX",
      config: { priority: 10 },
      content: "mail.example.test",
      createdOn: "2026-01-01T00:00:00Z",
      kind: "dns-record",
      modifiedOn: "2026-01-02T00:00:00Z",
      name: "example.test",
      proxiable: false,
      proxied: false,
      tags: ["prod"],
      ttl: 3600,
      type: "MX",
    });
    expect(entity.scope).toEqual({ accountId: ACCOUNT_ID, parentId: null, zoneId: ZONE_ID });
  });

  it("carries the record's own tag list through, and a fresh empty one when it has none", () => {
    const tags = ["prod"];
    const tagged = projectCloudflareDnsRecord({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "r-1", tags },
      zoneId: ZONE_ID,
    });
    const bare = projectCloudflareDnsRecord({ accountId: ACCOUNT_ID, at: AT, raw: { id: "r-2" }, zoneId: ZONE_ID });
    expect((tagged.detail as { tags: unknown }).tags).toBe(tags);
    expect((bare.detail as { tags: unknown }).tags).toEqual([]);
  });

  it("defaults every missing stable field to null or empty, with an empty config bucket", () => {
    const entity = projectCloudflareDnsRecord({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "record-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      comment: null,
      config: {},
      content: null,
      createdOn: null,
      kind: "dns-record",
      modifiedOn: null,
      name: null,
      proxiable: null,
      proxied: null,
      tags: [],
      ttl: null,
      type: null,
    });
  });
});
