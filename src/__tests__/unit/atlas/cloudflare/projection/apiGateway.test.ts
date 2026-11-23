import { describe, expect, it } from "vitest";

import {
  isCloudflareApiGatewayDetailOf,
  projectCloudflareApiGatewayConfiguration,
  projectCloudflareApiGatewayLabel,
  projectCloudflareApiGatewayOperation,
  projectCloudflareApiGatewaySettings,
  projectCloudflareDiscoveryOperation,
  projectCloudflareDiscoverySchemaCollection,
  projectCloudflareSchemaCollection,
  projectCloudflareUserSchema,
} from "../../../../../atlas/cloudflare/projection/apiGateway.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("projectCloudflareApiGatewayOperation", () => {
  it("projects stable fields and folds the rest into config", () => {
    const entity = projectCloudflareApiGatewayOperation({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        endpoint: "/users/{id}",
        host: "api.example.test",
        last_updated: "2026-01-01T00:00:00Z",
        method: "GET",
        operation_id: "op-1",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("operation:op-1");
    expect(entity.detail).toEqual({
      config: {},
      endpoint: "/users/{id}",
      host: "api.example.test",
      kind: "api-gateway",
      lastUpdated: "2026-01-01T00:00:00Z",
      method: "GET",
      subtype: "operation",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareApiGatewayOperation({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { operation_id: "op-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: {},
      endpoint: null,
      host: null,
      kind: "api-gateway",
      lastUpdated: null,
      method: null,
      subtype: "operation",
    });
  });

  it("keeps an unread field in config and leaves every read field out of it", () => {
    const entity = projectCloudflareApiGatewayOperation({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        endpoint: "/a",
        features: { thresholds: {} },
        host: "api.example.test",
        last_updated: "2026-01-01T00:00:00Z",
        method: "GET",
        operation_id: "op-1",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: { features: { thresholds: {} } },
      endpoint: "/a",
      host: "api.example.test",
      kind: "api-gateway",
      lastUpdated: "2026-01-01T00:00:00Z",
      method: "GET",
      subtype: "operation",
    });
  });
});

describe("projectCloudflareDiscoveryOperation", () => {
  it("projects every field", () => {
    const entity = projectCloudflareDiscoveryOperation({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        endpoint: "/orders",
        host: "api.example.test",
        id: "disc-1",
        last_updated: "2026-01-01T00:00:00Z",
        method: "POST",
        state: "review",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("discovery-operation:disc-1");
    expect(entity.detail).toEqual({
      config: {},
      endpoint: "/orders",
      host: "api.example.test",
      kind: "api-gateway",
      lastUpdated: "2026-01-01T00:00:00Z",
      method: "POST",
      state: "review",
      subtype: "discovery-operation",
    });
  });
});

describe("projectCloudflareDiscoverySchemaCollection / projectCloudflareSchemaCollection", () => {
  it("stores the whole schema array as one entity, each with a fixed provider id", () => {
    const discovery = projectCloudflareDiscoverySchemaCollection({
      accountId: ACCOUNT_ID,
      at: AT,
      schemas: [{ path: "/a" }],
      timestamp: "2026-01-01T00:00:00Z",
      zoneId: ZONE_ID,
    });
    expect(discovery.providerId).toBe("discovery-schema");
    expect(discovery.detail).toEqual({
      kind: "api-gateway",
      schema: { schemas: [{ path: "/a" }] },
      subtype: "discovery-schema",
      timestamp: "2026-01-01T00:00:00Z",
    });

    const schema = projectCloudflareSchemaCollection({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {},
      schemas: [],
      zoneId: ZONE_ID,
    });
    expect(schema.providerId).toBe("schema");
    expect(schema.detail).toEqual({ kind: "api-gateway", schema: { schemas: [] }, subtype: "schema", timestamp: null });
  });
});

describe("projectCloudflareApiGatewayLabel", () => {
  it("projects every field, keyed by name", () => {
    const entity = projectCloudflareApiGatewayLabel({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        created_at: "2025-01-01T00:00:00Z",
        description: "public API",
        last_updated: "2026-01-01T00:00:00Z",
        name: "public",
        source: "user",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("label:public");
    expect(entity.detail).toEqual({
      config: {},
      createdAt: "2025-01-01T00:00:00Z",
      description: "public API",
      kind: "api-gateway",
      lastUpdated: "2026-01-01T00:00:00Z",
      source: "user",
      subtype: "label",
    });
  });
});

describe("projectCloudflareApiGatewaySettings", () => {
  it("projects every field", () => {
    const entity = projectCloudflareApiGatewaySettings({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { validation_default_mitigation_action: "log", validation_override_mitigation_action: null },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("settings");
    expect(entity.detail).toEqual({
      kind: "api-gateway",
      subtype: "settings",
      validationDefaultMitigationAction: "log",
      validationOverrideMitigationAction: null,
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareApiGatewaySettings({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {},
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      kind: "api-gateway",
      subtype: "settings",
      validationDefaultMitigationAction: null,
      validationOverrideMitigationAction: null,
    });
  });
});

describe("projectCloudflareApiGatewayConfiguration", () => {
  it("projects the auth-id characteristics list", () => {
    const entity = projectCloudflareApiGatewayConfiguration({
      accountId: ACCOUNT_ID,
      at: AT,
      authIdCharacteristics: [{ name: "authorization", type: "header" }],
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("configuration");
    expect(entity.detail).toEqual({
      authIdCharacteristics: [{ name: "authorization", type: "header" }],
      kind: "api-gateway",
      subtype: "configuration",
    });
  });
});

describe("projectCloudflareUserSchema", () => {
  it("projects every field", () => {
    const entity = projectCloudflareUserSchema({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        created_at: "2026-01-01T00:00:00Z",
        kind: "openapi_v3",
        name: "public-api",
        schema_id: "sch-1",
        validation_enabled: true,
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("user-schema:sch-1");
    expect(entity.detail).toEqual({
      config: {},
      createdAt: "2026-01-01T00:00:00Z",
      kind: "api-gateway",
      name: "public-api",
      schemaKind: "openapi_v3",
      subtype: "user-schema",
      validationEnabled: true,
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareUserSchema({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { schema_id: "sch-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: {},
      createdAt: null,
      kind: "api-gateway",
      name: null,
      schemaKind: null,
      subtype: "user-schema",
      validationEnabled: null,
    });
  });
});

describe("isCloudflareApiGatewayDetailOf", () => {
  it("matches a detail of the exact requested subtype", () => {
    const entity = projectCloudflareApiGatewaySettings({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { validation_default_mitigation_action: "log", validation_override_mitigation_action: null },
      zoneId: ZONE_ID,
    });
    expect(isCloudflareApiGatewayDetailOf({ subtype: "settings", value: entity.detail })).toBe(true);
  });

  it("rejects a detail of a different subtype", () => {
    const entity = projectCloudflareApiGatewaySettings({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { validation_default_mitigation_action: "log", validation_override_mitigation_action: null },
      zoneId: ZONE_ID,
    });
    expect(isCloudflareApiGatewayDetailOf({ subtype: "label", value: entity.detail })).toBe(false);
  });

  it("rejects a value that is not a record", () => {
    expect(isCloudflareApiGatewayDetailOf({ subtype: "settings", value: "not-a-record" })).toBe(false);
  });
});
