import { describe, expect, it } from "vitest";

import * as firewallService from "../../../../../atlas/cloudflare/projection/firewallService.js";
import {
  projectCloudflareFirewallFilter,
  projectCloudflareFirewallRule,
  projectCloudflareRateLimit,
} from "../../../../../atlas/cloudflare/projection/firewallServiceExpressionRules.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("the firewall-service expression-rules extraction", () => {
  it("is what the original projection module still exports", () => {
    expect([
      firewallService.projectCloudflareFirewallFilter,
      firewallService.projectCloudflareFirewallRule,
      firewallService.projectCloudflareRateLimit,
    ]).toEqual([projectCloudflareFirewallFilter, projectCloudflareFirewallRule, projectCloudflareRateLimit]);
  });
});

describe("projectCloudflareFirewallFilter", () => {
  it("keys the entity on its prefixed id and names the filters read as its source", () => {
    const entity = projectCloudflareFirewallFilter({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "f-1" },
      zoneId: ZONE_ID,
    });
    expect({ operation: entity.source.operation, providerId: entity.providerId, scope: entity.scope }).toEqual({
      operation: "firewall-service-filters-list",
      providerId: "filter:f-1",
      scope: { accountId: ACCOUNT_ID, parentId: null, zoneId: ZONE_ID },
    });
  });
});

describe("projectCloudflareFirewallRule", () => {
  it("stores a filter the provider sent as null, or one with no id, as a null filter id", () => {
    const nullFilter = projectCloudflareFirewallRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { filter: null, id: "r-1" },
      zoneId: ZONE_ID,
    });
    const idlessFilter = projectCloudflareFirewallRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { filter: {}, id: "r-2" },
      zoneId: ZONE_ID,
    });
    expect((nullFilter.detail as { filterId: unknown }).filterId).toBe(null);
    expect((idlessFilter.detail as { filterId: unknown }).filterId).toBe(null);
  });

  it("stores the rule's own products list rather than a copy", () => {
    const products = ["waf", "uaBlock"];
    const entity = projectCloudflareFirewallRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "r-1", products },
      zoneId: ZONE_ID,
    });
    expect((entity.detail as { products: unknown }).products).toBe(products);
  });
});

describe("projectCloudflareRateLimit", () => {
  it("copies a record action and match, keeps a disabled false as false, and names the rate-limits read", () => {
    const action = { mode: "ban" };
    const match = { request: { methods: ["POST"] } };
    const entity = projectCloudflareRateLimit({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { action, disabled: false, id: "rl-1", match },
      zoneId: ZONE_ID,
    });
    const detail = entity.detail as { action: unknown; disabled: unknown; match: unknown };
    expect(detail.action).not.toBe(action);
    expect(detail.match).not.toBe(match);
    expect({
      action: detail.action,
      disabled: detail.disabled,
      match: detail.match,
      operation: entity.source.operation,
    }).toEqual({ action, disabled: false, match, operation: "firewall-service-rate-limits-list" });
  });
});
