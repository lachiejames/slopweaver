import { describe, expect, it } from "vitest";

import {
  type CloudflareWafOverrideDetail,
  type CloudflareWafPackageDetail,
  extractCloudflareLegacyWafChildren,
  isCloudflareWafOverrideDetail,
  isCloudflareWafPackageDetail,
  normalizeCloudflareLegacyWafChildItem,
  projectCloudflareWafOverride,
  projectCloudflareWafPackage,
} from "../../../../../atlas/cloudflare/projection/legacyWaf.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("normalizeCloudflareLegacyWafChildItem", () => {
  it("projects a group's every field", () => {
    const item = normalizeCloudflareLegacyWafChildItem({
      raw: {
        group: {
          allowed_modes: ["on", "off"],
          description: "OWASP core rules",
          id: "g-1",
          mode: "on",
          modified_rules_count: 2,
          name: "OWASP",
          package_id: "pkg-1",
          rules_count: 100,
        },
        itemKind: "group",
      },
    });
    expect(item).toEqual({
      group: {
        allowedModes: ["on", "off"],
        description: "OWASP core rules",
        id: "g-1",
        mode: "on",
        modifiedRulesCount: 2,
        name: "OWASP",
        rulesCount: 100,
      },
      itemKind: "group",
    });
  });

  it("defaults a group's missing fields to null or empty", () => {
    const item = normalizeCloudflareLegacyWafChildItem({ raw: { group: { id: "g-1" }, itemKind: "group" } });
    expect(item).toEqual({
      group: {
        allowedModes: [],
        description: null,
        id: "g-1",
        mode: null,
        modifiedRulesCount: null,
        name: null,
        rulesCount: null,
      },
      itemKind: "group",
    });
  });

  it("stores a group's null description as null", () => {
    const item = normalizeCloudflareLegacyWafChildItem({
      raw: { group: { description: null, id: "g-1" }, itemKind: "group" },
    });
    expect(item).toEqual({
      group: {
        allowedModes: [],
        description: null,
        id: "g-1",
        mode: null,
        modifiedRulesCount: null,
        name: null,
        rulesCount: null,
      },
      itemKind: "group",
    });
  });

  it("stores a rule's embedded group reference as null fields when the reference omits them", () => {
    const item = normalizeCloudflareLegacyWafChildItem({
      raw: { itemKind: "rule", rule: { allowed_modes: [], group: {}, id: "r-1" } },
    });
    expect(item).toEqual({
      itemKind: "rule",
      rule: {
        allowedModes: [],
        defaultMode: null,
        description: null,
        groupId: null,
        groupName: null,
        id: "r-1",
        mode: null,
        priority: null,
      },
    });
  });

  it("projects a rule's every field, including its embedded group reference", () => {
    const item = normalizeCloudflareLegacyWafChildItem({
      raw: {
        itemKind: "rule",
        rule: {
          allowed_modes: ["on", "off"],
          default_mode: "on",
          description: "SQL injection",
          group: { id: "g-1", name: "OWASP" },
          id: "r-1",
          mode: "on",
          package_id: "pkg-1",
          priority: "5",
        },
      },
    });
    expect(item).toEqual({
      itemKind: "rule",
      rule: {
        allowedModes: ["on", "off"],
        defaultMode: "on",
        description: "SQL injection",
        groupId: "g-1",
        groupName: "OWASP",
        id: "r-1",
        mode: "on",
        priority: "5",
      },
    });
  });

  it("defaults a rule's missing fields to null or empty", () => {
    const item = normalizeCloudflareLegacyWafChildItem({ raw: { itemKind: "rule", rule: { id: "r-1" } } });
    expect(item).toEqual({
      itemKind: "rule",
      rule: {
        allowedModes: [],
        defaultMode: null,
        description: null,
        groupId: null,
        groupName: null,
        id: "r-1",
        mode: null,
        priority: null,
      },
    });
  });
});

describe("projectCloudflareWafPackage", () => {
  it("stores the raw package (minus id) as open config, and splits combined children back apart", () => {
    const entity = projectCloudflareWafPackage({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [
        {
          group: {
            allowedModes: [],
            description: null,
            id: "g-1",
            mode: "on",
            modifiedRulesCount: null,
            name: "OWASP",
            rulesCount: 100,
          },
          itemKind: "group",
        },
        {
          itemKind: "rule",
          rule: {
            allowedModes: [],
            defaultMode: null,
            description: null,
            groupId: "g-1",
            groupName: "OWASP",
            id: "r-1",
            mode: "on",
            priority: "1",
          },
        },
      ],
      raw: { id: "pkg-1", sensitivity: "high", vendor: "cloudflare" },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("package:pkg-1");
    const detail = entity.detail as CloudflareWafPackageDetail;
    expect(detail.config).toEqual({ sensitivity: "high", vendor: "cloudflare" });
    expect(detail.groups).toHaveLength(1);
    expect(detail.rules).toHaveLength(1);
    expect(detail.groups[0]?.id).toBe("g-1");
    expect(detail.rules[0]?.id).toBe("r-1");
  });

  it("round-trips through extractCloudflareLegacyWafChildren", () => {
    const entity = projectCloudflareWafPackage({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [
        {
          group: {
            allowedModes: [],
            description: null,
            id: "g-1",
            mode: "on",
            modifiedRulesCount: null,
            name: "OWASP",
            rulesCount: 1,
          },
          itemKind: "group",
        },
      ],
      raw: { id: "pkg-1" },
      zoneId: ZONE_ID,
    });
    const detail = entity.detail as CloudflareWafPackageDetail;
    expect(extractCloudflareLegacyWafChildren({ detail })).toEqual([{ group: detail.groups[0], itemKind: "group" }]);
  });
});

describe("projectCloudflareWafOverride", () => {
  it("projects every field", () => {
    const entity = projectCloudflareWafOverride({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        description: "temporary bypass",
        groups: { "g-1": "disable" },
        id: "o-1",
        paused: false,
        priority: 1,
        rewrite_action: { block: "challenge" },
        rules: { "r-1": "block" },
        urls: ["example.test/*"],
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("override:o-1");
    expect(entity.detail).toEqual({
      description: "temporary bypass",
      groupActions: { "g-1": "disable" },
      itemKind: "override",
      kind: "legacy-waf",
      paused: false,
      priority: 1,
      rewriteAction: { block: "challenge" },
      ruleActions: { "r-1": "block" },
      urls: ["example.test/*"],
    });
  });

  it("stores a null description as null", () => {
    const entity = projectCloudflareWafOverride({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { description: null, id: "o-1" },
      zoneId: ZONE_ID,
    });
    expect((entity.detail as CloudflareWafOverrideDetail).description).toBeNull();
  });

  it("defaults every missing field to null or empty", () => {
    const entity = projectCloudflareWafOverride({ accountId: ACCOUNT_ID, at: AT, raw: { id: "o-1" }, zoneId: ZONE_ID });
    expect(entity.detail).toEqual({
      description: null,
      groupActions: {},
      itemKind: "override",
      kind: "legacy-waf",
      paused: null,
      priority: null,
      rewriteAction: null,
      ruleActions: {},
      urls: [],
    });
  });
});

describe("isCloudflareWafPackageDetail / isCloudflareWafOverrideDetail", () => {
  it("distinguishes a package detail from an override detail", () => {
    const packageEntity = projectCloudflareWafPackage({
      accountId: ACCOUNT_ID,
      at: AT,
      children: [],
      raw: { id: "pkg-1" },
      zoneId: ZONE_ID,
    });
    const overrideEntity = projectCloudflareWafOverride({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "o-1" },
      zoneId: ZONE_ID,
    });
    expect(isCloudflareWafPackageDetail(packageEntity.detail)).toBe(true);
    expect(isCloudflareWafPackageDetail(overrideEntity.detail)).toBe(false);
    expect(isCloudflareWafOverrideDetail(overrideEntity.detail)).toBe(true);
    expect(isCloudflareWafOverrideDetail(packageEntity.detail)).toBe(false);
  });

  it("rejects a value that is not a record", () => {
    expect(isCloudflareWafPackageDetail("not-a-record")).toBe(false);
    expect(isCloudflareWafOverrideDetail("not-a-record")).toBe(false);
  });
});
