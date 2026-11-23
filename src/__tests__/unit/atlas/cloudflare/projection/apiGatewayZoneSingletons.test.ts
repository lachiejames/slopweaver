import { describe, expect, it } from "vitest";

import * as apiGateway from "../../../../../atlas/cloudflare/projection/apiGateway.js";
import {
  projectCloudflareApiGatewayConfiguration,
  projectCloudflareApiGatewaySettings,
  projectCloudflareSchemaCollection,
} from "../../../../../atlas/cloudflare/projection/apiGatewayZoneSingletons.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("the api-gateway zone-singleton extraction", () => {
  it("is what the original projection module still exports", () => {
    expect([
      apiGateway.projectCloudflareApiGatewayConfiguration,
      apiGateway.projectCloudflareApiGatewaySettings,
      apiGateway.projectCloudflareSchemaCollection,
    ]).toEqual([
      projectCloudflareApiGatewayConfiguration,
      projectCloudflareApiGatewaySettings,
      projectCloudflareSchemaCollection,
    ]);
  });
});

describe("a zone-singleton entity", () => {
  it("is keyed on its subtype, scoped to the zone, and stamped with this run's instant", () => {
    const entity = projectCloudflareSchemaCollection({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { timestamp: "2026-01-01T00:00:00Z" },
      schemas: [{ path: "/a" }],
      zoneId: ZONE_ID,
    });
    expect({
      firstSeenAt: entity.firstSeenAt,
      kind: entity.kind,
      lastSeenAt: entity.lastSeenAt,
      providerId: entity.providerId,
      scope: entity.scope,
      source: entity.source,
      state: entity.state,
    }).toEqual({
      firstSeenAt: AT,
      kind: "api-gateway",
      lastSeenAt: AT,
      providerId: "schema",
      scope: { accountId: ACCOUNT_ID, parentId: null, zoneId: ZONE_ID },
      source: { channel: "rest-api", observedAt: AT, operation: "api-gateway-schemas-list" },
      state: "observed",
    });
  });
});

describe("projectCloudflareSchemaCollection", () => {
  it("carries the response's own timestamp and names the schemas read as its source", () => {
    const entity = projectCloudflareSchemaCollection({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { timestamp: "2026-02-01T00:00:00Z" },
      schemas: [{ path: "/b" }],
      zoneId: ZONE_ID,
    });
    expect({ detail: entity.detail, operation: entity.source.operation, providerId: entity.providerId }).toEqual({
      detail: {
        kind: "api-gateway",
        schema: { schemas: [{ path: "/b" }] },
        subtype: "schema",
        timestamp: "2026-02-01T00:00:00Z",
      },
      operation: "api-gateway-schemas-list",
      providerId: "schema",
    });
  });
});

describe("projectCloudflareApiGatewaySettings", () => {
  it("stores an override the provider sent as null, and an omitted default, as null", () => {
    const entity = projectCloudflareApiGatewaySettings({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { validation_override_mitigation_action: null },
      zoneId: ZONE_ID,
    });
    expect({ detail: entity.detail, operation: entity.source.operation }).toEqual({
      detail: {
        kind: "api-gateway",
        subtype: "settings",
        validationDefaultMitigationAction: null,
        validationOverrideMitigationAction: null,
      },
      operation: "api-gateway-settings-schema-validation-get",
    });
  });

  it("carries a present override through unchanged", () => {
    const entity = projectCloudflareApiGatewaySettings({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { validation_default_mitigation_action: "block", validation_override_mitigation_action: "none" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      kind: "api-gateway",
      subtype: "settings",
      validationDefaultMitigationAction: "block",
      validationOverrideMitigationAction: "none",
    });
  });
});

describe("projectCloudflareApiGatewayConfiguration", () => {
  it("stores an empty characteristic list as empty and names the configurations read as its source", () => {
    const entity = projectCloudflareApiGatewayConfiguration({
      accountId: ACCOUNT_ID,
      at: AT,
      authIdCharacteristics: [],
      zoneId: ZONE_ID,
    });
    expect({ detail: entity.detail, operation: entity.source.operation, providerId: entity.providerId }).toEqual({
      detail: { authIdCharacteristics: [], kind: "api-gateway", subtype: "configuration" },
      operation: "api-gateway-configurations-get",
      providerId: "configuration",
    });
  });
});
