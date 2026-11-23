import { describe, expect, it } from "vitest";

import {
  isCloudflareFirewallServiceDetailOf,
  projectCloudflareFirewallFilter,
  projectCloudflareFirewallRule,
  projectCloudflareIpAccessRule,
  projectCloudflareLockdown,
  projectCloudflareRateLimit,
  projectCloudflareUaRule,
} from "../../../../../atlas/cloudflare/projection/firewallService.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("projectCloudflareFirewallFilter", () => {
  it("projects every field, prefixed provider id", () => {
    const entity = projectCloudflareFirewallFilter({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { description: "block bots", expression: "cf.threat_score gt 10", id: "f-1", paused: true, ref: "r-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("filter:f-1");
    expect(entity.detail).toEqual({
      description: "block bots",
      expression: "cf.threat_score gt 10",
      kind: "firewall-service",
      paused: true,
      ref: "r-1",
      subtype: "filter",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareFirewallFilter({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "f-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      description: null,
      expression: null,
      kind: "firewall-service",
      paused: null,
      ref: null,
      subtype: "filter",
    });
  });
});

describe("projectCloudflareFirewallRule", () => {
  it("projects every field, including the embedded filter id", () => {
    const entity = projectCloudflareFirewallRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        action: "block",
        description: "block bad actors",
        filter: { id: "f-1" },
        id: "r-1",
        paused: false,
        priority: 5,
        products: ["waf"],
        ref: "ref-1",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("firewall-rule:r-1");
    expect(entity.detail).toEqual({
      action: "block",
      description: "block bad actors",
      filterId: "f-1",
      kind: "firewall-service",
      paused: false,
      priority: 5,
      products: ["waf"],
      ref: "ref-1",
      subtype: "firewall-rule",
    });
  });

  it("defaults every missing field to null, including a null-filter reference", () => {
    const entity = projectCloudflareFirewallRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "r-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      action: null,
      description: null,
      filterId: null,
      kind: "firewall-service",
      paused: null,
      priority: null,
      products: [],
      ref: null,
      subtype: "firewall-rule",
    });
  });
});

describe("projectCloudflareIpAccessRule", () => {
  it("projects every field, including scope type", () => {
    const entity = projectCloudflareIpAccessRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        allowed_modes: ["block"],
        configuration: { target: "ip", value: "1.2.3.4" },
        created_on: "2025-01-01T00:00:00Z",
        id: "a-1",
        mode: "block",
        modified_on: "2025-02-01T00:00:00Z",
        notes: "known attacker",
        scope: { type: "user" },
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("ip-access-rule:a-1");
    expect(entity.detail).toEqual({
      allowedModes: ["block"],
      configuration: { target: "ip", value: "1.2.3.4" },
      createdOn: "2025-01-01T00:00:00Z",
      kind: "firewall-service",
      mode: "block",
      modifiedOn: "2025-02-01T00:00:00Z",
      notes: "known attacker",
      scopeType: "user",
      subtype: "ip-access-rule",
    });
  });

  it("defaults every missing field to null and an empty configuration", () => {
    const entity = projectCloudflareIpAccessRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "a-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      allowedModes: [],
      configuration: {},
      createdOn: null,
      kind: "firewall-service",
      mode: null,
      modifiedOn: null,
      notes: null,
      scopeType: null,
      subtype: "ip-access-rule",
    });
  });

  it("falls back to an empty configuration when the raw value is not a record", () => {
    const entity = projectCloudflareIpAccessRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { configuration: "not-a-record", id: "a-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      allowedModes: [],
      configuration: {},
      createdOn: null,
      kind: "firewall-service",
      mode: null,
      modifiedOn: null,
      notes: null,
      scopeType: null,
      subtype: "ip-access-rule",
    });
  });

  it("stores the rule's own allowed-modes list rather than a copy", () => {
    const allowedModes = ["block", "challenge"];
    const entity = projectCloudflareIpAccessRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { allowed_modes: allowedModes, id: "a-1" },
      zoneId: ZONE_ID,
    });
    expect((entity.detail as { allowedModes: unknown }).allowedModes).toBe(allowedModes);
  });

  it("stores a scope without a type as a null scope type", () => {
    const entity = projectCloudflareIpAccessRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "a-1", scope: {} },
      zoneId: ZONE_ID,
    });
    expect((entity.detail as { scopeType: unknown }).scopeType).toBe(null);
  });
});

describe("projectCloudflareUaRule", () => {
  it("copies a record configuration and keeps a paused false as false", () => {
    const configuration = { target: "ua", value: "curl" };
    const entity = projectCloudflareUaRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { configuration, id: "u-1", paused: false },
      zoneId: ZONE_ID,
    });
    const detail = entity.detail as { configuration: unknown; paused: unknown };
    expect(detail.configuration).not.toBe(configuration);
    expect({ configuration: detail.configuration, paused: detail.paused }).toEqual({ configuration, paused: false });
  });

  it("projects every field", () => {
    const entity = projectCloudflareUaRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        configuration: { target: "ua", value: "curl" },
        description: "block curl",
        id: "u-1",
        mode: "block",
        paused: false,
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("ua-rule:u-1");
    expect(entity.detail).toEqual({
      configuration: { target: "ua", value: "curl" },
      description: "block curl",
      kind: "firewall-service",
      mode: "block",
      paused: false,
      subtype: "ua-rule",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareUaRule({ accountId: ACCOUNT_ID, at: AT, raw: { id: "u-1" }, zoneId: ZONE_ID });
    expect(entity.detail).toEqual({
      configuration: {},
      description: null,
      kind: "firewall-service",
      mode: null,
      paused: null,
      subtype: "ua-rule",
    });
  });
});

describe("projectCloudflareLockdown", () => {
  it("projects every field", () => {
    const entity = projectCloudflareLockdown({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        configurations: [{ target: "ip", value: "1.2.3.4" }],
        created_on: "2025-01-01T00:00:00Z",
        description: "admin lockdown",
        id: "l-1",
        modified_on: "2025-02-01T00:00:00Z",
        paused: false,
        urls: ["example.test/admin*"],
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("lockdown:l-1");
    expect(entity.detail).toEqual({
      configurations: [{ target: "ip", value: "1.2.3.4" }],
      createdOn: "2025-01-01T00:00:00Z",
      description: "admin lockdown",
      kind: "firewall-service",
      modifiedOn: "2025-02-01T00:00:00Z",
      paused: false,
      subtype: "lockdown",
      urls: ["example.test/admin*"],
    });
  });

  it("defaults every missing field to null or empty", () => {
    const entity = projectCloudflareLockdown({ accountId: ACCOUNT_ID, at: AT, raw: { id: "l-1" }, zoneId: ZONE_ID });
    expect(entity.detail).toEqual({
      configurations: [],
      createdOn: null,
      description: null,
      kind: "firewall-service",
      modifiedOn: null,
      paused: null,
      subtype: "lockdown",
      urls: [],
    });
  });

  it("stores the lockdown's own url and configuration lists rather than copies", () => {
    const urls = ["example.test/admin*"];
    const configurations = [{ target: "ip", value: "1.2.3.4" }];
    const entity = projectCloudflareLockdown({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { configurations, id: "l-1", urls },
      zoneId: ZONE_ID,
    });
    const detail = entity.detail as { configurations: unknown; urls: unknown };
    expect(detail.urls).toBe(urls);
    expect(detail.configurations).toBe(configurations);
  });
});

describe("projectCloudflareRateLimit", () => {
  it("projects every field", () => {
    const entity = projectCloudflareRateLimit({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        action: { mode: "ban", timeout: 60 },
        bypass: [{ name: "url", value: "example.test/health" }],
        description: "throttle login",
        disabled: false,
        id: "rl-1",
        match: { request: { methods: ["POST"] } },
        period: 60,
        threshold: 10,
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("rate-limit:rl-1");
    expect(entity.detail).toEqual({
      action: { mode: "ban", timeout: 60 },
      bypass: [{ name: "url", value: "example.test/health" }],
      description: "throttle login",
      disabled: false,
      kind: "firewall-service",
      match: { request: { methods: ["POST"] } },
      period: 60,
      subtype: "rate-limit",
      threshold: 10,
    });
  });

  it("defaults every missing field to null or empty", () => {
    const entity = projectCloudflareRateLimit({ accountId: ACCOUNT_ID, at: AT, raw: { id: "rl-1" }, zoneId: ZONE_ID });
    expect(entity.detail).toEqual({
      action: {},
      bypass: [],
      description: null,
      disabled: null,
      kind: "firewall-service",
      match: {},
      period: null,
      subtype: "rate-limit",
      threshold: null,
    });
  });
});

describe("isCloudflareFirewallServiceDetailOf", () => {
  it("matches a detail of the exact requested subtype", () => {
    const entity = projectCloudflareFirewallFilter({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "f-1" },
      zoneId: ZONE_ID,
    });
    expect(isCloudflareFirewallServiceDetailOf({ subtype: "filter", value: entity.detail })).toBe(true);
  });

  it("rejects a detail of a different subtype", () => {
    const entity = projectCloudflareFirewallFilter({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "f-1" },
      zoneId: ZONE_ID,
    });
    expect(isCloudflareFirewallServiceDetailOf({ subtype: "lockdown", value: entity.detail })).toBe(false);
  });

  it("rejects a value that is not a record", () => {
    expect(isCloudflareFirewallServiceDetailOf({ subtype: "filter", value: "not-a-record" })).toBe(false);
  });
});
